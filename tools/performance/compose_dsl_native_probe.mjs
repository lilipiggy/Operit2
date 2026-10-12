import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildUiScreenScripts } from '../../plugins/packages/buildin/character_cards/scripts/build.mjs';

const root = new URL('../../', import.meta.url);
const output = new URL('target/dsl-performance/native/', root);
mkdirSync(output, { recursive: true });
/** Nearest-rank quantiles; retain raw samples because 12-run p95 is the maximum. */
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries([['p50', .5], ['p95', .95]].map(([key, q]) => [key, +sorted[Math.ceil(sorted.length * q) - 1].toFixed(3)]));
}
const report = { measuredAt: new Date().toISOString(), samples: 12, modes: {} };
for (const precompile of [false, true]) {
  const mode = precompile ? 'artifact' : 'source';
  // Both inputs are built from identical current TypeScript and bundler options.
  // Build/file reads are outside native timers; production dist is not overwritten.
  const directory = new URL(mode + '/', output);
  for (const [path, bytes] of Object.entries(await buildUiScreenScripts({ precompile }))) {
    const file = new URL(path.replace('dist/ui/', ''), directory);
    mkdirSync(new URL('./', file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const result = spawnSync('cargo', ['test', '--manifest-path', 'core/Cargo.toml', '-p', 'operit-tools', '--lib',
    'native_character_editor_load_stage_performance_probe', '--', '--ignored', '--nocapture', '--test-threads=1'], {
    cwd: fileURLToPath(root), env: { ...process.env, OPERIT_DSL_PROBE_SOURCE_DIR: fileURLToPath(directory) },
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const log = String(result.stdout ?? '') + String(result.stderr ?? '');
  writeFileSync(new URL(mode + '.log', output), log);
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Native probe failed; see ' + mode + '.log');
  const line = log.split('\n').find(line => line.includes('dsl_native_probe '));
  if (!line) throw Error('Native probe did not emit measurements');
  const raw = JSON.parse(line.slice(line.indexOf('dsl_native_probe ') + 'dsl_native_probe '.length));
  writeFileSync(new URL(mode + '.json', output), JSON.stringify(raw, null, 2));
  report.modes[mode] = { scope: raw.scope, profile: raw.profile, screens: raw.screens.map(screen => {
    const summary = { screen: screen.screen, sourceBytes: screen.sourceBytes, upserts: screen.samples[0].upserts };
    for (const key of ['engineBootstrapMs', 'scriptToCommitMs', 'coldTotalMs']) summary[key] = stats(screen.samples.map(sample => sample[key]));
    for (const key of ['prepareMs', 'renderMs', 'commitMs']) summary[key] = stats(screen.samples.map(sample => sample.stages[key]));
    summary.warmInputRefreshMs = stats(screen.samples.flatMap(sample => sample.warmInputRefreshMs));
    return summary;
  }) };
}
writeFileSync(new URL('comparison.json', output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
