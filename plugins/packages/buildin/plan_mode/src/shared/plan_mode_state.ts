export type PlanModeRuntime = "main" | "floating";

export type PlanModeTrackedChatView = {
  viewId: string;
  runtime: PlanModeRuntime;
  chatId: string;
  workspacePath: string;
  workspaceEnv?: string;
  title: string;
  updatedAt: number;
};

type PlanModeState = {
  enabledChatIds: Record<string, true>;
  startedPlanKeys: Record<string, true>;
  trackedViewsByChatId: Record<string, PlanModeTrackedChatView>;
};

/** Builds the in-memory handoff key for one chat and one normalized plan. */
function buildPlanStartStateKey(planKey: string, chatId: string): string {
  return `${chatId}\u0000${planKey}`;
}

const state: PlanModeState = {
  enabledChatIds: {},
  startedPlanKeys: {},
  trackedViewsByChatId: {},
};

/** Clones a tracked view before it crosses the state boundary. */
function cloneTrackedChatView(view: PlanModeTrackedChatView): PlanModeTrackedChatView {
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
function cloneTrackedViewsByChatId(): Record<string, PlanModeTrackedChatView> {
  const next: Record<string, PlanModeTrackedChatView> = {};
  Object.entries(state.trackedViewsByChatId).forEach(([chatId, view]) => {
    next[chatId] = cloneTrackedChatView(view);
  });
  return next;
}

/** Returns an isolated snapshot of all in-memory plan state. */
export function readPlanModeStateSnapshot(): PlanModeState {
  return {
    enabledChatIds: { ...state.enabledChatIds },
    startedPlanKeys: { ...state.startedPlanKeys },
    trackedViewsByChatId: cloneTrackedViewsByChatId(),
  };
}

/** Reads plan state through the async shared-state contract. */
export async function readPlanModeStateAsync(): Promise<PlanModeState> {
  return readPlanModeStateSnapshot();
}

/** Reports whether a chat is currently marked as planning. */
export function isPlanModeEnabledInState(chatId: string): boolean {
  return state.enabledChatIds[chatId] === true;
}

/** Sets or clears the planning flag for a chat. */
export async function setPlanModeEnabledForChatAsync(
  chatId: string,
  enabled: boolean
): Promise<void> {
  if (enabled) {
    state.enabledChatIds[chatId] = true;
    return;
  }
  delete state.enabledChatIds[chatId];
}

/** Reports whether implementation handoff was recorded for a plan. */
export function isPlanStartRecorded(planKey: string, chatId: string): boolean {
  return state.startedPlanKeys[buildPlanStartStateKey(planKey, chatId)] === true;
}

/** Records implementation handoff for a normalized plan. */
export function recordPlanStart(planKey: string, chatId: string): void {
  state.startedPlanKeys[buildPlanStartStateKey(planKey, chatId)] = true;
}

/** Removes the implementation handoff record for a plan. */
export function forgetPlanStart(planKey: string, chatId: string): void {
  delete state.startedPlanKeys[buildPlanStartStateKey(planKey, chatId)];
}

/** Returns the tracked chat view active in one runtime. */
export function readActiveChatViewForRuntime(runtime: PlanModeRuntime): PlanModeTrackedChatView | null {
  const view = Object.values(state.trackedViewsByChatId).find((item) => item.runtime === runtime);
  return view ? cloneTrackedChatView(view) : null;
}

/** Returns the tracked view associated with one chat. */
export function readTrackedChatViewByChatId(chatId: string): PlanModeTrackedChatView | null {
  const view = state.trackedViewsByChatId[chatId];
  return view ? cloneTrackedChatView(view) : null;
}

/** Returns the chat view most recently reported by the host runtime. */
export function readSingleActiveChatView(): PlanModeTrackedChatView | null {
  const views = Object.values(state.trackedViewsByChatId);
  if (views.length === 0) {
    return null;
  }
  const activeView = views.reduce((latest, view) =>
    view.updatedAt > latest.updatedAt ? view : latest
  );
  return cloneTrackedChatView(activeView);
}

/** Stores the latest chat view and replaces the view in its runtime. */
export async function upsertTrackedChatViewAsync(view: PlanModeTrackedChatView): Promise<void> {
  state.trackedViewsByChatId[view.chatId] = cloneTrackedChatView(view);
}

/** Removes a tracked view when its matching runtime view closes. */
export async function removeTrackedChatViewAsync(
  runtime: PlanModeRuntime,
  viewId: string
): Promise<void> {
  Object.entries(state.trackedViewsByChatId).forEach(([chatId, trackedView]) => {
    if (trackedView.runtime === runtime && trackedView.viewId === viewId) {
      delete state.trackedViewsByChatId[chatId];
    }
  });
}
