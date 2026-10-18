import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ListChecks,
  Plus,
  Trash2,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  User,
  Copy,
  Search,
  Sparkles,
  Edit,
  ChevronRight,
  Timer,
  MoreHorizontal,
  Play,
} from 'lucide-react';
import { TestPlan, TestRun, BugLog } from '../../types';
import { getLocalDateStr } from '../../utils/dateUtils';
import { mergeRunsById } from '../../utils/cujReportUtils';
import { isRunFullyCompleted, buildStepFirstSeenIndex } from '../../utils/runUtils';

export interface TestPlansTabProps {
  testPlans: TestPlan[];
  filteredPlans: TestPlan[];
  testRuns: TestRun[];
  archivedRuns?: TestRun[];
  bugLogs?: BugLog[];
  todayStr?: string;
  liveInProgressRuns: TestRun[];
  activeRuns: number;
  searchPlanQuery: string;
  setSearchPlanQuery: React.Dispatch<React.SetStateAction<string>>;
  expandedPlanSteps: Record<string, boolean>;
  setExpandedPlanSteps: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSelectPlanToBuild: () => void;
  onEditPlan?: (plan: TestPlan) => void;
  onClonePlan: (planId: string) => void;
  onDeletePlan: (planId: string) => void;
  onOpenMobileView: (planId: string) => void;
  onRunSubagentTest?: (planId: string) => void;
  onBootTester?: (runId: string, deviceId?: string, testerName?: string, deviceName?: string) => void;
  onDeleteTestRun?: (runId: string) => void;
  setSelectedDailySessionDate: React.Dispatch<React.SetStateAction<string>>;
  setSelectedReportPlanId: React.Dispatch<React.SetStateAction<string>>;
  setActiveTab: React.Dispatch<React.SetStateAction<'overview' | 'devices' | 'testers' | 'features' | 'bugs'>>;
  setSubagentToast: React.Dispatch<React.SetStateAction<string | null>>;
  formatOngoingDuration: (startedAt?: string) => string;
}

const formatLastRunLabel = (isoDate: string | undefined, todayStr: string): string => {
  if (!isoDate) return '—';
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '—';
    const dayStr = getLocalDateStr(d);
    if (dayStr === todayStr) {
      return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
};

export const TestPlansTab: React.FC<TestPlansTabProps> = ({
  testPlans,
  filteredPlans,
  testRuns,
  archivedRuns = [],
  bugLogs = [],
  todayStr: todayStrProp,
  liveInProgressRuns,
  activeRuns,
  searchPlanQuery,
  setSearchPlanQuery,
  expandedPlanSteps,
  setExpandedPlanSteps,
  onSelectPlanToBuild,
  onEditPlan,
  onClonePlan,
  onDeletePlan,
  onOpenMobileView,
  onRunSubagentTest,
  onBootTester,
  onDeleteTestRun,
  setSelectedDailySessionDate,
  setSelectedReportPlanId,
  setActiveTab,
  setSubagentToast,
  formatOngoingDuration,
}) => {
  const [openMenuPlanId, setOpenMenuPlanId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const todayStr = todayStrProp || getLocalDateStr(new Date());

  useEffect(() => {
    if (!openMenuPlanId) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuPlanId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openMenuPlanId]);

  // Compute per-plan metrics: lastRunIso, todayRunsCount, bugCount
  const planStatsMap = useMemo(() => {
    const mergedRuns = mergeRunsById(archivedRuns, testRuns);
    const firstSeen = buildStepFirstSeenIndex(mergedRuns);
    const runPlanById = new Map<string, string>();
    mergedRuns.forEach(r => {
      if (r && r.id && r.planId) runPlanById.set(r.id, r.planId);
    });

    const stats = new Map<
      string,
      { lastRunIso?: string; lastRunMs: number; todayCount: number; bugCount: number }
    >();
    testPlans.forEach(p => {
      stats.set(p.id, { lastRunIso: undefined, lastRunMs: 0, todayCount: 0, bugCount: 0 });
    });

    mergedRuns.forEach(r => {
      if (!r || !r.planId) return;
      const entry = stats.get(r.planId);
      if (!entry) return;
      const completed = isRunFullyCompleted(r, testPlans, firstSeen);
      if (!completed) return;
      const refIso = r.completedAt || r.startedAt;
      const ms = refIso ? new Date(refIso).getTime() : 0;
      if (ms > entry.lastRunMs) {
        entry.lastRunMs = ms;
        entry.lastRunIso = refIso;
      }
      if (refIso && getLocalDateStr(refIso) === todayStr) {
        entry.todayCount += 1;
      }
    });

    bugLogs.forEach(b => {
      const pid = b.planId || (b.testRunId ? runPlanById.get(b.testRunId) : undefined);
      if (!pid) return;
      const entry = stats.get(pid);
      if (entry) entry.bugCount += 1;
    });

    return stats;
  }, [testPlans, testRuns, archivedRuns, bugLogs, todayStr]);

  return (
    <div className="space-y-4">
      {/* Single Compact Header Row spanning full width */}
      <div
        data-testid="test-plans-header"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h2 className="text-base font-bold text-slate-50 tracking-tight shrink-0">Test plans</h2>
          {testPlans.length > 0 && (
            <div className="relative w-full max-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2 pointer-events-none" />
              <input
                type="text"
                data-testid="test-plans-search"
                placeholder="Search plans..."
                value={searchPlanQuery}
                onChange={e => setSearchPlanQuery(e.target.value)}
                className="w-full bg-[#0f172a] border border-slate-800 rounded-xl pl-8 pr-6 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              {searchPlanQuery && (
                <button
                  type="button"
                  onClick={() => setSearchPlanQuery('')}
                  className="absolute right-2 top-1.5 text-slate-500 hover:text-white text-xs cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          data-testid="create-plan-button"
          onClick={onSelectPlanToBuild}
          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-sm border border-blue-500 flex items-center gap-1.5 transition-all duration-200 active:scale-[0.98] cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New plan</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Compact Test Plans Table Column */}
        <div className="lg:col-span-2" ref={menuContainerRef}>
          {testPlans.length === 0 ? (
            <div className="bg-[#111827] border border-slate-800 rounded-2xl p-8 text-center space-y-4">
              <div className="p-3 bg-[#0f172a] rounded-full border border-slate-800 text-slate-500 w-fit mx-auto">
                <ListChecks className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">No Test Plans Found</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Click "New plan" to get started with test steps.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onSelectPlanToBuild}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Create Test Plan
                </button>
              </div>
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="bg-[#111827] border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
              No test plans matching "{searchPlanQuery}".
            </div>
          ) : (
            <div
              data-testid="test-plans-table"
              className="bg-[#0f172a]/85 border border-slate-800/80 rounded-2xl divide-y divide-slate-800/80 overflow-visible"
            >
              {/* Column Headers: PLAN · STEPS · LAST RUN · TODAY · BUGS */}
              <div
                data-testid="test-plans-table-header"
                className="px-4 py-2.5 grid grid-cols-[minmax(0,1.6fr)_60px_110px_64px_56px_auto] items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                <span>Plan</span>
                <span>Steps</span>
                <span className="hidden sm:inline">Last run</span>
                <span className="hidden sm:inline">Today</span>
                <span>Bugs</span>
                <span className="sr-only">Actions</span>
              </div>

              {filteredPlans.map(plan => {
                const isExpanded = !!expandedPlanSteps[plan.id];
                const isMenuOpen = openMenuPlanId === plan.id;
                const st = planStatsMap.get(plan.id) || {
                  lastRunIso: undefined,
                  lastRunMs: 0,
                  todayCount: 0,
                  bugCount: 0,
                };
                const lastRunStr = formatLastRunLabel(st.lastRunIso, todayStr);

                return (
                  <div
                    key={plan.id}
                    data-testid="test-plan-row"
                    data-plan-id={plan.id}
                    className="transition-colors hover:bg-slate-900/40"
                  >
                    <div className="px-4 py-3 grid grid-cols-[minmax(0,1.6fr)_60px_110px_64px_56px_auto] items-center gap-3">
                      {/* Col 1: Plan Name (click to expand steps) */}
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          data-testid="test-plan-expand"
                          onClick={() =>
                            setExpandedPlanSteps(prev => ({ ...prev, [plan.id]: !prev[plan.id] }))
                          }
                          className="p-0.5 rounded text-slate-400 hover:text-slate-200 transition-colors cursor-pointer shrink-0"
                          title={isExpanded ? 'Collapse steps' : 'View steps'}
                        >
                          <ChevronRight
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${
                              isExpanded ? 'rotate-90 text-blue-400' : ''
                            }`}
                          />
                        </button>
                        <div
                          className="min-w-0 flex-1 cursor-pointer"
                          onClick={() =>
                            setExpandedPlanSteps(prev => ({ ...prev, [plan.id]: !prev[plan.id] }))
                          }
                        >
                          <h4 className="text-xs font-bold text-slate-100 tracking-tight truncate">
                            {plan.name}
                          </h4>
                        </div>
                      </div>

                      {/* Col 2: Steps */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPlanSteps(prev => ({ ...prev, [plan.id]: !prev[plan.id] }))
                        }
                        className="text-left text-xs font-mono font-semibold text-slate-200 hover:text-blue-300 cursor-pointer"
                      >
                        {plan.steps.length}
                      </button>

                      {/* Col 3: Last run */}
                      <span
                        data-testid="test-plan-last-run"
                        className="hidden sm:inline text-xs text-slate-400 truncate"
                      >
                        {lastRunStr}
                      </span>

                      {/* Col 4: Today */}
                      <span
                        data-testid="test-plan-today"
                        className="hidden sm:inline text-xs font-mono text-slate-400"
                      >
                        {st.todayCount > 0 ? st.todayCount : '—'}
                      </span>

                      {/* Col 5: Bugs */}
                      <span data-testid="test-plan-bugs" className="text-xs">
                        {st.bugCount > 0 ? (
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10.5px] font-mono font-bold bg-rose-500/15 text-rose-300 border border-rose-500/35">
                            {st.bugCount}
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono">—</span>
                        )}
                      </span>

                      {/* Col 6: Actions: [▶ Test on phone] [✎ Edit visible] [⋯ = Clone · Simulate a run · Delete] */}
                      <div className="flex items-center justify-end gap-1.5 shrink-0">
                        <button
                          type="button"
                          data-testid="run-on-phone-button"
                          onClick={() => onOpenMobileView(plan.id)}
                          className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-100 hover:text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all duration-150 cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current text-slate-300" />
                          <span>Test on phone</span>
                        </button>

                        {onEditPlan && (
                          <button
                            type="button"
                            data-testid="test-plan-edit-button"
                            onClick={() => onEditPlan(plan)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
                            title="Edit Test Plan & Steps"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* ⋯ Secondary Actions Menu */}
                        <div className="relative">
                          <button
                            type="button"
                            data-testid="test-plan-menu-button"
                            onClick={() =>
                              setOpenMenuPlanId(prev => (prev === plan.id ? null : plan.id))
                            }
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
                            title="More actions"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>

                          {isMenuOpen && (
                            <div
                              data-testid="test-plan-menu-dropdown"
                              className="absolute right-0 mt-1.5 w-44 rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl py-1 z-50 text-xs"
                            >
                              <button
                                type="button"
                                data-testid="plan-menu-duplicate"
                                onClick={() => {
                                  setOpenMenuPlanId(null);
                                  onClonePlan(plan.id);
                                }}
                                className="w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer"
                                title="Clone Test Plan"
                              >
                                <Copy className="w-3.5 h-3.5 text-slate-400" />
                                <span>Clone</span>
                              </button>

                              {onRunSubagentTest && (
                                <button
                                  type="button"
                                  data-testid="plan-menu-autotest"
                                  onClick={() => {
                                    setOpenMenuPlanId(null);
                                    onRunSubagentTest(plan.id);
                                    setSelectedDailySessionDate(getLocalDateStr(new Date()));
                                    setSelectedReportPlanId(plan.id);
                                    setActiveTab('features');
                                    setSubagentToast(
                                      `Simulated a full run of all ${plan.steps.length} steps in "${plan.name}" for Today.`
                                    );
                                    setTimeout(() => setSubagentToast(null), 5000);
                                  }}
                                  className="w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer"
                                  title="Simulate a run for Today"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                                  <span>Simulate a run</span>
                                </button>
                              )}

                              <div className="my-1 border-t border-slate-800" />

                              <button
                                type="button"
                                data-testid="plan-menu-delete"
                                onClick={() => {
                                  setOpenMenuPlanId(null);
                                  onDeletePlan(plan.id);
                                }}
                                className="w-full px-3 py-2 text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer"
                                title="Delete Test Plan"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                                <span>Delete</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Step Walkthrough */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-slate-800/60 bg-slate-950/30 space-y-2">
                        {plan.description && (
                          <p className="text-xs text-slate-400 pb-1">{plan.description}</p>
                        )}
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 pb-1">
                          <span className="uppercase tracking-wider text-blue-400">
                            Steps ({plan.steps.length})
                          </span>
                          <span className="text-slate-500 font-mono text-[10px]">Step Sequence</span>
                        </div>
                        <div className="space-y-1.5">
                          {plan.steps.map((step, sIdx) => {
                            const isLastStep = sIdx === plan.steps.length - 1;
                            return (
                              <div
                                key={step.id || `plan-step-${sIdx}`}
                                className={`p-2.5 rounded-xl border text-xs space-y-1 transition-all ${
                                  isLastStep
                                    ? 'bg-blue-950/20 border-blue-500/40'
                                    : 'bg-[#0f172a] border-slate-800/80'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono font-bold text-blue-300 text-[10px] bg-blue-500/15 px-1.5 py-0.5 rounded border border-blue-500/30 shrink-0">
                                      #{sIdx + 1}
                                    </span>
                                    <span className="font-semibold text-white text-xs truncate">
                                      {step.title}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 shrink-0">
                                    {step.feature || 'General'}
                                  </span>
                                </div>
                                {step.description && (
                                  <p className="text-slate-400 text-[11px] leading-relaxed pl-1">
                                    {step.description}
                                  </p>
                                )}
                                {step.expectedOutcome && (
                                  <div className="text-[11px] text-emerald-300 bg-emerald-950/30 px-2 py-1 rounded border border-emerald-800/30">
                                    <span className="text-emerald-400 font-semibold">Expected: </span>
                                    {step.expectedOutcome}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Slim Live Now Right Panel */}
        <div
          data-testid="live-now-panel"
          className="bg-[#0f172a]/85 border border-slate-800/80 rounded-2xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-2.5">
            <h3 className="text-xs font-bold text-slate-200">Live now</h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-slate-800/80 text-slate-400">
              {activeRuns}
            </span>
          </div>

          <div className="space-y-2.5">
            {(() => {
              const ongoingRuns = liveInProgressRuns;
              if (ongoingRuns.length === 0) {
                return (
                  <p className="text-xs text-slate-500 py-1">
                    No one is testing right now.
                  </p>
                );
              }

              return ongoingRuns.map(run => {
                const plan = testPlans.find(p => p.id === run.planId);
                const totalSteps = plan?.steps.length || 1;
                const stepEntries = Object.entries(run.results || {}).filter(
                  ([k, v]) =>
                    k !== '_meta' &&
                    v &&
                    typeof v === 'object' &&
                    'status' in v &&
                    (v as any).status !== 'pending'
                );
                const completedResults = stepEntries.map(([_, v]) => v);
                const completedSteps = completedResults.length;
                const progressPct = Math.min(100, Math.round((completedSteps / totalSteps) * 100));

                const lastResultTs = completedResults.reduce((max: number, r: any) => {
                  const t =
                    typeof r.timestamp === 'number'
                      ? r.timestamp
                      : r.timestamp
                      ? new Date(r.timestamp).getTime()
                      : 0;
                  return !isNaN(t) ? Math.max(max, t) : max;
                }, 0);
                const startedAtMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
                const refTs =
                  run.lastActivityTimestamp || lastResultTs || (!isNaN(startedAtMs) ? startedAtMs : 0);
                const isAway = Boolean(refTs && Date.now() - refTs > 3 * 60 * 1000);

                return (
                  <div
                    key={run.id}
                    className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-blue-400" />
                        {run.testerName || 'Unassigned Tester'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {run.startedAt && (
                          <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-[#0f172a] text-blue-300 border border-blue-500/30 flex items-center gap-1">
                            <Timer className="w-3 h-3 text-blue-400" />
                            <span>{formatOngoingDuration(run.startedAt)}</span>
                          </span>
                        )}
                        {isAway ? (
                          <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border bg-amber-500/20 text-amber-300 border-amber-400/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                            Away
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border bg-blue-500/20 text-blue-300 border-blue-400/30">
                            Active
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="truncate max-w-[140px] text-slate-300 font-medium">
                        {plan?.name || run.planName}
                      </span>
                      <span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded font-mono border border-slate-700 flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-blue-400" />
                        {run.deviceName || 'Device Unset'}
                      </span>
                    </div>

                    {(() => {
                      const currentStepIdx =
                        run.currentStepIndex !== undefined ? run.currentStepIndex : completedSteps;
                      const currentStep = plan?.steps[Math.min(currentStepIdx, totalSteps - 1)];
                      const stepTitle = currentStep
                        ? currentStep.title || currentStep.feature || `Step ${currentStepIdx + 1}`
                        : undefined;
                      const greenCount = completedResults.filter((r: any) => r.status === 'green').length;
                      const yellowCount = completedResults.filter((r: any) => r.status === 'yellow').length;
                      const redCount = completedResults.filter((r: any) => r.status === 'red').length;
                      return (
                        <>
                          <div className="bg-[#0f172a] rounded-lg px-2.5 py-1 border border-slate-800 flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 font-mono text-[10px]">
                              Step {Math.min(currentStepIdx + 1, totalSteps)}/{totalSteps}
                            </span>
                            {stepTitle && (
                              <span
                                className="text-blue-300 font-semibold truncate max-w-[150px]"
                                title={stepTitle}
                              >
                                {stepTitle}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="flex items-center gap-1 text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                              <CheckCircle2 className="w-2.5 h-2.5" /> {greenCount}
                            </span>
                            <span className="flex items-center gap-1 text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
                              <AlertTriangle className="w-2.5 h-2.5" /> {yellowCount}
                            </span>
                            <span className="flex items-center gap-1 text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/40">
                              <XCircle className="w-2.5 h-2.5" /> {redCount}
                            </span>
                          </div>
                        </>
                      );
                    })()}

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono text-slate-400">
                        <span>Progress</span>
                        <span>
                          {completedSteps}/{totalSteps} ({progressPct}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-blue-500 h-full transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {(onBootTester || onDeleteTestRun) && (
                      <div className="pt-1.5 border-t border-slate-800/60 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              confirm(
                                `Boot tester "${run.testerName || 'Tester'}" off phone mode and terminate this active session?`
                              )
                            ) {
                              if (onBootTester) {
                                onBootTester(run.id, run.deviceId, run.testerName, run.deviceName);
                              } else if (onDeleteTestRun) {
                                onDeleteTestRun(run.id);
                              }
                            }
                          }}
                          className="px-2.5 py-1 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-white text-[10px] font-bold rounded-lg border border-rose-500/30 flex items-center gap-1 transition-all cursor-pointer"
                          title="Boot tester off phone mode and terminate this test session"
                        >
                          <Trash2 className="w-3 h-3 text-rose-400" />
                          Boot Tester
                        </button>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
