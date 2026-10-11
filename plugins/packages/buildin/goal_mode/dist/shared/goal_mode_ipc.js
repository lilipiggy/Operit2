"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOAL_MODE_SET_INPUT_SLOT_ENABLED_CHANNEL = exports.GOAL_MODE_IS_INPUT_SLOT_ENABLED_CHANNEL = exports.GOAL_MODE_REMOVE_VIEW_CHANNEL = exports.GOAL_MODE_TRACK_VIEW_CHANNEL = exports.GOAL_MODE_ACTIVE_VIEW_CHANNEL = exports.GOAL_MODE_CLEAR_GOAL_CHANNEL = exports.GOAL_MODE_RESOLVE_WORKSPACE_CHANNEL = exports.GOAL_MODE_MARK_REVIEWED_CHANNEL = exports.GOAL_MODE_SET_STATUS_CHANNEL = exports.GOAL_MODE_SET_GOAL_CHANNEL = exports.GOAL_MODE_READ_GOAL_CHANNEL = void 0;
exports.registerGoalModeIpc = registerGoalModeIpc;
exports.readGoalAsync = readGoalAsync;
exports.resolveGoalWorkspaceAsync = resolveGoalWorkspaceAsync;
exports.setGoalAsync = setGoalAsync;
exports.setGoalStatusAsync = setGoalStatusAsync;
exports.markGoalMessageReviewedAsync = markGoalMessageReviewedAsync;
exports.clearGoalAsync = clearGoalAsync;
exports.readSingleActiveChatViewAsync = readSingleActiveChatViewAsync;
exports.upsertTrackedChatViewAsync = upsertTrackedChatViewAsync;
exports.removeTrackedChatViewAsync = removeTrackedChatViewAsync;
exports.isGoalInputSlotEnabledAsync = isGoalInputSlotEnabledAsync;
exports.setGoalInputSlotEnabledAsync = setGoalInputSlotEnabledAsync;
const goal_mode_state_js_1 = require("./goal_mode_state.js");
const goal_mode_persistence_js_1 = require("./goal_mode_persistence.js");
const goal_mode_workspace_js_1 = require("./goal_mode_workspace.js");
exports.GOAL_MODE_READ_GOAL_CHANNEL = "goal_mode.read_goal";
exports.GOAL_MODE_SET_GOAL_CHANNEL = "goal_mode.set_goal";
exports.GOAL_MODE_SET_STATUS_CHANNEL = "goal_mode.set_status";
exports.GOAL_MODE_MARK_REVIEWED_CHANNEL = "goal_mode.mark_reviewed";
exports.GOAL_MODE_RESOLVE_WORKSPACE_CHANNEL = "goal_mode.resolve_workspace";
exports.GOAL_MODE_CLEAR_GOAL_CHANNEL = "goal_mode.clear_goal";
exports.GOAL_MODE_ACTIVE_VIEW_CHANNEL = "goal_mode.active_view";
exports.GOAL_MODE_TRACK_VIEW_CHANNEL = "goal_mode.track_view";
exports.GOAL_MODE_REMOVE_VIEW_CHANNEL = "goal_mode.remove_view";
exports.GOAL_MODE_IS_INPUT_SLOT_ENABLED_CHANNEL = "goal_mode.is_input_slot_enabled";
exports.GOAL_MODE_SET_INPUT_SLOT_ENABLED_CHANNEL = "goal_mode.set_input_slot_enabled";
const GOAL_MODE_MAIN_CONTEXT_KEY = "toolpkg_main:com.operit.goal_mode_bundle";
/** Returns the main execution context used by Goal Mode state handlers. */
function goalModeIpcOptions() {
    return { targetContextKey: GOAL_MODE_MAIN_CONTEXT_KEY };
}
/** Registers the shared goal-state IPC endpoints in the owning plugin runtime. */
function registerGoalModeIpc() {
    ToolPkg.ipc.on(exports.GOAL_MODE_READ_GOAL_CHANNEL, async (chatId) => {
        return await (0, goal_mode_persistence_js_1.readPersistedGoal)(chatId);
    });
    ToolPkg.ipc.on(exports.GOAL_MODE_SET_GOAL_CHANNEL, async (request) => {
        if (!(0, goal_mode_workspace_js_1.resolveGoalWorkspaceBinding)(request.chatId)) {
            throw new Error("workspace is not bound");
        }
        const goal = (0, goal_mode_state_js_1.setGoal)(request.chatId, request.objective);
        return await (0, goal_mode_persistence_js_1.writePersistedGoal)(request.chatId, goal);
    });
    ToolPkg.ipc.on(exports.GOAL_MODE_SET_STATUS_CHANNEL, async (request) => {
        await (0, goal_mode_persistence_js_1.readPersistedGoal)(request.chatId);
        const goal = (0, goal_mode_state_js_1.setGoalStatus)(request.chatId, request.status);
        return goal ? await (0, goal_mode_persistence_js_1.writePersistedGoal)(request.chatId, goal) : null;
    });
    ToolPkg.ipc.on(exports.GOAL_MODE_MARK_REVIEWED_CHANNEL, async (request) => {
        await (0, goal_mode_persistence_js_1.readPersistedGoal)(request.chatId);
        const goal = (0, goal_mode_state_js_1.markGoalMessageReviewed)(request.chatId, request.timestamp);
        return goal ? await (0, goal_mode_persistence_js_1.writePersistedGoal)(request.chatId, goal) : null;
    });
    ToolPkg.ipc.on(exports.GOAL_MODE_CLEAR_GOAL_CHANNEL, async (chatId) => {
        await (0, goal_mode_persistence_js_1.deletePersistedGoal)(chatId);
        (0, goal_mode_state_js_1.clearGoal)(chatId);
    });
    ToolPkg.ipc.on(exports.GOAL_MODE_RESOLVE_WORKSPACE_CHANNEL, (request) => (0, goal_mode_workspace_js_1.resolveGoalWorkspaceBinding)(request.chatId, request.runtime));
    ToolPkg.ipc.on(exports.GOAL_MODE_ACTIVE_VIEW_CHANNEL, goal_mode_state_js_1.readSingleActiveChatView);
    ToolPkg.ipc.on(exports.GOAL_MODE_TRACK_VIEW_CHANNEL, goal_mode_state_js_1.upsertTrackedChatView);
    ToolPkg.ipc.on(exports.GOAL_MODE_REMOVE_VIEW_CHANNEL, (request) => {
        if (!(0, goal_mode_state_js_1.isGoalRuntime)(request.runtime)) {
            throw new Error("Goal view runtime is invalid.");
        }
        (0, goal_mode_state_js_1.removeTrackedChatView)(request.runtime, request.viewId);
    });
    ToolPkg.ipc.on(exports.GOAL_MODE_IS_INPUT_SLOT_ENABLED_CHANNEL, goal_mode_state_js_1.isGoalInputSlotEnabled);
    ToolPkg.ipc.on(exports.GOAL_MODE_SET_INPUT_SLOT_ENABLED_CHANNEL, (request) => (0, goal_mode_state_js_1.setGoalInputSlotEnabled)(request.chatId, request.enabled));
}
/** Reads one chat goal through the owning runtime. */
async function readGoalAsync(chatId) {
    return await ToolPkg.ipc.call(exports.GOAL_MODE_READ_GOAL_CHANNEL, chatId, goalModeIpcOptions());
}
/** Resolves the workspace bound to one chat through the owning runtime. */
async function resolveGoalWorkspaceAsync(chatId, runtime) {
    return await ToolPkg.ipc.call(exports.GOAL_MODE_RESOLVE_WORKSPACE_CHANNEL, { chatId, runtime }, goalModeIpcOptions());
}
/** Stores one active chat goal through the owning runtime. */
async function setGoalAsync(chatId, objective) {
    return await ToolPkg.ipc.call(exports.GOAL_MODE_SET_GOAL_CHANNEL, { chatId, objective }, goalModeIpcOptions());
}
/** Updates one chat goal status through the owning runtime. */
async function setGoalStatusAsync(chatId, status) {
    return await ToolPkg.ipc.call(exports.GOAL_MODE_SET_STATUS_CHANNEL, { chatId, status }, goalModeIpcOptions());
}
/** Records a persisted assistant message after goal review completes. */
async function markGoalMessageReviewedAsync(chatId, timestamp) {
    return await ToolPkg.ipc.call(exports.GOAL_MODE_MARK_REVIEWED_CHANNEL, { chatId, timestamp }, goalModeIpcOptions());
}
/** Clears one chat goal through the owning runtime. */
async function clearGoalAsync(chatId) {
    await ToolPkg.ipc.call(exports.GOAL_MODE_CLEAR_GOAL_CHANNEL, chatId, goalModeIpcOptions());
}
/** Reads the active chat view through the owning runtime. */
async function readSingleActiveChatViewAsync() {
    return await ToolPkg.ipc.call(exports.GOAL_MODE_ACTIVE_VIEW_CHANNEL, undefined, goalModeIpcOptions());
}
/** Tracks a chat view through the owning runtime. */
async function upsertTrackedChatViewAsync(view) {
    await ToolPkg.ipc.call(exports.GOAL_MODE_TRACK_VIEW_CHANNEL, view, goalModeIpcOptions());
}
/** Removes a closed chat view through the owning runtime. */
async function removeTrackedChatViewAsync(runtime, viewId) {
    await ToolPkg.ipc.call(exports.GOAL_MODE_REMOVE_VIEW_CHANNEL, { runtime, viewId }, goalModeIpcOptions());
}
/** Reads whether the next submitted message will establish the chat goal. */
async function isGoalInputSlotEnabledAsync(chatId) {
    return await ToolPkg.ipc.call(exports.GOAL_MODE_IS_INPUT_SLOT_ENABLED_CHANNEL, chatId, goalModeIpcOptions());
}
/** Opens or closes the one-message goal input slot through the owning runtime. */
async function setGoalInputSlotEnabledAsync(chatId, enabled) {
    await ToolPkg.ipc.call(exports.GOAL_MODE_SET_INPUT_SLOT_ENABLED_CHANNEL, { chatId, enabled }, goalModeIpcOptions());
}
