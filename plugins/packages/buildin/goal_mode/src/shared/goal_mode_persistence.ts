import { restoreGoal, type GoalRecord } from "./goal_mode_state.js";
import { buildGoalFilePath, resolveGoalWorkspaceBinding, GOAL_FILE_DIRECTORY_NAME } from "./goal_mode_workspace.js";

type PersistedGoal = GoalRecord;

/** Validates one persisted goal record before it enters runtime state. */
function parsePersistedGoal(content: string): GoalRecord {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Persisted goal must be a JSON object.");
  }
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.objective !== "string" ||
    (value.status !== "active" && value.status !== "paused" && value.status !== "completed") ||
    typeof value.updatedAt !== "number" ||
    typeof value.startedAt !== "number" ||
    typeof value.pausedDurationMs !== "number"
  ) {
    throw new Error("Persisted goal has invalid fields.");
  }
  if (value.pausedAt !== undefined && typeof value.pausedAt !== "number") {
    throw new Error("Persisted goal has an invalid pause timestamp.");
  }
  if (value.completedAt !== undefined && typeof value.completedAt !== "number") {
    throw new Error("Persisted goal has an invalid completion timestamp.");
  }
  if (
    value.lastReviewedMessageTimestamp !== undefined &&
    typeof value.lastReviewedMessageTimestamp !== "number"
  ) {
    throw new Error("Persisted goal has an invalid review timestamp.");
  }
  return value as PersistedGoal;
}

/** Reads and restores the goal persisted in the chat workspace. */
export async function readPersistedGoal(chatId: string): Promise<GoalRecord | null> {
  const binding = resolveGoalWorkspaceBinding(chatId);
  if (!binding) {
    return null;
  }
  const path = buildGoalFilePath(binding.workspacePath);
  const exists = await Tools.Files.exists(path);
  if (!exists.exists) {
    return null;
  }
  const result = await Tools.Files.read(path);
  return restoreGoal(chatId, parsePersistedGoal(result.content));
}

/** Persists the current goal record in the chat workspace. */
export async function writePersistedGoal(chatId: string, goal: GoalRecord): Promise<GoalRecord> {
  const binding = resolveGoalWorkspaceBinding(chatId);
  if (!binding) {
    throw new Error("workspace is not bound");
  }
  const path = buildGoalFilePath(binding.workspacePath);
  await Tools.Files.mkdir(`${binding.workspacePath}/${GOAL_FILE_DIRECTORY_NAME}`, true);
  await Tools.Files.write(path, `${JSON.stringify(goal, null, 2)}\n`, false);
  return goal;
}

/** Deletes the persisted goal from the chat workspace. */
export async function deletePersistedGoal(chatId: string): Promise<void> {
  const binding = resolveGoalWorkspaceBinding(chatId);
  if (!binding) {
    throw new Error("workspace is not bound");
  }
  const path = buildGoalFilePath(binding.workspacePath);
  const exists = await Tools.Files.exists(path);
  if (exists.exists) {
    await Tools.Files.deleteFile(path, false);
  }
}
