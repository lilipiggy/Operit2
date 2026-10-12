#!/usr/bin/env python3
"""Correlate DSL load stages, first frames and onLoad from application logs.

Usage: python3 tools/performance/analyze_compose_load.py run.log \
    --baseline previous.log --output target/dsl-performance/application-load
Stage durations may overlap. Quantiles are calculated from per-load samples,
never by adding phase quantiles. Missing measurements remain unknown.
"""
import argparse
import json
import math
import re
from pathlib import Path


FIELDS = re.compile(r'(\w+)=([^\s]+)')
NUMERIC = ('stepMs', 'totalMs', 'elapsedMs', 'queueMs', 'startedAfterMs',
           'frameWaitMs', 'actionMs')


def distribution(values):
    ordered = sorted(value for value in values if value is not None)
    if not ordered:
        return None
    return {'n': len(ordered), 'p50': ordered[math.ceil(len(ordered) * .5) - 1],
            'p95': ordered[math.ceil(len(ordered) * .95) - 1],
            'min': ordered[0], 'max': ordered[-1]}


def route_id(package, route):
    prefix = f'toolpkg:{package}:ui:'
    return route[len(prefix):] if route.startswith(prefix) else route


def analyze(text):
    loads, active, identities, contexts, last_open = [], {}, {}, {}, {}
    first_frames = {}
    unmatched = []
    lifecycle_count = 0
    for line_number, line in enumerate(text.splitlines(), 1):
        lifecycle_count += int('tool_lifecycle.run.' in line)
        fields = dict(FIELDS.findall(line))
        event = fields.get('event', '')
        if not event.startswith('compose_'):
            continue
        for name in NUMERIC:
            if name in fields:
                fields[name] = float(fields[name])
        package = fields.get('package')
        if event in ('compose_load_begin', 'compose_load_stage'):
            route = route_id(package, fields['route'])
            key = (package, route)
            identity = (fields.get('context'), fields.get('load'))
            sample = identities.get(identity) if identity[0] else active.get(key)
            stage = fields.get('stage')
            if (sample is None or event == 'compose_load_begin' or
                    (not identity[0] and (sample.get('firstFrameMs') is not None or
                                         stage in sample['stages']))):
                sample = {'package': package, 'route': route, 'line': line_number,
                          'context': fields.get('context'), 'load': fields.get('load'),
                          'updateInputs': fields.get('updateInputs') == 'true',
                          'stages': {}}
                loads.append(sample)
                active[key] = sample
                if identity[0]:
                    identities[identity] = sample
                    contexts[identity[0]] = sample
            if event == 'compose_load_begin':
                sample['queueMs'] = fields.get('queueMs')
                sample['startedAfterMs'] = fields.get('startedAfterMs')
            else:
                sample['stages'][stage] = {'durationMs': fields['stepMs'],
                                           'endMs': fields['totalMs']}
                if stage == 'open-session':
                    last_open[package] = sample
                if stage == 'render-command':
                    sample['loadMs'] = fields['totalMs']
        elif event == 'compose_session_open':
            sample = contexts.get(fields.get('context')) or last_open.get(package)
            if sample is not None:
                contexts[fields['context']] = sample
                sample['context'] = fields['context']
        elif event == 'compose_first_tree_frame':
            sample = identities.get((fields.get('context'), fields.get('load')))
            if sample is None:
                sample = active.get((package, route_id(package, fields['route'])))
            if sample is None:
                unmatched.append({'line': line_number, 'event': event})
                continue
            if sample.get('context'):
                first_frames[sample['context']] = sample
            sample['firstFrameMs'] = fields['elapsedMs']
            sample['firstFrameWaitMs'] = fields.get('frameWaitMs')
            sample['prepared'] = fields.get('prepared') == 'true'
            sample['tickerEnabled'] = fields.get('tickerEnabled') == 'true'
        elif event == 'compose_onload_frame':
            context = fields.get('context')
            sample = first_frames.get(context) or contexts.get(context)
            if sample is None:
                unmatched.append({'line': line_number, 'event': event})
                continue
            sample['onLoadMs'] = fields['elapsedMs']
            sample['onLoadActionMs'] = fields.get('actionMs')
            sample['onLoadFrameWaitMs'] = fields.get('frameWaitMs')
    grouped = {}
    for sample in loads:
        if sample.get('firstFrameMs') is not None and sample.get('loadMs') is not None:
            sample['outsideLoadMs'] = round(sample['firstFrameMs'] - sample['loadMs'], 3)
        if sample.get('firstFrameMs') is not None and sample.get('onLoadMs') is not None:
            sample['throughOnLoadFrameMs'] = sample['firstFrameMs'] + sample['onLoadMs']
        # Keep incomplete loads, updates and hidden surfaces out of visible-first-frame distributions.
        if (sample.get('firstFrameMs') is None or sample['updateInputs'] or
                not sample.get('tickerEnabled', True)):
            continue
        key = f"{sample['package']}:{sample['route']}"
        grouped.setdefault(key, []).append(sample)
    summaries = {}
    metrics = ('loadMs', 'firstFrameMs', 'onLoadMs', 'throughOnLoadFrameMs',
               'queueMs', 'startedAfterMs', 'firstFrameWaitMs', 'onLoadActionMs',
               'onLoadFrameWaitMs', 'outsideLoadMs')
    for key, samples in grouped.items():
        summaries[key] = {
            'observations': len(samples),
            'firstObserved': {metric: samples[0].get(metric) for metric in metrics},
            'all': {metric: distribution([sample.get(metric) for sample in samples])
                    for metric in metrics},
            'subsequent': {metric: distribution([sample.get(metric) for sample in samples[1:]])
                           for metric in metrics},
        }
    return {'scope': 'Application log observations; first tree frame is not GPU presentation. '
                     'First observed load is not necessarily a cold runtime. '
                     'throughOnLoadFrameMs approximates initial onLoad completion, not WebView readiness. '
                     'outsideLoadMs includes all time before/after measured loading; it is not solely frame work.',
            'samples': loads, 'summary': summaries, 'unmatched': unmatched,
            'lifecycleLogCount': lifecycle_count}


def markdown(report, baseline=None):
    lines = ['# DSL 加载诊断', '', '单位：ms。分阶段耗时可能重叠，不相加分位数。', '',
             '| 页面 | 样本数 | 首帧 p50 / p95 | 后续打开首帧 p50 | 加载流程 p50 | onLoad p50 |',
             '| --- | ---: | ---: | ---: | ---: | ---: |']
    def cell(stats):
        return '—' if stats is None else f"{stats['p50']:.1f}"
    for key, row in report['summary'].items():
        frame = row['all']['firstFrameMs']
        lines.append(f"| {key} | {row['observations']} | {frame['p50']:.1f} / {frame['p95']:.1f} | "
                     f"{cell(row['subsequent']['firstFrameMs'])} | {cell(row['all']['loadMs'])} | "
                     f"{cell(row['all']['onLoadMs'])} |")
    if baseline:
        lines += ['', '## 与基线比较', '',
                  '| 页面 | 本次后续打开首帧 p50 | 基线 p50 | 差值 |',
                  '| --- | ---: | ---: | ---: |']
        for key, row in report['summary'].items():
            current = row['subsequent']['firstFrameMs']
            old = baseline['summary'].get(key, {}).get('subsequent', {}).get('firstFrameMs')
            if current and old:
                lines.append(f"| {key} | {current['p50']:.1f} | {old['p50']:.1f} | "
                             f"{current['p50'] - old['p50']:+.1f} |")
    lines += ['', '首次观察与后续观察分开保留；样本少时 p95 可能就是最大值。',
              '缺失的排队、首帧等待、onLoad 动作计时保持未知，需新计时日志补齐。',
              f"未配对事件：{len(report['unmatched'])}；工具 hook 日志：{report['lifecycleLogCount']}。", '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path, default=Path('target/dsl-performance/application-load'))
    args = parser.parse_args()
    report = analyze(args.log.read_text(errors='replace'))
    baseline = analyze(args.baseline.read_text(errors='replace')) if args.baseline else None
    report['source'] = str(args.log)
    if baseline:
        report['baseline'] = baseline
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    text = markdown(report, baseline)
    args.output.with_suffix('.md').write_text(text)
    print(text)


if __name__ == '__main__':
    main()
