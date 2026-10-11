import {
  clearGoal,
  readSingleActiveChatView,
  removeTrackedChatView,
  setGoal,
  isGoalInputSlotEnabled,
  setGoalInputSlotEnabled,
  setGoalStatus,
  markGoalMessageReviewed,
  isGoalRuntime,
  upsertTrackedChatView,
  type GoalRecord,
  type GoalRuntime,
  type GoalStatus,
  type GoalTrackedChatView,
} from "./goal_mode_state.js";
import { deletePersistedGoal, readPersistedGoal, writePersistedGoal } from "./goal_mode_persistence.js";
import { resolveGoalWorkspaceBinding } from "./goal_mode_workspace.js";

export const GOAL_MODE_READ_GOAL_CHANNEL = "goal_mode.read_goal";
export const GOAL_MODE_SET_GOAL_CHANNEL = "goal_mode.set_goal";
export const GOAL_MODE_SET_STATUS_CHANNEL = "goal_mode.set_status";
export const GOAL_MODE_MARK_REVIEWED_CHANNEL = "goal_mode.mark_reviewed";
export const GOAL_MODE_RESOLVE_WORKSPACE_CHANNEL = "goal_mode.resolve_workspace";
export const GOAL_MODE_CLEAR_GOAL_CHANNEL = "goal_mode.clear_goal";
export const GOAL_MODE_ACTIVE_VIEW_CHANNEL = "goal_mode.active_view";
export const GOAL_MODE_TRACK_VIEW_CHANNEL = "goal_mode.track_view";
export const GOAL_MODE_REMOVE_VIEW_CHANNEL = "goal_mode.remove_view";
export const GOAL_MODE_IS_INPUT_SLOT_ENABLED_CHANNEL = "goal_mode.is_input_slot_enabled";
export const GOAL_MODE_SET_INPUT_SLOT_ENABLED_CHANNEL = "goal_mode.set_input_slot_enabled";
const GOAL_MODE_MAIN_CONTEXT_KEY = "toolpkg_main:com.operit.goal_mode_bundle";

/** Returns the main execution context used by Goal Mode state handlers. */
function goalModeIpcOptions(): ToolPkg.IpcCallOptions {
  return { targetContextKey: GOAL_MODE_MAIN_CONTEXT_KEY };
}

/** Registers the shared goal-state IPC endpoints in the owning plugin runtime. */
export function registerGoalModeIpc(): void {
  ToolPkg.ipc.on<string, GoalRecord | null>(GOAL_MODE_READ_GOAL_CHANNEL, async (chatId) => {
    return await readPersistedGoal(chatId);
  });
  ToolPkg.ipc.on<{ chatId: string; objective: string }, GoalRecord>(
    GOAL_MODE_SET_GOAL_CHANNEL,
    async (request) => {
      if (!resolveGoalWorkspaceBinding(request.chatId)) {
        throw new Error("workspace is not bound");
      }
      const goal = setGoal(request.chatId, request.objective);
      return await writePersistedGoal(request.chatId, goal);
    }
  );
  ToolPkg.ipc.on<{ chatId: string; status: GoalStatus }, GoalRecord | null>(
    GOAL_MODE_SET_STATUS_CHANNEL,
    async (request) => {
      await readPersistedGoal(request.chatId);
      const goal = setGoalStatus(request.chatId, request.status);
      return goal ? await writePersistedGoal(request.chatId, goal) : null;
    }
  );
  ToolPkg.ipc.on<{ chatId: string; timestamp: number }, GoalRecord | null>(
    GOAL_MODE_MARK_REVIEWED_CHANNEL,
    async (request) => {
      await readPersistedGoal(request.chatId);
      const goal = markGoalMessageReviewed(request.chatId, request.timestamp);
      return goal ? await writePersistedGoal(request.chatId, goal) : null;
    }
  );
  ToolPkg.ipc.on<string, void>(GOAL_MODE_CLEAR_GOAL_CHANNEL, async (chatId) => {
    await deletePersistedGoal(chatId);
    clearGoal(chatId);
  });
  ToolPkg.ipc.on<{ chatId: string; runtime?: GoalRuntime }, GoalTrackedChatView | null>(
    GOAL_MODE_RESOLVE_WORKSPACE_CHANNEL,
    (request) => resolveGoalWorkspaceBinding(request.chatId, request.runtime)
  );
  ToolPkg.ipc.on<void, GoalTrackedChatView | null>(
    GOAL_MODE_ACTIVE_VIEW_CHANNEL,
    readSingleActiveChatView
  );
  ToolPkg.ipc.on<GoalTrackedChatView, void>(GOAL_MODE_TRACK_VIEW_CHANNEL, upsertTrackedChatView);
  ToolPkg.ipc.on<{ runtime: GoalRuntime; viewId: string }, void>(
    GOAL_MODE_REMOVE_VIEW_CHANNEL,
    (request) => {
      if (!isGoalRuntime(request.runtime)) {
        throw new Error("Goal view runtime is invalid.");
      }
      removeTrackedChatView(request.runtime, request.viewId);
    }
  );
  ToolPkg.ipc.on<string, boolean>(
    GOAL_MODE_IS_INPUT_SLOT_ENABLED_CHANNEL,
    isGoalInputSlotEnabled
  );
  ToolPkg.ipc.on<{ chatId: string; enabled: boolean }, void>(
    GOAL_MODE_SET_INPUT_SLOT_ENABLED_CHANNEL,
    (request) => setGoalInputSlotEnabled(request.chatId, request.enabled)
  );
}

/** Reads one chat goal through the owning runtime. */
export async function readGoalAsync(chatId: string): Promise<GoalRecord | null> {
  return await ToolPkg.ipc.call<string, GoalRecord | null>(
    GOAL_MODE_READ_GOAL_CHANNEL,
    chatId,
    goalModeIpcOptions()
  );
}

/** Resolves the workspace bound to one chat through the owning runtime. */
export async function resolveGoalWorkspaceAsync(chatId: string, runtime?: GoalRuntime): Promise<GoalTrackedChatView | null> {
  return await ToolPkg.ipc.call<{ chatId: string; runtime?: GoalRuntime }, GoalTrackedChatView | null>(
    GOAL_MODE_RESOLVE_WORKSPACE_CHANNEL,
    { chatId, runtime },
    goalModeIpcOptions()
  );
}

/** Stores one active chat goal through the owning runtime. */
export async function setGoalAsync(chatId: string, objective: string): Promise<GoalRecord> {
  return await ToolPkg.ipc.call<{ chatId: string; objective: string }, GoalRecord>(
    GOAL_MODE_SET_GOAL_CHANNEL,
    { chatId, objective },
    goalModeIpcOptions()
  );
}

/** Updates one chat goal status through the owning runtime. */
export async function setGoalStatusAsync(chatId: string, status: GoalStatus): Promise<GoalRecord | null> {
  return await ToolPkg.ipc.call<{ chatId: string; status: GoalStatus }, GoalRecord | null>(
    GOAL_MODE_SET_STATUS_CHANNEL,
    { chatId, status },
    goalModeIpcOptions()
  );
}

/** Records a persisted assistant message after goal review completes. */
export async function markGoalMessageReviewedAsync(chatId: string, timestamp: number): Promise<GoalRecord | null> {
  return await ToolPkg.ipc.call<{ chatId: string; timestamp: number }, GoalRecord | null>(
    GOAL_MODE_MARK_REVIEWED_CHANNEL,
    { chatId, timestamp },
    goalModeIpcOptions()
  );
}

/** Clears one chat goal through the owning runtime. */
export async function clearGoalAsync(chatId: string): Promise<void> {
  await ToolPkg.ipc.call<string, void>(
    GOAL_MODE_CLEAR_GOAL_CHANNEL,
    chatId,
    goalModeIpcOptions()
  );
}

/** Reads the active chat view through the owning runtime. */
export async function readSingleActiveChatViewAsync(): Promise<GoalTrackedChatView | null> {
  return await ToolPkg.ipc.call<void, GoalTrackedChatView | null>(
    GOAL_MODE_ACTIVE_VIEW_CHANNEL,
    undefined,
    goalModeIpcOptions()
  );
}

/** Tracks a chat view through the owning runtime. */
export async function upsertTrackedChatViewAsync(view: GoalTrackedChatView): Promise<void> {
  await ToolPkg.ipc.call<GoalTrackedChatView, void>(
    GOAL_MODE_TRACK_VIEW_CHANNEL,
    view,
    goalModeIpcOptions()
  );
}

/** Removes a closed chat view through the owning runtime. */
export async function removeTrackedChatViewAsync(runtime: GoalRuntime, viewId: string): Promise<void> {
  await ToolPkg.ipc.call<{ runtime: GoalRuntime; viewId: string }, void>(
    GOAL_MODE_REMOVE_VIEW_CHANNEL,
    { runtime, viewId },
    goalModeIpcOptions()
  );
}

/** Reads whether the next submitted message will establish the chat goal. */
export async function isGoalInputSlotEnabledAsync(chatId: string): Promise<boolean> {
  return await ToolPkg.ipc.call<string, boolean>(
    GOAL_MODE_IS_INPUT_SLOT_ENABLED_CHANNEL,
    chatId,
    goalModeIpcOptions()
  );
}

/** Opens or closes the one-message goal input slot through the owning runtime. */
export async function setGoalInputSlotEnabledAsync(chatId: string, enabled: boolean): Promise<void> {
  await ToolPkg.ipc.call<{ chatId: string; enabled: boolean }, void>(
    GOAL_MODE_SET_INPUT_SLOT_ENABLED_CHANNEL,
    { chatId, enabled },
    goalModeIpcOptions()
  );
}
