"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPersistedGoal = readPersistedGoal;
exports.writePersistedGoal = writePersistedGoal;
exports.deletePersistedGoal = deletePersistedGoal;
const goal_mode_state_js_1 = require("./goal_mode_state.js");
const goal_mode_workspace_js_1 = require("./goal_mode_workspace.js");
/** Validates one persisted goal record before it enters runtime state. */
function parsePersistedGoal(content) {
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Persisted goal must be a JSON object.");
    }
    const value = parsed;
    if (typeof value.objective !== "string" ||
        (value.status !== "active" && value.status !== "paused" && value.status !== "completed") ||
        typeof value.updatedAt !== "number" ||
        typeof value.startedAt !== "number" ||
        typeof value.pausedDurationMs !== "number") {
        throw new Error("Persisted goal has invalid fields.");
    }
    if (value.pausedAt !== undefined && typeof value.pausedAt !== "number") {
        throw new Error("Persisted goal has an invalid pause timestamp.");
    }
    if (value.completedAt !== undefined && typeof value.completedAt !== "number") {
        throw new Error("Persisted goal has an invalid completion timestamp.");
    }
    if (value.lastReviewedMessageTimestamp !== undefined &&
        typeof value.lastReviewedMessageTimestamp !== "number") {
        throw new Error("Persisted goal has an invalid review timestamp.");
    }
    return value;
}
/** Reads and restores the goal persisted in the chat workspace. */
async function readPersistedGoal(chatId) {
    const binding = (0, goal_mode_workspace_js_1.resolveGoalWorkspaceBinding)(chatId);
    if (!binding) {
        return null;
    }
    const path = (0, goal_mode_workspace_js_1.buildGoalFilePath)(binding.workspacePath);
    const exists = await Tools.Files.exists(path);
    if (!exists.exists) {
        return null;
    }
    const result = await Tools.Files.read(path);
    return (0, goal_mode_state_js_1.restoreGoal)(chatId, parsePersistedGoal(result.content));
}
/** Persists the current goal record in the chat workspace. */
async function writePersistedGoal(chatId, goal) {
    const binding = (0, goal_mode_workspace_js_1.resolveGoalWorkspaceBinding)(chatId);
    if (!binding) {
        throw new Error("workspace is not bound");
    }
    const path = (0, goal_mode_workspace_js_1.buildGoalFilePath)(binding.workspacePath);
    await Tools.Files.mkdir(`${binding.workspacePath}/${goal_mode_workspace_js_1.GOAL_FILE_DIRECTORY_NAME}`, true);
    await Tools.Files.write(path, `${JSON.stringify(goal, null, 2)}\n`, false);
    return goal;
}
/** Deletes the persisted goal from the chat workspace. */
async function deletePersistedGoal(chatId) {
    const binding = (0, goal_mode_workspace_js_1.resolveGoalWorkspaceBinding)(chatId);
    if (!binding) {
        throw new Error("workspace is not bound");
    }
    const path = (0, goal_mode_workspace_js_1.buildGoalFilePath)(binding.workspacePath);
    const exists = await Tools.Files.exists(path);
    if (exists.exists) {
        await Tools.Files.deleteFile(path, false);
    }
}
