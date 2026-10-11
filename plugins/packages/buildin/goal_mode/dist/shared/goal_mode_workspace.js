"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOAL_FILE_NAME = exports.GOAL_FILE_DIRECTORY_NAME = void 0;
exports.resolveGoalWorkspaceBinding = resolveGoalWorkspaceBinding;
exports.buildGoalFilePath = buildGoalFilePath;
const goal_mode_state_js_1 = require("./goal_mode_state.js");
exports.GOAL_FILE_DIRECTORY_NAME = ".operit";
exports.GOAL_FILE_NAME = "goalmode.json";
/** Resolves the workspace bound to a goal chat. */
function resolveGoalWorkspaceBinding(chatId, runtime) {
    return (0, goal_mode_state_js_1.resolveGoalWorkspace)(chatId, runtime);
}
/** Builds the workspace-local path used to persist one goal. */
function buildGoalFilePath(workspacePath) {
    const normalizedWorkspacePath = workspacePath.endsWith("/")
        ? workspacePath.slice(0, -1)
        : workspacePath;
    return `${normalizedWorkspacePath}/${exports.GOAL_FILE_DIRECTORY_NAME}/${exports.GOAL_FILE_NAME}`;
}
