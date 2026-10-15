import type { BugLog } from '../types';

/**
 * Adjusting when a bug happened (time of day only, same day as it was logged), so testers can
 * correct a bug they noted a few minutes late. The first logged time is kept in `originalTimestamp`.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** Local "HH:MM" for an ISO timestamp ('' if invalid). */
export function toLocalHHMM(iso?: string): string {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const formatBugTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * The same local day as `baseIso`, at `hhmm` (seconds zeroed). Never later than `notAfter`.
 * Returns null for an invalid time.
 */
export function atLocalTime(baseIso: string, hhmm: string, notAfter?: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  const base = new Date(baseIso);
  if (!m || Number.isNaN(base.getTime())) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min, 0, 0);
  return notAfter && d.getTime() > notAfter.getTime() ? new Date(notAfter.getTime()) : d;
}

/**
 * The bug with its time of day changed to `hhmm`. Unchanged time returns the same object;
 * choosing the original time again restores it exactly and clears `originalTimestamp`.
 */
export function withBugTime(bug: BugLog, hhmm: string, now: Date = new Date()): BugLog {
  if (!hhmm || hhmm === toLocalHHMM(bug.timestamp)) return bug;
  const original = bug.originalTimestamp || bug.timestamp;
  if (hhmm === toLocalHHMM(original)) {
    const restored = new Date(original);
    const { originalTimestamp: _drop, ...rest } = bug;
    return { ...rest, timestamp: original, formattedTime: formatBugTime(restored) };
  }
  const d = atLocalTime(original, hhmm, now);
  if (!d) return bug;
  return { ...bug, timestamp: d.toISOString(), formattedTime: formatBugTime(d), originalTimestamp: original };
}

/** "2:10 PM (time adjusted; first logged 2:18 PM)" style label for reports. */
export function bugTimeLabel(bug: BugLog): string {
  const shown = bug.formattedTime || bug.timestamp || 'Unknown time';
  if (!bug.originalTimestamp) return shown;
  const first = new Date(bug.originalTimestamp);
  return Number.isNaN(first.getTime()) ? shown : `${shown} (time adjusted; first logged ${formatBugTime(first)})`;
}
