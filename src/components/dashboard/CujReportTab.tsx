import React from 'react';
import {
  Tag,
  Calendar,
  ListChecks,
  Plus,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Copy,
  Download,
  MessageSquareText,
  Bot,
  ChevronDown,
  History,
  Trash2
} from 'lucide-react';
import { TestPlan, BugLog } from '../../types';
import {
  ALL_PLANS,
  formatReportDateLabel,
  computeCujReport,
  buildTimelinePoints,
  getPlanPickerOptions
} from '../../utils/cujReportUtils';
import type { CujMetric } from '../../utils/cujReportUtils';
import {
  getBriefIssueSummarySync,
  getStoredGeminiApiKey,
  getStoredGeminiModel
} from '../../services/geminiService';
import { isRx95Available } from '../../services/rx95Service';

export interface GeneratedReportState {
  plainText: string;
  htmlText: string;
  generatedAt: number;
  scopeKey: string;
  modelUsed?: string;
  aiError?: string;
  featureSummaries?: Record<string, { summary: string; bugsKey: string }>;
}

export interface CujReportTabProps {
  testPlans: TestPlan[];
  selectedDailySessionDate: string;
  setSelectedDailySessionDate: React.Dispatch<React.SetStateAction<string>>;
  recordedDailySessions: { dateStr: string; label: string; stepCount: number; bugCount: number }[];
  todayStr: string;
  reportPlanId: string;
  setSelectedReportPlanId: React.Dispatch<React.SetStateAction<string>>;
  reportPlanLabel: string;
  allPlansRunCount: number;
  planPickerOptions: ReturnType<typeof getPlanPickerOptions>;
  newFeatureInput: string;
  setNewFeatureInput: React.Dispatch<React.SetStateAction<string>>;
  handleCreateFeatureSubmit: (e: React.FormEvent) => void;
  onRunSubagentTest?: (planId?: string) => void;
  onLoadSampleData: () => void;
  setSubagentToast: React.Dispatch<React.SetStateAction<string | null>>;
  onResetActiveDay?: (dateStr: string) => void;
  onDeleteFeature?: (featureName: string) => void;
  featureMetricsList: CujMetric[];
  bugOnlyMetrics: CujMetric[];
  untestedCujNames: string[];
  visualCardRef: React.RefObject<HTMLDivElement>;
  reportDayDisplayLabel: string;
  reportDayPhrase: string;
  latestReportDate: string;
  hasCurrentReport: boolean;
  generatedReport: GeneratedReportState | null;
  isGeneratingSummary: boolean;
  handleGenerateSummary: () => void;
  handleCopyGeneratedReport: () => void;
  copiedReport: boolean;
  handleCopyVisualImageToClipboard: () => void;
  copiedImage: boolean;
  setTempApiKey: React.Dispatch<React.SetStateAction<string>>;
  setTempModel: React.Dispatch<React.SetStateAction<string>>;
  setIsApiKeyModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openChatSummary: (notice?: string) => void;
  handleAskRx95: () => Promise<void>;
  rx95Elapsed: number | null;
  avgHealthScore: number | null;
  totalFeaturesCount: number;
  totalStepsAcrossFeatures: number;
  criticalFeaturesCount: number;
  criticalPct: number;
  warningFeaturesCount: number;
  warningPct: number;
  healthyFeaturesCount: number;
  healthyPct: number;
  totalBugsAcrossFeatures: number;
  goldenRunsAnalysis: ReturnType<typeof computeCujReport>['golden'];
  isFeatureReportExpanded: boolean;
  setIsFeatureReportExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  historicalTimelinePoints: ReturnType<typeof buildTimelinePoints>;
  makeBugsKey: (bugs: BugLog[]) => string;
}

export const CujReportTab: React.FC<CujReportTabProps> = ({
  testPlans,
  selectedDailySessionDate,
  setSelectedDailySessionDate,
  recordedDailySessions,
  todayStr,
  reportPlanId,
  setSelectedReportPlanId,
  reportPlanLabel,
  allPlansRunCount,
  planPickerOptions,
  newFeatureInput,
  setNewFeatureInput,
  handleCreateFeatureSubmit,
  onRunSubagentTest,
  onLoadSampleData,
  setSubagentToast,
  onResetActiveDay,
  onDeleteFeature,
  featureMetricsList,
  bugOnlyMetrics,
  untestedCujNames,
  visualCardRef,
  reportDayDisplayLabel,
  reportDayPhrase,
  latestReportDate,
  hasCurrentReport,
  generatedReport,
  isGeneratingSummary,
  handleGenerateSummary,
  handleCopyGeneratedReport,
  copiedReport,
  handleCopyVisualImageToClipboard,
  copiedImage,
  setTempApiKey,
  setTempModel,
  setIsApiKeyModalOpen,
  openChatSummary,
  handleAskRx95,
  rx95Elapsed,
  avgHealthScore,
  totalFeaturesCount,
  totalStepsAcrossFeatures,
  criticalFeaturesCount,
  criticalPct,
  warningFeaturesCount,
  warningPct,
  healthyFeaturesCount,
  healthyPct,
  totalBugsAcrossFeatures,
  goldenRunsAnalysis,
  isFeatureReportExpanded,
  setIsFeatureReportExpanded,
  historicalTimelinePoints,
  makeBugsKey
}) => {
  return (
    <div className="space-y-5">
      {/* Condensed Feature Health Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 liquid-glass-panel rounded-3xl px-4 py-3 shadow-lg">
        {/* Left group: Title + Day & Plan filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-slate-50 flex items-center gap-2 tracking-tight mr-1 flex-shrink-0">
            <Tag className="w-4 h-4 text-blue-400" />
            <span>Feature Health</span>
          </h3>

          {/* Day Selector Dropdown */}
          <div className="flex items-center gap-1.5 liquid-glass-input px-3 h-8 rounded-2xl text-xs min-w-0">
            <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-slate-400 font-medium text-xs whitespace-nowrap">Day:</span>
            <select
              value={selectedDailySessionDate}
              onChange={e => setSelectedDailySessionDate(e.target.value)}
              className="bg-transparent text-slate-100 font-semibold focus:outline-none cursor-pointer text-xs h-full flex items-center min-w-0"
            >
              {recordedDailySessions.map(session => (
                <option key={session.dateStr} value={session.dateStr} className="bg-slate-900 text-slate-200">
                  {session.label} {session.dateStr === todayStr ? '' : `(${session.stepCount} steps)`}
                </option>
              ))}
              <option value="all" className="bg-slate-900 text-blue-300 font-semibold">
                All Historical Days Combined
              </option>
            </select>
          </div>

          {/* Test Plan Selector Dropdown */}
          <div className="flex items-center gap-1.5 liquid-glass-input px-3 h-8 rounded-2xl text-xs min-w-0">
            <ListChecks className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-slate-400 font-medium text-xs whitespace-nowrap">Plan:</span>
            <select
              value={reportPlanId}
              onChange={e => setSelectedReportPlanId(e.target.value)}
              title={`Test plan: ${reportPlanLabel}`}
              aria-label="Test plan"
              className="bg-transparent text-slate-100 font-semibold focus:outline-none cursor-pointer text-xs h-full flex items-center min-w-0 sm:max-w-[14rem] truncate"
            >
              <option value={ALL_PLANS} className="bg-slate-900 text-slate-200">
                All plans ({allPlansRunCount} {allPlansRunCount === 1 ? 'run' : 'runs'})
              </option>
              {planPickerOptions.map(option => (
                <option key={option.planId} value={option.planId} className="bg-slate-900 text-slate-200">
                  {option.planName} ({option.runCount} {option.runCount === 1 ? 'run' : 'runs'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right group: Condensed action controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Inline Feature Creation Form */}
          <form onSubmit={handleCreateFeatureSubmit} className="flex items-center gap-1.5">
            <div className="relative flex items-center">
              <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Add feature..."
                value={newFeatureInput}
                onChange={e => setNewFeatureInput(e.target.value)}
                className="liquid-glass-input rounded-2xl pl-7 pr-2.5 h-8 text-xs text-slate-100 placeholder-slate-500 font-medium w-32 sm:w-40 focus:outline-none"
                required
              />
            </div>
            <button
              type="submit"
              className="px-3 h-8 bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 rounded-2xl text-xs font-semibold flex items-center justify-center gap-1 transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="leading-none">Add</span>
            </button>
          </form>

          {/* Run Subagent QA Test Flow Button */}
          {onRunSubagentTest && (
            <button
              type="button"
              onClick={() => {
                if (testPlans.length === 0) onLoadSampleData();
                const targetId = (reportPlanId !== ALL_PLANS ? reportPlanId : testPlans[0]?.id) || 'plan-demo-1';
                onRunSubagentTest(targetId);
                setSubagentToast(`Autonomous Subagent tested all steps for Today (${todayStr})! Live feature metrics populated below.`);
                setTimeout(() => setSubagentToast(null), 5000);
              }}
              className="px-3 h-8 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              title="Run autonomous QA subagent to execute full test flow and record data for Today"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
              <span className="leading-none">Auto-Test</span>
            </button>
          )}

          {/* Reset Active Day Datapoints Button (Active only on Today) */}
          {(() => {
            const isTodayActive = selectedDailySessionDate === todayStr;
            return (
              <button
                type="button"
                disabled={!isTodayActive}
                onClick={() => {
                  if (!isTodayActive || !onResetActiveDay) return;
                  if (confirm(`Reset all test results and bug logs for Today (${todayStr})? This will start a fresh QA session for today.`)) {
                    onResetActiveDay(todayStr);
                  }
                }}
                className={`px-3 h-8 rounded-2xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border ${
                  isTodayActive
                    ? 'bg-slate-800/90 hover:bg-rose-950/50 text-slate-300 hover:text-rose-300 border-slate-700 hover:border-rose-800/60 cursor-pointer'
                    : 'bg-slate-900/40 text-slate-600 border-slate-800 opacity-40 cursor-not-allowed'
                }`}
                title={isTodayActive ? "Reset test step results & bugs for Today (all plans)" : "Reset is only available when viewing Today's active session."}
              >
                <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 ${isTodayActive ? 'text-slate-400' : 'text-slate-600'}`} />
                <span className="leading-none">Reset Day</span>
              </button>
            );
          })()}
        </div>
      </div>

      {/* Feature Quality & Risk Profile Card */}
      {(featureMetricsList.length > 0 || bugOnlyMetrics.length > 0) && (
        <div ref={visualCardRef} data-visual-card="true" className="liquid-glass-panel rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 bg-[#111827] border border-slate-800">
          
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono">{reportDayDisplayLabel}</span>
                {hasCurrentReport && generatedReport && !isGeneratingSummary && (
                  generatedReport.modelUsed ? (
                    <span
                      className="no-capture text-[11px] font-medium px-2 py-0.5 rounded-full border bg-slate-900 text-slate-300 border-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap"
                      title={`AI summary by ${generatedReport.modelUsed} - generated at ${new Date(generatedReport.generatedAt).toLocaleTimeString()}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Ready · AI
                    </span>
                  ) : (
                    <span
                      className="no-capture text-[11px] font-medium px-2 py-0.5 rounded-full border bg-slate-900 text-slate-300 border-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap cursor-help"
                      title={`AI summary unavailable${generatedReport.aiError ? ` (${generatedReport.aiError})` : ''} - a basic offline summary was used. Generated at ${new Date(generatedReport.generatedAt).toLocaleTimeString()}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      Ready · Offline
                    </span>
                  )
                )}
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-slate-50 mt-0.5 flex flex-wrap items-center gap-2 tracking-tight">
                <span>CUJ Quality Report</span>
                <span
                  className="bg-blue-500/10 text-blue-300 border border-blue-500/25 px-2.5 py-0.5 rounded-full text-xs font-semibold max-w-[16rem] truncate"
                  title={`Test plan: ${reportPlanLabel}`}
                >
                  {reportPlanLabel}
                </span>
              </h3>
            </div>

            {/* Condensed Header Right Action Groups + Quality Status Pill */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 1. Report Actions Segmented Pill Group */}
              <div className="no-capture inline-flex items-center bg-[#0f172a] border border-slate-800 rounded-2xl p-0.5 gap-0.5 h-8">
                <button
                  type="button"
                  disabled={isGeneratingSummary}
                  onClick={handleGenerateSummary}
                  className={`px-2.5 h-7 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                    isGeneratingSummary
                      ? 'bg-blue-600/20 text-blue-300 cursor-wait animate-pulse'
                      : 'text-slate-200 hover:bg-slate-800 hover:text-white cursor-pointer'
                  }`}
                  title="Extract bugs and generate the AI summary report. Safe to tab away - the result is saved until you copy it."
                >
                  {isGeneratingSummary ? (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />
                      <span className="leading-none">Summarizing...</span>
                    </>
                  ) : hasCurrentReport ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      <span className="leading-none">Regenerate</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      <span className="leading-none">Summarize</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!hasCurrentReport || isGeneratingSummary}
                  onClick={handleCopyGeneratedReport}
                  className={`px-2.5 h-7 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                    !hasCurrentReport || isGeneratingSummary
                      ? 'text-slate-500 cursor-not-allowed'
                      : copiedReport
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm cursor-pointer'
                  }`}
                  title={
                    hasCurrentReport
                      ? 'Copy the generated report to your clipboard (rich text + plain text)'
                      : 'Generate a summary first, then copy it here'
                  }
                >
                  {copiedReport ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span className="leading-none">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="leading-none">Copy</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleCopyVisualImageToClipboard}
                  className="px-2.5 h-7 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-slate-200 hover:bg-slate-800 hover:text-white transition cursor-pointer"
                  title="Export 1400px wide crisp PNG image to file and clipboard"
                >
                  {copiedImage ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span className="text-emerald-300 leading-none">Exported!</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="leading-none">Export PNG</span>
                    </>
                  )}
                </button>
              </div>

              {/* 2. AI Configuration Segmented Pill Group */}
              <div className="no-capture inline-flex items-center bg-[#0f172a] border border-slate-800 rounded-2xl p-0.5 gap-0.5 h-8">
                <button
                  type="button"
                  onClick={() => {
                    setTempApiKey(getStoredGeminiApiKey());
                    setTempModel(getStoredGeminiModel());
                    setIsApiKeyModalOpen(true);
                  }}
                  className="px-2.5 h-7 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
                  title="Configure Gemini API Key for AI Summaries"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${getStoredGeminiApiKey() ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="leading-none">Gemini</span>
                </button>

                <button
                  type="button"
                  onClick={() => openChatSummary()}
                  disabled={isGeneratingSummary}
                  className="px-2.5 h-7 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="No API key? Summarize with any AI chat: copy a prompt, paste the reply back"
                >
                  <MessageSquareText className="w-3.5 h-3.5 text-blue-400" />
                  <span className="leading-none">AI Chat</span>
                </button>

                {isRx95Available() && (
                  <button
                    type="button"
                    onClick={() => void handleAskRx95()}
                    disabled={isGeneratingSummary || rx95Elapsed !== null}
                    className={`px-2.5 h-7 rounded-xl text-xs font-medium flex items-center gap-1.5 transition disabled:cursor-not-allowed ${
                      rx95Elapsed !== null
                        ? 'bg-violet-600/20 text-violet-200 cursor-wait'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer disabled:opacity-50'
                    }`}
                    title="Have RX95 (your Jetski agent) write the executive summary - no API key or copy/paste needed"
                  >
                    <Bot className={`w-3.5 h-3.5 text-violet-400 ${rx95Elapsed !== null ? 'animate-pulse' : ''}`} />
                    <span className="leading-none">
                      {rx95Elapsed !== null ? `RX95 writing… ${rx95Elapsed}s` : 'Ask RX95'}
                    </span>
                  </button>
                )}
              </div>

              {/* 3. Overall Quality Status Pill */}
              <div className="flex items-center gap-2 bg-[#0f172a] px-3 h-8 rounded-2xl border border-slate-800 whitespace-nowrap flex-shrink-0">
                <span className="text-xs text-slate-400 font-medium">Quality:</span>
                <span className="text-xs font-bold font-mono text-slate-50">{avgHealthScore === null ? '—' : `${avgHealthScore}%`}</span>
                {avgHealthScore !== null && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase whitespace-nowrap inline-flex items-center gap-1.5 leading-none border ${
                    criticalFeaturesCount > 0 || avgHealthScore < 60
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      : warningFeaturesCount > 0 || avgHealthScore < 95
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      criticalFeaturesCount > 0 || avgHealthScore < 60
                        ? 'bg-rose-400'
                        : warningFeaturesCount > 0 || avgHealthScore < 95
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`} />
                    <span>
                      {criticalFeaturesCount > 0 || avgHealthScore < 60
                        ? 'High Risk'
                        : warningFeaturesCount > 0 || avgHealthScore < 95
                        ? 'Moderate Risk'
                        : 'Healthy'}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-3.5">
              <div className="text-[11px] text-slate-400 font-medium">Total Features Tracked</div>
              <div className="text-2xl font-bold text-slate-50 mt-1 font-mono">{totalFeaturesCount}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{totalStepsAcrossFeatures} Total Test Steps</div>
            </div>

            <div className="bg-rose-950/30 border border-rose-800/40 rounded-2xl p-3.5">
              <div className="text-[11px] text-rose-400 font-semibold uppercase flex items-center justify-between">
                <span>Critical (Red)</span>
                <span className="font-mono text-xs">{criticalPct}%</span>
              </div>
              <div className="text-2xl font-bold text-rose-300 mt-1 font-mono">{criticalFeaturesCount}</div>
              <div className="text-[10px] text-rose-400/80 mt-0.5">Requires immediate attention</div>
            </div>

            <div className="bg-amber-950/30 border border-amber-800/40 rounded-2xl p-3.5">
              <div className="text-[11px] text-amber-400 font-semibold uppercase flex items-center justify-between">
                <span>Degraded (Yellow)</span>
                <span className="font-mono text-xs">{warningPct}%</span>
              </div>
              <div className="text-2xl font-bold text-amber-300 mt-1 font-mono">{warningFeaturesCount}</div>
              <div className="text-[10px] text-amber-400/80 mt-0.5">Minor defects reported</div>
            </div>

            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-2xl p-3.5">
              <div className="text-[11px] text-emerald-400 font-semibold uppercase flex items-center justify-between">
                <span>Healthy (Green)</span>
                <span className="font-mono text-xs">{healthyPct}%</span>
              </div>
              <div className="text-2xl font-bold text-emerald-300 mt-1 font-mono">{healthyFeaturesCount}</div>
              <div className="text-[10px] text-emerald-400/80 mt-0.5">100% Passing test steps</div>
            </div>

            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-3.5 relative overflow-hidden col-span-2 sm:col-span-1">
              <div className="text-[11px] text-slate-300 font-semibold uppercase flex items-center justify-between">
                <span>Golden Runs</span>
              </div>
              <div className="text-2xl font-bold text-slate-50 mt-1 font-mono">
                {goldenRunsAnalysis.goldenCount}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 font-medium">
                {goldenRunsAnalysis.goldenCount === 1 ? '1 clean run' : `${goldenRunsAnalysis.goldenCount} clean runs`} (≤1 yellow, 0 red)
              </div>
            </div>
          </div>

          {/* Multi-segment Proportion Distribution Bar Chart */}
          <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-300">
              <span>Feature Health Distribution (Proportion Chart)</span>
              
              <div className="flex items-center gap-3">
                <span className="font-mono text-slate-400 text-[11px]">Total Bugs: {totalBugsAcrossFeatures}</span>
                <button
                  type="button"
                  onClick={() => setIsFeatureReportExpanded(!isFeatureReportExpanded)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-2xl text-xs font-semibold transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-sm"
                >
                  <ChevronDown className={`w-3.5 h-3.5 text-blue-400 transition-transform duration-500 ease-out ${isFeatureReportExpanded ? 'rotate-180' : 'rotate-0'}`} />
                  <span>{isFeatureReportExpanded ? 'Hide Report Breakdown' : 'Expand Report Breakdown'}</span>
                </button>
              </div>
            </div>

            <div className="w-full bg-[#0f172a] h-3 rounded-xl overflow-hidden border border-slate-800 flex">
              {criticalPct > 0 && (
                <div
                  style={{ width: `${criticalPct}%` }}
                  className="bg-rose-500 h-full transition-all"
                  title={`Critical: ${criticalFeaturesCount} (${criticalPct}%)`}
                ></div>
              )}
              {warningPct > 0 && (
                <div
                  style={{ width: `${warningPct}%` }}
                  className="bg-amber-500 h-full transition-all"
                  title={`Degraded: ${warningFeaturesCount} (${warningPct}%)`}
                ></div>
              )}
              {healthyPct > 0 && (
                <div
                  style={{ width: `${healthyPct}%` }}
                  className="bg-emerald-500 h-full transition-all"
                  title={`Healthy: ${healthyFeaturesCount} (${healthyPct}%)`}
                ></div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 font-sans pt-1">
              <div className="flex items-center gap-4 text-[11px] font-semibold">
                <span className="text-rose-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  Critical: {criticalFeaturesCount} ({criticalPct}%)
                </span>
                <span className="text-amber-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  Degraded: {warningFeaturesCount} ({warningPct}%)
                </span>
                <span className="text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Healthy: {healthyFeaturesCount} ({healthyPct}%)
                </span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono font-semibold flex items-center gap-1.5">
                <span>Golden Runs: {goldenRunsAnalysis.goldenCount}</span>
              </div>
            </div>
          </div>

          {/* Fluid Liquid Glass Expandable Feature Breakdown Report Table */}
          <div className={`liquid-accordion-wrapper ${isFeatureReportExpanded ? 'expanded' : ''}`}>
            <div className="liquid-accordion-inner">
              <div className="pt-4 pb-4 border-t border-slate-800 space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-50 uppercase tracking-wider flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-blue-400" />
                      Feature Health Breakdown Report ({featureMetricsList.length + bugOnlyMetrics.length} Features)
                    </h4>
                    <span className="text-[10px] font-mono text-slate-400">Live Snapshot Table</span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0f172a] shadow-inner">
                    <table className="w-full text-left text-xs font-sans">
                      <thead className="bg-slate-900/90 border-b border-slate-800 text-[11px] text-slate-200 uppercase font-bold tracking-wider">
                        <tr>
                          <th className="py-3 px-4">Feature Name</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Health Score</th>
                          <th className="py-3 px-4">Execution Total</th>
                          <th className="py-3 px-4">Passed (Green)</th>
                          <th className="py-3 px-4">Warning (Yellow)</th>
                          <th className="py-3 px-4">Failed (Red)</th>
                          <th className="py-3 px-4">Bugs Logged</th>
                          <th className="py-3 px-4">Issues Encountered</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-slate-100 font-medium">
                        {[...featureMetricsList, ...bugOnlyMetrics].map(metric => {
                          // Reuse the AI summary only if it was written for exactly these bugs
                          const aiRowSummary = generatedReport?.featureSummaries?.[metric.featureName];
                          const rowBugsKey = makeBugsKey(metric.associatedBugs || []);
                          const isAiIssueSummary = !!aiRowSummary && !!rowBugsKey && aiRowSummary.bugsKey === rowBugsKey;
                          const issueSummary = isAiIssueSummary
                            ? aiRowSummary!.summary
                            : getBriefIssueSummarySync(metric.featureName, metric.associatedBugs, metric.yellowCount, metric.redCount);
                          return (
                            <tr key={metric.featureName} className="hover:bg-slate-900/50 transition">
                              <td className="py-2.5 px-4 font-bold text-white whitespace-nowrap">{metric.featureName}</td>
                              <td className="py-2.5 px-4 whitespace-nowrap">
                                {metric.status === 'no_steps' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border bg-slate-500/15 text-slate-300 border-slate-500/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                    No completed steps
                                  </span>
                                ) : (
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${
                                  metric.status === 'healthy'
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : metric.status === 'warning'
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                    : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    metric.status === 'healthy' ? 'bg-emerald-400' : metric.status === 'warning' ? 'bg-amber-400' : 'bg-rose-400'
                                  }`}></span>
                                  {metric.status === 'healthy' ? 'Healthy' : metric.status === 'warning' ? 'Degraded' : 'Critical'}
                                </span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-bold text-slate-100 font-mono whitespace-nowrap">{metric.status === 'no_steps' ? '—' : `${metric.healthScorePct}%`}</td>
                              <td className="py-2.5 px-4 font-mono font-semibold whitespace-nowrap">{metric.totalStepsExecuted}</td>
                              <td className="py-2.5 px-4 text-emerald-400 font-bold font-mono whitespace-nowrap">{metric.greenCount}</td>
                              <td className="py-2.5 px-4 text-amber-400 font-bold font-mono whitespace-nowrap">{metric.yellowCount}</td>
                              <td className="py-2.5 px-4 text-rose-400 font-bold font-mono whitespace-nowrap">{metric.redCount}</td>
                              <td className="py-2.5 px-4 text-rose-400 font-bold font-mono whitespace-nowrap">{metric.bugCount}</td>
                              <td className="py-2.5 px-4 text-xs font-sans text-slate-100 min-w-[18rem] max-w-md whitespace-normal break-words leading-snug" title={issueSummary ? `${issueSummary}${isAiIssueSummary ? ' (AI summary)' : ''}` : 'No issues encountered'}>
                                {issueSummary ? (
                                  <span className="text-amber-200 font-semibold">
                                    {isAiIssueSummary && <Sparkles className="inline w-3 h-3 mr-1 -mt-0.5 text-blue-400" />}
                                    {issueSummary}
                                  </span>
                                ) : (
                                  <span className="text-slate-500 font-mono">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Golden Runs Execution Tracker Panel */}
                <div className="pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>Golden Runs Tracker ({goldenRunsAnalysis.goldenCount} Qualified)</span>
                    </h4>
                    <span className="text-[10px] font-mono text-slate-400">
                      Criterion: 100% completed execution • ≤1 Yellow • 0 Reds
                    </span>
                  </div>

                  {goldenRunsAnalysis.runs.length === 0 ? (
                    <div className="p-4 rounded-xl border border-slate-800 bg-[#0f172a] text-center text-xs text-slate-400 font-medium">
                      No completed test runs recorded for {reportPlanLabel} {reportDayPhrase}.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0f172a] shadow-inner">
                      <table className="w-full text-left text-xs font-sans">
                        <thead className="bg-slate-900/90 border-b border-slate-800 text-[11px] text-slate-200 uppercase font-bold tracking-wider">
                          <tr>
                            <th className="py-3 px-4">Test Plan / Suite</th>
                            <th className="py-3 px-4">Tester</th>
                            <th className="py-3 px-4">Device</th>
                            <th className="py-3 px-4">Tracker Status</th>
                            <th className="py-3 px-4">Passed (Green)</th>
                            <th className="py-3 px-4">Degraded (Yellow)</th>
                            <th className="py-3 px-4">Failed (Red)</th>
                            <th className="py-3 px-4">Completed</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-100 font-medium">
                          {goldenRunsAnalysis.runs.map(({ run, plan, isGolden, greenCount, yellowCount, redCount, totalSteps }) => {
                            const completedTimeStr = run.completedAt
                              ? new Date(run.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : run.startedAt
                              ? new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : '-';
                            return (
                              <tr key={run.id} className={`transition ${isGolden ? 'bg-emerald-500/5 hover:bg-emerald-500/10' : 'hover:bg-slate-900/50'}`}>
                                <td className="py-2.5 px-4 font-bold text-white whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <span className={`w-1.5 h-1.5 rounded-full ${isGolden ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                                    <span>{plan?.name || run.planName || 'Test Run'}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-4 text-slate-300 whitespace-nowrap">{run.testerName || 'Anonymous'}</td>
                                <td className="py-2.5 px-4 text-slate-300 font-mono whitespace-nowrap">{run.deviceName || 'Web/Desktop'}</td>
                                <td className="py-2.5 px-4 whitespace-nowrap">
                                  {isGolden ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                      <span>Golden Run {yellowCount === 0 ? '(Clean 100%)' : '(1 Yellow allowed)'}</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-slate-400 bg-slate-800/60 border border-slate-700">
                                      <span className={`w-1.5 h-1.5 rounded-full ${redCount > 0 ? 'bg-rose-400' : 'bg-amber-400'}`} />
                                      <span>{redCount > 0 ? `Non-Golden (${redCount} Red)` : yellowCount > 1 ? `Non-Golden (${yellowCount} Yellows)` : 'Non-Golden (Bug Logged)'}</span>
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-emerald-400 font-bold font-mono whitespace-nowrap">{greenCount} / {totalSteps}</td>
                                <td className="py-2.5 px-4 text-amber-400 font-bold font-mono whitespace-nowrap">{yellowCount}</td>
                                <td className="py-2.5 px-4 text-rose-400 font-bold font-mono whitespace-nowrap">{redCount}</td>
                                <td className="py-2.5 px-4 text-slate-400 font-mono whitespace-nowrap">{completedTimeStr}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Separate Standalone Card: Historical Quality Evolution Timeline */}
      {historicalTimelinePoints.length > 0 && (
        <div className="liquid-glass-panel rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 border border-slate-800 bg-[#111827]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
            <div>
              <h4 className="text-base font-bold text-slate-50 flex items-center gap-2 tracking-tight">
                <History className="w-4 h-4 text-blue-400" />
                Historical Quality Evolution Timeline
              </h4>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                Click any date bar below to time-travel snapshot and view that day's QA metrics.
              </p>
            </div>
            <span className="text-[11px] text-blue-300 font-mono bg-blue-500/10 px-3 py-1 rounded-xl border border-blue-500/25 font-semibold w-fit">
              {historicalTimelinePoints.length} Recorded Sessions
            </span>
          </div>

          {/* Sparkline / Bar chart per date */}
          <div className="flex items-end gap-3 overflow-x-auto pb-2 pt-3 px-3 bg-[#0f172a] rounded-2xl border border-slate-800 min-h-[120px]">
            {historicalTimelinePoints.map(point => (
              <div
                key={point.dateStr}
                onClick={() => setSelectedDailySessionDate(point.dateStr)}
                className={`flex-1 min-w-[85px] max-w-[120px] flex flex-col items-center gap-1.5 group cursor-pointer transition-all duration-200 p-2.5 rounded-2xl border ${
                  selectedDailySessionDate === point.dateStr
                    ? 'bg-[#162033] border-blue-500 shadow-md font-bold ring-1 ring-blue-500/30'
                    : 'liquid-glass-button hover:bg-slate-800/80 border-slate-800'
                }`}
                title={`Click to inspect ${point.displayDate}: ${point.scorePct}% Score, ${point.totalSteps} Steps, ${point.bugs} Bugs`}
              >
                <div className="text-[11px] font-bold font-mono text-slate-200 group-hover:text-white">
                  {point.scorePct}%
                </div>

                {/* Vertical Bar Representation */}
                <div className="w-full bg-slate-950 h-16 rounded-xl overflow-hidden flex flex-col justify-end p-0.5 border border-slate-800 shadow-inner">
                  <div
                    style={{ height: `${point.scorePct}%` }}
                    className={`w-full rounded-lg transition-all duration-300 ${
                      point.scorePct >= 95
                        ? 'bg-emerald-500'
                        : point.scorePct >= 60
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                  ></div>
                </div>

                <div className="text-[10px] font-semibold text-slate-300 font-mono group-hover:text-white truncate max-w-full">
                  {point.displayDate}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {featureMetricsList.length === 0 && bugOnlyMetrics.length === 0 ? (
        <div className="bg-[#111827] border border-slate-800 rounded-3xl p-10 text-center space-y-4 shadow-xl">
          <div className="p-3 bg-slate-800/90 rounded-full border border-slate-700 text-blue-400 w-fit mx-auto">
            <Tag className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-base font-bold text-slate-50">No completed runs for {reportPlanLabel} {reportDayPhrase}</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Execute test runs or click below to have the autonomous QA subagent test a flow and populate live feature data for today.
            </p>
          </div>
          {latestReportDate && latestReportDate !== selectedDailySessionDate && (
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={() => setSelectedDailySessionDate(latestReportDate)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-2xl shadow-sm flex items-center gap-2 transition-all cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                <span>Jump to {formatReportDateLabel(latestReportDate)} (latest day with data)</span>
              </button>
            </div>
          )}
          {onRunSubagentTest && (
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  if (testPlans.length === 0) onLoadSampleData();
                  const targetId = (reportPlanId !== ALL_PLANS ? reportPlanId : testPlans[0]?.id) || 'plan-demo-1';
                  onRunSubagentTest(targetId);
                  setSubagentToast(`Autonomous Subagent tested all steps for Today (${todayStr})! Live feature metrics populated below.`);
                  setTimeout(() => setSubagentToast(null), 5000);
                }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-2xl shadow-sm border border-blue-500 flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-white" />
                <span>Run Subagent Test Flow for Today</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {[...featureMetricsList, ...bugOnlyMetrics].map(metric => (
            <div
              key={metric.featureName}
              className={`liquid-glass-card rounded-3xl p-4 flex flex-col justify-between space-y-3 relative group ${
                metric.status === 'critical'
                  ? 'border-rose-500/40 bg-rose-950/15'
                  : metric.status === 'warning'
                  ? 'border-amber-500/40 bg-amber-950/15'
                  : metric.status === 'no_steps'
                  ? 'border-slate-700 bg-slate-900/40'
                  : ''
              }`}
            >
              {/* Top Header: Full Title & Status Badge */}
              <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <span className="p-1.5 bg-slate-800 text-blue-400 rounded-lg border border-slate-700 shrink-0 mt-0.5">
                    <Tag className="w-3.5 h-3.5" />
                  </span>
                  <h4 className="text-sm font-bold text-slate-50 break-words leading-snug">
                    {metric.featureName}
                  </h4>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {metric.status === 'no_steps' ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-slate-900 text-slate-300 border-slate-700 inline-flex items-center gap-1.5" title="Bugs were logged, but no completed test steps were recorded in this view">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span>No completed steps</span>
                    </span>
                  ) : (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border inline-flex items-center gap-1.5 ${
                    metric.status === 'healthy'
                      ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80'
                      : metric.status === 'warning'
                      ? 'bg-amber-950/80 text-amber-400 border-amber-800/80'
                      : 'bg-rose-950/80 text-rose-400 border-rose-800/80'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      metric.status === 'healthy' ? 'bg-emerald-400' : metric.status === 'warning' ? 'bg-amber-400' : 'bg-rose-400'
                    }`} />
                    <span>{metric.status === 'healthy' ? 'Healthy' : metric.status === 'warning' ? 'Degraded' : 'Critical'}</span>
                  </span>
                  )}

                  {onDeleteFeature && metric.featureName.toLowerCase() !== 'general' && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete feature "${metric.featureName}"? Linked steps will be assigned to General.`)) {
                          onDeleteFeature(metric.featureName);
                        }
                      }}
                      className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                      title={`Delete feature "${metric.featureName}"`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Bar & Health Score */}
              {metric.status !== 'no_steps' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-medium">
                  <span className="text-slate-400">Health Score</span>
                  <span className="text-slate-50 font-mono font-bold">{metric.healthScorePct}%</span>
                </div>
                <div className="w-full bg-[#0f172a] h-1.5 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      metric.healthScorePct >= 95
                        ? 'bg-emerald-500'
                        : metric.healthScorePct >= 60
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${metric.healthScorePct}%` }}
                  ></div>
                </div>
              </div>
              )}

              {/* Inline Execution Stats & Bugs pill */}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80 font-mono">
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-emerald-400 font-semibold inline-flex items-center gap-1" title={`${metric.greenCount} Green Steps`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>{metric.greenCount} Pass</span>
                  </span>
                  <span className="text-amber-400 font-semibold inline-flex items-center gap-1" title={`${metric.yellowCount} Yellow Steps`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span>{metric.yellowCount} Warn</span>
                  </span>
                  <span className="text-rose-400 font-semibold inline-flex items-center gap-1" title={`${metric.redCount} Red Steps`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                    <span>{metric.redCount} Fail</span>
                  </span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                  metric.bugCount > 0
                    ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
                    : 'bg-[#0f172a] text-slate-400 border-slate-800'
                }`}>
                  {metric.bugCount} {metric.bugCount === 1 ? 'bug' : 'bugs'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Known CUJs with no data in this view: kept out of every report, listed so they can still be deleted */}
      {untestedCujNames.length > 0 && (
        <div className="liquid-glass-card rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">Not tested in this view ({untestedCujNames.length}):</span>
          {untestedCujNames.map(name => (
            <span
              key={name}
              className={`inline-flex items-center gap-1 pl-2.5 ${onDeleteFeature ? 'pr-1' : 'pr-2.5'} py-0.5 rounded-full text-[11px] font-semibold text-slate-300 bg-slate-900/70 border border-slate-700/80 max-w-full`}
            >
              <span className="truncate max-w-[14rem]" title={name}>{name}</span>
              {onDeleteFeature && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete feature "${name}"? Linked steps will be assigned to General.`)) {
                      onDeleteFeature(name);
                    }
                  }}
                  className="p-0.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-full transition flex-shrink-0"
                  title={`Delete feature "${name}"`}
                  aria-label={`Delete feature "${name}"`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
