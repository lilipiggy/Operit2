# DSL 冷加载：将编译移出页面生命周期

## 决策与边界

先前每个页面引擎第一次加载 CJS 模块，都在 QuickJS 内执行
`Acorn.parse → DSL 依赖分析/改写 → new Function → render → retained commit`。
工厂缓存归引擎所有，因此只对同一引擎有效；关闭页面再打开会重复静态编译。

本次只改变编译的生命周期，不增加全局页面缓存、引擎池或 AST 微优化：

- `plugins/tools/compile_compose_module.mjs` 在构建机上加载**生产编译器本身**，
  将 bundle 编译成普通 JS。不会执行插件代码，也不生成平台专属 QuickJS 字节码。
- 构建顺序是 TS/bundle → DSL lowering → 写入产物，角色卡七个独立页面均已接入。
- 首行 `// @operit-compose-artifact 1` 声明内部生成代码 ABI。
  加载入口 `OperitComposeCompiler.prepare` 校验 ABI 后直接交给 JS 引擎。
  **跳过的是 Acorn 和 DSL lowering，不是 JS 引擎自身的语法解析/编译。**
- 无产物头的旧插件/动态源码仍走原编译器。不支持或不完整的版本头明确报错，
  不静默回退后再次改写未知版本的生成代码。
- ABI 与公开插件 API 版本不同；当生成的 reactive/generation 调用约定不兼容时须升级。
  产物头必须保留在文件开头，不要在它前面拼接脚本、banner 或 BOM。
  它是格式声明，不是签名或安全校验；新产物需要支持此 ABI 的运行时。
- 模块身份使用包 ID + 产物路径；源内容仍参与现有工厂缓存键。
  引擎、状态、闭包、Promise 和 retained 节点继续归各页面所有。
- 构建输入快照包含共享编译器、Acorn 和构建适配器，避免构建过程中编译器改动而产出混合版本。
- 其他插件尚未迁移构建流程，仍通过源码兼容路径运行。

## 可复现测量

仓库根目录运行：

```sh
node tools/performance/compose_dsl_native_probe.mjs
```

该命令从相同当前 TypeScript 和 bundler 参数分别生成 source / artifact 输入到
`target/dsl-performance/native/`，不会覆盖生产 dist，然后串行运行真实 Native Host /
QuickJS 的 Rust session 探针。日志、原始样本、汇总分别写入 `*.log`、`*.json`、
`comparison.json`。每个模式每页 12 个独立新引擎，每个引擎 10 次同输入热刷新。
探针对 source 断言只编译一次，对 artifact 断言解析/编译次数均为零。

范围：

- Rust debug 测试程序，Apple M5 / arm64 / macOS。不是 release 手机基准。
- `engineBootstrapMs` 包含引擎创建和 eager SDK 初始化。
- `scriptToCommitMs` 是源码已在内存后的 session 执行到提交/完成。
- `coldTotalMs` 是每个样本上述两个阶段之和；插入计时代码本身被排除。
- 不包含磁盘/Host 文件读取、包解压、CoreLink、Flutter/GPU、业务数据查询或 WebView 就绪。
  编辑器首次提交只有加载占位的 2 个节点，选择器 9 个，侧栏 15 个；不是内容加载完成。
- JS 阶段使用毫秒时钟，0 ms 不表示工作为零；跳过编译由调用次数和抛错哨兵验证。
- p95 用 nearest-rank；12 次样本的 p95 实际为最大值，只适合本机初步比较。
- 热刷新是重复相同输入，不代表任意用户交互或数据变化的成本。

## 本机对比（2026-10-11，Asia/Singapore）

一次配对运行结果，单位 ms，`p50 / p95`：

| 页面 | 原冷启动阶段合计 | 预编译后 | p50 降幅 | 原脚本到提交 p50 | 预编译后 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 编辑器 main | 297.108 / 328.844 | 77.453 / 81.361 | 73.9% | 228.709 | 9.755 |
| 选择器 selection | 331.933 / 333.064 | 80.959 / 83.087 | 75.6% | 263.731 | 12.977 |
| 侧栏 chat-sidebar | 516.983 / 518.436 | 88.614 / 89.636 | 82.9% | 448.909 | 20.888 |

原编译 p50 为 219 / 251 / 429 ms（含解析 154 / 176 / 297 ms）；
预编译后在页面加载路径中编译和解析调用均为零。引擎初始化仍约 68 ms。

代价也要记录：文件字节数从 38,223 / 43,132 / 65,622 变为
38,645 / 47,038 / 76,759；热刷新 p50 从 1.791 / 2.364 / 3.663 ms 变为
1.808 / 2.502 / 4.052 ms。**本次显著改善冷加载，但没有改善热刷新；侧栏约增加 0.39 ms。**
源码更长以及每次调用仍处理源码是后续需要分阶段验证的原因，不能只报冷加载收益。

独立 Flutter debug widget 探针（非端到端）在 20/100/500 合成行时，
retained ingest p50 为 0.326/0.484/2.239 ms，测试 build/layout/paint p50 为
26.310/19.526/18.814 ms。它有框架预热、虚拟列表和执行顺序影响，不能与上表简单相加，
也不能据此推导首次 GPU 展示或真实大数据页完成时间。

## 第一轮回归与后续方向

覆盖产物确定性、与原编译器正文相同、不执行构建输入、版本拒绝、旧源码兼容；
覆盖真实 native factory 加载时禁用 parser/compiler、同长度源码缓存失效、错误后恢复；
覆盖状态依赖、异步动作、跨 reload 的引用、页面隔离、WebView 回调和侧栏 reorder。
测试夹具也改成同一页面 VM 内的真实 SDK，避免页面函数与 SDK 来自不同 realm。

下一步按剩余职责边界推进，不继续堆微优化：

1. **SDK 启动边界**：68 ms 初始化已成为主要剩余成本。先拆分计时，再将旧源码编译器、
   无关 SDK 库与页面必需的 generation/reactive runtime 分离；不要为省初始化共享页面状态。
   第一轮保留 eager SDK；第二轮按需加载与中断重试验证见下文。
2. **会话输入边界**：注册脚本/模块与更新输入/派发动作应分离，确认是否能让后续命令只发送
   稳定模块句柄而非重复源码；保留脚本更新失效和 owner 生命周期。先量化，不添加哈希缓存补丁。
3. **真实打开链路**：在生产 Host 读包、引擎准备、首次提交、Flutter 首帧、业务 onLoad 完成
   之间传递同一个 trace ID；只有这一层才能回答“用户打开页面到底等多久”。

## 当前初始化链路（2026-10-11）

运行时仅从统一 bootstrap 入口初始化。bootstrap 源码组装一次，可信编译结果由 host 共享；每个页面 runtime 的 heap、globals、绑定及状态仍独立。

辅助库和 Acorn 源码在实际使用时读取。预编译页面不读取或初始化解析器。解析器以局部 exports 初始化，错误和中断保持终止状态，不重新初始化。旧模块组装入口、重复性能 probe 和文本回调测试夹具已删除或迁移至统一 host Promise 协议。

最终 QuickJS 三策略测试及真实 CoreLink/Flutter 首树帧对照见 [加载优化报告](../../docs/dsl-load-optimization-20261011.md)。报告分别注明首次编译、编译结果复用、同 DLL 对照及测量范围，保留原始样本。

在仓库根目录单独运行：

```powershell
$env:RUSTFLAGS='-Awarnings'
cargo test --manifest-path core/Cargo.toml -p operit-js-bridge --lib `
  native_bootstrap_bytecode_probe -- --ignored --nocapture --test-threads=1
```
