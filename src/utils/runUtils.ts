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

const VALID_RECORDED_STATUSES = new Set([
  'green',
  'yellow',
  'red',
  'pass',
  'fail',
  'skip',
  'blocked',
]);

/** A recorded step result: an object with a real (non-empty, non-pending) status. `_meta` is never a step. */
export const isRecordedResult = (...args: [keyOrValue: unknown, maybeValue?: unknown]): boolean => {
  const [keyOrValue, maybeValue] = args;
  const hasKeyArg = args.length >= 2 || typeof keyOrValue === 'string';
  if (hasKeyArg && keyOrValue === '_meta') return false;
  const value = hasKeyArg ? maybeValue : keyOrValue;
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  if (typeof status !== 'string') return false;
  return VALID_RECORDED_STATUSES.has(status.trim().toLowerCase());
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
 * steps, the run recorded at least one current plan step result, and every current plan
 * step was either recorded by this run or was first recorded across the system strictly
 * after this run finished.
 */
export const hasAllLiveStepsRecorded = (
  run: TestRun,
  plans: TestPlan[] | TestPlan,
  firstSeen?: StepFirstSeenIndex
): boolean => {
  if (!run || run.status === 'terminated') return false;
  const plan = Array.isArray(plans) ? plans.find(p => p.id === run.planId) : plans;
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return false;
  const results = run.results || {};

  let recordedPlanStepCount = 0;
  let latestResultMs = NaN;
  plan.steps.forEach(s => {
    const res = results[s.id];
    if (!isRecordedResult(s.id, res)) return;
    recordedPlanStepCount++;
    const ms = toEpochMs(res?.timestamp);
    if (!Number.isNaN(ms) && (Number.isNaN(latestResultMs) || ms > latestResultMs)) {
      latestResultMs = ms;
    }
  });
  if (recordedPlanStepCount === 0) return false;

  const completedMs = toEpochMs(run.completedAt);
  const startedMs = toEpochMs(run.startedAt);
  const finishedAt = !Number.isNaN(completedMs)
    ? completedMs
    : !Number.isNaN(latestResultMs)
    ? latestResultMs
    : startedMs;

  return plan.steps.every(s => {
    if (isRecordedResult(s.id, results[s.id])) return true;
    if (!firstSeen) return false;
    const stepFirstSeen = firstSeen.get(stepFirstSeenKey(plan.id, s.id));
    if (stepFirstSeen === undefined) return false;
    return !Number.isNaN(finishedAt) && stepFirstSeen > finishedAt;
  });
};

// Single source of truth for "this run counts as a finished run".
export const isRunFullyCompleted = (run: TestRun, plans: TestPlan[], firstSeen?: StepFirstSeenIndex): boolean => {
  if (!run || run.status !== 'completed') return false;
  if (ONE_TIME_INCLUDED_RUN_IDS.has(run.id)) return true;
  if (firstSeen) return hasAllLiveStepsRecorded(run, plans, firstSeen);
  const plan = (plans || []).find(p => p.id === run.planId);
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return false;
  return plan.steps.every(s => isRecordedResult(s.id, run.results?.[s.id]));
};
