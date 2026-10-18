import { TestPlan, TestRun, DeviceProfile, BugLog } from '../types';
import { getLocalDateStr } from './dateUtils';

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

export const getEffectiveRunStatus = (run: TestRun, plans?: TestPlan[]) => {
  if (!run) return 'not_started';
  if ((run.status as any) === 'terminated') return 'terminated';
  const plan = plans?.find(p => p.id === run.planId);
  const totalSteps = plan?.steps?.length || 0;
  const stepEntries = Object.entries(run.results || {}).filter(
    ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
  );
  const completedCount = stepEntries.length;

  if (completedCount === 0) {
    if (run.status === 'in_progress' || (run.testerName && run.deviceName && run.status !== 'not_started')) {
      return 'in_progress';
    }
    return 'not_started';
  }

  if (
    run.status === 'completed' ||
    (totalSteps > 0 && (completedCount >= totalSteps || (run.currentStepIndex !== undefined && run.currentStepIndex >= totalSteps)))
  ) {
    return 'completed';
  }
  if (run.status === 'in_progress' || (run.testerName && run.deviceName)) {
    return 'in_progress';
  }
  if (run.status === 'not_started' || (!run.testerName && completedCount === 0)) {
    return 'not_started';
  }
  return 'in_progress';
};

/**
 * Filter active testRuns down to only genuinely live, same-day in-progress runs
 * that are not already archived.
 */
export const computeLiveInProgressRuns = (
  testRuns: TestRun[],
  archivedIdSet: Set<string>,
  testPlans: TestPlan[],
  todayStr: string = getLocalDateStr(new Date())
): TestRun[] => {
  return (testRuns || []).filter(
    r =>
      r &&
      r.id &&
      !archivedIdSet.has(r.id) &&
      r.status === 'in_progress' &&
      getEffectiveRunStatus(r, testPlans) === 'in_progress' &&
      (!r.startedAt || getLocalDateStr(r.startedAt) === todayStr)
  );
};

/**
 * Calculate completed runs today per device ID and plan ID (expects deduplicated runs from mergeRunsById).
 */
export const computeTodayRunsMap = (
  mergedRuns: TestRun[],
  devices: DeviceProfile[],
  testPlans: TestPlan[],
  stepFirstSeen?: StepFirstSeenIndex,
  todayStr: string = getLocalDateStr(new Date())
): Record<string, Record<string, number>> => {
  const map: Record<string, Record<string, number>> = {};

  (mergedRuns || []).forEach(run => {
    if (!run?.completedAt || !isRunFullyCompleted(run, testPlans, stepFirstSeen)) return;

    const runDate = getLocalDateStr(run.completedAt);
    if (runDate !== todayStr) return;

    const targetDev = (devices || []).find(
      d =>
        (run.deviceId && d.id.toLowerCase().trim() === run.deviceId.toLowerCase().trim()) ||
        (run.deviceName && d.name && d.name.toLowerCase().trim() === run.deviceName.toLowerCase().trim())
    );
    if (targetDev) {
      if (!map[targetDev.id]) map[targetDev.id] = {};
      map[targetDev.id][run.planId] = (map[targetDev.id][run.planId] || 0) + 1;
    }
  });
  return map;
};

/**
 * Aggregate daily fleet quota progress across all devices and active test plans.
 */
export const computeFleetProgress = (
  devices: DeviceProfile[],
  todayRunsMap: Record<string, Record<string, number>>,
  testPlans: TestPlan[]
): { totalCompleted: number; totalTarget: number; pct: number } => {
  const validPlanIds = new Set((testPlans || []).map(p => p.id));
  let totalTarget = 0;
  let totalCompleted = 0;
  (devices || []).forEach(dev => {
    const seenPlans = new Set<string>();
    (dev.quotas || []).forEach(q => {
      if (!q || !q.planId || !validPlanIds.has(q.planId) || seenPlans.has(q.planId)) return;
      const target = Math.max(0, Number(q.targetRunsPerDay) || 0);
      if (target <= 0) return;
      seenPlans.add(q.planId);
      totalTarget += target;
      const doneToday = (todayRunsMap[dev.id] && todayRunsMap[dev.id][q.planId]) || 0;
      totalCompleted += Math.min(doneToday, target);
    });
  });
  const pct = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0;
  return { totalCompleted, totalTarget, pct };
};

/**
 * Filter cloud archived runs on poll: only drops runs tombstoned in archived_runs
 * (never test_runs tombstones, which are set when a run completes and moves to archived_runs),
 * and requires at least one recorded step or bug.
 */
export const filterCloudArchivedRuns = (
  runs: TestRun[],
  isArchivedDeleted: (runId: string) => boolean
): TestRun[] => {
  return (runs || []).filter(r => {
    if (!r || !r.id || isArchivedDeleted(r.id)) return false;
    const stepEntries = Object.entries(r.results || {}).filter(
      ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
    );
    const hasBugs = Boolean(r.bugLogs && r.bugLogs.length > 0);
    return stepEntries.length > 0 || hasBugs;
  });
};

/**
 * Filter cloud active testRuns on poll: drops runs tombstoned in either test_runs or archived_runs,
 * already-archived or completed runs, prior-day orphaned in_progress runs, and empty ghost runs.
 */
export const filterCloudTestRuns = (
  runs: TestRun[],
  archivedIdSet: Set<string>,
  isTestDeleted: (runId: string) => boolean,
  isArchivedDeleted: (runId: string) => boolean,
  onRetireStaleRun?: (runId: string) => void,
  todayStr: string = getLocalDateStr(new Date())
): TestRun[] => {
  return (runs || []).filter(r => {
    if (!r || !r.id || isTestDeleted(r.id) || isArchivedDeleted(r.id)) return false;
    if (archivedIdSet.has(r.id) || r.status === 'completed') {
      onRetireStaleRun?.(r.id);
      return false;
    }
    if (r.status === 'in_progress' && r.startedAt && getLocalDateStr(r.startedAt) !== todayStr) {
      onRetireStaleRun?.(r.id);
      return false;
    }
    const stepEntries = Object.entries(r.results || {}).filter(
      ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
    );
    return Boolean(
      r.testerName || r.status !== 'not_started' || stepEntries.length > 0 || (r.bugLogs && r.bugLogs.length > 0)
    );
  });
};

/**
 * Determine which bugs remain vs. get cascade-deleted when a test run is deleted.
 * When `options.keepBugs` is true (e.g. an in_progress run superseded by switching device/plan),
 * all bugs are preserved; on explicit delete, bugs tied to the run are removed.
 */
export const filterBugsAfterRunDelete = (
  bugLogs: BugLog[],
  runId: string,
  deletedRun?: TestRun,
  options?: { keepBugs?: boolean }
): { remaining: BugLog[]; toDelete: BugLog[] } => {
  if (options?.keepBugs) {
    return { remaining: [...(bugLogs || [])], toDelete: [] };
  }
  const embeddedBugIds = new Set((deletedRun?.bugLogs || []).map(b => b.id).filter(Boolean));
  const toDelete = (bugLogs || []).filter(b => b.testRunId === runId || embeddedBugIds.has(b.id));
  const remaining = (bugLogs || []).filter(b => b.testRunId !== runId && !embeddedBugIds.has(b.id));
  return { remaining, toDelete };
};
