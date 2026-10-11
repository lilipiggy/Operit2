import { newNode, newWorkflow, values, type Workflow, type WorkflowNode, type Value, type NodeKind } from "./model";
import { validateTrigger } from "./schedule";

/** Requires a plain JSON object at an external input boundary. */
export function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

/** Requires a string instead of coercing malformed external input. */
export function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  return value;
}

/** Requires a finite numeric field. */
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
  return value;
}

/** Validates parameter values, including Kotlin serialization type annotations. */
export function parameter(value: unknown): Value {
  const raw = object(value, "参数");
  if (Object.hasOwnProperty.call(raw, "nodeId") && !Object.hasOwnProperty.call(raw, "value")) return { nodeId: string(raw.nodeId, "nodeId") };
  if (Object.hasOwnProperty.call(raw, "value") && !Object.hasOwnProperty.call(raw, "nodeId")) return { value: string(raw.value, "value") };
  throw new Error("参数必须是 {value: 字符串} 或 {nodeId: 节点ID}");
}

/** Checks an enum value against its exact public vocabulary. */
function enumValue<T extends string>(value: unknown, accepted: readonly T[], label: string): T {
  if (typeof value !== "string" || !accepted.some(item => item === value)) throw new Error(`${label} 取值无效：${JSON.stringify(value)}`);
  return value as T;
}

/** Decodes a node and applies only the documented initial values of omitted fields. */
export function parseNode(value: unknown): WorkflowNode {
  const raw = object(value, "节点");
  const type = enumValue<NodeKind>(raw.type, ["trigger", "execute", "condition", "logic", "extract"], "节点类型");
  const data: Record<string, unknown> = { ...newNode(type), ...raw };
  const position = object(data.position, "position");
  const base = { id: string(data.id, "id"), name: string(data.name, "name"), description: string(data.description, "description"),
    position: { x: number(position.x, "x"), y: number(position.y, "y") } };
  if (base.id === "") throw new Error("节点 ID 不能为空");
  switch (type) {
    case "trigger": {
      const node = newNode("trigger");
      if (node.type !== "trigger") throw new Error("节点类型不一致");
      const config = object(data.triggerConfig, "triggerConfig");
      return { ...node, ...base, triggerType: enumValue(data.triggerType, ["manual", "schedule", "app_open", "event"], "触发类型"),
        triggerConfig: Object.fromEntries(Object.entries(config).map(([key, item]) => [key, string(item, key)])) };
    }
    case "execute": return { ...base, type, actionType: string(data.actionType, "actionType"),
      actionConfig: Object.fromEntries(Object.entries(object(data.actionConfig, "actionConfig")).map(([key, item]) => [key, parameter(item)])),
      jsCode: data.jsCode === null ? null : string(data.jsCode, "jsCode") };
    case "condition": return { ...base, type, left: parameter(data.left), right: parameter(data.right),
      operator: enumValue(data.operator, ["EQ", "NE", "GT", "GTE", "LT", "LTE", "CONTAINS", "NOT_CONTAINS", "IN", "NOT_IN"], "比较符") };
    case "logic": return { ...base, type, operator: enumValue(data.operator, ["AND", "OR"], "逻辑符") };
    case "extract": {
      if (!Array.isArray(data.others)) throw new Error("others 必须是数组");
      if (typeof data.useFixed !== "boolean") throw new Error("useFixed 必须是布尔值");
      return { ...base, type, source: parameter(data.source), mode: enumValue(data.mode, ["REGEX", "JSON", "SUB", "CONCAT", "RANDOM_INT", "RANDOM_STRING"], "提取模式"),
        expression: string(data.expression, "expression"), group: number(data.group, "group"), others: data.others.map(parameter),
        startIndex: number(data.startIndex, "startIndex"), length: number(data.length, "length"), randomMin: number(data.randomMin, "randomMin"),
        randomMax: number(data.randomMax, "randomMax"), randomStringLength: number(data.randomStringLength, "randomStringLength"),
        randomStringCharset: string(data.randomStringCharset, "randomStringCharset"), useFixed: data.useFixed, fixedValue: string(data.fixedValue, "fixedValue") };
    }
  }
}

/** Imports workflow graph fields and deliberately resets runtime statistics. */
export function parseWorkflow(value: unknown): Workflow {
  const raw = object(value, "工作流");
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.connections)) throw new Error("nodes 和 connections 必须是数组");
  const result = newWorkflow(string(raw.name, "name"));
  if (raw.id !== undefined) result.id = string(raw.id, "id");
  if (raw.description !== undefined) result.description = string(raw.description, "description");
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
    result.enabled = raw.enabled;
  }
  result.nodes = raw.nodes.map(parseNode);
  result.connections = raw.connections.map(item => {
    const edge = object(item, "连接");
    return { id: string(edge.id, "连接ID"), sourceNodeId: string(edge.sourceNodeId, "起点"), targetNodeId: string(edge.targetNodeId, "终点"),
      condition: edge.condition === null || edge.condition === undefined ? null : string(edge.condition, "连线条件") };
  });
  validateGraph(result, false);
  return result;
}

/** Validates structure, references and cycles before persistence or execution. */
export function validateGraph(workflow: Workflow, executable: boolean): void {
  if (!workflow.name.trim()) throw new Error("工作流名称不能为空");
  const nodes = new Map(workflow.nodes.map(node => [node.id, node]));
  if (nodes.size !== workflow.nodes.length) throw new Error("节点 ID 重复");
  if (new Set(workflow.connections.map(edge => edge.id)).size !== workflow.connections.length) throw new Error("连线 ID 重复");
  const degree = new Map(workflow.nodes.map(node => [node.id, 0]));
  const next = new Map(workflow.nodes.map(node => [node.id, [] as string[]]));
  const parents = new Map(workflow.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of workflow.connections) {
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) throw new Error("连线指向不存在的节点");
    if (nodes.get(edge.targetNodeId)!.type === "trigger") throw new Error("触发节点不能有输入连线");
    next.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    parents.get(edge.targetNodeId)!.push(edge.sourceNodeId);
    degree.set(edge.targetNodeId, degree.get(edge.targetNodeId)! + 1);
    if (edge.condition !== null && edge.condition !== "" && !["true", "false", "on_success", "success", "ok", "on_error", "error", "failed"].includes(edge.condition.toLowerCase())) new RegExp(edge.condition);
  }
  const queue = [...degree].filter(([, count]) => count === 0).map(([key]) => key);
  for (let index = 0; index < queue.length; index++) {
    for (const target of next.get(queue[index])!) { degree.set(target, degree.get(target)! - 1); if (degree.get(target) === 0) queue.push(target); }
  }
  if (queue.length !== workflow.nodes.length) throw new Error("工作流存在循环依赖");
  for (const node of workflow.nodes) {
    parseNode(node);
    const ancestors = new Set<string>();
    const visit = [...parents.get(node.id)!];
    for (let index = 0; index < visit.length; index++) {
      if (ancestors.has(visit[index])) continue;
      ancestors.add(visit[index]); visit.push(...parents.get(visit[index])!);
    }
    for (const value of values(node)) {
      if ("nodeId" in value && !nodes.has(value.nodeId)) throw new Error(`${node.name} 引用的节点不存在`);
      if (executable && "nodeId" in value && !ancestors.has(value.nodeId)) throw new Error(`${node.name} 引用的节点必须通过连线位于上游`);
    }
    if (executable && node.type === "trigger") validateTrigger(node);
    if (executable && node.type === "execute" && !node.actionType.trim() && (node.jsCode === null || !node.jsCode.trim())) throw new Error(`${node.name} 尚未配置工具或脚本`);
    if (executable && node.type === "extract") {
      if (node.mode === "REGEX") new RegExp(node.expression);
      for (const value of [node.group, node.startIndex, node.length, node.randomMin, node.randomMax, node.randomStringLength]) if (!Number.isSafeInteger(value)) throw new Error("提取索引、长度及范围必须是整数");
      if (node.group < 0 || node.startIndex < 0 || node.length < -1 || node.randomMax < node.randomMin || node.randomStringLength < 0 || node.randomStringLength > 10000 || node.randomStringCharset.length === 0) throw new Error("提取节点参数超出范围");
    }
  }
  if (executable && !workflow.nodes.some(node => node.type === "trigger")) throw new Error("工作流至少需要一个触发节点");
}
