/** Ambient save: wait this long after the last edit before persisting. */
export const AUTOSAVE_DEBOUNCE_MS = 1000

/** While typing continuously, force a persist at least this often. */
export const AUTOSAVE_MAX_INTERVAL_MS = 12_000

/** Used by the editor autosave loop (unit-tested). */
export function shouldTriggerMaxIntervalSave(lastSuccessMs: number, nowMs: number): boolean {
  return nowMs - lastSuccessMs >= AUTOSAVE_MAX_INTERVAL_MS
}
