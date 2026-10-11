import { PLAN_FILE_DIRECTORY_NAME, PLAN_FILE_NAME } from "./plan_mode_constants.js";
import {
  readActiveChatViewForRuntime,
  readTrackedChatViewByChatId,
  type PlanModeRuntime,
  type PlanModeTrackedChatView,
} from "./plan_mode_state.js";

const LOG_TAG = "[plan_mode_workspace]";

type LogPayloadValue = string | number | boolean | null | undefined;

export type ChatWorkspaceBinding = {
  chatId: string;
  workspacePath: string;
  workspaceEnv?: string;
  runtime?: PlanModeRuntime;
  viewId?: string;
};

/** Formats structured debug data for the plugin log. */
function formatLogPayload(payload?: Record<string, LogPayloadValue>): string {
  if (!payload) {
    return "";
  }
  return ` ${JSON.stringify(payload)}`;
}

/** Writes a namespaced plan-mode diagnostic entry. */
export function logPlanModeDebug(message: string, payload?: Record<string, LogPayloadValue>): void {
  console.log(`${LOG_TAG} ${message}${formatLogPayload(payload)}`);
}

/** Tests whether a value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Tests whether a tracked view carries a usable workspace path. */
function hasValidWorkspaceBinding(
  view: Pick<PlanModeTrackedChatView, "workspacePath">
): boolean {
  return isNonEmptyString(view.workspacePath);
}

/** Maps a tracked view to its chat workspace binding. */
function buildWorkspaceBinding(view: PlanModeTrackedChatView): ChatWorkspaceBinding {
  return {
    chatId: view.chatId,
    workspacePath: view.workspacePath,
    workspaceEnv: isNonEmptyString(view.workspaceEnv) ? view.workspaceEnv : undefined,
    runtime: view.runtime,
    viewId: view.viewId,
  };
}

/** Resolves the workspace bound to a chat and optional runtime. */
export function resolveChatWorkspace(chatId: string, runtime?: PlanModeRuntime): ChatWorkspaceBinding | null {
  logPlanModeDebug("resolveChatWorkspace.input", { chatId, runtime });
  if (runtime) {
    const runtimeView = readActiveChatViewForRuntime(runtime);
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

  const trackedView = readTrackedChatViewByChatId(chatId);
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
export function buildPlanFilePath(workspacePath: string): string {
  const normalizedWorkspacePath = workspacePath.endsWith("/")
    ? workspacePath.slice(0, -1)
    : workspacePath;
  return `${normalizedWorkspacePath}/${PLAN_FILE_DIRECTORY_NAME}/${PLAN_FILE_NAME}`;
}
