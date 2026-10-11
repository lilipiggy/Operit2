import {
  disablePlanMode,
  enablePlanModeForChat,
  isPlanModeEnabledForChat,
} from "./plan_mode_mode.js";
import {
  hasPlanFile,
  normalizePlanText,
  planFileMatchesContent,
  writePlanFile,
  type PlanFileRecord,
} from "./plan_mode_plan_file.js";
import {
  forgetPlanStart as forgetPlanStartRecord,
  isPlanStartRecorded,
  readSingleActiveChatView,
  readTrackedChatViewByChatId,
  recordPlanStart,
  removeTrackedChatViewAsync,
  upsertTrackedChatViewAsync,
  type PlanModeRuntime,
  type PlanModeTrackedChatView,
} from "./plan_mode_state.js";
import {
  resolveChatWorkspace,
  type ChatWorkspaceBinding,
} from "./plan_mode_workspace.js";

type SharedMethodMetadata = {
  channel: string;
  methodName: string;
  original: (...args: readonly unknown[]) => unknown;
};

const sharedMethodMetadataMap = new WeakMap<object, SharedMethodMetadata[]>();

/** Reads IPC method metadata associated with a decorated target. */
function readSharedMethodMetadata(target: object): SharedMethodMetadata[] {
  return sharedMethodMetadataMap.get(target) ?? [];
}

/** Adds one IPC method descriptor to a decorated target. */
function appendSharedMethodMetadata(target: object, metadata: SharedMethodMetadata): void {
  const existing = readSharedMethodMetadata(target);
  sharedMethodMetadataMap.set(target, [...existing, metadata]);
}

/** Creates a method decorator that dispatches calls through the shared IPC channel. */
function Shared(channel: string) {
  return function <
    TTarget extends object,
    TArgs extends readonly unknown[],
    TResult
  >(
    target: TTarget,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<TResult>>
  ): void {
    const original = descriptor.value;
    if (!original) {
      throw new Error(`@Shared can only decorate methods: ${propertyKey}`);
    }
    appendSharedMethodMetadata(target, {
      channel,
      methodName: propertyKey,
      original: original as (...args: readonly unknown[]) => unknown,
    });
    descriptor.value = (async (...args: TArgs): Promise<TResult> => {
      return await ToolPkg.ipc.call<TArgs, TResult>(channel, args);
    }) as (...args: TArgs) => Promise<TResult>;
  };
}

/** Registers the local handlers for all shared methods on a target. */
export function registerSharedMethods(target: object): void {
  const entries = readSharedMethodMetadata(target);
  entries.forEach((entry) => {
    ToolPkg.ipc.on<readonly unknown[], unknown>(entry.channel, async (payload) => {
      const args = Array.isArray(payload) ? payload : [];
      return await entry.original.apply(target, args);
    });
  });
}

export const PLAN_MODE_GET_SINGLE_ACTIVE_CHAT_VIEW_IPC_CHANNEL = "plan_mode.get_single_active_chat_view";
export const PLAN_MODE_GET_TRACKED_CHAT_VIEW_BY_CHAT_ID_IPC_CHANNEL = "plan_mode.get_tracked_chat_view_by_chat_id";
export const PLAN_MODE_IS_ENABLED_IPC_CHANNEL = "plan_mode.is_enabled";
export const PLAN_MODE_ENABLE_IPC_CHANNEL = "plan_mode.enable";
export const PLAN_MODE_DISABLE_IPC_CHANNEL = "plan_mode.disable";
export const PLAN_MODE_RESOLVE_WORKSPACE_IPC_CHANNEL = "plan_mode.resolve_workspace";
export const PLAN_MODE_HAS_PLAN_FILE_IPC_CHANNEL = "plan_mode.has_plan_file";
export const PLAN_MODE_WRITE_PLAN_FILE_IPC_CHANNEL = "plan_mode.write_plan_file";
export const PLAN_MODE_IS_PLAN_STARTED_SHARED_IPC_CHANNEL = "plan_mode.shared_is_plan_started";
export const PLAN_MODE_CLAIM_PLAN_START_IPC_CHANNEL = "plan_mode.claim_plan_start";
export const PLAN_MODE_FORGET_PLAN_START_IPC_CHANNEL = "plan_mode.forget_plan_start";
export const PLAN_MODE_UPSERT_TRACKED_CHAT_VIEW_IPC_CHANNEL = "plan_mode.upsert_tracked_chat_view";
export const PLAN_MODE_REMOVE_TRACKED_CHAT_VIEW_IPC_CHANNEL = "plan_mode.remove_tracked_chat_view";

export class PlanModeShared {
  /** Reads the most recently active chat view from the owning runtime. */
  @Shared(PLAN_MODE_GET_SINGLE_ACTIVE_CHAT_VIEW_IPC_CHANNEL)
  static async getSingleActiveChatView(): Promise<PlanModeTrackedChatView | null> {
    return readSingleActiveChatView();
  }

  /** Reads the tracked chat view identified by its chat id. */
  @Shared(PLAN_MODE_GET_TRACKED_CHAT_VIEW_BY_CHAT_ID_IPC_CHANNEL)
  static async getTrackedChatViewByChatId(chatId: string): Promise<PlanModeTrackedChatView | null> {
    return readTrackedChatViewByChatId(chatId);
  }

  /** Reads the planning flag for a chat from the owning runtime. */
  @Shared(PLAN_MODE_IS_ENABLED_IPC_CHANNEL)
  static async isEnabled(chatId: string): Promise<boolean> {
    return isPlanModeEnabledForChat(chatId);
  }

  /** Enables planning for a chat in the owning runtime. */
  @Shared(PLAN_MODE_ENABLE_IPC_CHANNEL)
  static async enable(chatId: string): Promise<void> {
    await enablePlanModeForChat(chatId);
  }

  /** Disables planning for a chat in the owning runtime. */
  @Shared(PLAN_MODE_DISABLE_IPC_CHANNEL)
  static async disable(chatId: string): Promise<void> {
    await disablePlanMode(chatId);
  }

  /** Resolves the workspace currently bound to a chat. */
  @Shared(PLAN_MODE_RESOLVE_WORKSPACE_IPC_CHANNEL)
  static async resolveWorkspace(
    chatId: string,
    runtime?: PlanModeRuntime
  ): Promise<ChatWorkspaceBinding | null> {
    return resolveChatWorkspace(chatId, runtime);
  }

  /** Reports whether a chat workspace contains a persisted plan. */
  @Shared(PLAN_MODE_HAS_PLAN_FILE_IPC_CHANNEL)
  static async hasPlanFile(chatId: string): Promise<boolean> {
    return await hasPlanFile(chatId);
  }

  /** Persists a plan for a chat in the shared workspace host. */
  @Shared(PLAN_MODE_WRITE_PLAN_FILE_IPC_CHANNEL)
  static async writePlanFile(chatId: string, content: string): Promise<PlanFileRecord> {
    return await writePlanFile(chatId, content);
  }

  /** Reports whether this plan was already handed off for implementation. */
  @Shared(PLAN_MODE_IS_PLAN_STARTED_SHARED_IPC_CHANNEL)
  static async isPlanStarted(planContent: string, chatId: string): Promise<boolean> {
    const planKey = normalizePlanText(planContent);
    if (!planKey) {
      return false;
    }
    if (isPlanStartRecorded(planKey, chatId)) {
      return true;
    }
    const view = readTrackedChatViewByChatId(chatId);
    if (!view) {
      return false;
    }
    return await planFileMatchesContent(view.chatId, planKey);
  }

  /** Claims implementation handoff for a plan exactly once. */
  @Shared(PLAN_MODE_CLAIM_PLAN_START_IPC_CHANNEL)
  static async claimPlanStart(planContent: string, chatId: string): Promise<boolean> {
    const planKey = normalizePlanText(planContent);
    if (!planKey) {
      return false;
    }
    if (isPlanStartRecorded(planKey, chatId)) {
      return false;
    }
    // Record before awaiting so a second tap cannot slip through the same check.
    recordPlanStart(planKey, chatId);
    const view = readTrackedChatViewByChatId(chatId);
    if (view && (await planFileMatchesContent(view.chatId, planKey))) {
      return false;
    }
    return true;
  }

  /** Clears the implementation-handoff record for a plan. */
  @Shared(PLAN_MODE_FORGET_PLAN_START_IPC_CHANNEL)
  static async forgetPlanStart(planContent: string, chatId: string): Promise<void> {
    forgetPlanStartRecord(normalizePlanText(planContent), chatId);
  }

  /** Stores the latest tracked chat view in the shared runtime. */
  @Shared(PLAN_MODE_UPSERT_TRACKED_CHAT_VIEW_IPC_CHANNEL)
  static async upsertTrackedChatView(view: PlanModeTrackedChatView): Promise<void> {
    await upsertTrackedChatViewAsync(view);
  }

  /** Removes a closed chat view from the shared runtime. */
  @Shared(PLAN_MODE_REMOVE_TRACKED_CHAT_VIEW_IPC_CHANNEL)
  static async removeTrackedChatView(runtime: PlanModeRuntime, viewId: string): Promise<void> {
    await removeTrackedChatViewAsync(runtime, viewId);
  }
}
