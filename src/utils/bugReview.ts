import type { BugLog, BugReviewed } from '../types';
import { effectiveFiled } from './reproFollowUp';

/** This browser's triage choices for a bug (Dashboard qa_bug_categorizations). */
export interface LocalCategory { bugType?: string; priority?: string; status?: string }

/** Filed, waiting for Buganizer or bundled: always reviewed ("Move back to New" doesn't apply). */
export const isStronglyReviewed = (b: BugLog): boolean => !!(effectiveFiled(b) || b.filePending || b.bundle);

/**
 * Reviewed on the Bugs Feed. Strong signals (filed / pending / bundled) always count. Otherwise an explicit
 * `reviewed` wins (state 'new' = moved back to New); without one, any person-set triage (type, priority,
 * status, here or in this browser) counts, so existing bugs are derived on load instead of mass-written.
 */
export function isReviewed(b: BugLog, cat?: LocalCategory): boolean {
  if (isStronglyReviewed(b)) return true;
  if (b.reviewed) return b.reviewed.state !== 'new';
  return !!(b.bugType || b.priority || b.status || cat?.bugType || cat?.priority || cat?.status);
}

export const reviewedNow = (state: BugReviewed['state'] = 'reviewed'): BugReviewed => ({ at: new Date().toISOString(), state });
