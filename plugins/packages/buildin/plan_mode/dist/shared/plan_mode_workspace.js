"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logPlanModeDebug = logPlanModeDebug;
exports.resolveChatWorkspace = resolveChatWorkspace;
exports.buildPlanFilePath = buildPlanFilePath;
const plan_mode_constants_js_1 = require("./plan_mode_constants.js");
const plan_mode_state_js_1 = require("./plan_mode_state.js");
const LOG_TAG = "[plan_mode_workspace]";
/** Formats structured debug data for the plugin log. */
function formatLogPayload(payload) {
    if (!payload) {
        return "";
    }
    return ` ${JSON.stringify(payload)}`;
}
/** Writes a namespaced plan-mode diagnostic entry. */
function logPlanModeDebug(message, payload) {
    console.log(`${LOG_TAG} ${message}${formatLogPayload(payload)}`);
}
/** Tests whether a value is a non-empty string. */
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}
/** Tests whether a tracked view carries a usable workspace path. */
function hasValidWorkspaceBinding(view) {
    return isNonEmptyString(view.workspacePath);
}
/** Maps a tracked view to its chat workspace binding. */
function buildWorkspaceBinding(view) {
    return {
        chatId: view.chatId,
        workspacePath: view.workspacePath,
        workspaceEnv: isNonEmptyString(view.workspaceEnv) ? view.workspaceEnv : undefined,
        runtime: view.runtime,
        viewId: view.viewId,
    };
}
/** Resolves the workspace bound to a chat and optional runtime. */
function resolveChatWorkspace(chatId, runtime) {
    logPlanModeDebug("resolveChatWorkspace.input", { chatId, runtime });
    if (runtime) {
        const runtimeView = (0, plan_mode_state_js_1.readActiveChatViewForRuntime)(runtime);
        if (runtimeView && runtimeView.chatId === chatId && hasValidWorkspaceBinding(runtimeView)) {
            logPlanModeDebug("resolveChatWorkspace.runtime", {
                chatId,
                runtime: runtimeView.runtime,
                viewId: runtimeView.viewId,
                workspacePath: runtimeView.workspacePath,
                workspaceEnv: runtimeView.workspaceEnv,
            });
            return buildWorkspaceBinding(runtimeView);
        }
    }
    const trackedView = (0, plan_mode_state_js_1.readTrackedChatViewByChatId)(chatId);
    if (!trackedView || !hasValidWorkspaceBinding(trackedView)) {
        logPlanModeDebug("resolveChatWorkspace.unbound", {
            chatId,
            runtime,
            hasTrackedView: !!trackedView,
            workspacePath: trackedView?.workspacePath,
            workspaceEnv: trackedView?.workspaceEnv,
        });
        return null;
    }
    logPlanModeDebug("resolveChatWorkspace.tracked", {
        chatId,
        runtime: trackedView.runtime,
        viewId: trackedView.viewId,
        workspacePath: trackedView.workspacePath,
        workspaceEnv: trackedView.workspaceEnv,
    });
    return buildWorkspaceBinding(trackedView);
}
/** Builds the workspace-local path of the plan file. */
function buildPlanFilePath(workspacePath) {
    const normalizedWorkspacePath = workspacePath.endsWith("/")
        ? workspacePath.slice(0, -1)
        : workspacePath;
    return `${normalizedWorkspacePath}/${plan_mode_constants_js_1.PLAN_FILE_DIRECTORY_NAME}/${plan_mode_constants_js_1.PLAN_FILE_NAME}`;
}
