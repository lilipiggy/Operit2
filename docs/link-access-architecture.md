# Link / Access / Space Architecture

本文档只描述当前保留的两条链路。应用本地调用和 Space 节点间调用必须分开，
不能把远程节点能力重新挂回 Flutter/CLI Proxy。

## 1. 两条链路

### 本地应用链路

```text
Flutter / CLI
  -> GeneratedCoreProxy
  -> generated_core_dispatch
  -> ChatRuntimeHolder
  -> ChatRuntimeSlot
  -> ChatServiceCore
```

这一条链路只负责当前进程内的 Core 调用。Proxy 生成的对象直接进入本地 dispatch；
这里不经过 CoreNodeRouter、PeerLink、Space 或远程 session。

### Space 节点链路

```text
CoreNodeRouter
  -> PeerLink
  -> 远端 CoreNodeRouter
  -> 目标 Core 对象
```

Space 的调用、同步和跨端流全部从 CoreNodeRouter 接出。PeerLink 是节点之间的
双向数据载体，Flutter/CLI Proxy 不参与这条链路。

设备 Edge 节点属于目标 Core 对象的一种实现：

```text
CoreNodeRouter / PeerLink carrier
  -> Edge Node transport adapter
  -> operit-node-edge
  -> Edge Service
  -> Host API capability
```

`operit-proxy-edge` 只提供类型化的 Edge Service 投影。Edge 地址由
`operit-edge-contract` 共享；Proxy 不依赖本地 Edge Node 实现，传输 carrier 也不进入
app 层。

这里的 Edge Node 不是完整架构中的 `CoreNode`。完整 `CoreNode` 仍由
`OperitApplication + LocalCoreProxy + HostManager` 组成，并拥有身份、Space、持久化和
Agent/Chat 运行时；Edge Node 只提供设备侧服务对象，作为完整 CoreNode 的设备能力端点。

## 2. Link Access 的职责

Link Access 只提供控制面和 PeerLink carrier：

```text
/link/hello
/link/pair/start
/link/pair/finish
/link/session
/link/space/adopt
/link/peer/channel/events
/link/peer/channel/frame
/link/ws
```

配对、设备发现、session 建立、Space adopt 和服务器启动/关闭仍属于 Access 控制面。
控制面完成认证并建立 PeerLink 后，业务请求只进入 PeerFrame，不再创建应用层的
独立 HTTP RPC 入口。

## 3. 模块边界

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `operit-proxy-local` | 生成本地 Proxy、字符串 target 和本地 dispatch | Space 路由、设备信任、远程 session |
| `operit-node-runtime` | `CoreNodeRouter`、Space 路由、Binding 同步和本地 Core 目标解析 | Flutter/CLI 入口协议 |
| `RuntimePeerService` / `HostRuntimePeerService` | 节点配对、session、签名验证、连接管理及服务端接入 | 本地 Proxy 调用投影 |
| `operit-peer-link`（`node/peer-link`） | 共用 PeerLink 引擎和 HTTP/WebSocket/TCP/serial transport | 配对策略、存储、业务运行时 |
| `operit-edge-contract` | Edge Service object/property address contract | Host implementation、Link dispatch、Access session |
| `operit-node-edge` | 设备侧 Edge Node、Edge Service、Host capability dispatch | 桌面 runtime、Provider、ToolPkg、Chat、Access 控制面 |
| `operit-proxy-edge` | Edge Service 的类型化 Proxy facade | 本地 Node 实现、Host implementation、Access session |
| `operit-link` | Core 值、调用/观察/反向流类型和通用错误模型 | 设备配对、session 存储和业务路由 |
| `operit-runtime` | Holder、Slot、ChatServiceCore 和运行时状态 | 节点间传输和配对 |
| Flutter / CLI | 调用生成的本地 Proxy、展示 Access 状态 | 自行拼装远程路由或 PeerFrame |

## 4. Space 请求模型

节点间请求统一包装为 `RoutedCoreRequest<T>`：

```text
RoutedCoreRequest<T> {
  spaceId
  targetNodeId
  ttl
  routeKind: Target | SpaceRoute
  payload: T
}
```

`payload` 保持 `operit-link` 的标准类型：

```text
PeerRequest::Call(RoutedCoreRequest<CoreCallRequest>)
PeerRequest::Handoff(RoutedCoreRequest<CoreHandoffRequest>)
PeerRequest::BindingApply(RoutedCoreRequest<CoreNodeBindingApplyRequest>)
PeerRequest::WatchSnapshot(RoutedCoreRequest<CoreWatchRequest>)
PeerRequest::WatchOpen(PeerWatchOpenRequest)
PeerRequest::WatchClose(PeerWatchCloseRequest)
PeerRequest::PushOpen(PeerPushOpenRequest)
PeerRequest::PushItem(CorePushItem)
PeerRequest::PushClose(PeerPushCloseRequest)
```

`target` 是稳定字符串地址：本地 Proxy/SDK 使用 `core/<schema_key>`，SpaceRoute 使用
`space/<target_type>/<method>`。两者都不再按声明顺序分配编号。路由名属于公共协议，
新增声明不改变已有地址；改名属于破坏性变更。Peer 协议版本为 4，不接受旧数字寻址。

## 5. PeerFrame 载体

PeerLink 在认证的直接节点连接上交换以下帧：

```text
PeerFrame {
  messageId
  payload: Request | Response | WatchEvent | WatchClosed | Heartbeat
}
```

HTTP 只承载已经建立的 PeerLink channel：

* `events` 是远端主动发送 WatchEvent 的长连接方向。
* `frame` 发送请求、响应、Push item、关闭通知和心跳。

WebSocket 使用同一套 `PeerFrame` 语义。carrier 的选择不改变 CoreNodeRouter 的
调用模型，也不会生成第二条应用调用链。

### 通道双向能力（仅 Space 通道）

每条连接默认只有一个"发起"方向：拨号方发起 Call/Watch/Push，被连方只执行与应答
（拨号侧只关联应答，被连侧只分发请求）。被连方若需要主动调用对端——而对端位于
NAT 或端口重映射代理之后、其地址在本侧不可拨时——双方之间这条连接就是唯一可行
的路径。

两端在握手里各自声明 `duplex` 能力（`Hello` / `HelloReply` 的同名字段，缺省
false），因此与旧版本混跑时自动保持单向行为，双方都声明后才启用：

* 通道两端各有一个读循环（只做应答关联）与一个分发任务（执行对端请求、下发
  WatchEvent），互不阻塞：正在执行对端请求的一侧仍能收到自己发起的调用的应答。
* 被连方把该通道登记为可调用路由，优先于拨号，因此调用一个只会拨进来的对端不再
  需要它的任何地址。
* 授权不因方向而放宽：被连方在每个业务入口按 `spaceInbound` 重校，拨号方按
  `spaceOutbound` 重校（即"本侧仍被允许拨该对端"）。撤销后两者立即失效，通道
  随之下线。
* 配对 session 与 SessionReturn 通道保持单向语义，不受此能力影响。

## 6. 流和同步

Watch 和反向 Push 都拥有稳定的 `subscriptionId` 或 `pushId`，生命周期由 PeerLink
维护。相同 id 内保持顺序，不同 id 之间不定义全局顺序。断开 PeerLink 时，相关
订阅和输入流一起结束。

BindingApply 和 Space 持久化同步也使用 `PeerRequest::BindingApply`，由目标
`CoreNodeRouter` 执行或继续转发；它不经过应用 Proxy。

## 7. 明确禁止

以下内容不得重新加入应用入口或 `operit-proxy-local`：

```text
应用层远程 call/watch/push HTTP 路由
Flutter/CLI 到远端 CoreNode 的 Proxy 转发
分段对象路径、手写 CoreObjectPath 或 Holder 路径协议地址
把 PeerLink 请求转换成普通本地 Proxy 请求
```

配对、发现、静态 Web 服务器和控制面 session 仍由 Link Access 保留；它们与本地
Core 链路和 Space 数据链路相互独立。

## 5. 配对、路由策略与设备工具的共同入口

`NodeServices` 在一个节点内共享同一个 `RuntimePeerService`。配对、认证、连接和
session 生命周期由 Peer runtime 持有；Core 与 Edge 都使用这个引擎，不另建工具专用
连接。调用方通过 `hasPairing(nodeId, PairingDirection)` 查询入站、出站或任一方向授权，
单向配对不会产生反向授权。入网前的 Space 请求只走直接配对入口；配对本身不授予
Space 成员资格。Core 与 Edge 的 Space 快照、入网及取消请求共用
`NodeSpaceContext` 上的 `dispatchPeerSpaceCall`，入网后的业务同步或轻量控制投影仍由
各自的实现负责。

`space_policy::spaceChannelScope` 集中判断 Space 回连准入，Core Router 与 Edge 的
`NodeSpaceService` 共用它。双方都必须属于同一个已初始化的 Space 控制投影，且没有
被断开。传输认证与 Space 成员准入分别由各自的持有者负责。

`space_policy::RoutingPolicy` 从控制日志一次读取断开节点与中继权限。设备状态查询、
公开路由计划和实际下一跳选择都调用同一个 `routePlan`；列出多个设备时复用同一份
策略。第一跳必须是活动相邻节点，后续中继必须具有 `network.relay`，被断开的节点
不能成为目的地、第一跳或中继。撤销中继权限不会阻止该设备作为直接调用的目的地。

`route_forwarding` 统一来源和中继的 call、snapshot、watch、push 提交循环。路由器集中
检查 Space 标识、上一跳/来源/目的地的成员资格和撤销状态，以及本机管理 target 的
限制；Peer runtime 只按路由器选定的下一跳提交。逐跳保留原始 `originNodeId`、最终
`targetNodeId` 与 `routeKind`，扣减 TTL，排除上一跳和已失败的相邻节点。

插件 v2 的工具入口使用相同链路：

```text
Tools.device(nodeId).Files.read(path)
  -> DeviceToolRuntime
  -> CoreNodeRouter / Peer runtime / 中继 Router
  -> 目标 DeviceToolService
  -> 目标 Core 工具注册表

Tools.device(nodeId).Edge.execute(...) / Io.execute(...)
  -> 同一个 DeviceToolRuntime 与路由入口
  -> 目标 Edge Service / Host capability
```

JS bridge 与内置硬件工具共用 `DeviceToolRuntime`，没有独立的 `EdgeToolRuntime`。
设备工具 `core.tools` 和硬件 target `edge.plugins`、`edge.deviceIo` 在响应丢失后不切换
下一跳重发；该规则覆盖全部提交形式和中继，避免重复副作用。普通路由请求仍可在
链路错误后尝试其他下一跳。流建立后的取消和清理由 Peer runtime 与目标执行器负责，
转发层不重放已经打开的流，也不退回本机执行。
