"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templates = templates;
const model_1 = require("./model");
/** Connects two template nodes with an optional branch condition. */
function connect(source, target, condition = null) {
    return {
        id: (0, model_1.id)("edge"),
        sourceNodeId: source.id,
        targetNodeId: target.id,
        condition,
    };
}
/** Creates a configured trigger node at the requested canvas position. */
function triggerNode(name, x, y, triggerType = "manual") {
    const node = (0, model_1.newNode)("trigger", x, y);
    if (node.type !== "trigger")
        throw new Error("节点类型不一致");
    node.name = name;
    node.triggerType = triggerType;
    return node;
}
/** Creates a configured execute node for a host tool. */
function executeNode(name, actionType, actionConfig, x, y) {
    const node = (0, model_1.newNode)("execute", x, y);
    if (node.type !== "execute")
        throw new Error("节点类型不一致");
    node.name = name;
    node.actionType = actionType;
    node.actionConfig = actionConfig;
    return node;
}
/** Creates a configured extraction node for deterministic template data. */
function extractNode(name, x, y) {
    const node = (0, model_1.newNode)("extract", x, y);
    if (node.type !== "extract")
        throw new Error("节点类型不一致");
    node.name = name;
    return node;
}
/** Creates a configured condition node for a template branch. */
function conditionNode(name, x, y) {
    const node = (0, model_1.newNode)("condition", x, y);
    if (node.type !== "condition")
        throw new Error("节点类型不一致");
    node.name = name;
    return node;
}
/** Creates a configured logic node for combining condition outputs. */
function logicNode(name, x, y) {
    const node = (0, model_1.newNode)("logic", x, y);
    if (node.type !== "logic")
        throw new Error("节点类型不一致");
    node.name = name;
    return node;
}
/** Builds a manual notification workflow. */
function manualNotification() {
    const workflow = (0, model_1.newWorkflow)("手动通知", "手动触发后发送一条系统通知。");
    const trigger = triggerNode("手动触发", 60, 80);
    const notification = executeNode("发送通知", "send_notification", { title: { value: "工作流" }, message: { value: "工作流已执行" } }, 300, 80);
    workflow.nodes = [trigger, notification];
    workflow.connections = [connect(trigger, notification)];
    return workflow;
}
/** Builds a graph that demonstrates true and false branches. */
function randomConditionBranch() {
    const workflow = (0, model_1.newWorkflow)("随机数条件分支", "生成随机数，比较大小，并沿 true / false 连线显示不同结果；不调用外部工具。");
    const trigger = triggerNode("手动触发", 60, 100);
    const random = extractNode("随机数 0–100", 280, 100);
    random.mode = "RANDOM_INT";
    const condition = conditionNode("大于等于 50", 500, 100);
    condition.left = { nodeId: random.id };
    condition.operator = "GTE";
    condition.right = { value: "50" };
    const yes = extractNode("较大的数", 740, 40);
    yes.mode = "CONCAT";
    yes.source = { value: "数值 ≥ 50" };
    const no = extractNode("较小的数", 740, 180);
    no.mode = "CONCAT";
    no.source = { value: "数值 < 50" };
    workflow.nodes = [trigger, random, condition, yes, no];
    workflow.connections = [
        connect(trigger, random),
        connect(random, condition),
        connect(condition, yes, "true"),
        connect(condition, no, "false"),
    ];
    return workflow;
}
/** Builds the old web-key extraction and conditional-link workflow. */
function webKeywordBranch() {
    const workflow = (0, model_1.newWorkflow)("网页关键字分支", "访问网页后提取 Visit key；页面包含 Example Domain 时继续打开第一个链接，否则访问备用页面。");
    const trigger = triggerNode("手动触发", 40, 120);
    const visit = executeNode("访问网页", "visit_web", { url: { value: "https://example.com" } }, 260, 120);
    const visitKey = extractNode("提取 Visit key", 480, 120);
    visitKey.mode = "REGEX";
    visitKey.source = { nodeId: visit.id };
    visitKey.expression = "Visit key:\\s*([^\\s]+)";
    visitKey.group = 1;
    const condition = conditionNode("包含 Example Domain", 700, 120);
    condition.left = { nodeId: visit.id };
    condition.operator = "CONTAINS";
    condition.right = { value: "Example Domain" };
    const follow = executeNode("打开第一个链接", "visit_web", {
        visit_key: { nodeId: visitKey.id },
        link_number: { value: "1" },
    }, 940, 40);
    const fallback = executeNode("访问备用页面", "visit_web", { url: { value: "https://example.org" } }, 940, 220);
    workflow.nodes = [trigger, visit, visitKey, condition, follow, fallback];
    workflow.connections = [
        connect(trigger, visit),
        connect(visit, visitKey),
        connect(visitKey, condition),
        connect(condition, follow, "true"),
        connect(condition, fallback, "false"),
    ];
    return workflow;
}
/** Builds a pure extraction chain that demonstrates output references. */
function extractionPipeline() {
    const workflow = (0, model_1.newWorkflow)("数据提取流水线", "用固定值演示字符串拼接、截取和节点输出引用，最后显示处理结果。");
    const trigger = triggerNode("手动触发", 40, 120);
    const text = extractNode("固定文本", 260, 40);
    text.mode = "RANDOM_STRING";
    text.useFixed = true;
    text.fixedValue = "Operit";
    text.randomStringLength = 6;
    text.randomStringCharset = "Operit";
    const number = extractNode("固定数字", 260, 200);
    number.mode = "RANDOM_INT";
    number.useFixed = true;
    number.fixedValue = "42";
    const joined = extractNode("拼接结果", 500, 120);
    joined.mode = "CONCAT";
    joined.source = { nodeId: text.id };
    joined.others = [{ value: "-" }, { nodeId: number.id }];
    const preview = extractNode("截取预览", 720, 120);
    preview.mode = "SUB";
    preview.source = { nodeId: joined.id };
    preview.startIndex = 0;
    preview.length = 8;
    const show = executeNode("显示结果", "toast", { message: { nodeId: preview.id } }, 940, 120);
    workflow.nodes = [trigger, text, number, joined, preview, show];
    workflow.connections = [
        connect(trigger, text),
        connect(trigger, number),
        connect(text, joined),
        connect(number, joined),
        connect(joined, preview),
        connect(preview, show),
    ];
    return workflow;
}
/** Builds the old multi-condition AND branch with deterministic inputs. */
function logicAndBranch() {
    const workflow = (0, model_1.newWorkflow)("逻辑与分支", "两个条件同时满足时发送成功通知，否则发送未满足通知。");
    const trigger = triggerNode("手动触发", 40, 120);
    const firstValue = extractNode("条件值 A", 260, 40);
    firstValue.mode = "RANDOM_INT";
    firstValue.useFixed = true;
    firstValue.fixedValue = "80";
    const secondValue = extractNode("条件值 B", 260, 200);
    secondValue.mode = "RANDOM_INT";
    secondValue.useFixed = true;
    secondValue.fixedValue = "60";
    const first = conditionNode("A ≥ 50", 480, 40);
    first.left = { nodeId: firstValue.id };
    first.operator = "GTE";
    first.right = { value: "50" };
    const second = conditionNode("B ≥ 50", 480, 200);
    second.left = { nodeId: secondValue.id };
    second.operator = "GTE";
    second.right = { value: "50" };
    const all = logicNode("全部满足", 700, 120);
    all.operator = "AND";
    const success = executeNode("发送成功通知", "toast", { message: { value: "两个条件均满足" } }, 940, 40);
    const failure = executeNode("发送失败通知", "toast", { message: { value: "条件未全部满足" } }, 940, 200);
    workflow.nodes = [trigger, firstValue, secondValue, first, second, all, success, failure];
    workflow.connections = [
        connect(trigger, firstValue),
        connect(trigger, secondValue),
        connect(firstValue, first),
        connect(secondValue, second),
        connect(first, all),
        connect(second, all),
        connect(all, success, "true"),
        connect(all, failure, "false"),
    ];
    return workflow;
}
/** Builds a scheduled chat workflow that proactively sends a message through the host. */
function proactiveAiMessage() {
    const workflow = (0, model_1.newWorkflow)("AI 主动发消息（定时）", "每天 09:00 打开悬浮聊天并向 AI 发送一条主动消息；导入后默认停用，请确认内容和时间后启用。");
    const trigger = triggerNode("每天 09:00", 40, 120, "schedule");
    trigger.triggerConfig = {
        schedule_type: "cron",
        cron_expression: "0 9 * * *",
        enabled: "true",
        repeat: "true",
    };
    const start = executeNode("启动聊天服务", "start_chat_service", { initial_mode: { value: "WINDOW" }, keep_if_exists: { value: "true" } }, 280, 120);
    const create = executeNode("创建工作流会话", "create_new_chat", { group: { value: "workflow" }, set_as_current_chat: { value: "true" } }, 520, 120);
    const send = executeNode("发送主动消息", "send_message_to_ai", {
        message: { value: "早上好，请主动告诉我今天最值得关注的一件事。" },
        runtime: { value: "floating" },
        persist_turn: { value: "true" },
    }, 780, 120);
    workflow.nodes = [trigger, start, create, send];
    workflow.connections = [
        connect(trigger, start),
        connect(start, create),
        connect(create, send),
    ];
    return workflow;
}
/** Builds the built-in catalog used by both workflow UI implementations. */
function templates() {
    return [
        manualNotification(),
        randomConditionBranch(),
        webKeywordBranch(),
        extractionPipeline(),
        logicAndBranch(),
        proactiveAiMessage(),
    ];
}
