import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { compileComposeModule } from '../../plugins/tools/compile_compose_module.mjs';
import { readSdkScript, wrapComposeScript, composeRoot, composeManifest, composeSource } from '../runtime/compose_scripts.mjs';
import { composeStreamFixture } from '../tests/support/compose_stream_fixture.mjs';

const root = new URL('../../', import.meta.url);
const output = new URL('target/dsl-performance/current-load/', root);
const require = createRequire(new URL('plugins/packages/buildin/workflow/package.json', root));
const { buildSync } = require('esbuild');
const samples = 25;
const flags = new Set(process.argv.slice(2));
const prepareOnly = flags.has('--prepare-native-fixtures');
const nativeCurrentSdk = flags.has('--native-current-sdk');
assert.ok([...flags].every(flag => flag === '--prepare-native-fixtures' || flag === '--native-current-sdk'), 'Unknown probe option');

/** Installs checked-out SDK methods in an explicitly labelled old-DLL experiment. */
function nativeSdkInstaller() {
  const sources = composeManifest.context.map(composeSource);
  const names = sources.map(text => {
    const match = /^var (Operit\w+) = /m.exec(text);
    assert.ok(match, 'SDK module must declare its owned export');
    return match[1];
  });
  return '\nvar probeSdk = (function() {\n' + sources.join('\n') + '\nreturn {' +
    names.map(name => name + ':' + name).join(',') + '};\n})();\n' +
    names.map(name => name === 'OperitComposeLazy' || name === 'OperitComposeArtifact'
      ? 'var ' + name + ' = probeSdk.' + name + ';'
      : 'Object.assign(' + name + ', probeSdk.' + name + ');').join('\n') + '\n';
}
mkdirSync(output, { recursive: true });

/** Reports nearest-rank quantiles while retaining all original measurements. */
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}

/** Fails immediately when an artifact attempts runtime parsing or DSL compilation. */
function rejectCompilation() {
  throw new Error('A precompiled artifact invoked runtime parsing or DSL compilation');
}

/** Measures one fresh context and synchronous first commit using the checked-out SDK. */
function sample(scenario) {
  const times = {};
  let start = performance.now();
  const bridge = readSdkScript('ToolPkgComposeDslBridge.rs');
  const script = readFileSync(scenario.file, 'utf8');
  times.readScriptsMs = performance.now() - start;
  start = performance.now();
  const context = vm.createContext({ module: { exports: {} }, console, ...scenario.globals });
  context.exports = context.module.exports;
  vm.runInContext(bridge, context);
  times.sdkInitMs = performance.now() - start;

  let parseMs = 0;
  let compileMs = 0;
  let commitMs = 0;
  let rootRenderMs = 0;
  let parseCalls = 0;
  let compileCalls = 0;
  if (scenario.mode === 'artifact') {
    assert.ok(script.startsWith('// @operit-compose-artifact 1\n'));
    context.__operitAcorn.parse = rejectCompilation;
    context.OperitComposeCompiler.compile = rejectCompilation;
  } else {
    const parse = context.__operitAcorn.parse;
    const compile = context.OperitComposeCompiler.compile;
    /** Measures the real parser without inspecting or copying its AST. */
    context.__operitAcorn.parse = function (...args) {
      const start = performance.now();
      const result = parse(...args);
      parseMs += performance.now() - start;
      parseCalls++;
      return result;
    };
    /** Measures runtime DSL compilation, including its nested parser call. */
    context.OperitComposeCompiler.compile = function (...args) {
      const start = performance.now();
      const result = compile(...args);
      compileMs += performance.now() - start;
      compileCalls++;
      return result;
    };
  }
  const createContext = context.OperitComposeDslRuntime.createContext;
  /** Observes the production retained commit of the freshly created session. */
  context.OperitComposeDslRuntime.createContext = function (...args) {
    const bundle = createContext(...args);
    const commit = bundle.composition.commit;
    /** Measures retained registration and update generation without graph projection. */
    bundle.composition.commit = function (...args) {
      const start = performance.now();
      const result = commit(...args);
      commitMs += performance.now() - start;
      return result;
    };
    return bundle;
  };
  const render = context.OperitComposeReactive.render;
  /** Measures the actual root entry, including its reactive node construction. */
  context.OperitComposeReactive.render = function (...args) {
    const start = performance.now();
    const result = render(...args);
    rootRenderMs += performance.now() - start;
    return result;
  };
  start = performance.now();
  const prepared = context.OperitComposeCompiler.prepare(script, scenario.identity);
  vm.runInContext(wrapComposeScript(prepared), context);
  times.entryPrepareEvalMs = performance.now() - start;
  // Response projection is disabled; fixture installation is outside the timer.
  const fixture = composeStreamFixture(context, { projectTree: false, inspectStorage: false });
  fixture.adapt();
  start = performance.now();
  const response = context.__operit_render_compose_dsl({ state: scenario.state });
  times.firstRenderCommitMs = performance.now() - start;
  assert.equal(typeof response.then, 'undefined');
  assert.equal(response.update.reset, true);
  assert.equal(fixture.errors.length, 0);
  times.parseMs = parseMs;
  times.compileMs = compileMs;
  times.rootRenderMs = rootRenderMs;
  times.retainedCommitMs = commitMs;
  times.otherRenderMs = times.firstRenderCommitMs - rootRenderMs - commitMs;
  times.totalJsMs = times.readScriptsMs + times.sdkInitMs + times.entryPrepareEvalMs + times.firstRenderCommitMs;
  assert.equal(parseCalls, scenario.mode === 'artifact' ? 0 : 1);
  assert.equal(compileCalls, scenario.mode === 'artifact' ? 0 : 1);
  return { times, nodes: response.update.upserts.length, parseCalls, compileCalls, update: response.update };
}

/** Keeps first-use and subsequent fresh-context distributions explicitly separate. */
function measure(scenario) {
  const first = sample(scenario);
  for (let i = 0; i < 3; i++) sample(scenario);
  const measurements = [];
  for (let i = 0; i < samples; i++) measurements.push(sample(scenario));
  const summary = {};
  for (const key of Object.keys(first.times)) {
    summary[key] = distribution(measurements.map(item => item.times[key]));
  }
  return { name: scenario.name, mode: scenario.mode, rows: scenario.rows, nodes: first.nodes,
    scriptBytes: readFileSync(scenario.file).length,
    scriptSha256: createHash('sha256').update(readFileSync(scenario.file)).digest('hex'),
    firstSampleMs: first.times.totalJsMs, parseCalls: first.parseCalls, compileCalls: first.compileCalls,
    summary, rawSamples: measurements.map(item => item.times) };
}

// Development bundling and artifact generation are outside all runtime timers.
const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL('plugins/packages/buildin/character_cards/src/ui-selector.ts', root))],
  bundle: true, format: 'cjs', platform: 'neutral', target: 'es2020', write: false,
});
const source = bundle.outputFiles[0].text + `
/** Renders the production selector with explicitly preloaded synthetic rows. */
module.exports.default = function(ctx) {
  return selectorView(ctx, { mode: 'select', kind: 'all', selected: null, chatId: null }, data, controller);
};`;
const identity = 'current-load-selector';
const sourceFile = new URL('selector-source.cjs', output);
const artifactFile = new URL('selector-artifact.cjs', output);
writeFileSync(sourceFile, source);
writeFileSync(artifactFile, compileComposeModule(source, identity));
const scenarios = [];
for (const screen of ['main', 'selection', 'chat-sidebar']) {
  const states = {
    main: {},
    selection: { presentation: { requestId: 'perf-selection', input: { mode: 'select', kind: 'all', selected: null, chatId: null } } },
    'chat-sidebar': { input: { view: 'characters' }, chatSidebar: { chats: [], currentChatId: null, activeStreamingChatIds: [] } },
  };
  scenarios.push({ name: screen, mode: 'artifact', identity: screen,
    file: new URL(`plugins/packages/buildin/character_cards/dist/ui/${screen}/index.ui.js`, root),
    state: states[screen], globals: {} });
}
for (const rows of [20, 100, 500]) {
  const data = { data: { selected: null, options: Array.from({ length: rows }, (_, index) => ({
    key: 'group:' + index, token: 'group:' + index, kind: 'group', id: String(index),
    title: 'Diagnostic group ' + index, description: 'Synthetic performance row',
    selection: { CharacterGroup: { id: String(index) } }, avatar: { type: 'group' },
  })) }, loading: false, switchingKey: null, error: '', finished: false };
  const controller = {
    /** Keeps synthetic input preloaded without accessing business storage. */
    load() {},
    /** Rejects any unintended interaction with user data. */
    select() { throw new Error('No user data access'); },
    /** Rejects navigation during an isolated first-render measurement. */
    cancel() { throw new Error('No presentation'); },
  };
  const nativePrelude = `
var data = ${JSON.stringify(data)};
var controller = {
  /** Returns stage measurements without accessing business data. */
  load: function() { return Object.assign({}, globalThis.__dslProbeStages); },
  /** Rejects unintended interactions during the native probe. */
  select: function() { throw Error('No user data access'); },
  /** Rejects unintended navigation during the native probe. */
  cancel: function() { throw Error('No presentation'); }
};
globalThis.__dslProbeStages = {rootRenderMs:0, retainedCommitMs:0, parseCalls:0, compileCalls:0};
if (typeof __operitAcorn !== 'undefined' || typeof OperitComposeCompiler !== 'undefined') {
  throw Error('Native page must not own the shared compiler');
}
var probePrepare = __operitNativePrepareComposeModule;
/** Validates every module crossing the native shared preparation boundary. */
__operitNativePrepareComposeModule = function(source, identity) {
  if (source.indexOf('// @operit-compose-artifact 1') !== 0) throw Error('Probe module must be precompiled');
  return probePrepare(source, identity);
};
var probeRender = OperitComposeReactive.render;
/** Measures production node construction with the native engine clock. */
OperitComposeReactive.render = function() {
  var start = Date.now(); var result = probeRender.apply(this, arguments);
  __dslProbeStages.rootRenderMs += Date.now() - start; return result;
};
var probeCreate = OperitComposeDslRuntime.createContext;
/** Observes the retained composition created by the production session. */
OperitComposeDslRuntime.createContext = function() {
  var bundle = probeCreate.apply(this, arguments), commit = bundle.composition.commit;
  /** Measures native retained commit without inspecting its records. */
  bundle.composition.commit = function() {
    var start = Date.now(); var result = commit.apply(this, arguments);
    __dslProbeStages.retainedCommitMs += Date.now() - start;
    // Inspection uses the ordinary action helper after the measured first commit.
    __operitNativePrepareComposeModule = probePrepare;
    return result;
  };
  return bundle;
};
`;
  const nativeArtifact = readFileSync(artifactFile, 'utf8');
  const headerEnd = nativeArtifact.indexOf('\n') + 1;
  writeFileSync(new URL(`native-selector-${rows}.cjs`, output), nativeArtifact.slice(0, headerEnd) + (nativeCurrentSdk ? nativeSdkInstaller() : '') + nativePrelude + nativeArtifact.slice(headerEnd));
  for (const mode of ['artifact', 'source']) {
    const files = { artifact: artifactFile, source: sourceFile };
    scenarios.push({ name: 'preloaded-selector', mode, rows, identity,
      file: files[mode], state: {}, globals: { data, controller } });
  }
}
if (!prepareOnly) {
  const results = [];
  for (const scenario of scenarios) {
    const result = measure(scenario);
    results.push(result);
    console.log(JSON.stringify({ name: result.name, mode: result.mode, rows: result.rows, nodes: result.nodes, summary: result.summary }));
  }
  const sdkSha256 = createHash('sha256').update(readSdkScript('ToolPkgComposeDslBridge.rs')).update(wrapComposeScript()).digest('hex');
  const report = { measuredAt: new Date().toISOString(), engine: process.version + ' Node/V8', samples,
    scope: 'Fresh Node VM contexts; current production SDK and dist artifacts; synthetic state; OS-cached script reads; excludes native QuickJS, Rust conversion, CoreLink, business data queries, onLoad actions, WebView, Flutter and GPU presentation',
    sdkSha256, manifest: JSON.parse(readFileSync(new URL('sources.json', composeRoot), 'utf8')), results };
  writeFileSync(new URL('load-breakdown.json', output), JSON.stringify(report, null, 2));
}
