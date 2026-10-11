"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorText = errorText;
exports.resolve = resolve;
exports.boolean = boolean;
exports.compare = compare;
exports.jsonPath = jsonPath;
exports.extract = extract;
exports.edgeMatches = edgeMatches;
exports.execute = execute;
const model_1 = require("./model");
const validation_1 = require("./validation");
/** Converts thrown values into useful log messages. */
function errorText(error) { return error instanceof Error ? error.message : String(error); }
/** Resolves a literal or an explicitly completed upstream output. */
function resolve(value, results) {
    if ("value" in value)
        return value.value;
    const source = results[value.nodeId];
    if (source === undefined || source.status !== "success")
        throw new Error(`引用节点未成功完成：${value.nodeId}`);
    return source.output;
}
/** Decodes boolean output using the original executor's explicit vocabulary. */
function boolean(value) {
    switch (value.trim().toLowerCase()) {
        case "true":
        case "1":
        case "yes":
        case "y":
        case "on": return true;
        case "false":
        case "0":
        case "no":
        case "n":
        case "off": return false;
        default: throw new Error(`输出不是布尔值：${value}`);
    }
}
/** Compares typed numeric or textual operands with explicit membership syntax. */
function compare(node, results) {
    const a = resolve(node.left, results), b = resolve(node.right, results);
    if (node.operator === "CONTAINS")
        return a.includes(b);
    if (node.operator === "NOT_CONTAINS")
        return !a.includes(b);
    if (node.operator === "IN" || node.operator === "NOT_IN") {
        const list = JSON.parse(b);
        if (!Array.isArray(list) || !list.every(value => typeof value === "string") && !list.every(value => typeof value === "number"))
            throw new Error("IN 的右值必须是同类型字符串或数字 JSON 数组");
        const hit = list.length > 0 && list.some(value => value === (typeof list[0] === "number" ? Number(a) : a));
        return node.operator === "IN" ? hit : !hit;
    }
    const an = a.trim() !== "" && Number.isFinite(Number(a)), bn = b.trim() !== "" && Number.isFinite(Number(b));
    if (an !== bn)
        throw new Error("条件比较的左右值类型不一致");
    const left = an ? Number(a) : a, right = bn ? Number(b) : b;
    switch (node.operator) {
        case "EQ": return left === right;
        case "NE": return left !== right;
        case "GT": return left > right;
        case "GTE": return left >= right;
        case "LT": return left < right;
        case "LTE": return left <= right;
    }
}
/** Reads a strict property/index path from JSON without evaluating expressions. */
function jsonPath(source, path) {
    let result = JSON.parse(source);
    let cursor = path.startsWith("$") ? 1 : 0;
    while (cursor < path.length) {
        const match = /^(?:\.?([A-Za-z_$][\w$]*)|\[(\d+)\])/.exec(path.slice(cursor));
        if (!match)
            throw new Error(`JSON 路径无效：${path}`);
        const key = match[1] === undefined ? match[2] : match[1];
        if (result === null || typeof result !== "object" || !Object.prototype.hasOwnProperty.call(result, key))
            throw new Error(`JSON 路径不存在：${path}`);
        result = result[key];
        cursor += match[0].length;
    }
    if (path === "")
        throw new Error("JSON 路径不能为空，整个对象请使用 $");
    return typeof result === "string" ? result : JSON.stringify(result);
}
/** Executes all six extraction modes, reporting malformed or missing data. */
function extract(node, results) {
    switch (node.mode) {
        case "RANDOM_INT": {
            if (node.useFixed) {
                if (!/^-?\d+$/.test(node.fixedValue) || !Number.isSafeInteger(Number(node.fixedValue)))
                    throw new Error("固定值必须是整数");
                return node.fixedValue;
            }
            return String(node.randomMin + Math.floor(Math.random() * (node.randomMax - node.randomMin + 1)));
        }
        case "RANDOM_STRING": return node.useFixed ? node.fixedValue : Array.from({ length: node.randomStringLength }, () => node.randomStringCharset[Math.floor(Math.random() * node.randomStringCharset.length)]).join("");
        case "CONCAT": return [node.source, ...node.others].map(value => resolve(value, results)).join("");
        case "SUB": {
            const source = resolve(node.source, results);
            if (node.startIndex > source.length)
                throw new Error("截取起点超出字符串长度");
            return node.length === -1 ? source.slice(node.startIndex) : source.slice(node.startIndex, node.startIndex + node.length);
        }
        case "JSON": return jsonPath(resolve(node.source, results), node.expression);
        case "REGEX": {
            const match = new RegExp(node.expression).exec(resolve(node.source, results));
            if (match === null || match[node.group] === undefined)
                throw new Error("正则表达式未匹配到指定分组");
            return match[node.group];
        }
    }
}
/** Evaluates an edge against its source node's actual result and state. */
function edgeMatches(edge, source, result) {
    if (result.status === "skipped")
        return false;
    let condition = edge.condition === null ? "" : edge.condition.trim();
    if (condition === "" && (source.type === "condition" || source.type === "logic"))
        condition = "true";
    switch (condition.toLowerCase()) {
        case "on_error":
        case "error":
        case "failed": return result.status === "failed";
        case "":
        case "on_success":
        case "success":
        case "ok": return result.status === "success";
        case "true": return result.status === "success" && boolean(result.output);
        case "false": return result.status === "success" && !boolean(result.output);
        default: return result.status === "success" && new RegExp(condition).test(result.output);
    }
}
/** Executes a validated graph once, including gated branches and error edges. */
async function execute(workflow, triggerId, extras, host) {
    const run = { id: (0, model_1.id)("run"), workflowId: workflow.id, workflowName: workflow.name, triggerId,
        status: "RUNNING", startedAt: Date.now(), finishedAt: null, nodes: {}, logs: [] };
    /** Stores one observable node transition with a timestamped log. */
    async function transition(node, status, output) {
        const previous = run.nodes[node.id];
        run.nodes[node.id] = { status, output, startedAt: previous.startedAt === null ? Date.now() : previous.startedAt,
            finishedAt: status === "running" ? null : Date.now() };
        run.logs.push({ time: Date.now(), nodeId: node.id, level: status === "failed" ? "error" : "info", message: `${node.name} · ${status}${status === "failed" ? ": " + output : ""}` });
        await host.changed(run);
    }
    try {
        (0, validation_1.validateGraph)(workflow, true);
        if (!workflow.enabled)
            throw new Error("工作流已停用");
        const nodes = new Map(workflow.nodes.map(node => [node.id, node]));
        const triggers = workflow.nodes.filter(node => node.type === "trigger" && (triggerId === null ? node.triggerType === "manual" : node.id === triggerId));
        if (!triggers.length)
            throw new Error(triggerId === null ? "工作流没有手动触发节点" : "指定触发节点不存在");
        const active = new Set(triggers.map(node => node.id));
        const queue = [...active];
        for (let i = 0; i < queue.length; i++)
            for (const edge of workflow.connections.filter(edge => edge.sourceNodeId === queue[i])) {
                if (!active.has(edge.targetNodeId)) {
                    active.add(edge.targetNodeId);
                    queue.push(edge.targetNodeId);
                }
            }
        for (const node of workflow.nodes)
            run.nodes[node.id] = { status: active.has(node.id) ? "pending" : "skipped", output: "", startedAt: null, finishedAt: null };
        await host.changed(run);
        const pending = workflow.nodes.filter(node => active.has(node.id));
        while (pending.length) {
            if (host.cancelled()) {
                run.status = "CANCELLED";
                break;
            }
            const index = pending.findIndex(node => workflow.connections.filter(edge => edge.targetNodeId === node.id && active.has(edge.sourceNodeId)).every(edge => !["pending", "running"].includes(run.nodes[edge.sourceNodeId].status)));
            if (index < 0)
                throw new Error("依赖图无法继续执行");
            const node = pending.splice(index, 1)[0];
            const incoming = workflow.connections.filter(edge => edge.targetNodeId === node.id && active.has(edge.sourceNodeId));
            try {
                if (incoming.length > 0 && !incoming.some(edge => edgeMatches(edge, nodes.get(edge.sourceNodeId), run.nodes[edge.sourceNodeId]))) {
                    await transition(node, "skipped", "连线条件未满足");
                    continue;
                }
                await transition(node, "running", "");
                let output;
                switch (node.type) {
                    case "trigger":
                        output = JSON.stringify(extras);
                        break;
                    case "condition":
                        output = String(compare(node, run.nodes));
                        break;
                    case "logic": {
                        const inputs = incoming.filter(edge => run.nodes[edge.sourceNodeId].status === "success").map(edge => boolean(run.nodes[edge.sourceNodeId].output));
                        output = String(node.operator === "AND" ? inputs.length > 0 && inputs.every(Boolean) : inputs.some(Boolean));
                        break;
                    }
                    case "extract":
                        output = extract(node, run.nodes);
                        break;
                    case "execute": {
                        const params = Object.fromEntries(Object.entries(node.actionConfig).map(([key, value]) => [key, resolve(value, run.nodes)]));
                        output = node.jsCode !== null && node.jsCode.trim() !== "" ? await host.script(node.jsCode, params, extras) : await host.call(node.actionType, params);
                        break;
                    }
                }
                await transition(node, "success", output);
            }
            catch (error) {
                console.error(`[workflow:${workflow.id}:${node.id}]`, error);
                await transition(node, "failed", errorText(error));
            }
        }
        if (run.status !== "CANCELLED")
            run.status = Object.values(run.nodes).some(node => node.status === "failed") ? "FAILED" : "SUCCESS";
    }
    catch (error) {
        console.error(`[workflow:${workflow.id}]`, error);
        run.status = "FAILED";
        run.logs.push({ time: Date.now(), nodeId: "", level: "error", message: errorText(error) });
    }
    for (const node of Object.values(run.nodes))
        if (node.status === "pending") {
            node.status = "skipped";
            node.output = "执行已取消";
            node.finishedAt = Date.now();
        }
    run.finishedAt = Date.now();
    await host.changed(run);
    return run;
}
