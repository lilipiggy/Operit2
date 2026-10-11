"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePlanText = normalizePlanText;
exports.normalizePlanContent = normalizePlanContent;
exports.resolvePlanFileBinding = resolvePlanFileBinding;
exports.hasPlanFile = hasPlanFile;
exports.readPlanFile = readPlanFile;
exports.planFileMatchesContent = planFileMatchesContent;
exports.writePlanFile = writePlanFile;
exports.deletePlanFile = deletePlanFile;
const plan_mode_constants_js_1 = require("./plan_mode_constants.js");
const plan_mode_workspace_js_1 = require("./plan_mode_workspace.js");
/** Normalizes plan text for stable comparison and persistence. */
function normalizePlanText(content) {
    return content.replace(/\r\n/g, "\n").trim();
}
/** Validates and terminates plan content before it is written. */
function normalizePlanContent(content) {
    const normalized = normalizePlanText(content);
    if (!normalized) {
        throw new Error("plan content is empty");
    }
    return `${normalized}\n`;
}
/** Resolves the current chat workspace and its plan file path. */
function resolvePlanFileBinding(chatId) {
    const binding = (0, plan_mode_workspace_js_1.resolveChatWorkspace)(chatId);
    if (!binding) {
        return null;
    }
    return {
        ...binding,
        path: (0, plan_mode_workspace_js_1.buildPlanFilePath)(binding.workspacePath),
    };
}
/** Reports whether the workspace has a persisted plan file. */
async function hasPlanFile(chatId) {
    const binding = resolvePlanFileBinding(chatId);
    if (!binding) {
        return false;
    }
    const result = await Tools.Files.exists(binding.path);
    return result.exists;
}
/** Reads the plan associated with the specified chat workspace. */
async function readPlanFile(chatId) {
    const binding = resolvePlanFileBinding(chatId);
    if (!binding) {
        return null;
    }
    const exists = await Tools.Files.exists(binding.path);
    if (!exists.exists) {
        return null;
    }
    const result = await Tools.Files.read(binding.path);
    return {
        ...binding,
        content: result.content.replace(/\r\n/g, "\n"),
    };
}
/** Compares normalized content against the plan stored for a chat. */
async function planFileMatchesContent(chatId, content) {
    const normalized = normalizePlanText(content);
    if (!normalized) {
        return false;
    }
    const plan = await readPlanFile(chatId);
    return plan !== null && normalizePlanText(plan.content) === normalized;
}
/** Persists a normalized plan through the runtime's shared file host. */
async function writePlanFile(chatId, content) {
    const binding = resolvePlanFileBinding(chatId);
    if (!binding) {
        throw new Error("workspace is not bound");
    }
    const normalized = normalizePlanContent(content);
    await Tools.Files.mkdir(`${binding.workspacePath}/${plan_mode_constants_js_1.PLAN_FILE_DIRECTORY_NAME}`, true);
    await Tools.Files.write(binding.path, normalized, false);
    return {
        ...binding,
        path: binding.path,
        content: normalized,
    };
}
/** Deletes the plan stored for the specified chat workspace. */
async function deletePlanFile(chatId) {
    const binding = resolvePlanFileBinding(chatId);
    if (!binding) {
        throw new Error("workspace is not bound");
    }
    const exists = await Tools.Files.exists(binding.path);
    if (exists.exists) {
        await Tools.Files.deleteFile(binding.path, false);
    }
    return {
        chatId: binding.chatId,
        workspacePath: binding.workspacePath,
        path: binding.path,
        deleted: exists.exists,
    };
}
