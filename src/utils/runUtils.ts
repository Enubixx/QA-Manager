import { TestPlan, TestRun, DeviceProfile, BugLog, AutoReleaseMeta } from '../types';
import { getLocalDateStr } from './dateUtils';
import { AUTO_RELEASE_IDLE_MINUTES } from '../constants';

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
 * Extracts the canonical device ID (e.g. "dev-1790876661069") from a run ID
 * such as "run-plan-1791908761906-dev-1790876661069-mvb5nn18" or "run-plan-1-dev-1790876661069",
 * stripping the trailing per-run timestamp suffix when present.
 */
export const extractDeviceIdFromRunId = (
  runId: string,
  knownDeviceIds?: Iterable<string | { id: string }>
): string | undefined => {
  if (!runId || typeof runId !== 'string' || !runId.includes('-dev-')) return undefined;
  if (knownDeviceIds) {
    const sortedKnown = Array.from(knownDeviceIds)
      .map(item => (typeof item === 'string' ? item : item?.id))
      .filter((x): x is string => Boolean(x))
      .sort((a, b) => b.length - a.length);
    for (const devId of sortedKnown) {
      if (runId.endsWith(`-${devId}`) || runId.includes(`-${devId}-`)) {
        return devId;
      }
    }
  }
  const afterDev = runId.split('-dev-').slice(1).join('-dev-');
  if (!afterDev) return undefined;
  const numericMatch = afterDev.match(/^(\d{10,})-[a-z0-9]{6,13}$/i);
  if (numericMatch) return `dev-${numericMatch[1]}`;
  const twoSegMatch = afterDev.match(/^([a-z0-9]+-[a-z0-9]+)-[a-z0-9]{6,13}$/i);
  if (twoSegMatch) return `dev-${twoSegMatch[1]}`;
  const parts = afterDev.split('-');
  if (parts.length >= 2 && /^[a-z0-9]{6,13}$/i.test(parts[parts.length - 1])) {
    return `dev-${parts.slice(0, -1).join('-')}`;
  }
  return `dev-${afterDev}`;
};

const normalizeDeviceName = (name?: string | null): string => (name || '').trim().toLowerCase();

/**
 * Returns true if `deviceName` matches the name of routine/exactly ONE device in `devices`.
 */
export const isDeviceNameUnique = (deviceName: string | undefined, devices: DeviceProfile[]): boolean => {
  const target = normalizeDeviceName(deviceName);
  if (!target || !Array.isArray(devices)) return false;
  let matches = 0;
  for (const d of devices) {
    if (d && normalizeDeviceName(d.name) === target) {
      matches++;
      if (matches > 1) return false;
    }
  }
  return matches === 1;
};

/**
 * Returns true if another device (excluding `excludeDeviceId`) already uses `name` (case-insensitive, trimmed).
 */
export const hasDuplicateDeviceName = (
  name: string,
  devices: DeviceProfile[],
  excludeDeviceId?: string
): boolean => {
  const target = normalizeDeviceName(name);
  if (!target || !Array.isArray(devices)) return false;
  return devices.some(d => d && d.id !== excludeDeviceId && normalizeDeviceName(d.name) === target);
};

/**
 * Returns the set of device IDs whose normalized `name` is shared by 2 or more devices.
 */
export const getDuplicateDeviceIds = (devices: DeviceProfile[]): Set<string> => {
  const counts = new Map<string, string[]>();
  (devices || []).forEach(d => {
    if (!d || !d.id) return;
    const key = normalizeDeviceName(d.name);
    if (!key) return;
    const list = counts.get(key) || [];
    list.push(d.id);
    counts.set(key, list);
  });
  const dupIds = new Set<string>();
  counts.forEach(ids => {
    if (ids.length > 1) {
      ids.forEach(id => dupIds.add(id));
    }
  });
  return dupIds;
};

/**
 * Resolves which device ID a run belongs to:
 * 1. Exact `run.deviceId` match against `devices` (if `run.deviceId` is present, never falls back to a different device's name).
 * 2. Device ID embedded in `run.id` (`extractDeviceIdFromRunId`).
 * 3. Legacy fallback to `run.deviceName` ONLY when `!run.deviceId` and `isDeviceNameUnique(run.deviceName, devices)` is true.
 */
export const resolveRunDeviceId = (
  run: Pick<TestRun, 'id' | 'deviceId' | 'deviceName'> | null | undefined,
  devices: DeviceProfile[]
): string | undefined => {
  if (!run || !Array.isArray(devices) || devices.length === 0) return undefined;
  const rawDeviceId = (run.deviceId || '').trim();
  if (rawDeviceId) {
    const byId = devices.find(d => d && d.id && d.id.toLowerCase().trim() === rawDeviceId.toLowerCase());
    return byId?.id;
  }
  const knownIds = devices.map(d => d?.id).filter(Boolean) as string[];
  const extracted = extractDeviceIdFromRunId(run.id, knownIds);
  if (extracted) {
    const byExtracted = devices.find(d => d && d.id && d.id.toLowerCase().trim() === extracted.toLowerCase());
    if (byExtracted) return byExtracted.id;
  }
  if (run.deviceName && isDeviceNameUnique(run.deviceName, devices)) {
    const targetName = normalizeDeviceName(run.deviceName);
    const byUniqueName = devices.find(d => d && normalizeDeviceName(d.name) === targetName);
    return byUniqueName?.id;
  }
  return undefined;
};

export type ReconciledDeviceLock = TestRun & {
  run: TestRun;
  testerName: string;
};

/**
 * Reconciles active device locks from `liveInProgressRuns`.
 * Guarantees:
 * - Matching is performed by device ID first (`resolveRunDeviceId`), falling back to `device.activeRunId === run.id`
 *   only when the run does not belong to a different device.
 * - One run can lock AT MOST ONE device (never locks 2 devices with the same name).
 */
export const reconcileDeviceLocks = (
  devices: DeviceProfile[],
  liveInProgressRuns: TestRun[]
): Map<string, ReconciledDeviceLock> => {
  const result = new Map<string, ReconciledDeviceLock>();
  const claimedRunIds = new Set<string>();
  const safeDevices = devices || [];
  const safeRuns = liveInProgressRuns || [];
  const devById = new Map(safeDevices.filter(d => d && d.id).map(d => [d.id, d]));

  // Pass 1: Match by resolved device ID (deviceId -> run.id embedded deviceId -> unique deviceName)
  for (const run of safeRuns) {
    if (!run || !run.id || claimedRunIds.has(run.id)) continue;
    const devId = resolveRunDeviceId(run, safeDevices);
    if (devId && !result.has(devId)) {
      const dev = devById.get(devId);
      result.set(devId, {
        ...run,
        run,
        testerName: run.testerName || dev?.activeTesterName || 'Tester',
      });
      claimedRunIds.add(run.id);
    }
  }

  // Pass 2: Match by explicit device.activeRunId if the run wasn't already claimed and doesn't specify another deviceId
  for (const dev of safeDevices) {
    if (!dev || !dev.id || result.has(dev.id) || !dev.activeRunId) continue;
    const run = safeRuns.find(r => r && r.id === dev.activeRunId && !claimedRunIds.has(r.id));
    if (!run) continue;
    if (run.deviceId && run.deviceId.trim().toLowerCase() !== dev.id.trim().toLowerCase()) continue;
    result.set(dev.id, {
      ...run,
      run,
      testerName: run.testerName || dev.activeTesterName || 'Tester',
    });
    claimedRunIds.add(run.id);
  }

  return result;
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

    const targetDevId = resolveRunDeviceId(run, devices || []);
    if (targetDevId) {
      if (!map[targetDevId]) map[targetDevId] = {};
      map[targetDevId][run.planId] = (map[targetDevId][run.planId] || 0) + 1;
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

/**
 * Latest activity timestamp (epoch ms) on a run: checks recorded step timestamps in `results`
 * (excluding `_meta`), `updatedAt`, `lastActivityTimestamp`, and `startedAt`.
 * Returns `NaN` if no valid timestamp exists.
 */
export const getRunLastActivityMs = (
  run: TestRun | null | undefined,
  globalBugs?: BugLog[]
): number => {
  if (!run) return NaN;
  let latest = NaN;
  const consider = (ms: number) => {
    if (Number.isFinite(ms) && (Number.isNaN(latest) || ms > latest)) {
      latest = ms;
    }
  };
  if (run.results && typeof run.results === 'object') {
    Object.entries(run.results).forEach(([stepId, res]) => {
      if (stepId === '_meta' || !res || typeof res !== 'object') return;
      consider(toEpochMs((res as { timestamp?: unknown }).timestamp));
    });
  }
  if (Array.isArray(run.bugLogs)) {
    run.bugLogs.forEach(bug => {
      if (!bug || typeof bug !== 'object') return;
      consider(toEpochMs(bug.timestamp));
      consider(toEpochMs(bug.originalTimestamp));
    });
  }
  if (Array.isArray(globalBugs) && run.id) {
    globalBugs.forEach(bug => {
      if (!bug || typeof bug !== 'object' || bug.testRunId !== run.id) return;
      consider(toEpochMs(bug.timestamp));
      consider(toEpochMs(bug.originalTimestamp));
    });
  }
  consider(toEpochMs((run as { updatedAt?: unknown }).updatedAt));
  if (typeof run.lastActivityTimestamp === 'number' && Number.isFinite(run.lastActivityTimestamp)) {
    consider(run.lastActivityTimestamp);
  } else {
    consider(toEpochMs(run.lastActivityTimestamp));
  }
  consider(toEpochMs(run.startedAt));
  return latest;
};

/**
 * Extract `_meta.autoReleased` from a run (supports both `run.results._meta.autoReleased` and `run._meta.autoReleased`).
 */
export const getRunAutoReleasedMeta = (run: TestRun | null | undefined): AutoReleaseMeta | null => {
  if (!run) return null;
  const fromResults = (run.results as any)?._meta?.autoReleased;
  if (
    fromResults &&
    typeof fromResults === 'object' &&
    (fromResults.reason === 'previous-day' || fromResults.reason === 'idle')
  ) {
    return { at: String(fromResults.at || ''), reason: fromResults.reason };
  }
  const fromTop = (run as any)?._meta?.autoReleased;
  if (
    fromTop &&
    typeof fromTop === 'object' &&
    (fromTop.reason === 'previous-day' || fromTop.reason === 'idle')
  ) {
    return { at: String(fromTop.at || ''), reason: fromTop.reason };
  }
  return null;
};

/**
 * Human-readable mobile modal message for an auto-released session.
 */
export const getAutoReleaseMessage = (reason: 'previous-day' | 'idle'): string => {
  if (reason === 'previous-day') {
    return 'Your session from a previous day was automatically released.';
  }
  return 'Your session was released after 2 hours with no activity.';
};

/**
 * Decide whether a run should be auto-released:
 * 1. Only `in_progress` runs are eligible (`completed`, `terminated`, `not_started` return `null`).
 * 2. If `startedAt` is on a previous local day -> `'previous-day'`.
 * 3. If same-day `in_progress` run has had no activity for strictly more than `idleMinutes` -> `'idle'`.
 */
export const getAutoReleaseReason = (
  run: TestRun | null | undefined,
  now: number | Date = Date.now(),
  idleMinutes: number = AUTO_RELEASE_IDLE_MINUTES,
  globalBugs?: BugLog[]
): 'previous-day' | 'idle' | null => {
  if (!run || run.status !== 'in_progress') return null;
  const nowDate = typeof now === 'number' ? new Date(now) : now;
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) return null;

  const todayStr = getLocalDateStr(nowDate);
  if (run.startedAt) {
    const startDay = getLocalDateStr(run.startedAt);
    if (startDay && startDay !== todayStr) {
      return 'previous-day';
    }
  }

  const lastActivityMs = getRunLastActivityMs(run, globalBugs);
  if (Number.isFinite(lastActivityMs) && nowMs - lastActivityMs > idleMinutes * 60 * 1000) {
    return 'idle';
  }
  return null;
};

/**
 * Mark an `in_progress` run as auto-released (`status: 'terminated'`, preserving all steps and bugs,
 * and recording `_meta.autoReleased = { at, reason }` in `results._meta` and `_meta`).
 */
export const markRunAutoReleased = (
  run: TestRun,
  reason: 'previous-day' | 'idle',
  now: number | Date = Date.now()
): TestRun => {
  const nowDate = typeof now === 'number' ? new Date(now) : now;
  const nowIso = nowDate.toISOString();
  const prevResultsMeta =
    run.results && typeof (run.results as any)._meta === 'object' && (run.results as any)._meta
      ? (run.results as any)._meta
      : {};
  const prevTopMeta =
    typeof (run as any)._meta === 'object' && (run as any)._meta ? (run as any)._meta : {};
  const autoReleased: AutoReleaseMeta = { at: nowIso, reason };

  return {
    ...run,
    status: 'terminated',
    completedAt: run.completedAt || nowIso,
    results: {
      ...(run.results || {}),
      _meta: {
        ...prevResultsMeta,
        autoReleased,
      } as any,
    },
    _meta: {
      ...prevTopMeta,
      autoReleased,
    },
  };
};

export interface AutoReleaseSweepResult {
  testRuns: TestRun[];
  devices: DeviceProfile[];
  releasedRuns: { run: TestRun; reason: 'previous-day' | 'idle' }[];
  releasedDevices: DeviceProfile[];
}

/**
 * Idempotent pass over `testRuns` and `devices` that auto-releases any stuck `in_progress` runs
 * (previous-day or idle > `idleMinutes`) and unlocks their devices unless locked by another live run.
 */
export const autoReleaseStuckSessions = (
  testRuns: TestRun[],
  devices: DeviceProfile[],
  now: number | Date = Date.now(),
  idleMinutes: number = AUTO_RELEASE_IDLE_MINUTES,
  globalBugs?: BugLog[]
): AutoReleaseSweepResult => {
  const releasedRuns: { run: TestRun; reason: 'previous-day' | 'idle' }[] = [];
  const nextRuns = (testRuns || []).map(r => {
    if (!r || r.status !== 'in_progress') return r;
    const reason = getAutoReleaseReason(r, now, idleMinutes, globalBugs);
    if (!reason) return r;
    const terminated = markRunAutoReleased(r, reason, now);
    releasedRuns.push({ run: terminated, reason });
    return terminated;
  });

  const nowDate = typeof now === 'number' ? new Date(now) : now;
  const todayStr = getLocalDateStr(nowDate);

  // Remaining genuinely live in-progress runs
  const remainingLiveRuns = nextRuns.filter(
    r =>
      r &&
      r.status === 'in_progress' &&
      (!r.startedAt || getLocalDateStr(r.startedAt) === todayStr) &&
      getAutoReleaseReason(r, now, idleMinutes, globalBugs) === null
  );

  // Any run that is now auto-released (either in this pass or a prior pass)
  const autoReleasedRuns = nextRuns.filter(r => r && r.status === 'terminated' && getRunAutoReleasedMeta(r) !== null);
  const liveLockMap = reconcileDeviceLocks(devices || [], remainingLiveRuns);

  const releasedDevices: DeviceProfile[] = [];
  const nextDevices = (devices || []).map(d => {
    if (!d || (!d.activeRunId && !d.activeTesterName)) return d;

    // Keep lock if there is still a genuinely live in-progress run on this device
    if (liveLockMap.has(d.id)) return d;

    const matchesAutoReleased = autoReleasedRuns.some(r => {
      if (d.activeRunId && r.id === d.activeRunId) return true;
      const resolvedId = resolveRunDeviceId(r, devices || []);
      if (resolvedId && resolvedId === d.id) return true;
      if (
        !resolvedId &&
        !r.deviceId &&
        r.testerName &&
        d.activeTesterName &&
        r.testerName.toLowerCase().trim() === d.activeTesterName.toLowerCase().trim()
      ) {
        return true;
      }
      return false;
    });

    if (matchesAutoReleased) {
      const unlocked: DeviceProfile = {
        ...d,
        activeRunId: undefined,
        activeTesterName: undefined,
      };
      releasedDevices.push(unlocked);
      return unlocked;
    }

    return d;
  });

  return {
    testRuns: nextRuns,
    devices: nextDevices,
    releasedRuns,
    releasedDevices,
  };
};

