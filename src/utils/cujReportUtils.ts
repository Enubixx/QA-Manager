import type { TestPlan, TestRun, BugLog, StepResult } from '../types';
import { isRunFullyCompleted, hasAllLiveStepsRecorded, buildStepFirstSeenIndex } from './runUtils';
import type { StepFirstSeenIndex } from './runUtils';

/**
 * Plan-scoped CUJ report math (pure: no React, no DOM, no storage).
 * A report scope is one test plan (or all plans) and one day (or all days). Only finished
 * runs count (history-aware rule, see runUtils), each result is reported under the CUJ it
 * was recorded as, and CUJs with no counted result in scope never appear as "tested".
 */

export const ALL_PLANS = 'all';
export const ALL_DATES = 'all';
/** planId: ALL_PLANS or a plan id; date: ALL_DATES or a local 'YYYY-MM-DD'. */
export interface CujReportScope { planId: string; date: string }
export type CujStatus = 'healthy' | 'warning' | 'critical' | 'no_steps';
export interface CujMetric {
  featureName: string;
  totalStepsExecuted: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  bugCount: number;
  healthScorePct: number;
  status: CujStatus;
  associatedBugs: BugLog[];
}
export interface GoldenRunRow {
  run: TestRun;
  plan?: TestPlan;
  isGolden: boolean;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  totalSteps: number;
  cleanPct: number;
}
export interface CujReportTotals {
  testedCujCount: number;
  stepsExecuted: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  criticalPct: number;
  warningPct: number;
  healthyPct: number;
  avgHealthScore: number | null;
  bugCount: number;
}
export interface PlanInScope { planId: string; planName: string; runCount: number }
export interface CujReportData {
  scope: CujReportScope;
  /** 'All plans' | plan name | 'Unknown plan' */
  planLabel: string;
  /** CUJs with >= 1 counted result, worst first */
  testedMetrics: CujMetric[];
  /** CUJs with bugs but no counted result (status 'no_steps'), by name */
  bugOnlyMetrics: CujMetric[];
  /** Known CUJ names that are neither tested nor bug-only, by name */
  untestedCujNames: string[];
  totals: CujReportTotals;
  golden: { runs: GoldenRunRow[]; goldenCount: number; totalCount: number; goldenPct: number };
  plansInScope: PlanInScope[];
}
export interface ReportDateEntry { dateStr: string; stepCount: number; bugCount: number; runCount: number }
export interface TimelinePoint { dateStr: string; displayDate: string; totalSteps: number; green: number; yellow: number; red: number; bugs: number; scorePct: number }
export interface PlanPickerOption { planId: string; planName: string; runCount: number; latestDate: string }

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const trimName = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 'YYYY-MM-DD' -> local Date, or null when it isn't a real calendar day. */
const parseLocalDate = (dateStr: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dateStr === 'string' ? dateStr : '');
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
};

/** Epoch ms of a timestamp, or NaN when it is missing or invalid. */
const toEpochMs = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return NaN;
  const ms = (value instanceof Date ? value : new Date(value as string)).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

/** Local calendar day ('YYYY-MM-DD') of a timestamp; '' when it is missing or invalid. */
export function localDateStr(input?: string | number | Date | null): string {
  const ms = toEpochMs(input);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** ALL_DATES -> 'All days'; 'YYYY-MM-DD' -> e.g. 'Oct 9, 2026'; anything else is returned as is. */
export function formatReportDateLabel(date: string): string {
  if (date === ALL_DATES) return 'All days';
  const parsed = parseLocalDate(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Identifies a report scope, e.g. for clearing a stored report when the scope changes. */
export function buildReportScopeKey(scope: CujReportScope): string {
  return `plan:${scope.planId}|date:${scope.date}`;
}

/** A reportable CUJ name: non-blank, not "General" (any case), not an internal "__" marker. */
export function isCujName(name?: string | null): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== 'general' && !trimmed.startsWith('__');
}

/** Escapes text before it is embedded in the copied rich-text report. */
export function escapeHtml(text: string): string {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A run's recorded step results: object values with a real (non-empty, non-pending) status; `_meta` excluded. */
export function getRecordedResults(run: TestRun): Array<[string, StepResult]> {
  if (!run || !run.results || typeof run.results !== 'object') return [];
  const recorded: Array<[string, StepResult]> = [];
  Object.entries(run.results).forEach(([stepId, res]) => {
    if (stepId === '_meta' || !res || typeof res !== 'object') return;
    const status = (res as { status?: unknown }).status;
    if (!status || status === 'pending') return;
    recorded.push([stepId, res]);
  });
  return recorded;
}

/** Archived + active runs, one per id; the active copy wins on a collision. */
export function mergeRunsById(archivedRuns: TestRun[], activeRuns: TestRun[]): TestRun[] {
  const map = new Map<string, TestRun>();
  (archivedRuns || []).forEach(r => {
    if (r && r.id) map.set(r.id, r);
  });
  (activeRuns || []).forEach(r => {
    if (r && r.id) map.set(r.id, r);
  });
  return Array.from(map.values());
}

/** Every CUJ name the app knows: the features list, every current plan step and every bug (trimmed, deduped). */
export function getKnownCujNames(plans: TestPlan[], bugs: BugLog[], populatedFeatures: string[]): string[] {
  const names = new Set<string>();
  const add = (value: unknown) => {
    const name = trimName(value);
    if (isCujName(name)) names.add(name);
  };
  (populatedFeatures || []).forEach(add);
  (plans || []).forEach(p => (p?.steps || []).forEach(s => add(s?.feature)));
  (bugs || []).forEach(b => add(b?.feature));
  return Array.from(names);
}

// ---------------------------------------------------------------------------
// Shared counting (S1-S8)
// ---------------------------------------------------------------------------

interface CountingContext {
  plans: TestPlan[];
  planById: Map<string, TestPlan>;
  /** planId -> stepId -> trimmed current step feature */
  stepFeatures: Map<string, Map<string, string>>;
  /** run id -> plan id, over the full run set (any status) */
  runPlanIds: Map<string, string>;
  finishedRuns: TestRun[];
  firstSeen: StepFirstSeenIndex;
}

const buildContext = (plans: TestPlan[], runs: TestRun[], firstSeen?: StepFirstSeenIndex): CountingContext => {
  const safePlans = (plans || []).filter(Boolean);
  const safeRuns = (runs || []).filter(Boolean);
  const index = firstSeen ?? buildStepFirstSeenIndex(safeRuns);
  const planById = new Map<string, TestPlan>();
  const stepFeatures = new Map<string, Map<string, string>>();
  safePlans.forEach(p => {
    if (!planById.has(p.id)) planById.set(p.id, p);
    if (!stepFeatures.has(p.id)) {
      const steps = new Map<string, string>();
      (p.steps || []).forEach(s => {
        if (s && !steps.has(s.id)) steps.set(s.id, trimName(s.feature));
      });
      stepFeatures.set(p.id, steps);
    }
  });
  const runPlanIds = new Map<string, string>();
  safeRuns.forEach(r => {
    if (r.id && !runPlanIds.has(r.id)) runPlanIds.set(r.id, r.planId);
  });
  return {
    plans: safePlans,
    planById,
    stepFeatures,
    runPlanIds,
    finishedRuns: safeRuns.filter(r => isRunFullyCompleted(r, safePlans, index)),
    firstSeen: index
  };
};

const stepFeatureOf = (ctx: CountingContext, planId: string, stepId: string): string =>
  ctx.stepFeatures.get(planId)?.get(stepId) || '';

const runsInPlanScope = (ctx: CountingContext, planId: string): TestRun[] =>
  planId === ALL_PLANS ? ctx.finishedRuns : ctx.finishedRuns.filter(r => r.planId === planId);

/** S5: the result's local day, else the run's start day; '' = only counted under All days. */
const resultDateOf = (res: StepResult, run: TestRun): string => localDateStr(res.timestamp) || localDateStr(run.startedAt);

/** S6: the CUJ the result was recorded as, else the current step's feature (trimmed). */
const resultCujOf = (ctx: CountingContext, run: TestRun, stepId: string, res: StepResult): string =>
  trimName(res.feature) || stepFeatureOf(ctx, run.planId, stepId);

interface CountedResult { run: TestRun; stepId: string; res: StepResult; date: string; cuj: string }

/** S7: every recorded result with a valid CUJ in the given runs (no date filter). */
const collectCountedResults = (ctx: CountingContext, runs: TestRun[]): CountedResult[] => {
  const counted: CountedResult[] = [];
  runs.forEach(run => {
    getRecordedResults(run).forEach(([stepId, res]) => {
      const cuj = resultCujOf(ctx, run, stepId, res);
      if (!isCujName(cuj)) return;
      counted.push({ run, stepId, res, date: resultDateOf(res, run), cuj });
    });
  });
  return counted;
};

interface ScopedBug { bug: BugLog; planId: string; date: string; cuj: string }

/** S8: deduped bugs in the plan scope with a valid CUJ (no date filter); date '' = invalid timestamp. */
const collectScopedBugs = (ctx: CountingContext, bugs: BugLog[], planId: string): ScopedBug[] => {
  const seenIds = new Set<string>();
  const scoped: ScopedBug[] = [];
  (bugs || []).forEach(bug => {
    if (!bug) return;
    if (bug.id) {
      if (seenIds.has(bug.id)) return;
      seenIds.add(bug.id);
    }
    const bugPlan = bug.planId || (bug.testRunId ? ctx.runPlanIds.get(bug.testRunId) : undefined) || '';
    if (planId !== ALL_PLANS && bugPlan !== planId) return;
    const cuj = trimName(bug.feature) || (bug.stepId ? stepFeatureOf(ctx, bugPlan, bug.stepId) : '');
    if (!isCujName(cuj)) return;
    scoped.push({ bug, planId: bugPlan, date: localDateStr(bug.timestamp), cuj });
  });
  return scoped;
};

const matchesDate = (date: string, scopeDate: string): boolean =>
  scopeDate === ALL_DATES || (date !== '' && date === scopeDate);

const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((100 * part) / whole) : 0);

const STATUS_RANK: Record<CujStatus, number> = { critical: 1, warning: 2, healthy: 3, no_steps: 4 };

/** Newest first: completedAt, else startedAt; runs with neither go last. */
const runRecencyMs = (run: TestRun): number => {
  const completed = toEpochMs(run.completedAt);
  if (!Number.isNaN(completed)) return completed;
  const started = toEpochMs(run.startedAt);
  return Number.isNaN(started) ? -Infinity : started;
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** The full CUJ report for one scope (contract S1-S15). `runs` is the merged run set (mergeRunsById). */
export function computeCujReport(input: {
  plans: TestPlan[];
  runs: TestRun[];
  bugs: BugLog[];
  scope: CujReportScope;
  /** Defaults to getKnownCujNames(plans, bugs, []) */
  knownCujNames?: string[];
  /** Defaults to buildStepFirstSeenIndex(runs) */
  firstSeen?: StepFirstSeenIndex;
}): CujReportData {
  const scope: CujReportScope = { planId: input.scope.planId, date: input.scope.date };
  const ctx = buildContext(input.plans, input.runs, input.firstSeen);
  const isAllPlans = scope.planId === ALL_PLANS;
  const scopedRuns = runsInPlanScope(ctx, scope.planId);

  const metricsByName = new Map<string, CujMetric>();
  const metricFor = (name: string): CujMetric => {
    let metric = metricsByName.get(name);
    if (!metric) {
      metric = {
        featureName: name,
        totalStepsExecuted: 0,
        greenCount: 0,
        yellowCount: 0,
        redCount: 0,
        bugCount: 0,
        healthScorePct: 0,
        status: 'no_steps',
        associatedBugs: []
      };
      metricsByName.set(name, metric);
    }
    return metric;
  };

  // S7 results + S14 contributing runs per plan
  const contributingRuns = new Map<string, { runIds: Set<string>; fallbackName: string }>();
  collectCountedResults(ctx, scopedRuns).forEach(({ run, res, date, cuj }) => {
    if (!matchesDate(date, scope.date)) return;
    const metric = metricFor(cuj);
    metric.totalStepsExecuted += 1;
    if (res.status === 'green') metric.greenCount += 1;
    else if (res.status === 'yellow') metric.yellowCount += 1;
    else if (res.status === 'red') metric.redCount += 1;

    let entry = contributingRuns.get(run.planId);
    if (!entry) {
      entry = { runIds: new Set<string>(), fallbackName: run.planName || '' };
      contributingRuns.set(run.planId, entry);
    }
    entry.runIds.add(run.id);
  });

  // S8 bugs (count whether or not their run finished)
  collectScopedBugs(ctx, input.bugs, scope.planId).forEach(({ bug, date, cuj }) => {
    if (!matchesDate(date, scope.date)) return;
    const metric = metricFor(cuj);
    metric.bugCount += 1;
    metric.associatedBugs.push(bug);
  });

  // S9 / S10 classification and health
  const testedMetrics: CujMetric[] = [];
  const bugOnlyMetrics: CujMetric[] = [];
  metricsByName.forEach(metric => {
    if (metric.totalStepsExecuted >= 1) {
      metric.healthScorePct = Math.round((100 * metric.greenCount) / metric.totalStepsExecuted);
      metric.status = metric.healthScorePct <= 59 ? 'critical' : metric.healthScorePct <= 94 ? 'warning' : 'healthy';
      testedMetrics.push(metric);
    } else if (metric.bugCount >= 1) {
      metric.healthScorePct = 0;
      metric.status = 'no_steps';
      bugOnlyMetrics.push(metric);
    }
  });

  // S13 sorting
  testedMetrics.sort((a, b) =>
    (STATUS_RANK[a.status] - STATUS_RANK[b.status]) ||
    (a.healthScorePct - b.healthScorePct) ||
    a.featureName.localeCompare(b.featureName)
  );
  bugOnlyMetrics.sort((a, b) => a.featureName.localeCompare(b.featureName));

  const knownNames = input.knownCujNames ?? getKnownCujNames(ctx.plans, input.bugs || [], []);
  const untestedSet = new Set<string>();
  (knownNames || []).forEach(n => {
    const name = trimName(n);
    if (isCujName(name) && !metricsByName.has(name)) untestedSet.add(name);
  });
  const untestedCujNames = Array.from(untestedSet).sort((a, b) => a.localeCompare(b));

  // S11 totals
  const testedCujCount = testedMetrics.length;
  const criticalCount = testedMetrics.filter(m => m.status === 'critical').length;
  const warningCount = testedMetrics.filter(m => m.status === 'warning').length;
  const healthyCount = testedMetrics.filter(m => m.status === 'healthy').length;
  const criticalPct = pct(criticalCount, testedCujCount);
  const warningPct = pct(warningCount, testedCujCount);
  const totals: CujReportTotals = {
    testedCujCount,
    stepsExecuted: testedMetrics.reduce((sum, m) => sum + m.totalStepsExecuted, 0),
    healthyCount,
    warningCount,
    criticalCount,
    criticalPct,
    warningPct,
    healthyPct: testedCujCount > 0 ? Math.max(0, 100 - criticalPct - warningPct) : 0,
    avgHealthScore: testedCujCount > 0
      ? Math.round(testedMetrics.reduce((sum, m) => sum + m.healthScorePct, 0) / testedCujCount)
      : null,
    bugCount: testedMetrics.concat(bugOnlyMetrics).reduce((sum, m) => sum + m.bugCount, 0)
  };

  // S12 golden runs: session runs judged on everything they recorded
  const sessionRuns = scope.date === ALL_DATES
    ? scopedRuns
    : scopedRuns.filter(run =>
        localDateStr(run.completedAt) === scope.date ||
        localDateStr(run.startedAt) === scope.date ||
        getRecordedResults(run).some(([, res]) => localDateStr(res.timestamp) === scope.date)
      );
  const goldenRows: GoldenRunRow[] = sessionRuns.map(run => {
    const recorded = getRecordedResults(run);
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;
    recorded.forEach(([, res]) => {
      if (res.status === 'green') greenCount += 1;
      else if (res.status === 'yellow') yellowCount += 1;
      else if (res.status === 'red') redCount += 1;
    });
    const totalSteps = recorded.length;
    return {
      run,
      plan: ctx.planById.get(run.planId),
      isGolden: redCount === 0 && yellowCount <= 1 && hasAllLiveStepsRecorded(run, ctx.plans, ctx.firstSeen),
      greenCount,
      yellowCount,
      redCount,
      totalSteps,
      cleanPct: pct(greenCount, totalSteps)
    };
  });
  goldenRows.sort((a, b) => {
    const ta = runRecencyMs(a.run);
    const tb = runRecencyMs(b.run);
    if (ta === tb) return 0;
    return tb > ta ? 1 : -1;
  });
  const goldenCount = goldenRows.filter(r => r.isGolden).length;

  // S14 plans in scope
  const plansInScope: PlanInScope[] = Array.from(contributingRuns.entries())
    .map(([planId, entry]) => ({
      planId,
      planName: ctx.planById.get(planId)?.name || entry.fallbackName || 'Unknown plan',
      runCount: entry.runIds.size
    }))
    .sort((a, b) => (b.runCount - a.runCount) || a.planName.localeCompare(b.planName));

  const scopedPlan = isAllPlans ? undefined : ctx.planById.get(scope.planId);
  const planLabel = isAllPlans ? 'All plans' : (scopedPlan && scopedPlan.name) || 'Unknown plan';

  return {
    scope,
    planLabel,
    testedMetrics,
    bugOnlyMetrics,
    untestedCujNames,
    totals,
    golden: { runs: goldenRows, goldenCount, totalCount: goldenRows.length, goldenPct: pct(goldenCount, goldenRows.length) },
    plansInScope
  };
}

// ---------------------------------------------------------------------------
// Days, timeline and plan picker
// ---------------------------------------------------------------------------

interface DayBucket { dateStr: string; stepCount: number; green: number; yellow: number; red: number; bugCount: number; runIds: Set<string> }

/** Per-day counted results (non-empty date) and bugs (valid date) for one plan scope. */
const aggregateDays = (input: { plans: TestPlan[]; runs: TestRun[]; bugs: BugLog[]; planId: string; firstSeen?: StepFirstSeenIndex }): Map<string, DayBucket> => {
  const ctx = buildContext(input.plans, input.runs, input.firstSeen);
  const days = new Map<string, DayBucket>();
  const dayFor = (dateStr: string): DayBucket => {
    let bucket = days.get(dateStr);
    if (!bucket) {
      bucket = { dateStr, stepCount: 0, green: 0, yellow: 0, red: 0, bugCount: 0, runIds: new Set<string>() };
      days.set(dateStr, bucket);
    }
    return bucket;
  };
  collectCountedResults(ctx, runsInPlanScope(ctx, input.planId)).forEach(({ run, res, date }) => {
    if (!date) return;
    const bucket = dayFor(date);
    bucket.stepCount += 1;
    if (res.status === 'green') bucket.green += 1;
    else if (res.status === 'yellow') bucket.yellow += 1;
    else if (res.status === 'red') bucket.red += 1;
    bucket.runIds.add(run.id);
  });
  collectScopedBugs(ctx, input.bugs, input.planId).forEach(({ date }) => {
    if (!date) return;
    dayFor(date).bugCount += 1;
  });
  return days;
};

/** Days with >= 1 counted result or bug for the plan scope (Session Day list), newest first. */
export function listReportDates(input: { plans: TestPlan[]; runs: TestRun[]; bugs: BugLog[]; planId: string; firstSeen?: StepFirstSeenIndex }): ReportDateEntry[] {
  return Array.from(aggregateDays(input).values())
    .map(d => ({ dateStr: d.dateStr, stepCount: d.stepCount, bugCount: d.bugCount, runCount: d.runIds.size }))
    .sort((a, b) => b.dateStr.localeCompare(a.dateStr));
}

/** One point per day with data for the plan scope (quality timeline), oldest first. */
export function buildTimelinePoints(input: { plans: TestPlan[]; runs: TestRun[]; bugs: BugLog[]; planId: string; firstSeen?: StepFirstSeenIndex }): TimelinePoint[] {
  return Array.from(aggregateDays(input).values())
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    .map(d => {
      const parsed = parseLocalDate(d.dateStr);
      return {
        dateStr: d.dateStr,
        displayDate: parsed ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.dateStr,
        totalSteps: d.stepCount,
        green: d.green,
        yellow: d.yellow,
        red: d.red,
        bugs: d.bugCount,
        scorePct: d.stepCount > 0 ? Math.round((100 * d.green) / d.stepCount) : 100
      };
    });
}

/**
 * One option per plan: runCount = finished runs of the plan with >= 1 counted result on `date`
 * (ALL_DATES = any day); latestDate = latest day with a counted result or bug ('' if none).
 * Sorted by latestDate (newest first, '' last), then name.
 */
export function getPlanPickerOptions(input: { plans: TestPlan[]; runs: TestRun[]; bugs: BugLog[]; date: string; firstSeen?: StepFirstSeenIndex }): PlanPickerOption[] {
  const ctx = buildContext(input.plans, input.runs, input.firstSeen);
  const runIdsByPlan = new Map<string, Set<string>>();
  const latestByPlan = new Map<string, string>();
  const noteLatest = (planId: string, date: string) => {
    if (!date) return;
    const prev = latestByPlan.get(planId);
    if (prev === undefined || date > prev) latestByPlan.set(planId, date);
  };
  collectCountedResults(ctx, ctx.finishedRuns).forEach(({ run, date }) => {
    noteLatest(run.planId, date);
    if (!matchesDate(date, input.date)) return;
    let ids = runIdsByPlan.get(run.planId);
    if (!ids) {
      ids = new Set<string>();
      runIdsByPlan.set(run.planId, ids);
    }
    ids.add(run.id);
  });
  collectScopedBugs(ctx, input.bugs, ALL_PLANS).forEach(({ planId, date }) => noteLatest(planId, date));

  const seenPlans = new Set<string>();
  const options: PlanPickerOption[] = [];
  ctx.plans.forEach(p => {
    if (seenPlans.has(p.id)) return;
    seenPlans.add(p.id);
    options.push({
      planId: p.id,
      planName: p.name || '',
      runCount: runIdsByPlan.get(p.id)?.size || 0,
      latestDate: latestByPlan.get(p.id) || ''
    });
  });
  return options.sort((a, b) => {
    if (a.latestDate !== b.latestDate) {
      if (!a.latestDate) return 1;
      if (!b.latestDate) return -1;
      return a.latestDate > b.latestDate ? -1 : 1;
    }
    return a.planName.localeCompare(b.planName);
  });
}

// ---------------------------------------------------------------------------
// Copied report text
// ---------------------------------------------------------------------------

/**
 * Plain-text and rich-HTML report for one scope (same layout as the original Dashboard report).
 * `getSummary` returns the one-line issue summary for a CUJ ('' = no summary line).
 */
export function buildCujReportText(data: CujReportData, opts: {
  dateLabel: string;
  disclaimer?: string;
  overallSummary?: string;
  getSummary: (metric: CujMetric) => string;
}): { plainText: string; htmlText: string } {
  const { totals, golden, testedMetrics, bugOnlyMetrics, plansInScope, planLabel, scope } = data;
  const { dateLabel, disclaimer, overallSummary, getSummary } = opts;

  const summaries = new Map<CujMetric, string>();
  const summaryOf = (metric: CujMetric): string => {
    if (!summaries.has(metric)) summaries.set(metric, getSummary(metric) || '');
    return summaries.get(metric) || '';
  };

  const criticalList = testedMetrics.filter(m => m.status === 'critical');
  const warningList = testedMetrics.filter(m => m.status === 'warning');
  const healthyList = testedMetrics.filter(m => m.status === 'healthy');

  const bugsLabel = (n: number) => `${n} ${n === 1 ? 'bug' : 'bugs'}`;
  const bugText = (m: CujMetric) => (m.bugCount > 0 ? `, ${bugsLabel(m.bugCount)}` : '');
  const stepDetail = (m: CujMetric) => (m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps');
  // Healthy CUJs only show a summary when there is something worth reading
  const showHealthySummary = (m: CujMetric, summary: string): boolean => {
    if (!summary) return false;
    const lower = summary.toLowerCase();
    return m.bugCount > 0 || m.healthScorePct < 100 || lower.includes('false positive') || lower.includes('false trigger') || lower.includes('worked fine') || lower.includes('observation') || lower.includes('thwart');
  };

  const showPlans = scope.planId === ALL_PLANS && plansInScope.length > 0;
  const planRuns = (p: PlanInScope) => `(${p.runCount} ${p.runCount === 1 ? 'run' : 'runs'})`;
  const goldenCount = golden.goldenCount;

  // Plain text format
  let plainText = `📊 CUJ Report: ${planLabel} (${dateLabel})\n`;
  if (showPlans) {
    plainText += `• Plans: ${plansInScope.map(p => `${p.planName} ${planRuns(p)}`).join(', ')}\n`;
  }
  plainText += `• Coverage: ${totals.testedCujCount} CUJs (${totals.stepsExecuted} steps)\n`;
  plainText += `• Status: 🟢 ${totals.healthyCount} Healthy | 🟡 ${totals.warningCount} Degraded | 🔴 ${totals.criticalCount} Critical (${totals.bugCount} Bugs)\n`;
  plainText += `• Golden Runs: 🏆 ${goldenCount} (${goldenCount === 1 ? '1 clean run' : `${goldenCount} clean runs`}, ≤1 yellow, 0 reds)\n`;
  if (disclaimer && disclaimer.trim()) {
    plainText += `Disclaimer: ${disclaimer.trim()}\n`;
  }
  if (overallSummary) {
    plainText += `Issue Summary: ${overallSummary}\n`;
  }
  plainText += `\n`;

  if (criticalList.length > 0) {
    plainText += `🔴 Critical CUJs:\n`;
    criticalList.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})\n`;
      if (summary) plainText += `↳ Summary: ${summary}\n`;
    });
    plainText += `\n`;
  }

  if (warningList.length > 0) {
    plainText += `🟡 Degraded CUJs:\n`;
    warningList.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})\n`;
      if (summary) plainText += `↳ Summary: ${summary}\n`;
    });
    plainText += `\n`;
  }

  if (healthyList.length > 0) {
    plainText += `🟢 Healthy CUJs:\n`;
    healthyList.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})\n`;
      if (showHealthySummary(m, summary)) plainText += `↳ Summary: ${summary}\n`;
    });
  }

  if (bugOnlyMetrics.length > 0) {
    // Exactly one blank line before this section
    if (!plainText.endsWith('\n\n')) plainText += `\n`;
    plainText += `🐛 Bugs on CUJs without completed steps:\n`;
    bugOnlyMetrics.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${bugsLabel(m.bugCount)}\n`;
      if (summary) plainText += `↳ Summary: ${summary}\n`;
    });
  }

  // Rich HTML format (for Slack, Teams, Google Docs, Word, Apple Notes, Email)
  const summaryHtml = (summary: string) =>
    `<div style="color: #475569; font-size: 12px; margin-top: 1px; margin-left: 12px;">↳ <i>Summary: ${escapeHtml(summary)}</i></div>`;
  const metricRowHtml = (m: CujMetric, summary: string) =>
    `<div style="margin-bottom: 6px;"><b>${escapeHtml(m.featureName)}</b>: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})${summary ? summaryHtml(summary) : ''}</div>`;

  let htmlText = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.5;">`;
  htmlText += `<p style="margin: 0 0 6px 0;">📊 <b>CUJ Report: ${escapeHtml(planLabel)}</b> (${escapeHtml(dateLabel)})</p>`;
  if (showPlans) {
    htmlText += `<p style="margin: 0 0 4px 0;">• <b>Plans</b>: ${plansInScope.map(p => `${escapeHtml(p.planName)} ${planRuns(p)}`).join(', ')}</p>`;
  }
  htmlText += `<p style="margin: 0 0 4px 0;">• <b>Coverage</b>: ${totals.testedCujCount} CUJs (${totals.stepsExecuted} steps)</p>`;
  htmlText += `<p style="margin: 0 0 4px 0;">• <b>Status</b>: 🟢 ${totals.healthyCount} Healthy | 🟡 ${totals.warningCount} Degraded | 🔴 ${totals.criticalCount} Critical (${totals.bugCount} Bugs)</p>`;
  htmlText += `<p style="margin: 0 0 8px 0;">• <b>Golden Runs</b>: 🏆 <b>${goldenCount}</b> <span style="color: #64748b; font-size: 11px;">(≤1 yellow, 0 reds)</span></p>`;
  if (disclaimer && disclaimer.trim()) {
    htmlText += `<p style="margin: 0 0 8px 0; color: #475569;"><b>Disclaimer:</b> ${disclaimer.trim()}</p>`;
  }
  if (overallSummary) {
    htmlText += `<div style="background-color: #f8fafc; border-left: 3px solid #6366f1; padding: 8px 12px; margin: 8px 0 12px 0; border-radius: 6px; font-size: 12.5px; color: #1e293b; line-height: 1.55;"><b>Issue Summary:</b> ${escapeHtml(overallSummary)}</div>`;
  }

  if (criticalList.length > 0) {
    htmlText += `<p style="margin: 8px 0 4px 0; color: #dc2626; font-weight: 700;">🔴 Critical CUJs:</p>`;
    htmlText += `<div style="margin: 0 0 8px 0;">`;
    criticalList.forEach(m => {
      htmlText += metricRowHtml(m, summaryOf(m));
    });
    htmlText += `</div>`;
  }

  if (warningList.length > 0) {
    htmlText += `<p style="margin: 8px 0 4px 0; color: #d97706; font-weight: 700;">🟡 Degraded CUJs:</p>`;
    htmlText += `<div style="margin: 0 0 8px 0;">`;
    warningList.forEach(m => {
      htmlText += metricRowHtml(m, summaryOf(m));
    });
    htmlText += `</div>`;
  }

  if (healthyList.length > 0) {
    htmlText += `<p style="margin: 8px 0 4px 0; color: #16a34a; font-weight: 700;">🟢 Healthy CUJs:</p>`;
    htmlText += `<div style="margin: 0 0 4px 0;">`;
    healthyList.forEach(m => {
      const summary = summaryOf(m);
      htmlText += metricRowHtml(m, showHealthySummary(m, summary) ? summary : '');
    });
    htmlText += `</div>`;
  }

  if (bugOnlyMetrics.length > 0) {
    htmlText += `<p style="margin: 8px 0 4px 0; color: #7c3aed; font-weight: 700;">🐛 Bugs on CUJs without completed steps:</p>`;
    htmlText += `<div style="margin: 0 0 4px 0;">`;
    bugOnlyMetrics.forEach(m => {
      const summary = summaryOf(m);
      htmlText += `<div style="margin-bottom: 6px;"><b>${escapeHtml(m.featureName)}</b>: ${bugsLabel(m.bugCount)}${summary ? summaryHtml(summary) : ''}</div>`;
    });
    htmlText += `</div>`;
  }

  htmlText += `</div>`;

  return { plainText, htmlText };
}
