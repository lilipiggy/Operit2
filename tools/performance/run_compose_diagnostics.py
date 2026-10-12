#!/usr/bin/env python3
"""Run DSL regression tests and measured probes, saving logs and structured results."""
import argparse
import datetime
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'apps/flutter/app'
OUT = ROOT / 'target/dsl-performance/diagnostics'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--log-only', action='store_true')
    parser.add_argument('--skip-native', action='store_true')
    parser.add_argument('--skip-pipeline', action='store_true')
    parser.add_argument('--application', action='store_true',
                        help='Also launch the real macOS page benchmark without supplied logs')
    parser.add_argument('--application-samples', type=int, default=8)
    parser.add_argument('--application-rows', type=int, default=20)
    args = parser.parse_args()
    if args.log_only and not args.log:
        parser.error('--log-only requires --log')
    if not args.log_only and not args.skip_pipeline and sys.platform != 'darwin':
        parser.error('The pipeline library build targets macOS; use --skip-pipeline elsewhere')
    OUT.mkdir(parents=True, exist_ok=True)
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    results = []

    def run(name, command, cwd=ROOT, env=None):
        log = OUT / f'{name}.log'
        print(f'RUN {name}: {log}', flush=True)
        try:
            with log.open('w') as stream:
                process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                           start_new_session=os.name == 'posix')
                try:
                    code = process.wait(timeout=900)
                except subprocess.TimeoutExpired:
                    if os.name == 'posix':
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                    process.wait()
                    stream.write('\nDiagnostic step timed out after 900 seconds.\n')
                    code = 124
        except OSError as error:
            with log.open('a') as stream:
                stream.write(str(error) + '\n')
            code = 1
        results.append({'name': name, 'exitCode': code, 'log': str(log.relative_to(ROOT))})
        print(f'{"PASS" if code == 0 else "FAIL"} {name}', flush=True)
        return code == 0

    if not args.log_only:
        run('analysis-tests', [sys.executable, '-m', 'unittest', 'discover', '-s', 'tools/tests', '-p', 'test_compose*py'])
        run('storage-tests', ['node', '--test', 'plugins/packages/buildin/character_cards/tests/storage-persistence.test.mjs',
                              'plugins/packages/buildin/character_cards/tests/sidebar-loading.test.mjs'])
        run('lifecycle-tests', ['flutter', 'test', 'test/toolpkg_dsl/toolpkg_ui_launcher_screen_test.dart',
                                'test/compose_dsl_error_lifecycle_test.dart',
                                'test/compose_dsl_retained_layout_test.dart',
                                'test/compose_dsl_interactions_test.dart'], APP)
        if not args.skip_native:
            run('native-engine-ownership', ['cargo', 'test', '--manifest-path', 'core/Cargo.toml',
                                            '-p', 'operit-js-bridge', '--lib',
                                            'toolpkg_engine_binds_its_execution_host_once'])
            run('native-quickjs', ['node', 'tools/performance/compose_dsl_native_probe.mjs'])
        prepared = run('prepare-render-fixtures', ['node', 'tools/performance/compose_dsl_first_render_probe.mjs'])
        if prepared:
            run('retained-first-frame', ['flutter', 'test', '--dart-define=OPERIT_DSL_FIRST_FRAME_PROBE=true',
                                         'test/compose_dsl_first_frame_probe_test.dart'], APP)
        if not args.skip_pipeline:
            target = 'aarch64-apple-darwin' if platform.machine() == 'arm64' else 'x86_64-apple-darwin'
            manifest = ROOT / 'apps/flutter/native/operit-flutter-bridge/Cargo.toml'
            built = run('pipeline-library', ['cargo', 'rustc', '--manifest-path', str(manifest), '--release',
                                             '--target', target, '--crate-type', 'cdylib'],
                        env={**os.environ, 'RUSTFLAGS': '-Awarnings'})
            prepared = run('prepare-pipeline-fixtures', ['node', 'tools/performance/compose_dsl_load_breakdown_probe.mjs',
                                                         '--prepare-native-fixtures'])
            if built and prepared:
                metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--manifest-path', str(manifest),
                                                                '--no-deps', '--format-version', '1'], cwd=ROOT))
                library = Path(metadata['target_directory']) / target / 'release/liboperit_flutter_bridge.dylib'
                run('native-flutter-pipeline', ['flutter', 'test', '--dart-define=OPERIT_DSL_LOAD_PIPELINE_PROBE=true',
                                                f'--dart-define=OPERIT_DSL_PROBE_LIBRARY={library}',
                                                'test/compose_dsl_load_pipeline_probe_test.dart'], APP)
    if args.application and not args.log_only:
        run('real-application', [sys.executable, 'tools/performance/run_compose_application_benchmark.py',
                                '--samples', str(args.application_samples),
                                '--rows', str(args.application_rows),
                                '--output', str(OUT / 'real-application')])
    if args.log:
        command = [sys.executable, 'tools/performance/analyze_compose_load.py', str(args.log.resolve()),
                   '--output', str(OUT / 'application-load')]
        if args.baseline:
            command += ['--baseline', str(args.baseline.resolve())]
        run('application-log', command)
    report = {'scope': 'Separate regression tests, synthetic probes and optional real macOS application benchmark. '
                       'Real application metrics are in the real-application report; synthetic probes do not '
                       'measure business/WebView readiness. Never add independent layer quantiles.',
              'startedAt': started_at,
              'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'skippedNative': args.skip_native or args.log_only,
              'skippedPipeline': args.skip_pipeline or args.log_only,
              'realApplication': args.application and not args.log_only,
              'steps': results}
    (OUT / 'run.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Report: {OUT / "run.json"}', flush=True)
    return int(any(item['exitCode'] != 0 for item in results))


if __name__ == '__main__':
    sys.exit(main())
