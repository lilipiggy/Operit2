"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGoalRuntime = isGoalRuntime;
exports.readGoal = readGoal;
exports.setGoal = setGoal;
exports.restoreGoal = restoreGoal;
exports.setGoalStatus = setGoalStatus;
exports.markGoalMessageReviewed = markGoalMessageReviewed;
exports.clearGoal = clearGoal;
exports.isGoalInputSlotEnabled = isGoalInputSlotEnabled;
exports.setGoalInputSlotEnabled = setGoalInputSlotEnabled;
exports.upsertTrackedChatView = upsertTrackedChatView;
exports.removeTrackedChatView = removeTrackedChatView;
exports.readTrackedChatViewByChatId = readTrackedChatViewByChatId;
exports.resolveGoalWorkspace = resolveGoalWorkspace;
exports.readSingleActiveChatView = readSingleActiveChatView;
/** Checks whether a value identifies one supported chat runtime surface. */
function isGoalRuntime(value) {
    return value === "main" || value === "floating";
}
const goalsByChatId = {};
const trackedViewsByChatId = {};
const inputSlotEnabledByChatId = {};
/** Returns an isolated copy of one goal record. */
function cloneGoal(goal) {
    return {
        objective: goal.objective,
        status: goal.status,
        updatedAt: goal.updatedAt,
        startedAt: goal.startedAt,
        pausedAt: goal.pausedAt,
        pausedDurationMs: goal.pausedDurationMs,
        completedAt: goal.completedAt,
        lastReviewedMessageTimestamp: goal.lastReviewedMessageTimestamp,
    };
}
/** Returns an isolated copy of one tracked chat view. */
function cloneTrackedView(view) {
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
/** Reads the goal associated with a chat. */
function readGoal(chatId) {
    const goal = goalsByChatId[chatId];
    return goal ? cloneGoal(goal) : null;
}
/** Stores one active goal for a chat. */
function setGoal(chatId, objective) {
    const now = Date.now();
    const goal = {
        objective,
        status: "active",
        updatedAt: now,
        startedAt: now,
        pausedDurationMs: 0,
    };
    goalsByChatId[chatId] = goal;
    return cloneGoal(goal);
}
/** Restores a persisted goal into the in-memory goal state. */
function restoreGoal(chatId, goal) {
    goalsByChatId[chatId] = cloneGoal(goal);
    return cloneGoal(goal);
}
/** Changes the status of an existing goal. */
function setGoalStatus(chatId, status) {
    const goal = goalsByChatId[chatId];
    if (!goal) {
        return null;
    }
    const now = Date.now();
    if (status === "paused" && goal.status === "active") {
        goal.pausedAt = now;
    }
    if (status === "active" && goal.status === "paused" && goal.pausedAt !== undefined) {
        goal.pausedDurationMs += Math.max(0, now - goal.pausedAt);
        delete goal.pausedAt;
    }
    if (status === "active" && goal.status === "completed") {
        delete goal.completedAt;
    }
    if (status === "completed") {
        if (goal.pausedAt !== undefined) {
            goal.pausedDurationMs += Math.max(0, now - goal.pausedAt);
            delete goal.pausedAt;
        }
        goal.completedAt = now;
    }
    goal.status = status;
    goal.updatedAt = now;
    return cloneGoal(goal);
}
/** Records the assistant message timestamp that the goal reviewer handled. */
function markGoalMessageReviewed(chatId, timestamp) {
    const goal = goalsByChatId[chatId];
    if (!goal) {
        return null;
    }
    goal.lastReviewedMessageTimestamp = timestamp;
    goal.updatedAt = Date.now();
    return cloneGoal(goal);
}
/** Removes a goal from a chat. */
function clearGoal(chatId) {
    delete goalsByChatId[chatId];
}
/** Reports whether the next submitted message should become this chat's goal. */
function isGoalInputSlotEnabled(chatId) {
    return inputSlotEnabledByChatId[chatId] === true;
}
/** Opens or closes the one-message goal input slot for a chat. */
function setGoalInputSlotEnabled(chatId, enabled) {
    if (enabled) {
        inputSlotEnabledByChatId[chatId] = true;
        return;
    }
    delete inputSlotEnabledByChatId[chatId];
}
/** Records the currently active chat view. */
function upsertTrackedChatView(view) {
    trackedViewsByChatId[view.chatId] = cloneTrackedView(view);
}
/** Removes a closed chat view by its host identity. */
function removeTrackedChatView(runtime, viewId) {
    Object.entries(trackedViewsByChatId).forEach(([chatId, view]) => {
        if (view.runtime === runtime && view.viewId === viewId) {
            delete trackedViewsByChatId[chatId];
        }
    });
}
/** Reads the tracked workspace binding associated with a chat. */
function readTrackedChatViewByChatId(chatId) {
    const view = trackedViewsByChatId[chatId];
    return view ? cloneTrackedView(view) : null;
}
/** Resolves a workspace binding for a chat and optional runtime. */
function resolveGoalWorkspace(chatId, runtime) {
    if (runtime) {
        const runtimeView = Object.values(trackedViewsByChatId).find((view) => view.runtime === runtime && view.chatId === chatId);
        if (runtimeView) {
            return cloneTrackedView(runtimeView);
        }
    }
    return readTrackedChatViewByChatId(chatId);
}
/** Reads the most recently updated tracked chat view. */
function readSingleActiveChatView() {
    const views = Object.values(trackedViewsByChatId);
    if (views.length === 0) {
        return null;
    }
    return cloneTrackedView(views.reduce((latest, view) => view.updatedAt > latest.updatedAt ? view : latest));
}
