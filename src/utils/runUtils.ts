import { TestPlan, TestRun } from '../types';

// ONE-TIME EXCEPTION (2026-09-30): these runs were cut short by the pre-v2.2.0
// "Test Again" bug, which archived other testers' in-progress runs as 'completed'.
// They're kept in the logged data and quota for that day only. The steps they never
// reached are NOT backfilled; they simply show as not executed.
// Safe to delete once 2026-09-30 no longer matters for reporting.
const ONE_TIME_INCLUDED_RUN_IDS = new Set<string>([
  'run-plan-1790014154218-dev-1790725090457-muoj79mg', // Will C / WP02 - 8/14 steps
  'run-plan-1790014154218-dev-1790797176485-muok39mv', // Amy H / GM06 - 13/14 steps
  'run-plan-1790014154218-dev-1790797220035-muol67l9', // Eric / WP03 - 13/14 steps
]);

// Single source of truth for "this run counts as a finished run".
// Used by quota counters so they always agree with the logged-data views, which
// only show runs where every step of the plan has a non-pending result.
// Runs that were cut short (e.g. archived by a restart) stay out of the quota.
export const isRunFullyCompleted = (run: TestRun, plans: TestPlan[]): boolean => {
  if (!run || run.status !== 'completed') return false;
  if (ONE_TIME_INCLUDED_RUN_IDS.has(run.id)) return true;
  const plan = plans.find(p => p.id === run.planId);
  if (!plan || plan.steps.length === 0) return false;
  return plan.steps.every(s => {
    const res = run.results?.[s.id];
    return !!(res && res.status && res.status !== 'pending');
  });
};
