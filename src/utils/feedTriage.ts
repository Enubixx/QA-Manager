/**
 * Bugs feed ① To review: staged triage (type / priority / status).
 * Changing a select on an expanded To-review row only stages the change; Confirm applies it,
 * marks the bug reviewed, closes the row and opens the next one.
 */
export type TriageField = 'bugType' | 'priority' | 'status';
export type TriagePatch = Partial<Record<TriageField, string>>;

/** Adds one field to a staged patch; a value equal to the current one un-stages that field. */
export function stageTriage(staged: TriagePatch | undefined, field: TriageField, value: string, current: string): TriagePatch {
  const next: TriagePatch = { ...(staged || {}) };
  if (value === current) delete next[field];
  else next[field] = value;
  return next;
}

/** True when the staged patch changes at least one field vs the current values. */
export function isTriageDirty(staged: TriagePatch | undefined, current: Record<TriageField, string>): boolean {
  if (!staged) return false;
  return (Object.keys(staged) as TriageField[]).some(f => staged[f] !== undefined && staged[f] !== current[f]);
}

/**
 * The bug to open after confirming `currentId`: the next one in display order, else the one before it
 * (end of the list), skipping `currentId` and anything in `skip` (e.g. already reviewed). null when none is left.
 */
export function nextTriageBugId(orderedIds: string[], currentId: string, skip: (id: string) => boolean = () => false): string | null {
  const ok = (id: string) => id !== currentId && !skip(id);
  const idx = orderedIds.indexOf(currentId);
  const after = idx < 0 ? orderedIds : orderedIds.slice(idx + 1);
  const before = idx < 0 ? [] : orderedIds.slice(0, idx).reverse();
  return after.find(ok) ?? before.find(ok) ?? null;
}
