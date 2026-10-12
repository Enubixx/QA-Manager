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

/** Earliest recorded-result time (epoch ms) per plan step; key = stepFirstSeenKey(planId, stepId). */
export type StepFirstSeenIndex = Map<string, number>;

export const stepFirstSeenKey = (planId: string, stepId: string): string => `${planId}::${stepId}`;

/** A recorded step result: an object with a real (non-empty, non-pending) status. `_meta` is never a step. */
const isRecordedResult = (key: string, value: unknown): boolean => {
  if (key === '_meta' || !value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return !!status && status !== 'pending';
};

/** Epoch ms of a timestamp, or NaN when it is missing or invalid. */
const toEpochMs = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return NaN;
  const ms = new Date(value as string).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

/**
 * For every plan step, the earliest time any of the given runs (any status) recorded a
 * result for it. Results without a valid timestamp are ignored.
 */
export const buildStepFirstSeenIndex = (runs: TestRun[]): StepFirstSeenIndex => {
  const index: StepFirstSeenIndex = new Map();
  (runs || []).forEach(run => {
    if (!run || !run.results) return;
    Object.entries(run.results).forEach(([stepId, res]) => {
      if (!isRecordedResult(stepId, res)) return;
      const ms = toEpochMs(res.timestamp);
      if (Number.isNaN(ms)) return;
      const key = stepFirstSeenKey(run.planId, stepId);
      const prev = index.get(key);
      if (prev === undefined || ms < prev) index.set(key, ms);
    });
  });
  return index;
};

/**
 * History-aware step check (no status or one-time check): the run's plan exists and has
 * steps, the run recorded at least one result, and every current plan step was either
 * recorded by this run or did not exist yet when the run finished - i.e. no run of the
 * plan had recorded it at or before this run's finish time.
 * Finish time = completedAt, else the latest result timestamp; with neither, every step
 * that has ever been recorded is required.
 */
export const hasAllLiveStepsRecorded = (run: TestRun, plans: TestPlan[], firstSeen: StepFirstSeenIndex): boolean => {
  if (!run) return false;
  const plan = plans.find(p => p.id === run.planId);
  if (!plan || !plan.steps || plan.steps.length === 0) return false;
  const results = run.results || {};

  let recordedCount = 0;
  let latestResultMs = NaN;
  Object.entries(results).forEach(([stepId, res]) => {
    if (!isRecordedResult(stepId, res)) return;
    recordedCount++;
    const ms = toEpochMs(res.timestamp);
    if (!Number.isNaN(ms) && (Number.isNaN(latestResultMs) || ms > latestResultMs)) latestResultMs = ms;
  });
  if (recordedCount === 0) return false;

  const completedMs = toEpochMs(run.completedAt);
  const finishedAt = !Number.isNaN(completedMs) ? completedMs : latestResultMs;

  return plan.steps.every(s => {
    if (isRecordedResult(s.id, results[s.id])) return true;
    const stepFirstSeen = firstSeen.get(stepFirstSeenKey(plan.id, s.id));
    if (stepFirstSeen === undefined) return true;
    return !Number.isNaN(finishedAt) && stepFirstSeen > finishedAt;
  });
};

// Single source of truth for "this run counts as a finished run".
// Used by quota counters so they always agree with the logged-data views, which
// only show runs where every step of the plan has a non-pending result.
// Runs that were cut short (e.g. archived by a restart) stay out of the quota.
//
// History-aware option (pass `firstSeen` from buildStepFirstSeenIndex): the strict rule
// judges every run against the plan as it is NOW, so adding a step to a plan used to
// hide every earlier run of that plan from the reports and quota counters (they never
// recorded the new step). With `firstSeen`, a run only needs the steps that already
// existed when it finished (some run of the plan had recorded them by then); runs cut
// short still miss steps that existed at the time, so they stay excluded.
// The restart/archive decision in App.tsx (handleRestartRun) keeps the strict rule
// (no `firstSeen`): at that moment the current plan is the plan being run.
export const isRunFullyCompleted = (run: TestRun, plans: TestPlan[], firstSeen?: StepFirstSeenIndex): boolean => {
  if (!run || run.status !== 'completed') return false;
  if (ONE_TIME_INCLUDED_RUN_IDS.has(run.id)) return true;
  if (firstSeen) return hasAllLiveStepsRecorded(run, plans, firstSeen);
  const plan = plans.find(p => p.id === run.planId);
  if (!plan || plan.steps.length === 0) return false;
  return plan.steps.every(s => {
    const res = run.results?.[s.id];
    return !!(res && res.status && res.status !== 'pending');
  });
};
