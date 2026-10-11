"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STYLES = void 0;
exports.id = id;
exports.copy = copy;
exports.newNode = newNode;
exports.newWorkflow = newWorkflow;
exports.duplicate = duplicate;
exports.values = values;
exports.STYLES = {
    trigger: { label: "触发", color: "#4CAF50", tint: "#E8F5E9", border: "#81C784" },
    execute: { label: "执行", color: "#2196F3", tint: "#E3F2FD", border: "#64B5F6" },
    condition: { label: "条件", color: "#FF9800", tint: "#FFF3E0", border: "#FFB74D" },
    logic: { label: "逻辑", color: "#7E57C2", tint: "#F3E5F5", border: "#B39DDB" },
    extract: { label: "运算", color: "#009688", tint: "#E0F2F1", border: "#4DB6AC" },
};
/** Creates a collision-resistant identifier within a plugin runtime. */
function id(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}
/** Copies JSON-owned workflow state without sharing mutable references. */
function copy(value) { return JSON.parse(JSON.stringify(value)); }
/** Creates the explicit initial configuration for each supported node type. */
function newNode(type, x = 40, y = 40) {
    const base = { id: id("node"), name: exports.STYLES[type].label, description: "", position: { x, y } };
    switch (type) {
        case "trigger": return { ...base, type, triggerType: "manual", triggerConfig: {} };
        case "execute": return { ...base, type, actionType: "", actionConfig: {}, jsCode: null };
        case "condition": return { ...base, type, left: { value: "" }, operator: "EQ", right: { value: "" } };
        case "logic": return { ...base, type, operator: "AND" };
        case "extract": return { ...base, type, source: { value: "" }, mode: "REGEX", expression: "", group: 0,
            others: [], startIndex: 0, length: -1, randomMin: 0, randomMax: 100, randomStringLength: 8,
            randomStringCharset: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", useFixed: false, fixedValue: "" };
    }
}
/** Creates the blank workflow shown by the Kotlin creation dialog. */
function newWorkflow(name, description = "") {
    return { id: id("workflow"), name, description, nodes: [], connections: [],
        createdAt: Date.now(), updatedAt: Date.now(), enabled: true, revision: 0, totalExecutions: 0,
        successfulExecutions: 0, failedExecutions: 0, lastExecutionTime: null, lastExecutionStatus: null };
}
/** Resets identities and statistics while preserving all internal references. */
function duplicate(workflow) {
    const result = copy(workflow);
    const ids = new Map(result.nodes.map(node => [node.id, id("node")]));
    /** Rewrites a parameter reference into the duplicated graph. */
    function remap(value) {
        if ("value" in value)
            return value;
        const next = ids.get(value.nodeId);
        if (next === undefined)
            throw new Error(`引用节点不存在：${value.nodeId}`);
        return { nodeId: next };
    }
    for (const node of result.nodes) {
        node.id = ids.get(node.id);
        if (node.type === "execute")
            node.actionConfig = Object.fromEntries(Object.entries(node.actionConfig).map(([key, value]) => [key, remap(value)]));
        if (node.type === "condition") {
            node.left = remap(node.left);
            node.right = remap(node.right);
        }
        if (node.type === "extract") {
            node.source = remap(node.source);
            node.others = node.others.map(remap);
        }
    }
    result.connections = result.connections.map(edge => ({ ...edge, id: id("edge"), sourceNodeId: ids.get(edge.sourceNodeId), targetNodeId: ids.get(edge.targetNodeId) }));
    return { ...result, id: id("workflow"), revision: 0, createdAt: Date.now(), updatedAt: Date.now(),
        totalExecutions: 0, successfulExecutions: 0, failedExecutions: 0, lastExecutionTime: null, lastExecutionStatus: null };
}
/** Returns the reference-bearing parameters of a node. */
function values(node) {
    switch (node.type) {
        case "execute": return Object.values(node.actionConfig);
        case "condition": return [node.left, node.right];
        case "extract": return [node.source, ...node.others];
        default: return [];
    }
}
