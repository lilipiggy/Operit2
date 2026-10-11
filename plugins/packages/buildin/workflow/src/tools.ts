import { object, parseWorkflow } from "./validation";

/* METADATA
{
  "name": "workflow",
  "display_name": {"zh":"工作流","en":"Workflow"},
  "description": {"zh":"管理和执行可视化工作流。工作流保存在当前插件中。","en":"Manage and execute plugin-owned visual workflows."},
  "tools": [
    {"name":"list","description":"列出工作流和最近执行记录","parameters":[]},
    {"name":"import_workflow","description":"导入工作流 JSON；生成新 ID，初始停用，返回导入结果。","parameters":[{"name":"json","type":"string","required":true,"description":"Workflow JSON"}]},
    {"name":"run","description":"运行已启用的工作流；工具调用使用宿主权限。","parameters":[{"name":"id","type":"string","required":true,"description":"工作流 ID"},{"name":"triggerId","type":"string","required":false,"description":"指定触发节点 ID"}]},
    {"name":"save","description":"更新工作流；必须保留 list 返回的 revision，用于防止覆盖其他编辑。","parameters":[{"name":"json","type":"string","required":true,"description":"包含 revision 的完整 Workflow JSON"}]},
    {"name":"cancel","description":"请求在当前节点结束后取消后续执行","parameters":[{"name":"id","type":"string","required":true,"description":"工作流 ID"}]}
  ]
}
*/
const workflowServiceName = "workflow.service";
import type { Request } from "./service";
import type { Snapshot, Workflow } from "./model";

/** Calls the one main-runtime owner shared by UI, tools and schedules. */
function call(request: Request): Promise<Snapshot> { return ToolPkg.ipc.call<Request, Snapshot>(workflowServiceName, request, { targetRuntime: "main" }); }

/** Lists workflows together with retained execution records. */
export async function list(): Promise<Snapshot> { return call({ action: "list" }); }

/** Imports a new disabled workflow after structural validation. */
export async function import_workflow(params: { json: string }): Promise<Snapshot> { return call({ action: "import", json: params.json }); }

/** Executes all entry nodes or one explicitly selected trigger. */
export async function run(params: { id: string; triggerId?: string }): Promise<Snapshot> {
  return call({ action: "run", id: params.id, triggerId: params.triggerId === undefined ? null : params.triggerId, extras: {} });
}

/** Updates an existing graph using the caller's exact saved revision. */
export async function save(params: { json: string }): Promise<Snapshot> {
  const raw = object(JSON.parse(params.json), "工作流");
  const workflow: Workflow = parseWorkflow(raw);
  if (typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision)) throw new Error("revision 必须是整数");
  workflow.revision = raw.revision;
  return call({ action: "save", workflow });
}

/** Requests cooperative cancellation without claiming to interrupt host tools. */
export async function cancel(params: { id: string }): Promise<Snapshot> { return call({ action: "cancel", id: params.id }); }
