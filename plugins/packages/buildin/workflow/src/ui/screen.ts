import type { ComposeDslContext, ComposeNode } from "../../../../../types/compose-dsl";
import { copy, id, newNode, STYLES, values, type NodeKind, type Run, type Snapshot, type ToolDefinition, type Workflow, type WorkflowNode } from "../model";
import type { Request } from "../service";
import { errorText } from "../engine";
import { validateGraph } from "../validation";
import { templates } from "../templates";
import { fitViewport, graphCanvas, snapPosition, type Viewport } from "./canvas";
import { choose, field, nodeForm, scheduleForm } from "./forms";

type Modal = "" | "create" | "templates" | "import" | "export" | "delete" | "meta" | "node" | "nodeMenu" | "deleteNode" | "connections" | "condition" | "logs" | "result";
interface State {
  width: number; tools: ToolDefinition[];
  snapshot: Snapshot; workflow: Workflow | null; ready: boolean; busy: boolean; saving: boolean; error: string;
  menu: boolean; selectionMode: boolean; marked: string[]; modal: Modal;
  name: string; description: string; enabled: boolean; text: string; path: string;
  selected: string | null; nodeDraft: WorkflowNode | null; adding: boolean; schedule: WorkflowNode | null;
  edgeId: string | null; conditionMode: "default" | "false" | "custom";
  viewport: Viewport; fitted: boolean; latest: Run | null; logId: string | null; logNode: string | null;
}
interface MenuAction { label: string; icon: string; action: () => void | Promise<void>; danger?: boolean; enabled?: boolean }

/** Formats timestamps with the compact date layout used by the original list. */
function date(value: number): string {
  const d = new Date(value);
  /** Pads one calendar component to two digits. */
  const pad = (part: number): string => String(part).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/** Describes the elapsed time since the most recent execution. */
function relative(value: number): string {
  const minutes = Math.floor((Date.now() - value) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return minutes + " 分钟前";
  if (minutes < 1440) return Math.floor(minutes / 60) + " 小时前";
  return Math.floor(minutes / 1440) + " 天前";
}

/** Maps persisted run state to the original Material status presentation. */
function status(run: Run["status"]): { text: string; color: string; icon: string } {
  return {
    SUCCESS: { text: "执行成功", color: "tertiary", icon: "CheckCircle" },
    FAILED: { text: "执行失败", color: "error", icon: "Error" },
    RUNNING: { text: "正在执行", color: "primary", icon: "PlayCircle" },
    CANCELLED: { text: "已取消", color: "onSurfaceVariant", icon: "Close" },
  }[run];
}

/** Reproduces the Kotlin list, speed dial, graph, and transactional editing dialogs. */
export default function screen(ctx: ComposeDslContext): ComposeNode {
  const UI = ctx.UI;
  const [state, setState] = ctx.useState<State>("workflow-ui", {
    width: 0, tools: [],
    snapshot: { workflows: [], runs: [], manifestTemplates: [] }, workflow: null, ready: false, busy: false, saving: false, error: "",
    menu: false, selectionMode: false, marked: [], modal: "", name: "", description: "", enabled: true, text: "", path: "",
    selected: null, nodeDraft: null, adding: false, schedule: null, edgeId: null, conditionMode: "default",
    viewport: { x: 0, y: 0, zoom: 1, width: 0, height: 0 }, fitted: false, latest: null, logId: null, logNode: null,
  });
  const live = ctx.useRef("workflow-live", state);
  live.current = state;
  const drag = ctx.useRef<{ nodeId: string | null; before: Workflow | null }>("workflow-drag", { nodeId: null, before: null });

  /** Updates the current frame without losing asynchronous changes. */
  function update(patch: Partial<State>): void {
    const next = { ...live.current, ...patch };
    live.current = next;
    setState(next);
  }

  /** Reports failures both in the host log and on the active page or dialog. */
  async function perform(action: () => void | Promise<void>): Promise<void> {
    try { update({ error: "" }); await action(); }
    catch (error) { console.error("[workflow UI]", error); update({ error: errorText(error) }); }
  }

  /** Resolves the selected workflow as an explicit precondition for editor actions. */
  function current(): Workflow {
    const workflow = live.current.workflow;
    if (workflow === null) throw new Error("没有正在编辑的工作流");
    return workflow;
  }

  /** Refreshes plugin data and the selected saved workflow from the main runtime. */
  async function request(message: Request): Promise<Snapshot> {
    const result = await ToolPkg.ipc.call<Request, Snapshot>("workflow.service", message, { targetRuntime: "main" });
    const selected = live.current.workflow;
    const workflow = selected === null ? null : result.workflows.find(item => item.id === selected.id);
    const tools = result.tools === undefined ? live.current.tools : result.tools;
    update({ snapshot: { ...result, tools }, tools, ready: true, workflow: workflow === undefined ? null : workflow,
      marked: live.current.marked.filter(value => result.workflows.some(item => item.id === value)) });
    return { ...result, tools };
  }

  /** Saves one completed edit, keeping the modal available when validation fails. */
  async function commit(workflow: Workflow): Promise<void> {
    if (live.current.busy || live.current.saving) throw new Error("请等待当前操作完成");
    validateGraph(workflow, false);
    update({ saving: true });
    try { await request({ action: "save", workflow }); }
    finally { update({ saving: false }); }
  }

  /** Opens a saved graph and requests an initial centered fit after measurement. */
  function open(workflow: Workflow): void {
    const runs = live.current.snapshot.runs.filter(item => item.workflowId === workflow.id).sort((a, b) => b.startedAt - a.startedAt);
    update({ workflow: copy(workflow), selected: null, modal: "", menu: false, fitted: false,
      latest: runs.length === 0 ? null : runs[0], viewport: { ...live.current.viewport, x: 0, y: 0, zoom: 1 } });
  }

  /** Opens the graph created by an operation that appends exactly one workflow. */
  function openCreated(snapshot: Snapshot): void {
    const workflow = snapshot.workflows[snapshot.workflows.length - 1];
    if (workflow === undefined) throw new Error("创建结果缺少工作流");
    open(workflow);
  }

  /** Creates a compact dialog action with consistent failure handling. */
  function button(text: string, action: () => void | Promise<void>, enabled = true, danger = false): ComposeNode {
    return UI.TextButton({ text, enabled: enabled && !state.saving, contentColor: danger ? "error" : "primary", onClick: () => perform(action) });
  }

  /** Creates a labeled Material icon button. */
  function iconButton(icon: string, label: string, action: () => void | Promise<void>, enabled = true): ComposeNode {
    return UI.IconButton({ key: label, enabled: enabled && !state.saving, onClick: () => perform(action) },
      UI.Icon({ name: icon, contentDescription: label, size: 22 }));
  }

  /** Closes editing without applying its detached draft to persisted data. */
  function dismiss(): void { update({ modal: "", nodeDraft: null, schedule: null, error: "" }); }

  /** Presents bounded, scrollable content and keeps actions outside the scroll area. */
  function dialog(key: string, title: string, body: ComposeNode[], actions: ComposeNode[], bodyHeight: number, close = dismiss): ComposeNode {
    return UI.Dialog({ key, onDismissRequest: close, closeOnDismissRequest: false,
      properties: { usePlatformDefaultWidth: false }, shape: { cornerRadius: 28 }, containerColor: "surfaceContainerHigh",
    }, UI.Column({ width: Math.min(560, Math.max(0, state.width - 32)), modifier: ctx.Modifier.heightIn(0, 650), padding: 24, spacing: 16 }, [
      UI.Text({ text: title, style: "headlineSmall" }),
      UI.LazyColumn({ key: key + ":body", weight: 1, weightFill: false, height: bodyHeight, fillMaxWidth: true, spacing: 12 }, [
        ...body, ...(state.error ? [UI.Text({ text: state.error, color: "error", key: "dialog-error" })] : []),
      ]),
      UI.FlowRow({ fillMaxWidth: true, horizontalArrangement: "end", spacing: 8 }, actions),
    ]));
  }

  /** Opens a detached node form, including node type selection when adding. */
  function showNode(node: WorkflowNode | null): void {
    const v = live.current.viewport;
    const created = newNode("trigger");
    created.position = snapPosition((v.width / 2 - v.x) / v.zoom - 60, (v.height / 2 - v.y) / v.zoom - 40);
    update({ modal: "node", adding: node === null, nodeDraft: node === null ? created : copy(node), menu: false });
  }

  /** Persists an accepted node form; cancelling never inserts an unfinished node. */
  async function saveNode(): Promise<void> {
    const node = live.current.nodeDraft;
    if (node === null) throw new Error("节点草稿不存在");
    const workflow = current();
    await commit({ ...workflow, nodes: live.current.adding ? [...workflow.nodes, node] : workflow.nodes.map(item => item.id === node.id ? node : item) });
    fit();
    dismiss();
  }

  /** Executes the saved graph and displays the completed execution result. */
  async function run(): Promise<void> {
    const workflow = current();
    update({ busy: true, latest: null, menu: false });
    try {
      const snapshot = await request({ action: "run", id: workflow.id, triggerId: null, extras: {} });
      const runs = snapshot.runs.filter(item => item.workflowId === workflow.id).sort((a, b) => b.startedAt - a.startedAt);
      if (runs.length === 0) throw new Error("执行完成但没有返回执行记录");
      update({ latest: runs[0], modal: "result" });
    } finally { update({ busy: false }); }
  }

  /** Deletes a node and its edges after checking every parameter reference. */
  async function removeNode(): Promise<void> {
    const workflow = current(), nodeId = live.current.selected;
    const dependents = workflow.nodes.filter(node => node.id !== nodeId && values(node).some(value => "nodeId" in value && value.nodeId === nodeId));
    if (dependents.length) throw new Error("先修改这些节点的参数引用：" + dependents.map(node => node.name).join("、"));
    await commit({ ...workflow, nodes: workflow.nodes.filter(node => node.id !== nodeId),
      connections: workflow.connections.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId) });
    update({ selected: null, fitted: false });
    fit();
    dismiss();
  }

  /** Fits graph bounds with the same 48dp padding and zoom limits as Kotlin. */
  function fit(): void {
    const workflow = live.current.workflow;
    const viewport = live.current.viewport;
    if (workflow !== null) update({ viewport: fitViewport(workflow, viewport),
      fitted: viewport.width > 0 && viewport.height > 0 && workflow.nodes.length > 0 });
  }

  /** Registers progress observation and loads state through the real main IPC service. */
  async function initialize(): Promise<void> {
    ToolPkg.ipc.on<Run, boolean>("workflow.progress", progress => {
      const latest = live.current.latest;
      if (live.current.workflow?.id !== progress.workflowId) return true;
      if (latest !== null && (latest.startedAt > progress.startedAt ||
        (latest.id === progress.id && latest.finishedAt !== null))) return true;
      update({ latest: progress });
      return true;
    });
    await request({ action: "tool_catalog" });
  }

  /** Renders the original execution result strip inside a workflow card. */
  function executionStatus(workflow: Workflow): ComposeNode[] {
    if (workflow.lastExecutionStatus === null) return [];
    const s = status(workflow.lastExecutionStatus);
    const rate = workflow.totalExecutions === 0 ? 0 : Math.floor(workflow.successfulExecutions / workflow.totalExecutions * 100);
    return [UI.Row({ fillMaxWidth: true, paddingHorizontal: 10, paddingVertical: 8, spacing: 6, verticalAlignment: "center",
      modifier: ctx.Modifier.background(ctx.MaterialTheme.colorScheme[s.color].copy({ alpha: 0.08 }), { cornerRadius: 8 }),
    }, [
      UI.Icon({ name: s.icon, size: 16, tint: s.color }),
      UI.Column({ weight: 1, spacing: 2 }, [
        UI.Text({ text: s.text, style: "labelMedium", color: s.color }),
        ...(workflow.lastExecutionTime === null ? [] : [UI.Text({ text: relative(workflow.lastExecutionTime), fontSize: 10, color: "onSurfaceVariant" })]),
      ]),
      ...(workflow.totalExecutions > 0 && workflow.lastExecutionStatus !== "RUNNING" ? [UI.Text({ text: rate + "%", style: "labelLarge",
        color: rate >= 80 ? "tertiary" : rate >= 50 ? "primary" : "error" })] : []),
    ])];
  }

  /** Selects or deselects an item only while explicit multi-selection is active. */
  function mark(workflow: Workflow): void {
    const marked = live.current.marked;
    update({ marked: marked.includes(workflow.id) ? marked.filter(item => item !== workflow.id) : [...marked, workflow.id] });
  }

  /** Renders the outlined, clickable 18dp-padded card from WorkflowListScreen.kt. */
  function workflowCard(workflow: Workflow): ComposeNode {
    const selected = state.marked.includes(workflow.id);
    return UI.Card({ key: workflow.id, fillMaxWidth: true, elevation: 0, shape: { cornerRadius: 12 },
      containerColor: selected ? "primaryContainer" : "surface", containerAlpha: selected ? 0.3 : 1,
      border: { width: 1, color: "outlineVariant" },
      modifier: ctx.Modifier.clickable(() => state.selectionMode ? mark(workflow) : open(workflow)),
    }, UI.Column({ padding: 18, spacing: 12, fillMaxWidth: true }, [
      UI.Row({ fillMaxWidth: true, verticalAlignment: "center", spacing: 8 }, [
        UI.Text({ text: workflow.name, style: "titleMedium", fontWeight: "medium", maxLines: 1, overflow: "ellipsis", weight: 1 }),
        ...(!workflow.enabled ? [UI.Text({ text: "已禁用", fontSize: 10, color: "error", paddingHorizontal: 6, paddingVertical: 2,
          modifier: ctx.Modifier.background(ctx.MaterialTheme.colorScheme.errorContainer.copy({ alpha: 0.5 }), { cornerRadius: 4 }) })] : []),
        state.selectionMode
          ? UI.Checkbox({ checked: selected, onCheckedChange: () => mark(workflow) })
          : UI.Switch({ checked: workflow.enabled, modifier: ctx.Modifier.scale(0.82), onCheckedChange: (enabled: boolean) => perform(async () => {
            await request({ action: "save", workflow: { ...workflow, enabled } });
          }) }),
      ]),
      ...(workflow.description ? [UI.Text({ text: workflow.description, style: "bodySmall", color: "onSurfaceVariant", maxLines: 2, overflow: "ellipsis" })] : []),
      ...executionStatus(workflow),
      UI.Row({ fillMaxWidth: true, spacing: 4, verticalAlignment: "center" }, [
        UI.Text({ text: String(workflow.nodes.length), style: "labelMedium", fontWeight: "semibold", color: "primary" }),
        UI.Text({ text: "节点", style: "labelSmall", color: "onSurfaceVariant" }),
        ...(workflow.totalExecutions > 0 ? [UI.Icon({ name: "PlayCircle", size: 14, tint: "onSurfaceVariant", paddingStart: 8 }),
          UI.Text({ text: String(workflow.totalExecutions), style: "labelSmall", color: "onSurfaceVariant" })] : []),
        UI.Box({ weight: 1 }),
        UI.Text({ text: date(workflow.updatedAt), style: "labelSmall", color: "onSurfaceVariant", maxLines: 1 }),
      ]),
    ]));
  }

  /** Groups compact cards by available width without platform-specific layout rules. */
  function cardRows(): ComposeNode[] {
    const columns = Math.max(1, Math.floor((state.width - 28) / 372));
    const rows: ComposeNode[] = [];
    for (let start = 0; start < state.snapshot.workflows.length; start += columns) {
      const items = state.snapshot.workflows.slice(start, start + columns);
      rows.push(UI.Row({ key: "workflow-row:" + start, fillMaxWidth: true, spacing: 12, verticalAlignment: "start" },
        Array.from({ length: columns }, (_, index) => UI.Box({ weight: 1 },
          index < items.length ? [workflowCard(items[index])] : []))));
    }
    return rows;
  }

  /** Renders the centered empty state or responsive scrollable card rows. */
  function listView(): ComposeNode {
    if (!state.ready) return UI.Box({ fillMaxSize: true, contentAlignment: "center" },
      state.error ? button("重新加载", initialize) : UI.CircularProgressIndicator());
    if (state.snapshot.workflows.length === 0) return UI.Box({ fillMaxSize: true, contentAlignment: "center", padding: 24 },
      UI.Column({ horizontalAlignment: "center", spacing: 8 }, [
        UI.Box({ width: 72, height: 72, contentAlignment: "center",
          modifier: ctx.Modifier.background(ctx.MaterialTheme.colorScheme.primaryContainer.copy({ alpha: 0.3 }), { cornerRadius: 36 }) }, UI.Text({ text: "⚡", fontSize: 45 })),
        UI.Spacer({ height: 16 }),
        UI.Text({ text: "开始创建工作流", style: "headlineSmall", fontWeight: "semibold" }),
        UI.Text({ text: "自动化你的任务流程", style: "bodyMedium", color: "onSurfaceVariant" }),
        UI.Spacer({ height: 24 }),
        UI.FilledTonalButton({ text: "＋  新建工作流", height: 48, onClick: () => update({ modal: "create", name: "", description: "" }) }),
      ]));
    return UI.LazyColumn({ fillMaxSize: true, padding: 20, spacing: 12 }, [
      ...(state.selectionMode ? [UI.Card({ fillMaxWidth: true, elevation: 0, containerColor: "surfaceVariant" }, UI.Row({ padding: 12, spacing: 4, verticalAlignment: "center" }, [
        UI.Text({ text: "已选择 " + state.marked.length + " / " + state.snapshot.workflows.length, weight: 1, style: "bodyMedium" }),
        button("全选", () => update({ marked: state.snapshot.workflows.map(item => item.id) })),
        button("清空", () => update({ marked: [] })),
      ]))] : []),
      ...cardRows(),
      UI.Spacer({ height: 72 }),
    ]);
  }

  /** Renders the inset graph and persists positions only after a completed grid-snapped drag. */
  function editor(workflow: Workflow): ComposeNode {
    return UI.Column({ fillMaxSize: true }, [
      UI.Row({ fillMaxWidth: true, spacing: 4, verticalAlignment: "center" }, [
        iconButton("ArrowBack", "返回工作流列表", () => update({ workflow: null, menu: false, modal: "" }), !state.busy && !state.saving),
        UI.TextButton({ key: "返回列表按钮", text: "返回工作流列表", enabled: !state.busy && !state.saving,
          onClick: () => update({ workflow: null, menu: false, modal: "" }) }),
        UI.Text({ text: workflow.name, style: "titleMedium", weight: 1, maxLines: 1, overflow: "ellipsis" }),
      ]),
      UI.Box({ weight: 1, fillMaxWidth: true, paddingHorizontal: 16, paddingVertical: 8 }, workflow.nodes.length === 0
        ? UI.Box({ fillMaxSize: true, background: "surfaceVariant", contentAlignment: "center" }, UI.Column({ padding: 24, spacing: 8, horizontalAlignment: "center" }, [
          UI.Text({ text: "📋", fontSize: 45 }),
          UI.Text({ text: "暂无节点", style: "bodyLarge", color: "onSurfaceVariant" }),
          UI.Text({ text: "点击右下角 + 按钮添加节点", style: "bodyMedium", color: "onSurfaceVariant" }),
          button("返回工作流列表", () => update({ workflow: null, menu: false, modal: "" }), !state.busy),
        ]))
        : graphCanvas(ctx, workflow, {
          viewport: state.viewport, run: state.latest, dragging: drag.current.nodeId,
          menu: nodeId => update({ selected: nodeId, modal: "nodeMenu", menu: false }),
          fit,
          begin: nodeId => { drag.current = { nodeId: state.busy || state.saving ? null : nodeId, before: copy(live.current.workflow) }; },
          drag: (dx, dy) => {
            const latest = live.current, selected = drag.current.nodeId;
            if (selected === null) update({ viewport: { ...latest.viewport, x: latest.viewport.x + dx, y: latest.viewport.y + dy } });
            else update({ workflow: { ...current(), nodes: current().nodes.map(node => node.id === selected
              ? { ...node, position: { x: node.position.x + dx / latest.viewport.zoom, y: node.position.y + dy / latest.viewport.zoom } } : node) } });
          },
          end: () => perform(async () => {
            const nodeId = drag.current.nodeId;
            drag.current = { nodeId: null, before: null };
            if (nodeId === null) return;
            const moved = current();
            await commit({ ...moved, nodes: moved.nodes.map(node => node.id === nodeId
              ? { ...node, position: snapPosition(node.position.x, node.position.y) } : node) });
          }),
          cancel: () => {
            const before = drag.current.before;
            if (drag.current.nodeId !== null && before !== null) update({ workflow: before });
            drag.current = { nodeId: null, before: null };
          },
          transform: (x, y, zoom) => update({ viewport: { ...live.current.viewport, x, y, zoom } }),
          resize: (width, height) => {
            if (width === live.current.viewport.width && height === live.current.viewport.height) return;
            update({ viewport: { ...live.current.viewport, width, height } });
            if (!live.current.fitted) fit();
          },
        })),
    ]);
  }

  /** Builds the expanding bottom-right action menu used by both Kotlin screens. */
  function speedDial(): ComposeNode {
    const actions: MenuAction[] = [];
    if (state.workflow === null) {
      if (state.selectionMode) {
        if (state.marked.length) actions.push({ label: "删除所选 (" + state.marked.length + ")", icon: "Delete", danger: true, action: () => update({ modal: "delete" }) });
        actions.push({ label: "退出多选", icon: "CheckCircle", action: () => update({ selectionMode: false, marked: [] }) });
      } else actions.push(
        { label: "创建空白工作流", icon: "Add", action: () => update({ modal: "create", name: "", description: "" }) },
        { label: "从模板创建", icon: "PlayCircle", action: () => update({ modal: "templates" }) },
        { label: "多选", icon: "CheckCircle", action: () => update({ selectionMode: true, marked: [] }) },
        { label: "导入工作流", icon: "FileUpload", action: () => update({ modal: "import", text: "" }) },
      );
    } else {
      if (state.workflow.enabled || state.busy) actions.push({ label: state.busy ? "取消执行" : "触发工作流", icon: state.busy ? "Close" : "PlayArrow",
        action: state.busy ? async () => { await request({ action: "cancel", id: current().id }); } : run });
      actions.push(
        { label: "查看日志", icon: "Call", action: async () => { await request({ action: "list" }); update({ modal: "logs", logId: null, logNode: null }); } },
        { label: "添加节点", icon: "Add", enabled: !state.busy, action: () => showNode(null) },
        { label: "编辑工作流", icon: "Edit", enabled: !state.busy, action: () => {
          const workflow = current(); update({ modal: "meta", name: workflow.name, description: workflow.description, enabled: workflow.enabled });
        } },
        { label: "删除工作流", icon: "Delete", enabled: !state.busy, danger: true, action: () => update({ modal: "delete" }) },
      );
    }
    return UI.Column({ key: "workflow-speed-dial", modifier: ctx.Modifier.align("bottomEnd").heightIn(0, 440),
      padding: 16, spacing: 16, horizontalAlignment: "end",
    }, [
      ...(state.menu ? [UI.LazyColumn({ key: "speed-dial-actions", weight: 1, weightFill: false, height: actions.length * 56, width: 260, spacing: 16 },
        actions.map(item => UI.Row({ key: item.label, fillMaxWidth: true, horizontalArrangement: "end", verticalAlignment: "center", spacing: 12 }, [
          UI.Box({ weight: 1, contentAlignment: "end" }, UI.Surface({ shape: { cornerRadius: 8 }, containerColor: "surface",
            ...(item.enabled !== false && !state.saving ? { onClick: () => perform(async () => { update({ menu: false }); await item.action(); }) } : {}),
          }, UI.Text({ text: item.label, paddingHorizontal: 12, paddingVertical: 8, style: "labelLarge" }))),
          UI.SmallFloatingActionButton({ key: item.label + ":fab", icon: item.icon, shape: { cornerRadius: 12 },
            enabled: item.enabled !== false && !state.saving,
            containerColor: item.danger ? "errorContainer" : "primaryContainer", contentColor: item.danger ? "onErrorContainer" : "onPrimaryContainer",
            onClick: () => perform(async () => { update({ menu: false }); await item.action(); }),
          }),
        ])))] : []),
      UI.FloatingActionButton({ key: "workflow-menu", icon: state.menu ? "Close" : "Add", shape: { cornerRadius: 16 },
        containerColor: "primary", contentColor: "onPrimary", onClick: () => update({ menu: !live.current.menu }) }),
    ]);
  }

  /** Renders existing outgoing edges and available target cards in the connection dialog. */
  function connections(workflow: Workflow, source: WorkflowNode): ComposeNode[] {
    const outgoing = workflow.connections.filter(edge => edge.sourceNodeId === source.id);
    const targets = workflow.nodes.filter(node => node.id !== source.id && !outgoing.some(edge => edge.targetNodeId === node.id));
    return [
      UI.Text({ text: "源节点：" + source.name, style: "bodyMedium", color: "onSurfaceVariant" }),
      ...(outgoing.length ? [UI.Text({ text: "已有连接", style: "titleSmall", color: "primary" })] : []),
      ...outgoing.map(edge => {
        const target = workflow.nodes.find(node => node.id === edge.targetNodeId)!;
        return UI.Card({ fillMaxWidth: true, elevation: 0, containerColor: "errorContainer", containerAlpha: 0.3 }, UI.Row({ padding: 12, verticalAlignment: "center" }, [
          UI.Column({ weight: 1, spacing: 4 }, [UI.Text({ text: target.name }), UI.Text({ text: "→ " + (edge.condition === null
            ? source.type === "condition" || source.type === "logic" ? "默认 true 分支" : "无条件" : edge.condition), style: "bodySmall", color: "onSurfaceVariant" })]),
          iconButton("Edit", "编辑连接条件", () => update({ modal: "condition", edgeId: edge.id, text: edge.condition === null ? "" : edge.condition,
            conditionMode: edge.condition === null || edge.condition === "" ? "default" : edge.condition === "false" ? "false" : "custom" })),
          iconButton("Delete", "删除连接", async () => { await commit({ ...current(), connections: current().connections.filter(item => item.id !== edge.id) }); }, !state.busy),
        ]));
      }),
      ...(outgoing.length ? [UI.HorizontalDivider()] : []),
      UI.Text({ text: targets.length ? "选择目标节点" : "没有可连接的节点", style: "titleSmall", color: "primary" }),
      ...targets.map(target => UI.Card({ fillMaxWidth: true, elevation: 0, containerColor: "surfaceVariant" }, UI.Row({ padding: 12, spacing: 8, verticalAlignment: "center" }, [
        UI.Text({ text: target.type === "trigger" ? "🎯" : "⚙️" }),
        UI.Column({ weight: 1, spacing: 4 }, [UI.Text({ text: target.name }), ...(target.description ? [UI.Text({ text: target.description, style: "bodySmall", maxLines: 1 })] : [])]),
        iconButton("Add", "连接到 " + target.name, async () => {
          const next = copy(current());
          next.connections.push({ id: id("edge"), sourceNodeId: source.id, targetNodeId: target.id, condition: null });
          await commit(next);
        }, !state.busy),
      ]))),
    ];
  }

  /** Shows run metadata and filters node output when invoked from a node menu. */
  function logs(workflow: Workflow): ComposeNode[] {
    const runs = state.snapshot.runs.filter(run => run.workflowId === workflow.id).sort((a, b) => b.startedAt - a.startedAt);
    if (state.latest !== null && state.latest.workflowId === workflow.id) {
      const index = runs.findIndex(run => run.id === state.latest!.id);
      if (index >= 0) runs[index] = state.latest; else runs.unshift(state.latest);
    }
    const selected = state.logId === null ? runs[0] : runs.find(run => run.id === state.logId);
    if (selected === undefined) return [UI.Text({ text: "暂无执行日志" })];
    return [
      ...(runs.length > 1 ? [choose(ctx, "run-history", "执行记录", selected.id, runs.map(run => ({ value: run.id, label: date(run.startedAt) + " · " + status(run.status).text })), logId => update({ logId }))] : []),
      UI.Text({ text: status(selected.status).text, style: "titleMedium", color: status(selected.status).color }),
      UI.Text({ text: "开始时间：" + date(selected.startedAt), style: "bodySmall" }),
      ...(selected.finishedAt === null ? [] : [UI.Text({ text: "耗时：" + (selected.finishedAt - selected.startedAt) + " ms", style: "bodySmall" })]),
      UI.HorizontalDivider(),
      ...Object.entries(selected.nodes).filter(([nodeId]) => state.logNode === null || nodeId === state.logNode).map(([nodeId, result]) => {
        const node = workflow.nodes.find(item => item.id === nodeId);
        return UI.Column({ spacing: 6 }, [
          UI.Text({ text: (node === undefined ? nodeId : node.name) + " · " + result.status, style: "titleSmall" }),
          UI.Text({ text: result.output, fontSize: 12 }),
        ]);
      }),
      ...selected.logs.filter(entry => state.logNode === null || entry.nodeId === state.logNode).map(entry =>
        UI.Text({ text: new Date(entry.time).toLocaleTimeString() + " " + entry.message, fontSize: 12, color: entry.level === "error" ? "error" : "onSurfaceVariant" })),
    ];
  }

  /** Renders every edit as an explicit confirm/cancel transaction, like the Kotlin dialogs. */
  function modal(): ComposeNode[] {
    const workflow = state.workflow;
    const node = workflow === null ? undefined : workflow.nodes.find(item => item.id === state.selected);
    const cancel = button("取消", dismiss);
    const close = button("关闭", dismiss);
    switch (state.modal) {
      case "": return [];
      case "create": return [dialog("create", "创建工作流", [
        field(ctx, "create-name", "工作流名称", state.name, name => update({ name })),
        field(ctx, "create-description", "工作流描述", state.description, description => update({ description }), true),
      ], [close, button("创建", async () => openCreated(await request({ action: "create", name: live.current.name, description: live.current.description })), state.name.trim().length > 0)], 212)];
      case "templates": {
        const options = [
          ...templates().map(template => ({ key: `builtin:${template.id}`, name: template.name, description: template.description, builtin: template })),
          ...state.snapshot.manifestTemplates.map(template => ({ key: `${template.sourceToolPkgId}:${template.templateId}`, name: template.displayName, description: template.description, manifest: template })),
        ];
        return [dialog("templates", "选择模板", options.map(option => UI.Card({
          key: option.key,
          fillMaxWidth: true, elevation: 0, containerColor: "surfaceVariant",
          modifier: ctx.Modifier.clickable(() => perform(async () => {
            const result = "builtin" in option
              ? await request({ action: "import", json: JSON.stringify(option.builtin) })
              : await request({ action: "import_manifest_template", sourceToolPkgId: option.manifest.sourceToolPkgId, templateId: option.manifest.templateId });
            openCreated(result);
          })),
        }, UI.Column({ padding: 16, spacing: 8 }, [UI.Text({ text: option.name, style: "titleMedium" }), UI.Text({ text: option.description, style: "bodySmall", color: "onSurfaceVariant" })]))), [close], 320)];
      }
      case "meta": return [dialog("meta", "编辑工作流", [
        field(ctx, "workflow-name", "工作流名称", state.name, name => update({ name })),
        field(ctx, "workflow-description", "工作流描述", state.description, description => update({ description }), true),
        UI.Row({ fillMaxWidth: true, verticalAlignment: "center" }, [UI.Text({ text: "启用工作流", weight: 1 }), UI.Switch({ checked: state.enabled, onCheckedChange: (enabled: boolean) => update({ enabled }) })]),
        UI.FlowRow({ spacing: 8 }, [
          button("导出 JSON", () => update({ modal: "export", text: JSON.stringify(current(), null, 2), path: "" })),
          button("复制工作流", async () => { await request({ action: "copy", id: current().id }); await ctx.showToast("已复制工作流"); }),
        ]),
      ], [cancel, button("保存", async () => { await commit({ ...current(), name: live.current.name, description: live.current.description, enabled: live.current.enabled }); dismiss(); }, state.name.trim().length > 0 && !state.busy)], 340)];
      case "node": {
        const draft = state.nodeDraft;
        if (draft === null || workflow === null) throw new Error("节点编辑上下文不存在");
        const dialogs = [dialog("node:" + draft.id, state.adding ? "添加节点" : "编辑节点", [
          ...(state.adding ? [choose(ctx, "node-type", "节点类型", draft.type, (Object.keys(STYLES) as NodeKind[]).map(value => ({ value, label: STYLES[value].label + "节点" })), value => {
            const next = newNode(value as NodeKind);
            update({ nodeDraft: { ...next, id: draft.id, position: draft.position } });
          })] : []),
          ...nodeForm(ctx, workflow, draft, state.tools, nodeDraft => update({ nodeDraft }), () => update({ schedule: copy(live.current.nodeDraft) })),
        ], [cancel, button(state.adding ? "添加" : "保存", saveNode, !state.busy)], 440)];
        const schedule = state.schedule;
        if (schedule !== null && schedule.type === "trigger") dialogs.push(dialog("schedule", "定时配置",
          scheduleForm(ctx, schedule, value => update({ schedule: value })), [
            button("取消", () => update({ schedule: null })),
            button("确认", () => update({ nodeDraft: live.current.schedule, schedule: null })),
          ], 400, () => update({ schedule: null })));
        return dialogs;
      }
      case "nodeMenu": {
        if (node === undefined) throw new Error("选中的节点不存在");
        return [dialog("node-menu", node.name, [
          UI.TextButton({ text: "✎  编辑节点", fillMaxWidth: true, enabled: !state.busy, onClick: () => showNode(node) }),
          UI.TextButton({ text: "☎  查看日志", fillMaxWidth: true, onClick: () => update({ modal: "logs", logNode: node.id, logId: null }) }),
          UI.TextButton({ text: "↗  创建连接", fillMaxWidth: true, enabled: !state.busy, onClick: () => update({ modal: "connections" }) }),
          UI.TextButton({ text: "删除节点", contentColor: "error", fillMaxWidth: true, enabled: !state.busy, onClick: () => update({ modal: "deleteNode" }) }),
        ], [cancel], 236)];
      }
      case "connections":
        if (workflow === null || node === undefined) throw new Error("连线编辑上下文不存在");
        return [dialog("connections", "管理连接", connections(workflow, node), [close], 400)];
      case "condition": {
        const edge = current().connections.find(item => item.id === state.edgeId);
        if (edge === undefined) throw new Error("连线不存在");
        const source = current().nodes.find(item => item.id === edge.sourceNodeId)!;
        const target = current().nodes.find(item => item.id === edge.targetNodeId)!;
        const choices: { value: State["conditionMode"]; label: string }[] = [
          { value: "default", label: source.type === "condition" || source.type === "logic" ? "默认（true 分支）" : "默认（无条件）" },
          { value: "false", label: "false 分支" }, { value: "custom", label: "自定义（正则表达式 / 成功或失败分支）" },
        ];
        return [dialog("condition", "编辑连接条件", [
          UI.Text({ text: source.name + " → " + target.name, style: "bodyMedium" }),
          ...choices.map(choice => UI.Row({ verticalAlignment: "center", spacing: 8 }, [
            UI.RadioButton({ selected: state.conditionMode === choice.value, onClick: () => update({ conditionMode: choice.value }) }),
            UI.Text({ text: choice.label, weight: 1 }),
          ])),
          ...(state.conditionMode === "custom" ? [field(ctx, "edge-condition", "正则表达式 / on_success / on_error", state.text, text => update({ text }))] : []),
        ], [button("取消", () => update({ modal: "connections" })), button("确认", async () => {
          const condition = live.current.conditionMode === "default" ? null : live.current.conditionMode === "false" ? "false" : live.current.text.trim();
          await commit({ ...current(), connections: current().connections.map(item => item.id === edge.id ? { ...item, condition } : item) });
          update({ modal: "connections" });
        })], 260, () => update({ modal: "connections" }))];
      }
      case "logs":
        if (workflow === null) throw new Error("工作流不存在");
        return [dialog("logs", state.logNode === null ? "执行日志" : "节点执行日志", logs(workflow), [close], 420)];
      case "result": return [dialog("result", "执行结果", [
        UI.Text({ text: state.latest === null ? "执行已结束" : status(state.latest.status).text }),
      ], [button("查看日志", () => update({ modal: "logs", logNode: null, logId: null })), button("确定", dismiss)], 64)];
      case "deleteNode": return [dialog("delete-node", "确认删除", [
        UI.Text({ text: "确定删除节点「" + (node === undefined ? "" : node.name) + "」及相关连接？" }),
      ], [cancel, button("删除", removeNode, !state.busy, true)], 72)];
      case "delete": return [dialog("delete-workflow", "确认删除", [
        UI.Text({ text: workflow === null ? "确定删除所选的 " + state.marked.length + " 个工作流？" : "确定删除工作流「" + workflow.name + "」？" }),
      ], [cancel, button("删除", async () => {
        await request({ action: "delete", ids: workflow === null ? live.current.marked : [workflow.id] });
        update({ workflow: null, marked: [], selectionMode: false }); dismiss();
      }, !state.busy, true)], 72)];
      case "import": return [dialog("import", "导入工作流", [
        UI.Text({ text: "导入 Workflow JSON。导入后为停用状态，请检查节点配置后启用。", style: "bodySmall" }),
        field(ctx, "import-json", "Workflow JSON", state.text, text => update({ text }), true),
        button("选择 JSON 文件", async () => {
          const picked = await ctx.openFilePicker({ picker: "document", mimeTypes: ["application/json"] });
          if (picked.cancelled) return;
          if (picked.files.length !== 1) throw new Error("请选择一个工作流文件");
          update({ text: (await Tools.Files.read(picked.files[0].path)).content });
        }),
      ], [cancel, button("导入", async () => openCreated(await request({ action: "import", json: live.current.text })), state.text.trim().length > 0)], 310)];
      case "export": return [dialog("export", "导出工作流", [
        UI.OutlinedTextField({ value: state.text, onValueChange: () => {}, readOnly: true, minLines: 5, maxLines: 10, fillMaxWidth: true }),
        field(ctx, "export-path", "保存路径", state.path, path => update({ path })),
      ], [close, button("导出", async () => {
        await Tools.Files.create(live.current.path, live.current.text); await ctx.showToast("已导出工作流"); dismiss();
      }, state.path.trim().length > 0)], 340)];
    }
  }

  return UI.Box({ fillMaxSize: true, key: "workflow-root", topBarTitle: UI.Text({ text: "工作流" }), onLoad: () => perform(initialize),
    modifier: ctx.Modifier.onSizeChanged(size => {
      if (size.width !== live.current.width) update({ width: size.width });
    }),
  }, [
    state.workflow === null ? listView() : editor(state.workflow),
    speedDial(),
    ...(state.error && state.modal === "" ? [UI.Row({ modifier: ctx.Modifier.align("topCenter"), background: "errorContainer", padding: 12, spacing: 8, fillMaxWidth: true }, [
      UI.Text({ text: state.error, color: "onErrorContainer", weight: 1 }), button("关闭", () => update({ error: "" })),
    ])] : []),
    ...modal(),
  ]);
}
