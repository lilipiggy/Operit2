import {
  resolveGoalWorkspace,
  type GoalRuntime,
  type GoalTrackedChatView,
} from "./goal_mode_state.js";

export const GOAL_FILE_DIRECTORY_NAME = ".operit";
export const GOAL_FILE_NAME = "goalmode.json";

/** Resolves the workspace bound to a goal chat. */
export function resolveGoalWorkspaceBinding(chatId: string, runtime?: GoalRuntime): GoalTrackedChatView | null {
  return resolveGoalWorkspace(chatId, runtime);
}

/** Builds the workspace-local path used to persist one goal. */
export function buildGoalFilePath(workspacePath: string): string {
  const normalizedWorkspacePath = workspacePath.endsWith("/")
    ? workspacePath.slice(0, -1)
    : workspacePath;
  return `${normalizedWorkspacePath}/${GOAL_FILE_DIRECTORY_NAME}/${GOAL_FILE_NAME}`;
}
