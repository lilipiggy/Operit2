"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPlanModeStateSnapshot = readPlanModeStateSnapshot;
exports.readPlanModeStateAsync = readPlanModeStateAsync;
exports.isPlanModeEnabledInState = isPlanModeEnabledInState;
exports.setPlanModeEnabledForChatAsync = setPlanModeEnabledForChatAsync;
exports.isPlanStartRecorded = isPlanStartRecorded;
exports.recordPlanStart = recordPlanStart;
exports.forgetPlanStart = forgetPlanStart;
exports.readActiveChatViewForRuntime = readActiveChatViewForRuntime;
exports.readTrackedChatViewByChatId = readTrackedChatViewByChatId;
exports.readSingleActiveChatView = readSingleActiveChatView;
exports.upsertTrackedChatViewAsync = upsertTrackedChatViewAsync;
exports.removeTrackedChatViewAsync = removeTrackedChatViewAsync;
/** Builds the in-memory handoff key for one chat and one normalized plan. */
function buildPlanStartStateKey(planKey, chatId) {
    return `${chatId}\u0000${planKey}`;
}
const state = {
    enabledChatIds: {},
    startedPlanKeys: {},
    trackedViewsByChatId: {},
};
/** Clones a tracked view before it crosses the state boundary. */
function cloneTrackedChatView(view) {
    return {
        viewId: view.viewId,
        runtime: view.runtime,
        chatId: view.chatId,
        workspacePath: view.workspacePath,
        workspaceEnv: view.workspaceEnv,
        title: view.title,
        updatedAt: view.updatedAt,
    };
}
/** Clones every tracked chat view into a new lookup map. */
function cloneTrackedViewsByChatId() {
    const next = {};
    Object.entries(state.trackedViewsByChatId).forEach(([chatId, view]) => {
        next[chatId] = cloneTrackedChatView(view);
    });
    return next;
}
/** Returns an isolated snapshot of all in-memory plan state. */
function readPlanModeStateSnapshot() {
    return {
        enabledChatIds: { ...state.enabledChatIds },
        startedPlanKeys: { ...state.startedPlanKeys },
        trackedViewsByChatId: cloneTrackedViewsByChatId(),
    };
}
/** Reads plan state through the async shared-state contract. */
async function readPlanModeStateAsync() {
    return readPlanModeStateSnapshot();
}
/** Reports whether a chat is currently marked as planning. */
function isPlanModeEnabledInState(chatId) {
    return state.enabledChatIds[chatId] === true;
}
/** Sets or clears the planning flag for a chat. */
async function setPlanModeEnabledForChatAsync(chatId, enabled) {
    if (enabled) {
        state.enabledChatIds[chatId] = true;
        return;
    }
    delete state.enabledChatIds[chatId];
}
/** Reports whether implementation handoff was recorded for a plan. */
function isPlanStartRecorded(planKey, chatId) {
    return state.startedPlanKeys[buildPlanStartStateKey(planKey, chatId)] === true;
}
/** Records implementation handoff for a normalized plan. */
function recordPlanStart(planKey, chatId) {
    state.startedPlanKeys[buildPlanStartStateKey(planKey, chatId)] = true;
}
/** Removes the implementation handoff record for a plan. */
function forgetPlanStart(planKey, chatId) {
    delete state.startedPlanKeys[buildPlanStartStateKey(planKey, chatId)];
}
/** Returns the tracked chat view active in one runtime. */
function readActiveChatViewForRuntime(runtime) {
    const view = Object.values(state.trackedViewsByChatId).find((item) => item.runtime === runtime);
    return view ? cloneTrackedChatView(view) : null;
}
/** Returns the tracked view associated with one chat. */
function readTrackedChatViewByChatId(chatId) {
    const view = state.trackedViewsByChatId[chatId];
    return view ? cloneTrackedChatView(view) : null;
}
/** Returns the chat view most recently reported by the host runtime. */
function readSingleActiveChatView() {
    const views = Object.values(state.trackedViewsByChatId);
    if (views.length === 0) {
        return null;
    }
    const activeView = views.reduce((latest, view) => view.updatedAt > latest.updatedAt ? view : latest);
    return cloneTrackedChatView(activeView);
}
/** Stores the latest chat view and replaces the view in its runtime. */
async function upsertTrackedChatViewAsync(view) {
    state.trackedViewsByChatId[view.chatId] = cloneTrackedChatView(view);
}
/** Removes a tracked view when its matching runtime view closes. */
async function removeTrackedChatViewAsync(runtime, viewId) {
    Object.entries(state.trackedViewsByChatId).forEach(([chatId, trackedView]) => {
        if (trackedView.runtime === runtime && trackedView.viewId === viewId) {
            delete state.trackedViewsByChatId[chatId];
        }
    });
}
