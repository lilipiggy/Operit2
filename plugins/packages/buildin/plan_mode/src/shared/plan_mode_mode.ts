import { isPlanModeEnabledInState, setPlanModeEnabledForChatAsync } from "./plan_mode_state.js";

/** Reports whether planning is enabled for the chat. */
export function isPlanModeEnabledForChat(chatId: string): boolean {
  return isPlanModeEnabledInState(chatId);
}

/** Enables planning for the chat. */
export async function enablePlanModeForChat(chatId: string): Promise<void> {
  await setPlanModeEnabledForChatAsync(chatId, true);
}

/** Disables planning for the chat. */
export async function disablePlanMode(chatId: string): Promise<void> {
  await setPlanModeEnabledForChatAsync(chatId, false);
}
