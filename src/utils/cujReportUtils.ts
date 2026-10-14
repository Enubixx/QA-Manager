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
/** One listed step of a Demo Flow Quality section (a current plan step with >= 1 counted result in scope). */
export interface DemoFlowStepRow {
  stepId: string;
  position: number;     // 1-based index in plan.steps (current order); skipped/hidden entries still use up their index
  title: string;        // collapse(step.title) || `Step ${position}`
  greenCount: number;
  yellowCount: number;  // shown as 🟠 "orange" (tester button "Caution")
  redCount: number;
  total: number;        // greenCount + yellowCount + redCount (> 0 for every listed row)
  greenPct: number;     // pct(greenCount, total)
}
/** Demo Flow Quality for one plan: its listed steps in plan order, plus their totals. */
export interface DemoFlowSection {
  planId: string;
  planName: string;     // collapse(plan.name) || 'Unknown plan'
  runCount: number;     // distinct run ids that contributed >= 1 counted result to a listed row
  rows: DemoFlowStepRow[];
  greenCount: number; yellowCount: number; redCount: number; total: number; // sums over rows
  greenPct: number;     // pct(greenCount, total)
  allGreenSteps: number; // rows with yellowCount === 0 && redCount === 0
  orangeSteps: number;   // rows with yellowCount > 0 && redCount === 0
  redSteps: number;      // rows with redCount > 0
}
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
  /** Demo Flow Quality: one section per plan in scope with >= 1 listed step, most runs first (D1-D9) */
  demoFlow: DemoFlowSection[];
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
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    const localDay = parseLocalDate(trimmed);
    if (localDay) return localDay.getTime();
  }
  const ms = (value instanceof Date ? value : new Date(value as string)).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

/** Local calendar day ('YYYY-MM-DD') of a timestamp; '' when it is missing or invalid. */
export function localDateStr(input?: string | number | Date | null): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return parseLocalDate(trimmed) ? trimmed : '';
    }
  }
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

/** Archived + active runs, one per id; active copy wins unless an existing entry is already completed and the incoming copy is not. */
export function mergeRunsById(archivedRuns: TestRun[], activeRuns: TestRun[] = []): TestRun[] {
  const map = new Map<string, TestRun>();
  const upsert = (r: TestRun | undefined | null) => {
    if (!r || !r.id) return;
    const existing = map.get(r.id);
    if (existing && existing.status === 'completed' && r.status !== 'completed') {
      return;
    }
    map.set(r.id, r);
  };
  (archivedRuns || []).forEach(upsert);
  (activeRuns || []).forEach(upsert);
  return Array.from(map.values());
}

/** Every CUJ name the app knows: the features list, every current plan step and every bug (trimmed, case-insensitively deduped). */
export function getKnownCujNames(plans: TestPlan[], bugs: BugLog[], populatedFeatures: string[]): string[] {
  const namesByKey = new Map<string, string>();
  const add = (value: unknown) => {
    const name = trimName(value);
    if (!isCujName(name)) return;
    const key = name.toLowerCase();
    if (!namesByKey.has(key)) namesByKey.set(key, name);
  };
  (populatedFeatures || []).forEach(add);
  (plans || []).forEach(p => (p?.steps || []).forEach(s => add(s?.feature)));
  (bugs || []).forEach(b => add(b?.feature));
  return Array.from(namesByKey.values());
}

// ---------------------------------------------------------------------------
// Shared counting (S1-S8)
// ---------------------------------------------------------------------------

interface CountingContext {
  plans: TestPlan[];
  planById: Map<string, TestPlan>;
  /** planId -> stepId -> trimmed current step feature */
  stepFeatures: Map<string, Map<string, string>>;
  /** stepId -> first matching planId */
  stepToPlanId: Map<string, string>;
  /** run id -> plan id, over the full run set (any status) */
  runPlanIds: Map<string, string>;
  /** All non-terminated runs that have recorded step results, bugs, or completed status */
  finishedRuns: TestRun[];
  firstSeen: StepFirstSeenIndex;
  /** `${runId}::${stepId}` -> bugs logged on that run + step */
  stepBugsByRunStep: Map<string, BugLog[]>;
}

const isCriticalBug = (b: BugLog): boolean =>
  b.severity === 'critical' || b.priority === 'P0' || b.priority === '0';

const buildContext = (
  plans: TestPlan[],
  runs: TestRun[],
  firstSeen?: StepFirstSeenIndex,
  bugs?: BugLog[]
): CountingContext => {
  const safePlans = (plans || []).filter(Boolean);
  const safeRuns = (runs || []).filter(Boolean);
  const index = firstSeen ?? buildStepFirstSeenIndex(safeRuns);
  const planById = new Map<string, TestPlan>();
  const stepFeatures = new Map<string, Map<string, string>>();
  const stepToPlanId = new Map<string, string>();
  safePlans.forEach(p => {
    if (!planById.has(p.id)) planById.set(p.id, p);
    if (!stepFeatures.has(p.id)) {
      const steps = new Map<string, string>();
      (p.steps || []).forEach(s => {
        if (s && !steps.has(s.id)) {
          steps.set(s.id, trimName(s.feature));
          if (!stepToPlanId.has(s.id)) stepToPlanId.set(s.id, p.id);
        }
      });
      stepFeatures.set(p.id, steps);
    }
  });
  const runPlanIds = new Map<string, string>();
  safeRuns.forEach(r => {
    if (r.id && !runPlanIds.has(r.id)) runPlanIds.set(r.id, r.planId);
  });

  // Index bugs by (runId, stepId) across both global bugLogs and run.bugLogs
  const stepBugsByRunStep = new Map<string, BugLog[]>();
  const seenBugIds = new Set<string>();
  const registerBug = (b: BugLog | undefined | null, fallbackRunId?: string) => {
    if (!b) return;
    if (b.id) {
      if (seenBugIds.has(b.id)) return;
      seenBugIds.add(b.id);
    }
    const runId = b.testRunId || fallbackRunId || '';
    const stepId = b.stepId || '';
    if (!runId || !stepId) return;
    const key = `${runId}::${stepId}`;
    let list = stepBugsByRunStep.get(key);
    if (!list) {
      list = [];
      stepBugsByRunStep.set(key, list);
    }
    list.push(b);
  };
  (bugs || []).forEach(b => registerBug(b));
  safeRuns.forEach(r => (r.bugLogs || []).forEach(b => registerBug(b, r.id)));

  // Include completed runs AND active/partial non-terminated runs that have recorded steps or bugs
  const runsWithBugs = new Set<string>();
  stepBugsByRunStep.forEach((_, key) => {
    const runId = key.split('::')[0];
    if (runId) runsWithBugs.add(runId);
  });

  const finishedRuns = safeRuns.filter(r => {
    if (!r || r.status === 'terminated') return false;
    if (isRunFullyCompleted(r, safePlans, index)) return true;
    if (getRecordedResults(r).length > 0) return true;
    if (r.id && runsWithBugs.has(r.id)) return true;
    return false;
  });

  return {
    plans: safePlans,
    planById,
    stepFeatures,
    stepToPlanId,
    runPlanIds,
    finishedRuns,
    firstSeen: index,
    stepBugsByRunStep
  };
};

const stepFeatureOf = (ctx: CountingContext, planId: string, stepId: string): string =>
  ctx.stepFeatures.get(planId)?.get(stepId) || '';

const runsInPlanScope = (ctx: CountingContext, planId: string): TestRun[] =>
  planId === ALL_PLANS ? ctx.finishedRuns : ctx.finishedRuns.filter(r => r.planId === planId);

/** S5: the result's local day, else the run's completed day, else the run's start day; '' = only counted under All days. */
const resultDateOf = (res: StepResult, run: TestRun): string =>
  localDateStr(res?.timestamp) || localDateStr(run?.completedAt) || localDateStr(run?.startedAt);

/** S6: the CUJ the result was recorded as, else the current step's feature (trimmed). */
const resultCujOf = (ctx: CountingContext, run: TestRun, stepId: string, res: StepResult): string =>
  trimName(res.feature) || stepFeatureOf(ctx, run.planId, stepId);

interface CountedResult { run: TestRun; stepId: string; res: StepResult; date: string; cuj: string }

/**
 * Returns every recorded step result for `run`, plus any step on `run` that has a logged bug:
 * - If a step was graded `'green'` despite having a bug logged on `(run.id, stepId)`, its effective
 *   status is downgraded to `'red'` (if critical/P0) or `'yellow'`.
 * - If a step has a bug logged on `(run.id, stepId)` before the tester tapped Confirm on the step,
 *   a synthetic `'red'` / `'yellow'` StepResult is included so the step is counted immediately.
 */
const getEffectiveStepResults = (ctx: CountingContext, run: TestRun): Array<[string, StepResult]> => {
  const rawEntries = getRecordedResults(run);
  const seenSteps = new Set<string>();
  const effective: Array<[string, StepResult]> = [];

  rawEntries.forEach(([stepId, res]) => {
    seenSteps.add(stepId);
    const stepBugs = run.id ? ctx.stepBugsByRunStep.get(`${run.id}::${stepId}`) : undefined;
    if (stepBugs && stepBugs.length > 0 && res.status === 'green') {
      const downgradedStatus: StepResult['status'] = stepBugs.some(isCriticalBug) ? 'red' : 'yellow';
      effective.push([stepId, { ...res, status: downgradedStatus }]);
    } else {
      effective.push([stepId, res]);
    }
  });

  if (run.id) {
    const prefix = `${run.id}::`;
    ctx.stepBugsByRunStep.forEach((stepBugs, key) => {
      if (!key.startsWith(prefix) || stepBugs.length === 0) return;
      const stepId = key.slice(prefix.length);
      if (!stepId || seenSteps.has(stepId)) return;
      seenSteps.add(stepId);
      const firstBug = stepBugs[0];
      const inferredStatus: StepResult['status'] = stepBugs.some(isCriticalBug) ? 'red' : 'yellow';
      const inferredFeature = trimName(firstBug.feature) || stepFeatureOf(ctx, run.planId, stepId);
      effective.push([
        stepId,
        {
          stepId,
          status: inferredStatus,
          feature: inferredFeature || undefined,
          timestamp: firstBug.timestamp
        }
      ]);
    });
  }

  return effective;
};

/** S7: every recorded (or bug-inferred) result with a valid CUJ in the given runs (no date filter). */
const collectCountedResults = (ctx: CountingContext, runs: TestRun[]): CountedResult[] => {
  const counted: CountedResult[] = [];
  runs.forEach(run => {
    getEffectiveStepResults(ctx, run).forEach(([stepId, res]) => {
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
    const inferredPlan =
      bug.planId ||
      (bug.testRunId ? ctx.runPlanIds.get(bug.testRunId) : undefined) ||
      (bug.stepId ? ctx.stepToPlanId.get(bug.stepId) : undefined) ||
      '';
    const stepMatchesSelectedPlan =
      planId !== ALL_PLANS && !!bug.stepId && !!ctx.stepFeatures.get(planId)?.has(bug.stepId);
    const bugPlan = stepMatchesSelectedPlan ? planId : inferredPlan;
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
// Demo flow (D1-D9)
// ---------------------------------------------------------------------------

/** One-line text: whitespace runs collapsed to one space, trimmed; '' for non-strings. */
const collapse = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * Per-step 🟢/🟠/🔴 counts for each plan in scope, from an existing context: the scope's finished
 * runs grouped by plan once, then one pass over their recorded results. A result counts for the
 * current step of its run's plan whose id equals the result key (first occurrence), on the scope's
 * day; other statuses and deleted steps are ignored. CUJ tags don't matter. Steps without a counted
 * result are hidden (the rest keep their position), and so are plans without a listed step.
 */
const buildDemoFlow = (ctx: CountingContext, scope: CujReportScope): DemoFlowSection[] => {
  // D1 + D2: runs are already plan-scoped; planById holds the first plan per id
  const runsByPlan = new Map<string, TestRun[]>();
  runsInPlanScope(ctx, scope.planId).forEach(run => {
    let list = runsByPlan.get(run.planId);
    if (!list) {
      list = [];
      runsByPlan.set(run.planId, list);
    }
    list.push(run);
  });

  const sections: DemoFlowSection[] = [];
  runsByPlan.forEach((runs, planId) => {
    const plan = ctx.planById.get(planId);
    if (!plan) return; // unknown plan: no current steps to list

    // D4: current steps by id (first occurrence only); skipped entries still use up their position
    const rowsById = new Map<string, DemoFlowStepRow>();
    (plan.steps || []).forEach((step, i) => {
      const stepId: unknown = step && typeof step === 'object' ? step.id : undefined;
      if (typeof stepId !== 'string' || stepId === '' || rowsById.has(stepId)) return;
      rowsById.set(stepId, {
        stepId,
        position: i + 1,
        title: collapse(step.title) || `Step ${i + 1}`,
        greenCount: 0,
        yellowCount: 0,
        redCount: 0,
        total: 0,
        greenPct: 0
      });
    });

    // D3 + D5: one pass over the recorded results (the day only matters for a single-day scope)
    const runIds = new Set<string>();
    runs.forEach(run => {
      getEffectiveStepResults(ctx, run).forEach(([stepId, res]) => {
        const row = rowsById.get(stepId);
        const status = res.status;
        if (!row || (status !== 'green' && status !== 'yellow' && status !== 'red')) return;
        if (scope.date !== ALL_DATES && !matchesDate(resultDateOf(res, run), scope.date)) return;
        if (status === 'green') row.greenCount += 1;
        else if (status === 'yellow') row.yellowCount += 1;
        else row.redCount += 1;
        row.total += 1;
        runIds.add(run.id);
      });
    });

    // D7: hide steps with no counted result; rows stay in position order
    const rows = Array.from(rowsById.values()).filter(row => row.total > 0);
    if (rows.length === 0) return;
    rows.forEach(row => {
      row.greenPct = pct(row.greenCount, row.total);
    });
    const greenCount = rows.reduce((sum, r) => sum + r.greenCount, 0);
    const yellowCount = rows.reduce((sum, r) => sum + r.yellowCount, 0);
    const redCount = rows.reduce((sum, r) => sum + r.redCount, 0);
    const total = greenCount + yellowCount + redCount;
    sections.push({
      planId: plan.id,
      planName: collapse(plan.name) || 'Unknown plan',
      runCount: runIds.size,
      rows,
      greenCount,
      yellowCount,
      redCount,
      total,
      greenPct: pct(greenCount, total),
      allGreenSteps: rows.filter(r => r.yellowCount === 0 && r.redCount === 0).length,
      orangeSteps: rows.filter(r => r.yellowCount > 0 && r.redCount === 0).length,
      redSteps: rows.filter(r => r.redCount > 0).length
    });
  });

  // D8: most runs first, then name, then id
  return sections.sort((a, b) =>
    (b.runCount - a.runCount) ||
    a.planName.localeCompare(b.planName) ||
    (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0)
  );
};

/** Standalone (builds its own context); computeCujReport must reuse its existing context instead. */
export function computeDemoFlow(input: { plans: TestPlan[]; runs: TestRun[]; scope: CujReportScope; firstSeen?: StepFirstSeenIndex }): DemoFlowSection[] {
  return buildDemoFlow(buildContext(input.plans, input.runs, input.firstSeen), input.scope);
}

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
  const ctx = buildContext(input.plans, input.runs, input.firstSeen, input.bugs);
  const isAllPlans = scope.planId === ALL_PLANS;
  const scopedRuns = runsInPlanScope(ctx, scope.planId);

  const knownNames = input.knownCujNames ?? getKnownCujNames(ctx.plans, input.bugs || [], []);
  const canonicalDisplayByKey = new Map<string, string>();
  const registerCanonical = (raw: string) => {
    const trimmed = trimName(raw);
    if (!isCujName(trimmed)) return '';
    const key = trimmed.toLowerCase();
    if (!canonicalDisplayByKey.has(key)) {
      canonicalDisplayByKey.set(key, trimmed);
    }
    return canonicalDisplayByKey.get(key)!;
  };
  (knownNames || []).forEach(registerCanonical);
  ctx.plans.forEach(p => (p?.steps || []).forEach(s => registerCanonical(s?.feature || '')));
  (input.bugs || []).forEach(b => registerCanonical(b?.feature || ''));

  const metricsByKey = new Map<string, CujMetric>();
  const metricFor = (rawName: string): CujMetric => {
    const displayName = registerCanonical(rawName) || trimName(rawName);
    const key = displayName.toLowerCase();
    let metric = metricsByKey.get(key);
    if (!metric) {
      metric = {
        featureName: displayName,
        totalStepsExecuted: 0,
        greenCount: 0,
        yellowCount: 0,
        redCount: 0,
        bugCount: 0,
        healthScorePct: 0,
        status: 'no_steps',
        associatedBugs: []
      };
      metricsByKey.set(key, metric);
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
  metricsByKey.forEach(metric => {
    // If a feature has bugs logged on it, it can never have 0 executed steps or 100% green passes:
    // 1) If no step results were matched (e.g. standalone bug), each bug counts as a yellow/red step execution.
    // 2) If all matched step results were green, downgrade up to `bugCount` green steps to yellow/red.
    if (metric.bugCount >= 1) {
      const criticalBugCount = metric.associatedBugs.filter(isCriticalBug).length;
      if (metric.totalStepsExecuted === 0) {
        metric.redCount = criticalBugCount;
        metric.yellowCount = Math.max(0, metric.bugCount - criticalBugCount);
        metric.totalStepsExecuted = metric.redCount + metric.yellowCount;
      } else if (metric.yellowCount === 0 && metric.redCount === 0 && metric.greenCount > 0) {
        const toDowngrade = Math.min(metric.greenCount, metric.bugCount);
        const newRed = Math.min(toDowngrade, criticalBugCount);
        const newYellow = toDowngrade - newRed;
        metric.greenCount -= toDowngrade;
        metric.redCount += newRed;
        metric.yellowCount += newYellow;
      }
    }

    if (metric.totalStepsExecuted >= 1) {
      metric.healthScorePct = Math.round((100 * metric.greenCount) / metric.totalStepsExecuted);
      let status: CujStatus =
        metric.healthScorePct <= 59 ? 'critical' : metric.healthScorePct <= 94 ? 'warning' : 'healthy';
      if (metric.bugCount > 0 && status === 'healthy') {
        const hasCriticalBug = metric.associatedBugs.some(isCriticalBug);
        status = hasCriticalBug ? 'critical' : 'warning';
      }
      metric.status = status;
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

  const untestedByKey = new Map<string, string>();
  (knownNames || []).forEach(n => {
    const name = trimName(n);
    if (!isCujName(name)) return;
    const key = name.toLowerCase();
    if (!metricsByKey.has(key) && !untestedByKey.has(key)) {
      untestedByKey.set(key, canonicalDisplayByKey.get(key) || name);
    }
  });
  const untestedCujNames = Array.from(untestedByKey.values()).sort((a, b) => a.localeCompare(b));

  // S11 totals
  const testedCujCount = testedMetrics.length;
  const criticalCount = testedMetrics.filter(m => m.status === 'critical').length;
  const warningCount = testedMetrics.filter(m => m.status === 'warning').length;
  const healthyCount = testedMetrics.filter(m => m.status === 'healthy').length;
  const criticalPct = pct(criticalCount, testedCujCount);
  const warningPct = pct(warningCount, testedCujCount);
  const healthyPct = pct(healthyCount, testedCujCount);
  const totals: CujReportTotals = {
    testedCujCount,
    stepsExecuted: testedMetrics.reduce((sum, m) => sum + m.totalStepsExecuted, 0),
    healthyCount,
    warningCount,
    criticalCount,
    criticalPct,
    warningPct,
    healthyPct,
    avgHealthScore: testedCujCount > 0
      ? Math.round(testedMetrics.reduce((sum, m) => sum + m.healthScorePct, 0) / testedCujCount)
      : null,
    bugCount: testedMetrics.concat(bugOnlyMetrics).reduce((sum, m) => sum + m.bugCount, 0)
  };

  // S12 golden runs: session runs judged on everything they recorded
  const sessionRuns = scope.date === ALL_DATES
    ? scopedRuns
    : scopedRuns.filter(run => {
        const recorded = getRecordedResults(run);
        if (recorded.length > 0) {
          return recorded.some(([, res]) => resultDateOf(res, run) === scope.date);
        }
        return (localDateStr(run.completedAt) || localDateStr(run.startedAt)) === scope.date;
      });
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

  // Demo flow from the same context (no second buildContext / firstSeen build)
  const demoFlow = buildDemoFlow(ctx, scope);

  return {
    scope,
    planLabel,
    testedMetrics,
    bugOnlyMetrics,
    untestedCujNames,
    totals,
    golden: { runs: goldenRows, goldenCount, totalCount: goldenRows.length, goldenPct: pct(goldenCount, goldenRows.length) },
    plansInScope,
    demoFlow
  };
}

// ---------------------------------------------------------------------------
// Days, timeline and plan picker
// ---------------------------------------------------------------------------

interface DayBucket { dateStr: string; stepCount: number; green: number; yellow: number; red: number; bugCount: number; runIds: Set<string> }

/** Per-day counted results (non-empty date) and bugs (valid date) for one plan scope. */
const aggregateDays = (input: { plans: TestPlan[]; runs: TestRun[]; bugs: BugLog[]; planId: string; firstSeen?: StepFirstSeenIndex }): Map<string, DayBucket> => {
  const ctx = buildContext(input.plans, input.runs, input.firstSeen, input.bugs);
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
        scorePct: d.stepCount > 0 ? Math.round((100 * d.green) / d.stepCount) : d.bugCount > 0 ? 0 : 100
      };
    });
}

/**
 * One option per plan: runCount = finished runs of the plan with >= 1 counted result on `date`
 * (ALL_DATES = any day); latestDate = latest day with a counted result or bug ('' if none).
 * Sorted by latestDate (newest first, '' last), then name.
 */
export function getPlanPickerOptions(input: { plans: TestPlan[]; runs: TestRun[]; bugs: BugLog[]; date: string; firstSeen?: StepFirstSeenIndex }): PlanPickerOption[] {
  const ctx = buildContext(input.plans, input.runs, input.firstSeen, input.bugs);
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

/** A real Buganizer bug linked into the report (structurally matches geminiService.FiledBug). */
export interface ReportFiledBug { id: string; title: string; priority?: string; status?: string }
/** One summarized issue shown as its own line item (structurally matches geminiService.ReportIssue). */
export interface ReportLineItem { summary: string; count: number; filedBugs: ReportFiledBug[] }

const BUG_URL = (id: string) => `https://issuetracker.google.com/issues/${encodeURIComponent(id)}`;
/** Drops leading "[Gemini on Glasses] [Bug] [Maps]"-style tags - the CUJ heading already says where it is. */
const cleanBugTitle = (title: string) => {
  const stripped = (title || '').replace(/^\s*(\[[^\]]{1,40}\]\s*)+/, '').trim();
  return stripped || (title || '').trim();
};
const priorityTag = (b: ReportFiledBug) => (b.priority && /^P[0-4]$/.test(b.priority) ? `[${b.priority}] ` : '');
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lineItemText = (item: ReportLineItem) => capFirst(item.count > 1 ? `${item.summary} (${item.count}x)` : item.summary);

/**
 * Plain-text and rich-HTML report for one scope (same layout as the original Dashboard report).
 * `getSummary` returns the one-line issue summary for a CUJ ('' = no summary line).
 * `getIssues` (optional) returns the CUJ's issues as separate line items, each with any linked
 * Buganizer bugs; when it returns items they replace the one-line summary.
 * Ends with one Demo Flow Quality block per `data.demoFlow` section (nothing when there is none).
 */
export function buildCujReportText(data: CujReportData, opts: {
  dateLabel: string;
  disclaimer?: string;
  overallSummary?: string;
  getSummary: (metric: CujMetric) => string;
  getIssues?: (metric: CujMetric) => ReportLineItem[] | undefined;
  getFiledBugs?: (metric: CujMetric) => ReportFiledBug[] | undefined;
  otherFiledBugs?: ReportFiledBug[];
}): { plainText: string; htmlText: string } {
  const { totals, golden, testedMetrics, bugOnlyMetrics, plansInScope, planLabel, scope } = data;
  const { dateLabel, disclaimer, overallSummary, getSummary } = opts;
  const demoFlow = Array.isArray(data.demoFlow) ? data.demoFlow : [];
  const otherFiledBugs = Array.isArray(opts.otherFiledBugs) ? opts.otherFiledBugs : [];

  const summaries = new Map<CujMetric, string>();
  const summaryOf = (metric: CujMetric): string => {
    if (!summaries.has(metric)) summaries.set(metric, getSummary(metric) || '');
    return summaries.get(metric) || '';
  };
  const issuesOf = (m: CujMetric): ReportLineItem[] => (opts.getIssues?.(m) || []).filter(i => i && i.summary);
  const filedOf = (m: CujMetric): ReportFiledBug[] => opts.getFiledBugs?.(m) || [];
  const hasLineItems = (m: CujMetric) => issuesOf(m).length > 0 || filedOf(m).length > 0;

  // Plain text: each issue on its own line, linked Buganizer bugs indented beneath it
  const plainDetail = (m: CujMetric, summary: string): string => {
    if (!hasLineItems(m)) return summary ? `↳ Summary: ${summary}\n` : '';
    let out = '';
    issuesOf(m).forEach(item => {
      out += `  • ${lineItemText(item)}\n`;
      item.filedBugs.forEach(b => { out += `      ↳ b/${b.id} ${priorityTag(b)}${cleanBugTitle(b.title)}\n`; });
    });
    filedOf(m).forEach(b => { out += `  • 🐞 Filed: b/${b.id} ${priorityTag(b)}${cleanBugTitle(b.title)}\n`; });
    return out;
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
  // Demo Flow step counts: non-zero counts only, in green / yellow / red order (e.g. "7 · 2 · 1")
  const flowParts = (row: DemoFlowStepRow) =>
    [
      { count: row.greenCount, color: '#16a34a' },
      { count: row.yellowCount, color: '#d97706' },
      { count: row.redCount, color: '#dc2626' }
    ].filter(part => part.count > 0);

  // Plain text format
  let plainText = `📊 CUJ Report: ${planLabel} (${dateLabel})\n`;
  if (showPlans) {
    plainText += `• Plans: ${plansInScope.map(p => `${p.planName} ${planRuns(p)}`).join(', ')}\n`;
  }
  plainText += `• Coverage: ${totals.testedCujCount} CUJs (${totals.stepsExecuted} steps)\n`;
  plainText += `• Status: 🟢 ${totals.healthyCount} Healthy | 🟡 ${totals.warningCount} Degraded | 🔴 ${totals.criticalCount} Critical (${totals.bugCount} Bugs)\n`;
  plainText += `• Golden Runs: 🏆 ${goldenCount} (${goldenCount === 1 ? '1 clean run' : `${goldenCount} clean runs`}, ≤1 orange, 0 reds)\n`;
  if (disclaimer && disclaimer.trim()) {
    plainText += `Disclaimer: ${disclaimer.trim()}\n`;
  }
  if (overallSummary) {
    plainText = plainText.replace(/\n*$/, '\n\n');
    plainText += `Issue Summary: ${overallSummary}\n`;
  }

  if (criticalList.length > 0) {
    plainText = plainText.replace(/\n*$/, '\n\n');
    plainText += `🔴 Critical CUJs:\n`;
    criticalList.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})\n`;
      plainText += plainDetail(m, summary);
    });
  }

  if (warningList.length > 0) {
    plainText = plainText.replace(/\n*$/, '\n\n');
    plainText += `🟡 Degraded CUJs:\n`;
    warningList.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})\n`;
      plainText += plainDetail(m, summary);
    });
  }

  if (healthyList.length > 0) {
    plainText = plainText.replace(/\n*$/, '\n\n');
    plainText += `🟢 Healthy CUJs:\n`;
    healthyList.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})\n`;
      if (hasLineItems(m)) plainText += plainDetail(m, summary);
      else if (showHealthySummary(m, summary)) plainText += `↳ Summary: ${summary}\n`;
    });
  }

  if (bugOnlyMetrics.length > 0) {
    plainText = plainText.replace(/\n*$/, '\n\n');
    plainText += `🐛 Bugs on CUJs without completed steps:\n`;
    bugOnlyMetrics.forEach(m => {
      const summary = summaryOf(m);
      plainText += `${m.featureName}: ${bugsLabel(m.bugCount)}\n`;
      plainText += plainDetail(m, summary);
    });
  }

  if (otherFiledBugs.length > 0) {
    plainText = plainText.replace(/\n*$/, '\n\n');
    plainText += `🐞 Other bugs filed today:\n`;
    otherFiledBugs.forEach(b => { plainText += `  • b/${b.id} ${priorityTag(b)}${cleanBugTitle(b.title)}\n`; });
  }

  // Demo Flow Quality, after every other section: one block per plan
  demoFlow.forEach(section => {
    plainText = plainText.replace(/\n*$/, '\n\n');
    plainText += `🎬 Demo Flow Quality:\n`;
    section.rows.forEach(row => {
      plainText += `${row.position}. ${row.title}: ${flowParts(row).map(part => `${part.count}`).join(' · ')} (${row.greenPct}%)\n`;
    });
  });

  // Rich HTML format (for Google Chat, Slack, Teams, Google Docs, Word, Apple Notes, Email)
  const summaryHtml = (summary: string) =>
    `<div style="color: #475569; font-size: 12px; margin-top: 1px; margin-left: 12px;">↳ <i>Summary: ${escapeHtml(summary)}</i></div>`;
  const bugLinkHtml = (b: ReportFiledBug) =>
    `<a href="${BUG_URL(b.id)}" style="color: #2563eb; text-decoration: none; font-weight: 600;">b/${escapeHtml(b.id)}</a> ${escapeHtml(priorityTag(b))}${escapeHtml(cleanBugTitle(b.title))}`;
  const lineItemsHtml = (m: CujMetric) => {
    let out = `<ul style="margin: 2px 0 2px 0; padding-left: 26px; color: #334155; font-size: 12px;">`;
    issuesOf(m).forEach(item => {
      out += `<li style="margin: 1px 0;">${escapeHtml(lineItemText(item))}`;
      item.filedBugs.forEach(b => { out += `<div style="margin: 1px 0 0 2px; color: #475569;">↳ ${bugLinkHtml(b)}</div>`; });
      out += `</li>`;
    });
    filedOf(m).forEach(b => { out += `<li style="margin: 1px 0;">🐞 Filed: ${bugLinkHtml(b)}</li>`; });
    return out + `</ul>`;
  };
  const detailHtml = (m: CujMetric, summary: string) =>
    hasLineItems(m) ? lineItemsHtml(m) : (summary ? summaryHtml(summary) : '');
  const metricRowHtml = (m: CujMetric, summary: string) =>
    `<div style="margin-bottom: 4px;"><b>${escapeHtml(m.featureName)}</b>: ${m.healthScorePct}% (${stepDetail(m)}${bugText(m)})${detailHtml(m, summary)}</div>`;

  let htmlText = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.5;">`;
  htmlText += `<p style="margin: 0 0 6px 0; color: #4f46e5; font-weight: 700;">📊 CUJ Report: ${escapeHtml(planLabel)} (${escapeHtml(dateLabel)})</p>`;
  if (showPlans) {
    htmlText += `<p style="margin: 0 0 4px 0;">• <b>Plans</b>: ${plansInScope.map(p => `${escapeHtml(p.planName)} ${planRuns(p)}`).join(', ')}</p>`;
  }
  htmlText += `<p style="margin: 0 0 4px 0;">• <b>Coverage</b>: ${totals.testedCujCount} CUJs (${totals.stepsExecuted} steps)</p>`;
  htmlText += `<p style="margin: 0 0 4px 0;">• <b>Status</b>: 🟢 ${totals.healthyCount} Healthy | 🟡 ${totals.warningCount} Degraded | 🔴 ${totals.criticalCount} Critical (${totals.bugCount} Bugs)</p>`;
  htmlText += `<p style="margin: 0;">• <b>Golden Runs</b>: 🏆 <b>${goldenCount}</b> <span style="color: #64748b; font-size: 11px;">(≤1 orange, 0 reds)</span></p>`;
  if (disclaimer && disclaimer.trim()) {
    htmlText += `<p style="margin: 4px 0 0 0; color: #475569;"><b>Disclaimer:</b> ${escapeHtml(disclaimer.trim())}</p>`;
  }
  if (overallSummary) {
    htmlText += `<br>`;
    htmlText += `<div style="background-color: #f8fafc; border-left: 3px solid #6366f1; padding: 8px 12px; margin: 0; border-radius: 6px; font-size: 12.5px; color: #1e293b; line-height: 1.55;"><b>Issue Summary:</b> ${escapeHtml(overallSummary)}</div>`;
  }

  if (criticalList.length > 0) {
    htmlText += `<br>`;
    htmlText += `<p style="margin: 0 0 4px 0; color: #dc2626; font-weight: 700;">🔴 Critical CUJs:</p>`;
    htmlText += `<div style="margin: 0;">`;
    criticalList.forEach(m => {
      htmlText += metricRowHtml(m, summaryOf(m));
    });
    htmlText += `</div>`;
  }

  if (warningList.length > 0) {
    htmlText += `<br>`;
    htmlText += `<p style="margin: 0 0 4px 0; color: #d97706; font-weight: 700;">🟡 Degraded CUJs:</p>`;
    htmlText += `<div style="margin: 0;">`;
    warningList.forEach(m => {
      htmlText += metricRowHtml(m, summaryOf(m));
    });
    htmlText += `</div>`;
  }

  if (healthyList.length > 0) {
    htmlText += `<br>`;
    htmlText += `<p style="margin: 0 0 4px 0; color: #16a34a; font-weight: 700;">🟢 Healthy CUJs:</p>`;
    htmlText += `<div style="margin: 0;">`;
    healthyList.forEach(m => {
      const summary = summaryOf(m);
      htmlText += metricRowHtml(m, hasLineItems(m) || showHealthySummary(m, summary) ? summary : '');
    });
    htmlText += `</div>`;
  }

  if (bugOnlyMetrics.length > 0) {
    htmlText += `<br>`;
    htmlText += `<p style="margin: 0 0 4px 0; color: #7c3aed; font-weight: 700;">🐛 Bugs on CUJs without completed steps:</p>`;
    htmlText += `<div style="margin: 0;">`;
    bugOnlyMetrics.forEach(m => {
      const summary = summaryOf(m);
      htmlText += `<div style="margin-bottom: 4px;"><b>${escapeHtml(m.featureName)}</b>: ${bugsLabel(m.bugCount)}${detailHtml(m, summary)}</div>`;
    });
    htmlText += `</div>`;
  }

  if (otherFiledBugs.length > 0) {
    htmlText += `<br>`;
    htmlText += `<p style="margin: 0 0 4px 0; color: #475569; font-weight: 700;">🐞 Other bugs filed today:</p>`;
    htmlText += `<ul style="margin: 0; padding-left: 26px; font-size: 12px; color: #334155;">`;
    otherFiledBugs.forEach(b => { htmlText += `<li style="margin: 1px 0;">${bugLinkHtml(b)}</li>`; });
    htmlText += `</ul>`;
  }

  if (demoFlow.length > 0) {
    demoFlow.forEach(section => {
      htmlText += `<br>`;
      htmlText += `<p style="margin: 0 0 4px 0; color: #4f46e5; font-weight: 700;">🎬 Demo Flow Quality:</p>`;
      htmlText += `<div style="margin: 0;">`;
      section.rows.forEach(row => {
        const countsHtml = flowParts(row).map(part => `<span style="color: ${part.color}; font-weight: 700;">${part.count}</span>`).join(' · ');
        htmlText += `<div style="margin-bottom: 3px;"><b>${row.position}. ${escapeHtml(row.title)}</b>: ${countsHtml} <span style="color: #64748b;">(${row.greenPct}%)</span></div>`;
      });
      htmlText += `</div>`;
    });
  }

  htmlText += `</div>`;

  return { plainText, htmlText };
}
