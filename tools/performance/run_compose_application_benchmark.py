#!/usr/bin/env python3
"""Run real macOS page benchmarks, collect metrics, and optionally enforce a baseline.

python3 tools/performance/run_compose_application_benchmark.py --samples 8 --rows 20
No manually collected logs, diagnostic secrets, mock bridge or synthetic DSL required.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import shutil
import subprocess
import sys
import time

from analyze_compose_load import analyze, distribution

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'apps/flutter/app'
METRICS = ('firstFrameMs', 'loadMs', 'onLoadActionMs', 'onLoadFrameWaitMs',
           'firstFrameWaitMs', 'throughOnLoadFrameMs', 'hostThroughOnLoadObservedMs',
           'businessContentReadyObservedMs')


def summarize(data):
    groups = {}
    for raw in data.get('samples', []):
        parsed = analyze(raw['log'])
        complete = [sample for sample in parsed['samples']
                    if sample.get('firstFrameMs') is not None and sample.get('onLoadMs') is not None]
        if len(complete) != 1 or parsed['unmatched']:
            raise ValueError(f"Expected one correlated complete page load: {raw['workload']} #{raw['iteration']}")
        sample = {**complete[0], **{key: value for key, value in raw.items() if key != 'log'}}
        load = sample.get('loadMs')
        frame = sample['firstFrameMs']
        sample['phaseRatios'] = {
            'firstFrameWait': sample['firstFrameWaitMs'] / frame if frame else None,
            **{f"load:{name}": stage['durationMs'] / load if load else None
               for name, stage in sample['stages'].items()},
        }
        groups.setdefault(raw['workload'], []).append(sample)
    if not groups:
        raise ValueError('No application samples returned')
    summary = {}
    for workload, samples in groups.items():
        subsequent = [sample for sample in samples if not sample['firstObserved']]
        if not subsequent:
            raise ValueError('At least two repetitions are required')
        summary[workload] = {
            'firstObserved': samples[0],
            'samples': samples,
            'subsequent': {metric: distribution([sample.get(metric) for sample in subsequent])
                           for metric in METRICS},
            'phaseRatios': {key: distribution([sample['phaseRatios'].get(key) for sample in subsequent])
                            for key in {key for sample in subsequent for key in sample['phaseRatios']}},
            'frames': {metric: distribution([frame[metric] for sample in subsequent
                                             for frame in sample['frames']])
                       for metric in ('buildMs', 'rasterMs', 'totalSpanMs')},
        }
    return summary


def web_content_stages(data):
    """Keep browser intervals and wall-time observations separate; calls may overlap."""
    samples = []
    common = ('host-wait', 'dom-render')
    for sample in data.get('samples', []):
        timing = sample.get('webTiming')
        if timing is None:
            continue
        entries = {entry['name'].removeprefix('character-memory.'): entry
                   for entry in timing['entries']}
        required = common + (('load-screen',) if 'load-screen' in entries else ('theme', 'current-screen', 'snapshot'))
        missing = set(required + ('app-start', 'host-ready', 'content-ready')) - entries.keys()
        if missing:
            raise ValueError(f"Incomplete browser timing: {sorted(missing)}")
        app, ready = entries['app-start']['startTime'], entries['content-ready']['startTime']
        durations = {name: entries[name]['duration'] for name in required}
        durations['app-to-content'] = ready - app
        durations['navigation-to-app'] = app
        # Compare monotonic timestamps within the WebView; do not depend on
        # epoch alignment between WKWebView and Dart for the polling delay.
        durations['content-observation-delay'] = timing['observedAt'] - ready
        if 'businessContentReadyObservedMs' in sample:
            # Removes only the measured in-browser observation delay. Native
            # query/return overhead remains; this is not a GPU presentation metric.
            durations['mount-to-dom-estimate'] = sample['businessContentReadyObservedMs'] - durations['content-observation-delay']
        navigation = timing.get('navigation', [])
        if navigation:
            durations['document-response'] = navigation[0]['responseEnd'] - navigation[0]['responseStart']
        if any(value < 0 for value in durations.values()):
            raise ValueError('Browser timing contains a negative interval')
        samples.append({'workload': sample['workload'], 'iteration': sample['iteration'],
                        'firstObserved': sample['firstObserved'], 'durationsMs': durations})
    summary = {}
    for sample in samples:
        if not sample['firstObserved']:
            for name, value in sample['durationsMs'].items():
                summary.setdefault(sample['workload'], {}).setdefault(name, []).append(value)
    return {'samples': samples,
            'summary': {workload: {name: distribution(values) for name, values in stages.items()}
                        for workload, stages in summary.items()}}


def paired_workloads(data):
    """Compare prepared and unprepared paths within the same repetition."""
    pairs = {}
    for sample in data['samples']:
        if sample['firstObserved']:
            continue
        pairs.setdefault(sample['iteration'], {})[sample['workload']] = sample
    metrics = ('hostThroughOnLoadObservedMs', 'businessContentReadyObservedMs')
    samples = []
    for iteration, values in pairs.items():
        if 'sidebar-prepared' not in values or 'sidebar-unprepared' not in values:
            raise ValueError(f'Missing same-round sidebar comparison: {iteration}')
        prepared, unprepared = values['sidebar-prepared'], values['sidebar-unprepared']
        samples.append({'iteration': iteration, **{metric: {
            'preparedMs': prepared[metric], 'unpreparedMs': unprepared[metric],
            'ratio': prepared[metric] / unprepared[metric],
            'differenceMs': prepared[metric] - unprepared[metric],
        } for metric in metrics}})
    return {'scope': 'Matched same-process repetitions; both retain authoritative onLoad refresh. '
                     'Prepared data is a different workload, not a code-version baseline.',
            'samples': samples,
            'summary': {metric: {
                'ratio': distribution([sample[metric]['ratio'] for sample in samples]),
                'differenceMs': distribution([sample[metric]['differenceMs'] for sample in samples]),
            } for metric in metrics}}



def pipeline_stages(data, raw_log):
    """Attribute measured stage intervals to the real sample wall-clock window.

    js-send-inclusive contains JS-to-Rust conversion and typed response delivery;
    it must not be added to its children. Millisecond JS clocks are lower precision.
    """
    pattern = re.compile(r'event=compose_pipeline_stage\s+((?:(?!event=compose_pipeline_stage)[^\r\n])+)')
    events = []
    for match in pattern.finditer(raw_log):
        fields = dict(re.findall(r'(\w+)=([^\s]+)', match.group(1)))
        if not all(key in fields for key in ('stage', 'durationMs', 'wallMicros')):
            raise ValueError(f'Incomplete pipeline trace line: {match.group(0)}')
        event = {'stage': fields['stage'], 'durationMs': float(fields['durationMs']),
                 'wallMicros': int(fields['wallMicros'])}
        for key in ('bytes', 'nodes', 'revision', 'directStringBytes'):
            if key in fields:
                event[key] = int(fields[key])
        event.update({key: fields[key] for key in ('call', 'request', 'context') if key in fields})
        events.append(event)
    groups = {}
    for sample in data['samples']:
        start, end = sample['startedWallMicros'], sample['finishedWallMicros']
        sample_events = [event for event in events if start <= event['wallMicros'] <= end]
        frame_match = re.search(r'event=compose_first_tree_frame[^\n]*?wallMicros=(\d+)', sample['log'])
        frame_end = int(frame_match.group(1)) if frame_match else None
        first_render_events = [event for event in sample_events if frame_end is not None and event['wallMicros'] <= frame_end]
        sample['pipelineStages'] = {'events': sample_events, 'beforeFirstFrame': first_render_events}
        if sample['firstObserved']:
            continue
        row = groups.setdefault(sample['workload'], {'beforeFirstFrame': {}, 'throughContent': {}})
        for scope, scoped in (('beforeFirstFrame', first_render_events), ('throughContent', sample_events)):
            for stage in {event['stage'] for event in scoped}:
                measured = [event for event in scoped if event['stage'] == stage]
                fields = row[scope].setdefault(stage, {'durationMs': [], 'calls': [], 'bytes': [], 'directStringBytes': [], 'nodes': []})
                fields['durationMs'].append(sum(event['durationMs'] for event in measured))
                fields['calls'].append(len(measured))
                for key in ('bytes', 'directStringBytes', 'nodes'):
                    if any(key in event for event in measured):
                        fields[key].append(sum(event.get(key, 0) for event in measured))
    return {'scope': 'Measured durations summed per mount, then p50/p95 across subsequent mounts. '
                    'js-send-inclusive contains js-to-rust and rust-typed-response; do not add them twice. '
                    'js-stage-invoke_target_function also contains synchronous render/commit/send. '
                    'JS clocks have 1ms precision. Wall-clock attribution assumes a stable system clock. '
                    'Unmeasured gaps include scheduling, bridge transfer and frame waiting.',
            'eventCount': len(events),
            'summary': {workload: {scope: {stage: {key: distribution(values) for key, values in fields.items() if values}
                        for stage, fields in stages.items()} for scope, stages in row.items()}
                        for workload, row in groups.items()}}

def validate_pipeline_capture(data):
    """Require every page's native stages and a complete declared decode path."""
    required = {'rust-to-js-input', 'js-render-sync', 'js-retained-commit', 'js-send-inclusive',
                'js-to-rust', 'rust-typed-response', 'rust-core-value', 'rust-messagepack',
                'dart-node-apply'}
    incremental = {'dart-messagepack', 'dart-watch-read', 'dart-watch-retain', 'dart-watch-reencode'}
    for sample in data['samples']:
        actual = {event['stage'] for event in sample['pipelineStages']['beforeFirstFrame']}
        missing = required - actual
        if 'dart-stream-messagepack' not in actual:
            missing |= incremental - actual
        if missing:
            raise ValueError(f"Incomplete pipeline capture for {sample['workload']} #{sample['iteration']}: {sorted(missing)}")


def power_source(value):
    """Ignores the changing battery estimate while retaining AC-vs-battery identity."""
    match = re.search(r"Now drawing from ['\"]([^'\"]+)['\"]", value)
    return match.group(1) if match else value.strip()


def compare(current, baseline, allowed_percent):
    """Compare only matching workloads/environments; missing data is an error."""
    if bool(current.get('traceStages')) != bool(baseline.get('traceStages')):
        raise ValueError('Baseline tracing differs; trace runs are diagnostic, not optimization comparisons')
    for field in ('rows', 'repetitions', 'mode', 'view', 'totalCards'):
        if current.get(field) != baseline.get(field):
            raise ValueError(f'Baseline configuration differs: {field}')
    for field in ('platform', 'machine', 'flutter'):
        if current['environment'].get(field) != baseline['environment'].get(field):
            raise ValueError(f'Baseline environment differs: {field}')
    if power_source(current['environment']['power']) != power_source(baseline['environment']['power']):
        raise ValueError('Baseline power source/state differs; rerun under the same conditions')
    comparison = []
    for workload, row in current['summary'].items():
        previous = baseline['summary'].get(workload)
        if previous is None:
            raise ValueError(f'Missing baseline workload {workload}')
        for metric in ('firstFrameMs', 'throughOnLoadFrameMs', 'businessContentReadyObservedMs'):
            now = row['subsequent'][metric]['p50']
            old = previous['subsequent'][metric]['p50']
            percent = (now / old - 1) * 100 if old else None
            comparison.append({'workload': workload, 'metric': metric,
                               'baselineMs': old, 'currentMs': now, 'changePercent': percent,
                               'passed': percent is not None and percent <= allowed_percent})
    # Older reports have only host observations; compare browser metrics only
    # when both binaries expose the same measured completion boundaries.
    browser_now = current.get('webContentStages', {}).get('summary', {})
    browser_old = baseline.get('webContentStages', {}).get('summary', {})
    for workload, stages in browser_now.items():
        for metric in ('app-to-content', 'mount-to-dom-estimate'):
            previous = browser_old.get(workload, {}).get(metric)
            if metric not in stages or previous is None:
                continue
            now, old = stages[metric]['p50'], previous['p50']
            percent = (now / old - 1) * 100 if old else None
            comparison.append({'workload': workload, 'metric': 'web:' + metric,
                               'baselineMs': old, 'currentMs': now, 'changePercent': percent,
                               'passed': percent is not None and percent <= allowed_percent})
    return comparison


def markdown(report):
    lines = ['# 真实 macOS DSL 页面性能', '',
             f"模式：{report['mode']}；每项 {report['repetitions']} 次；实际角色卡和聊天各 {report['rows']} 条。", '',
             '首个样本单列；下表 p50/p95 仅统计后续打开。单位 ms。', '',
             '| 页面 | 首次首帧 | 首帧 p50 / p95 | 加载 p50 | onLoad 动作 p50 | 首帧等待占比 p50 | 内容完成 p50 | build p95 | raster p95 |',
             '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for name, row in report['summary'].items():
        stats = row['subsequent']
        frame = stats['firstFrameMs']
        ratio = row['phaseRatios']['firstFrameWait']['p50']
        build, raster = row['frames']['buildMs'], row['frames']['rasterMs']
        lines.append(f"| {name} | {row['firstObserved']['firstFrameMs']:.1f} | "
                     f"{frame['p50']:.1f} / {frame['p95']:.1f} | {stats['loadMs']['p50']:.1f} | "
                     f"{stats['onLoadActionMs']['p50']:.1f} | {ratio:.1%} | "
                     f"{stats['businessContentReadyObservedMs']['p50']:.1f} | {build['p95'] if build else '—'} | {raster['p95'] if raster else '—'} |")
    lines += ['', '所有阶段比例来自同一个样本；阶段可能重叠，不能相加。',
              '内容完成：侧栏验证真实角色名称；主页面通过原生 WebView 查询 DOM，验证全部测试角色卡已呈现。'
              '主页面 readiness 以 50ms 间隔观察，onLoad 以 20ms 间隔观察；保留独立指标。',
              '原生 FrameTiming 是引擎 build/raster，首树帧和 onLoad 帧不代表 GPU 展示。',
              '测试使用真实生产页面宿主、原生插件、工具链路和存储，独立目录、普通平台密钥存储；'
              '客户端日志使用内存 sink，未启动完整 Operit 主窗口壳。',
              '不同轮的基线比较仍受机器负载影响；需相同供电、尺寸、数据量和模式。']
    if report.get('imageCopies'):
        lines += ['', '| 页面 | 图片控件 p50 | 唯一 MemoryImage p50 | 唯一 VFS ImageProvider p50 | 内存图片字节 p50 |',
                  '| --- | ---: | ---: | ---: | ---: |']
        for workload, values in report['imageCopies'].items():
            if all(values.get(key) for key in ('imageWidgets', 'uniqueMemoryImages', 'memoryImageBytes')):
                lines.append(f"| {workload} | {values['imageWidgets']['p50']:.0f} | "
                             f"{values['uniqueMemoryImages']['p50']:.0f} | "
                             f"{values.get('uniqueVfsImages', {}).get('p50', 0):.0f} | {values['memoryImageBytes']['p50']:.0f} |")
        lines += ['', '图片副本在内容完成观察点统计；0 可能表示异步图片控件尚未发布，不作为图片就绪证明。']
    if report.get('webContentStages', {}).get('summary'):
        lines += ['', '## WebView 内容阶段', '',
                  '读取浏览器 User Timing 和 Navigation Timing；接口调用阶段可能重叠，不能相加。'
                  'DOM 渲染表示同步 DOM 更新，不代表 GPU 展示；头像不参与内容完成条件。'
                  'mount-to-dom-estimate 从宿主观测总耗时扣除浏览器内观测延迟，仍包含查询返回开销。', '',
                  '| 页面 | 步骤 | p50 / p95 (ms) |', '| --- | --- | ---: |']
        for workload, stages in report['webContentStages']['summary'].items():
            for name, stats in stages.items():
                lines.append(f"| {workload} | {name} | {stats['p50']:.3f} / {stats['p95']:.3f} |")
    if report.get('pipelineStages'):
        lines += ['', '## 实测链路细分（诊断模式）', '', report['pipelineStages']['scope'], '',
                  '| 页面 | 首帧前步骤 | 累计耗时 p50 / p95 (ms) | 次数 p50 | 字节数 p50 |',
                  '| --- | --- | ---: | ---: | ---: |']
        for workload, scopes in report['pipelineStages']['summary'].items():
            for stage, fields in sorted(scopes['beforeFirstFrame'].items(), key=lambda item: -item[1]['durationMs']['p50']):
                duration = fields['durationMs']
                byte_count = fields.get('bytes', fields.get('directStringBytes', {})).get('p50', '—')
                lines.append(f"| {workload} | {stage} | {duration['p50']:.3f} / {duration['p95']:.3f} | {fields['calls']['p50']:.0f} | {byte_count} |")
    if 'toolCallPolicies' in report:
        lines += ['', f"工具调用策略：{report['toolCallPolicies']}；工具 lifecycle hook 次数：{report['toolHookLogCount']}。"]
    if report.get('comparison'):
        lines += ['', '| 页面 | 指标 | 基线 p50 | 当前 p50 | 变化 | 门限 |',
                  '| --- | --- | ---: | ---: | ---: | --- |']
        for item in report['comparison']:
            lines.append(f"| {item['workload']} | {item['metric']} | {item['baselineMs']:.1f} | "
                         f"{item['currentMs']:.1f} | {item['changePercent']:+.1f}% | "
                         f"{'PASS' if item['passed'] else 'FAIL'} |")
    return '\n'.join(lines) + '\n'


def capture(command):
    process = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=10)
    return process.stdout.strip() if process.returncode == 0 else f'unavailable: {process.stderr.strip()}'


def generated_proxy_hashes():
    """Fingerprint the generated Dart inputs consumed by Flutter compilation."""
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted((APP / 'lib/core/proxy/generated').glob('*.dart'))}


def run_logged_command(command, cwd, log_path, environment):
    """Bound the whole command group while retaining its build/test output."""
    with log_path.open('w') as log:
        process = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                                   env=environment, start_new_session=True)
        started = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic() - started > 1200:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                    raise TimeoutError(f'Command timed out after 20 minutes; see {log_path}')
                time.sleep(1)
        except BaseException:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=10)
            raise
    return {'exitCode': process.returncode, 'durationSeconds': time.monotonic() - started,
            'command': command}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=8)
    parser.add_argument('--rows', type=int, default=20)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--application-binary', type=Path,
                        help='Run an already built benchmark .app with its baked sample/row settings')
    parser.add_argument('--trace-stages', action='store_true', help='Measure production JS, Rust, Link and Dart pipeline phases')
    parser.add_argument('--save-binary', action='store_true', help='Save the benchmark .app beside the report for controlled reruns')
    parser.add_argument('--baseline', type=Path, help='Previous report.json from the same configuration')
    parser.add_argument('--max-regression-percent', type=float, default=15)
    parser.add_argument('--mode', choices=('profile', 'debug'), default='profile')
    args = parser.parse_args()
    if platform.system() != 'Darwin':
        parser.error('This benchmark requires the production macOS host')
    if args.samples < 2 or args.rows < 1:
        parser.error('--samples >= 2 and --rows >= 1 required')
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    output = (args.output or ROOT / 'target/dsl-performance/application' / stamp).resolve()
    output.mkdir(parents=True, exist_ok=True)
    for stale in ('application.json', 'report.json', 'report.md'):
        (output / stale).unlink(missing_ok=True)
    environment = {'platform': platform.platform(), 'machine': platform.machine(),
                   'power': capture(['pmset', '-g', 'batt']).splitlines()[0],
                   'flutter': capture(['flutter', '--version']),
                   'revision': capture(['git', 'rev-parse', 'HEAD']),
                   'workingChanges': capture(['git', 'status', '--short']),
                   'thermal': capture(['pmset', '-g', 'therm']),
                   'loadAverage': capture(['uptime'])}
    (output / 'environment.json').write_text(json.dumps(environment, indent=2) + '\n')
    source_paths = subprocess.check_output(
        ['git', 'diff', '--name-only', 'HEAD', '-z'], cwd=ROOT).decode().split('\0')
    environment['changedSourceSha256'] = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
                                          for path in source_paths if path and (ROOT / path).is_file()}
    command = ['flutter', 'drive', '-d', 'macos', f'--{args.mode}',
               '--target=integration_test/compose_performance_test.dart',
               '--driver=test_driver/compose_performance_driver.dart',
               f'--dart-define=OPERIT_PERFORMANCE_SAMPLES={args.samples}',
               f'--dart-define=OPERIT_PERFORMANCE_ROWS={args.rows}']
    if args.trace_stages:
        command += ['--dart-define=OPERIT_PROFILE_COMPOSE_STAGES=true']
    if args.application_binary:
        command += [f'--use-application-binary={args.application_binary.resolve()}']
    if not args.application_binary:
        # Xcode builds native code alongside Dart. Generate proxy sources first
        # so the AOT compiler sees the current generator's output on this build.
        prepare_command = ['/bin/sh', str(APP / 'macos/build_rust_bridge.sh')]
        print('Preparing production native bridge and proxy sources:', output / 'native-prepare.log', flush=True)
        preparation = run_logged_command(prepare_command, APP, output / 'native-prepare.log',
                                         {**os.environ, 'PROJECT_DIR': str(APP / 'macos'),
                                          'ARCHS': 'arm64 x86_64'})
        environment['nativePreparation'] = preparation
        (output / 'environment.json').write_text(json.dumps(environment, indent=2) + '\n')
        if preparation['exitCode']:
            print((output / 'native-prepare.log').read_text(errors='replace')[-10000:], file=sys.stderr)
            return preparation['exitCode']
    if not args.application_binary:
        environment['generatedProxyBeforeBuild'] = generated_proxy_hashes()
    print('Running real application benchmark. Build and test log:', output / 'run.log', flush=True)
    result = run_logged_command(command, APP, output / 'run.log',
                                {**os.environ, 'OPERIT_PERFORMANCE_OUTPUT': str(output),
                                 **({'OPERIT_PROFILE_COMPOSE_STAGES': '1'} if args.trace_stages else {})})
    environment['powerAfterRun'] = capture(['pmset', '-g', 'batt']).splitlines()[0]
    environment['thermalAfterRun'] = capture(['pmset', '-g', 'therm'])
    (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    (output / 'environment.json').write_text(json.dumps(environment, indent=2) + '\n')
    if args.save_binary and result['exitCode'] == 0:
        binary = args.application_binary or APP / f'build/macos/Build/Products/{args.mode.title()}/Operit2.app'
        shutil.copytree(binary, output / 'benchmark.app', dirs_exist_ok=True)
    if result['exitCode']:
        print((output / 'run.log').read_text(errors='replace')[-10000:], file=sys.stderr)
        return result['exitCode']
    if not args.application_binary:
        environment['generatedProxyAfterBuild'] = generated_proxy_hashes()
        (output / 'environment.json').write_text(json.dumps(environment, indent=2) + '\n')
        if environment['generatedProxyBeforeBuild'] != environment['generatedProxyAfterBuild']:
            raise ValueError('Generated Dart proxy changed during compilation; refuse stale-build metrics')
    data = json.loads((output / 'application.json').read_text())
    for field, expected in (('rows', args.rows), ('repetitions', args.samples), ('mode', args.mode)):
        if data.get(field) != expected:
            raise ValueError(f'Application binary settings differ: {field}')
    if power_source(environment['powerAfterRun']) != power_source(environment['power']):
        raise ValueError('Power source changed during benchmark; rerun in stable conditions')
    data['environment'] = environment
    raw_log = (output / 'run.log').read_text(errors='replace')
    data['toolHookLogCount'] = analyze(raw_log)['lifecycleLogCount']
    policies = re.findall(r'tool.execute.request .*?policy=(\w+)', raw_log)
    data['toolCallPolicies'] = {policy: policies.count(policy) for policy in set(policies)}
    if data['toolHookLogCount']:
        raise ValueError('Direct business calls unexpectedly triggered tool lifecycle hooks')
    if bool(data.get('traceStages')) != args.trace_stages:
        raise ValueError('Application binary tracing settings differ')
    if args.trace_stages:
        data['pipelineStages'] = pipeline_stages(data, raw_log)
        validate_pipeline_capture(data)
    if data.get('wirePayloads'):
        payload_dir = output / 'wire-payloads'
        payload_dir.mkdir(exist_ok=True)
        for payload in data['wirePayloads']:
            source = Path(payload['path'])
            if source.stat().st_size != payload['bytes']:
                raise ValueError(f"Captured payload size differs: {source}")
            destination = payload_dir / source.name
            shutil.copyfile(source, destination)
            payload['path'] = str(destination)
            payload['sha256'] = hashlib.sha256(destination.read_bytes()).hexdigest()
    data['summary'] = summarize(data)
    data['webContentStages'] = web_content_stages(data)
    data['imageCopies'] = {workload: {key: distribution([sample.get(key) for sample in row['samples']
        if not sample['firstObserved']]) for key in ('imageWidgets', 'uniqueMemoryImages', 'uniqueVfsImages', 'memoryImageBytes')}
        for workload, row in data['summary'].items()}
    data['pairedWorkloads'] = paired_workloads(data)
    if args.baseline:
        data['comparison'] = compare(data, json.loads(args.baseline.read_text()), args.max_regression_percent)
    (output / 'report.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    (output / 'report.md').write_text(markdown(data))
    print(markdown(data))
    print('Report:', output / 'report.json')
    return int(any(not item['passed'] for item in data.get('comparison', [])))


if __name__ == '__main__':
    sys.exit(main())
