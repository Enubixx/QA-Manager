import React from 'react';
import {
  ListChecks,
  Clock,
  Plus,
  Trash2,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  User,
  Activity,
  Copy,
  Search,
  Sparkles,
  Edit,
  ChevronDown,
  Timer,
} from 'lucide-react';
import { TestPlan, TestRun } from '../../types';
import { getLocalDateStr } from '../../utils/dateUtils';

export interface TestPlansTabProps {
  testPlans: TestPlan[];
  filteredPlans: TestPlan[];
  testRuns: TestRun[];
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

export const TestPlansTab: React.FC<TestPlansTabProps> = ({
  testPlans,
  filteredPlans,
  testRuns,
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
  return (
    <div className="space-y-6">
      {/* Test Plans Area Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 liquid-glass-panel rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-xl font-bold text-slate-50 tracking-tight">Test Plans & Feature Health Monitor</h2>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Design test templates, track individual feature health metrics, and organize bug logs by device model.
          </p>
        </div>

        <div className="flex items-center gap-2.5 relative z-10">
          <button
            type="button"
            onClick={onSelectPlanToBuild}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-2xl shadow-sm border border-blue-500 flex items-center gap-1.5 transition-all duration-200 active:scale-[0.98] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Plan</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Test Plans List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-base font-bold text-slate-50 flex items-center gap-2">
              <span>Configured QA Test Plans</span>
              <span className="text-xs text-slate-400 font-normal">
                ({filteredPlans.length} / {testPlans.length} plans)
              </span>
            </h3>

            {testPlans.length > 0 && (
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search test plans..."
                  value={searchPlanQuery}
                  onChange={e => setSearchPlanQuery(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-700/80 rounded-2xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                {searchPlanQuery && (
                  <button
                    onClick={() => setSearchPlanQuery('')}
                    className="absolute right-2.5 top-2 text-slate-500 hover:text-white text-xs"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>

          {testPlans.length === 0 ? (
            <div className="bg-[#111827] border border-slate-800 rounded-2xl p-8 text-center space-y-4">
              <div className="p-3 bg-[#0f172a] rounded-full border border-slate-800 text-slate-500 w-fit mx-auto">
                <ListChecks className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">No Test Plans Found</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Click "Create Test Plan" to get started with test steps.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={onSelectPlanToBuild}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-2xl shadow-sm inline-flex items-center gap-1.5"
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
            <div className="space-y-4">
              {filteredPlans.map(plan => (
                <div key={plan.id} className="liquid-glass-card rounded-3xl p-6 space-y-4 transition-all duration-200">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-lg font-bold text-slate-50 tracking-tight">{plan.name}</h4>
                      <p className="text-xs text-slate-400 mt-1">{plan.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {onEditPlan && (
                        <button
                          onClick={() => onEditPlan(plan)}
                          className="p-2 text-slate-400 hover:text-blue-300 liquid-glass-button rounded-xl transition-all"
                          title="Edit Test Plan & Steps"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => onClonePlan(plan.id)}
                        className="p-2 text-slate-400 hover:text-blue-300 liquid-glass-button rounded-xl transition-all"
                        title="Duplicate / Clone Test Plan"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          // Mirrors App.handleDeletePlan: removes this plan's active (non-archived) runs; bugs and completed runs are kept.
                          const runsInProgress = testRuns.filter(r => r.planId === plan.id).length;
                          const runsNote =
                            runsInProgress > 0
                              ? ` This also removes ${runsInProgress} run${runsInProgress === 1 ? '' : 's'} in progress.`
                              : '';
                          if (confirm(`Delete "${plan.name}"?${runsNote} Completed runs and bugs are kept.`)) {
                            onDeletePlan(plan.id);
                          }
                        }}
                        className="p-2 text-slate-500 hover:text-rose-400 liquid-glass-button hover:bg-rose-500/10 rounded-xl transition-all"
                        title="Delete Test Plan"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Step Count & Action Buttons */}
                  <div className="flex items-center justify-between pt-3.5 border-t border-slate-800 text-xs text-slate-400 font-medium">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedPlanSteps(prev => ({ ...prev, [plan.id]: !prev[plan.id] }))}
                        className="font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform duration-300 ${
                            expandedPlanSteps[plan.id] ? 'rotate-180 text-blue-400' : ''
                          }`}
                        />
                        <span>
                          {plan.steps.length} Steps {expandedPlanSteps[plan.id] ? '(Collapse)' : '(View Steps)'}
                        </span>
                      </button>
                      <span>•</span>
                      <span className="font-mono text-[11px]">
                        Created {new Date(plan.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {onRunSubagentTest && (
                        <button
                          type="button"
                          onClick={() => {
                            onRunSubagentTest(plan.id);
                            setSelectedDailySessionDate(getLocalDateStr(new Date()));
                            setSelectedReportPlanId(plan.id);
                            setActiveTab('features');
                            setSubagentToast(
                              `Subagent executed all ${plan.steps.length} steps in "${plan.name}" for Today! Features populated.`
                            );
                            setTimeout(() => setSubagentToast(null), 5000);
                          }}
                          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-2xl flex items-center gap-1.5 transition-all duration-200 shadow-sm active:scale-[0.98] cursor-pointer"
                          title="Run autonomous subagent to execute all steps in this test flow and record data for Today"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                          <span>Auto-Test (Today)</span>
                        </button>
                      )}

                      <button
                        onClick={() => onOpenMobileView(plan.id)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white text-xs font-semibold rounded-2xl flex items-center gap-1.5 transition-all duration-200 shadow-sm active:scale-[0.98]"
                      >
                        <Smartphone className="w-3.5 h-3.5 text-white" />
                        Test on Phone App
                      </button>
                    </div>
                  </div>

                  {/* Expandable Step Walkthrough Table/List */}
                  {expandedPlanSteps[plan.id] && (
                    <div className="mt-3 pt-3 border-t border-slate-800 space-y-2 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 pb-1">
                        <span className="uppercase tracking-wider text-blue-400">
                          Test Flow Step Sequence ({plan.steps.length} Steps)
                        </span>
                        <span className="text-slate-400 font-mono text-[10px]">Verify Step Order</span>
                      </div>
                      <div className="space-y-2">
                        {plan.steps.map((step, sIdx) => {
                          const isLastStep = sIdx === plan.steps.length - 1;
                          return (
                            <div
                              key={step.id || `plan-step-${sIdx}`}
                              className={`p-3 rounded-xl border text-xs space-y-1.5 transition-all ${
                                isLastStep
                                  ? 'bg-blue-950/20 border-blue-500/40 shadow-sm'
                                  : 'bg-[#0f172a] border-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-blue-300 text-[11px] bg-blue-500/15 px-2 py-0.5 rounded-lg border border-blue-500/30">
                                    Step #{sIdx + 1}
                                  </span>
                                  {isLastStep && (
                                    <span className="font-bold text-amber-300 text-[10px] bg-amber-500/15 px-2 py-0.5 rounded-lg border border-amber-500/30 uppercase tracking-wide flex items-center gap-1">
                                      Final Step
                                    </span>
                                  )}
                                  <span className="font-bold text-white text-xs">{step.title}</span>
                                </div>
                                <span className="text-[10px] font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                                  {step.feature || 'General'}
                                </span>
                              </div>
                              {step.description && (
                                <p className="text-slate-300 text-[11px] leading-relaxed pl-1">{step.description}</p>
                              )}
                              {step.expectedOutcome && (
                                <div className="text-[11px] text-emerald-300 bg-emerald-950/40 p-2 rounded-lg border border-emerald-800/40">
                                  <span className="text-emerald-400 font-bold uppercase tracking-wider text-[9px] block">
                                    Expected Outcome:
                                  </span>
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
              ))}
            </div>
          )}
        </div>

        {/* Active Testing Runs Live Monitor Card */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-50 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Live Test Runs</span>
            </h3>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              {activeRuns} Active
            </span>
          </div>

          <div className="space-y-3">
            {(() => {
              const ongoingRuns = liveInProgressRuns;
              if (ongoingRuns.length === 0) {
                return (
                  <div className="liquid-glass-card rounded-2xl p-6 text-center space-y-2">
                    <Clock className="w-6 h-6 text-slate-500 mx-auto" />
                    <p className="text-xs font-bold text-slate-400">No active test runs right now.</p>
                    <p className="text-[11px] text-slate-500">
                      Testers will appear here automatically when they begin execution.
                    </p>
                  </div>
                );
              }

              return ongoingRuns.map(run => {
                const plan = testPlans.find(p => p.id === run.planId);
                const totalSteps = plan?.steps.length || 1;
                const stepEntries = Object.entries(run.results || {}).filter(
                  ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in v && (v as any).status !== 'pending'
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
                const refTs = run.lastActivityTimestamp || lastResultTs || (!isNaN(startedAtMs) ? startedAtMs : 0);
                const isAway = Boolean(refTs && Date.now() - refTs > 3 * 60 * 1000);

                return (
                  <div key={run.id} className="liquid-glass-card rounded-2xl p-4 space-y-3 shadow-md">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-blue-400" />
                        {run.testerName || 'Unassigned Tester'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {run.startedAt && (
                          <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-[#0f172a] text-blue-300 border border-blue-500/30 flex items-center gap-1 shadow-sm">
                            <Timer className="w-3 h-3 text-blue-400" />
                            <span>{formatOngoingDuration(run.startedAt)}</span>
                          </span>
                        )}
                        {isAway ? (
                          <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border bg-amber-500/20 text-amber-300 border-amber-400/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                            Away / In Background
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border bg-blue-500/20 text-blue-300 border-blue-400/30">
                            In Progress
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/60 pb-2">
                      <span className="truncate max-w-[140px] text-slate-300 font-medium">
                        {plan?.name || run.planName}
                      </span>
                      <span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded font-mono border border-slate-700 flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-blue-400" />
                        {run.deviceName || 'Device Unset'}
                      </span>
                    </div>

                    {/* Current Step being tested */}
                    {(() => {
                      const currentStepIdx = run.currentStepIndex !== undefined ? run.currentStepIndex : completedSteps;
                      const currentStep = plan?.steps[Math.min(currentStepIdx, totalSteps - 1)];
                      const stepTitle = currentStep
                        ? currentStep.title || currentStep.feature || `Step ${currentStepIdx + 1}`
                        : undefined;
                      const greenCount = completedResults.filter((r: any) => r.status === 'green').length;
                      const yellowCount = completedResults.filter((r: any) => r.status === 'yellow').length;
                      const redCount = completedResults.filter((r: any) => r.status === 'red').length;
                      return (
                        <>
                          <div className="bg-[#0f172a] rounded-xl px-2.5 py-1.5 border border-slate-800 flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 font-mono text-[10px]">
                              Step {Math.min(currentStepIdx + 1, totalSteps)} of {totalSteps}
                            </span>
                            {stepTitle && (
                              <span className="text-blue-300 font-semibold truncate max-w-[170px]" title={stepTitle}>
                                {stepTitle}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="flex items-center gap-1 text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                              <CheckCircle2 className="w-3 h-3" /> {greenCount} Green
                            </span>
                            <span className="flex items-center gap-1 text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
                              <AlertTriangle className="w-3 h-3" /> {yellowCount} Yellow
                            </span>
                            <span className="flex items-center gap-1 text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/40">
                              <XCircle className="w-3 h-3" /> {redCount} Red
                            </span>
                          </div>
                        </>
                      );
                    })()}

                    {/* Progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-slate-400">
                        <span>Progress</span>
                        <span>
                          {completedSteps} / {totalSteps} steps ({progressPct}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full transition-all" style={{ width: `${progressPct}%` }}></div>
                      </div>
                    </div>

                    {/* Delete Session / Boot Tester Button */}
                    {(onBootTester || onDeleteTestRun) && (
                      <div className="pt-2 border-t border-slate-800/60 flex items-center justify-end">
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
                          className="px-2.5 py-1 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-white text-[10px] font-bold rounded-xl border border-rose-500/30 flex items-center gap-1 transition-all cursor-pointer"
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
