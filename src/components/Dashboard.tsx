import React, { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { DashboardTabKey, NavbarTabCounts } from './Navbar';
import {
  TestPlan,
  TestRun,
  BugLog,
  DeviceProfile,
  TesterProfile,
  RefinedBugText,
  ReproMatches
} from '../types';
import { TestPlansTab } from './dashboard/TestPlansTab';
import { DevicesTestersTab } from './dashboard/DevicesTestersTab';
import { CujReportTab } from './dashboard/CujReportTab';
import { BugsFeedTab } from './dashboard/BugsFeedTab';
import { DashboardModals } from './dashboard/DashboardModals';
import {
  useDashboardController,
  makeBugsKey,
  getLocalDateStr
} from './dashboard/useDashboardController';
import type { Rx95SuggestionsData } from '../services/supabaseService';

/** Buganizer triage view: on by default; set VITE_BUGANIZER_ENABLED=0 to hide it. */
const BUGANIZER_ENABLED = ((import.meta as any).env?.VITE_BUGANIZER_ENABLED || '') !== '0';

interface DashboardProps {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  bugLogs: BugLog[];
  populatedFeatures?: string[];
  devices?: DeviceProfile[];
  testers?: TesterProfile[];
  onSelectPlanToBuild: () => void;
  onOpenMobileView: (planId?: string) => void;
  onDeletePlan: (planId: string) => void;
  onDeleteBug: (bugId: string) => void;
  onUpdateBugLog?: (updatedBug: BugLog | BugLog[]) => void;
  /** Sets only `refined` on bugs whose current text still matches each refinement's sig. */
  onApplyBugRefinements?: (refinements: Record<string, RefinedBugText>) => void;
  /** Merges a patch into the CURRENT copy of one bug (Filed stamp, status). */
  onPatchBugLog?: (bugId: string, patch: Partial<BugLog>) => void;
  /** Merges patches into the CURRENT copies of several bugs (bundles, filing a mega bug). */
  onPatchBugLogs?: (patches: Record<string, Partial<BugLog>>) => void;
  /** RX95 worker output: same-day bundle suggestions + heartbeat (read-only). */
  rx95Suggestions?: Rx95SuggestionsData;
  /** Sets only `reproMatches` on bugs whose current text still matches each result's sig. */
  onApplyReproMatches?: (matches: Record<string, ReproMatches>) => void;
  onWipeAllBugs?: () => void;
  onClonePlan: (planId: string) => void;
  onEditPlan?: (plan: TestPlan) => void;
  onLoadSampleData: () => void;
  onClearAllData?: () => void;
  onImportJSONData: (data: {
    testPlans?: TestPlan[];
    testRuns?: TestRun[];
    bugLogs?: BugLog[];
    archivedRuns?: TestRun[];
  }) => void;
  onAddFeature?: (featureName: string) => void;
  onDeleteFeature?: (featureName: string) => void;
  onDeleteTestRun?: (runId: string) => void;
  onBootTester?: (
    runId: string,
    deviceId?: string,
    testerName?: string,
    deviceName?: string
  ) => void;
  onDeleteTester?: (testerName: string) => void;
  onResetActiveDay?: (dateStr: string) => void;
  onResetDailyQuotas?: () => void;
  onSaveDevice?: (device: DeviceProfile) => void;
  onDeleteDevice?: (deviceId: string) => void;
  onSaveTester?: (tester: TesterProfile) => void;
  onDeleteTesterProfile?: (testerId: string) => void;
  archivedRuns?: TestRun[];
  onRunSubagentTest?: (planId?: string) => void;
  minAppVersion?: number;
  onUpdateMinAppVersion?: (versionCode: number) => void;
  activeTab?: DashboardTabKey;
  onActiveTabChange?: (tab: DashboardTabKey) => void;
  onTabCountsChange?: (counts: NavbarTabCounts) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  testPlans,
  testRuns,
  bugLogs,
  populatedFeatures = [],
  devices = [],
  testers = [],
  archivedRuns = [],
  onSelectPlanToBuild,
  onOpenMobileView,
  onDeletePlan,
  onDeleteBug,
  onUpdateBugLog,
  onApplyBugRefinements,
  onPatchBugLog,
  onPatchBugLogs,
  rx95Suggestions,
  onApplyReproMatches,
  onWipeAllBugs,
  onClonePlan,
  onEditPlan,
  onLoadSampleData,
  onImportJSONData,
  onAddFeature,
  onDeleteFeature,
  onDeleteTestRun,
  onBootTester,
  onDeleteTester,
  onResetActiveDay,
  onResetDailyQuotas,
  onSaveDevice,
  onDeleteDevice,
  onSaveTester,
  onDeleteTesterProfile,
  onRunSubagentTest,
  minAppVersion,
  onUpdateMinAppVersion,
  activeTab: activeTabProp,
  onActiveTabChange,
  onTabCountsChange
}) => {
  const c = useDashboardController({
    testPlans,
    testRuns,
    bugLogs,
    populatedFeatures,
    devices,
    testers,
    archivedRuns,
    onUpdateBugLog,
    onPatchBugLog,
    onPatchBugLogs,
    rx95Suggestions,
    onImportJSONData,
    onAddFeature,
    activeTabProp,
    onActiveTabChange
  });

  const floorBadgeLabel =
    c.activeRuns > 0
      ? `${c.activeRuns} live`
      : c.activeOrTestedTodayCount > 0
      ? `${c.activeOrTestedTodayCount} today`
      : '0 live';

  const cujBadgeLabel =
    c.totalStepsAcrossFeatures > 0 && c.avgHealthScore !== null
      ? `${Math.round(c.avgHealthScore)}%`
      : 'Today';

  useEffect(() => {
    onTabCountsChange?.({
      plans: c.totalPlans,
      floor: floorBadgeLabel,
      cuj: cujBadgeLabel,
      bugs: c.newFeedBugs.length,
    });
  }, [
    onTabCountsChange,
    c.totalPlans,
    floorBadgeLabel,
    cujBadgeLabel,
    c.newFeedBugs.length,
  ]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
      {/* Hidden File Input for JSON Backup Import */}
      <input
        type="file"
        ref={c.fileInputRef}
        onChange={c.handleJSONFileImport}
        accept=".json"
        className="hidden"
      />

      {/* Subagent Execution Toast / Banner */}
      {c.subagentToast && (
        <div className="bg-[#111827] border border-blue-500/40 p-4 rounded-3xl backdrop-blur-xl flex items-center justify-between text-xs font-semibold text-slate-100 animate-in fade-in slide-in-from-top-2 duration-300 shadow-lg">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span>{c.subagentToast}</span>
          </div>
          <button
            onClick={() => c.setSubagentToast(null)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Unified Tab: Single-Screen Devices & Testers */}
      {(c.activeTab === 'devices' || c.activeTab === 'testers') && (
        <DevicesTestersTab
          testPlans={testPlans}
          testRuns={testRuns}
          archivedRuns={archivedRuns}
          bugLogs={bugLogs}
          devices={devices}
          unassignedDevices={c.unassignedDevices}
          unifiedTesters={c.unifiedTesters}
          activeTesterMap={c.activeTesterMap}
          todayRunsMap={c.todayRunsMap}
          fleetProgress={c.fleetProgress}
          liveInProgressRuns={c.liveInProgressRuns}
          selectedQaDate={c.selectedQaDate}
          setSelectedQaDate={c.setSelectedQaDate}
          todayStr={c.todayStr}
          allQaDatesList={c.allQaDatesList}
          testerViewMode={c.testerViewMode}
          setTesterViewMode={c.setTesterViewMode}
          showOffShiftTesters={c.showOffShiftTesters}
          setShowOffShiftTesters={c.setShowOffShiftTesters}
          newDeviceName={c.newDeviceName}
          setNewDeviceName={c.setNewDeviceName}
          newPersonName={c.newPersonName}
          setNewPersonName={c.setNewPersonName}
          newPersonRole={c.newPersonRole}
          setNewPersonRole={c.setNewPersonRole}
          quickActivateDeviceId={c.quickActivateDeviceId}
          setQuickActivateDeviceId={c.setQuickActivateDeviceId}
          quickActivatePlanId={c.quickActivatePlanId}
          setQuickActivatePlanId={c.setQuickActivatePlanId}
          quickActivateQuota={c.quickActivateQuota}
          setQuickActivateQuota={c.setQuickActivateQuota}
          inspectorTarget={c.inspectorTarget}
          setInspectorTarget={c.setInspectorTarget}
          selectedInspectorTester={c.selectedInspectorTester}
          setSelectedInspectorTester={c.setSelectedInspectorTester}
          isFloorMenuOpen={c.isFloorMenuOpen}
          setIsFloorMenuOpen={c.setIsFloorMenuOpen}
          floorMenuRef={c.floorMenuRef}
          isActivateTileOpen={c.isActivateTileOpen}
          setIsActivateTileOpen={c.setIsActivateTileOpen}
          setActiveTab={c.setActiveTab}
          formatOngoingDuration={c.formatOngoingDuration}
          getLocalDateStr={getLocalDateStr}
          minAppVersion={minAppVersion}
          onUpdateMinAppVersion={onUpdateMinAppVersion}
          onResetActiveDay={onResetActiveDay}
          onResetDailyQuotas={onResetDailyQuotas}
          onSaveDevice={onSaveDevice}
          onDeleteDevice={onDeleteDevice}
          onSaveTester={onSaveTester}
          onDeleteTesterProfile={onDeleteTesterProfile}
          onDeleteTester={onDeleteTester}
          onDeleteTestRun={onDeleteTestRun}
          onBootTester={onBootTester}
        />
      )}

      {/* Tab 1: Overview - Test Plans & Active Runs */}
      {c.activeTab === 'overview' && (
        <TestPlansTab
          testPlans={testPlans}
          filteredPlans={c.filteredPlans}
          testRuns={testRuns}
          archivedRuns={archivedRuns}
          bugLogs={bugLogs}
          todayStr={c.todayStr}
          liveInProgressRuns={c.liveInProgressRuns}
          activeRuns={c.activeRuns}
          searchPlanQuery={c.searchPlanQuery}
          setSearchPlanQuery={c.setSearchPlanQuery}
          expandedPlanSteps={c.expandedPlanSteps}
          setExpandedPlanSteps={c.setExpandedPlanSteps}
          onSelectPlanToBuild={onSelectPlanToBuild}
          onEditPlan={onEditPlan}
          onClonePlan={onClonePlan}
          onDeletePlan={onDeletePlan}
          onOpenMobileView={onOpenMobileView}
          onRunSubagentTest={onRunSubagentTest}
          onBootTester={onBootTester}
          onDeleteTestRun={onDeleteTestRun}
          setSelectedDailySessionDate={c.setSelectedDailySessionDate}
          setSelectedReportPlanId={c.setSelectedReportPlanId}
          setActiveTab={c.setActiveTab}
          setSubagentToast={c.setSubagentToast}
          formatOngoingDuration={c.formatOngoingDuration}
        />
      )}

      {/* Tab 4: Feature Health Metrics & CUJ Quality Report */}
      {c.activeTab === 'features' && (
        <CujReportTab
          testPlans={testPlans}
          selectedDailySessionDate={c.selectedDailySessionDate}
          setSelectedDailySessionDate={c.setSelectedDailySessionDate}
          recordedDailySessions={c.recordedDailySessions}
          todayStr={c.todayStr}
          reportPlanId={c.reportPlanId}
          setSelectedReportPlanId={c.setSelectedReportPlanId}
          reportPlanLabel={c.reportPlanLabel}
          allPlansRunCount={c.allPlansRunCount}
          planPickerOptions={c.planPickerOptions}
          newFeatureInput={c.newFeatureInput}
          setNewFeatureInput={c.setNewFeatureInput}
          handleCreateFeatureSubmit={c.handleCreateFeatureSubmit}
          onRunSubagentTest={onRunSubagentTest}
          onLoadSampleData={onLoadSampleData}
          setSubagentToast={c.setSubagentToast}
          onResetActiveDay={onResetActiveDay}
          onDeleteFeature={onDeleteFeature}
          featureMetricsList={c.featureMetricsList}
          bugOnlyMetrics={c.bugOnlyMetrics}
          untestedCujNames={c.untestedCujNames}
          visualCardRef={c.visualCardRef}
          reportDayDisplayLabel={c.reportDayDisplayLabel}
          reportDayPhrase={c.reportDayPhrase}
          latestReportDate={c.latestReportDate}
          hasCurrentReport={c.hasCurrentReport}
          generatedReport={c.generatedReport}
          isGeneratingSummary={c.isGeneratingSummary}
          handleGenerateSummary={c.handleGenerateSummary}
          handleCopyGeneratedReport={c.handleCopyGeneratedReport}
          copiedReport={c.copiedReport}
          handleCopyVisualImageToClipboard={c.handleCopyVisualImageToClipboard}
          copiedImage={c.copiedImage}
          setTempApiKey={c.setTempApiKey}
          setTempModel={c.setTempModel}
          setIsApiKeyModalOpen={c.setIsApiKeyModalOpen}
          openChatSummary={c.openChatSummary}
          handleAskRx95={c.handleAskRx95}
          rx95Elapsed={c.rx95Elapsed}
          avgHealthScore={c.avgHealthScore}
          totalFeaturesCount={c.totalFeaturesCount}
          totalStepsAcrossFeatures={c.totalStepsAcrossFeatures}
          criticalFeaturesCount={c.criticalFeaturesCount}
          criticalPct={c.criticalPct}
          warningFeaturesCount={c.warningFeaturesCount}
          warningPct={c.warningPct}
          healthyFeaturesCount={c.healthyFeaturesCount}
          healthyPct={c.healthyPct}
          totalBugsAcrossFeatures={c.totalBugsAcrossFeatures}
          goldenRunsAnalysis={c.goldenRunsAnalysis}
          isFeatureReportExpanded={c.isFeatureReportExpanded}
          setIsFeatureReportExpanded={c.setIsFeatureReportExpanded}
          historicalTimelinePoints={c.historicalTimelinePoints}
          makeBugsKey={makeBugsKey}
        />
      )}

      {/* Tab 3: Bugs Feed & Buganizer Triage */}
      {c.activeTab === 'bugs' && (
        <BugsFeedTab
          buganizerEnabled={BUGANIZER_ENABLED}
          bugsView={c.bugsView}
          setBugsView={c.setBugsView}
          testPlans={testPlans}
          bugLogs={bugLogs}
          bugById={c.bugById}
          processedBugs={c.processedBugs}
          processedBugById={c.processedBugById}
          buganizerBugs={c.buganizerBugs}
          newFeedBugs={c.newFeedBugs}
          reviewedFeedBugs={c.reviewedFeedBugs}
          feedRows={c.feedRows}
          feedSuggestions={c.feedSuggestions}
          suggestionByBugId={c.suggestionByBugId}
          bugCategorizations={c.bugCategorizations}
          dismissedSuggestions={c.dismissedSuggestions}
          setDismissedSuggestions={c.setDismissedSuggestions}
          expandedFeedBundles={c.expandedFeedBundles}
          setExpandedFeedBundles={c.setExpandedFeedBundles}
          suggestionsCollapsed={c.suggestionsCollapsed}
          setSuggestionsCollapsed={c.setSuggestionsCollapsed}
          feedNow={c.feedNow}
          feedTab={c.feedTab}
          setFeedTab={c.setFeedTab}
          expandedBugIds={c.expandedBugIds}
          toggleBugExpand={c.toggleBugExpand}
          setStickyNewBugIds={c.setStickyNewBugIds}
          feedToast={c.feedToast}
          flashFeed={c.flashFeed}
          buganizerFocus={c.buganizerFocus}
          setBuganizerFocus={c.setBuganizerFocus}
          rx95Suggestions={rx95Suggestions}
          onApplyBugRefinements={onApplyBugRefinements}
          onPatchBugLog={onPatchBugLog}
          onPatchBugLogs={onPatchBugLogs}
          onApplyReproMatches={onApplyReproMatches}
          onUpdateBugLog={onUpdateBugLog}
          onDeleteBug={onDeleteBug}
          onWipeAllBugs={onWipeAllBugs}
          openInFeed={c.openInFeed}
          openInBuganizer={c.openInBuganizer}
          jumpToSuggestion={c.jumpToSuggestion}
          handleCategorizeAndBundle={c.handleCategorizeAndBundle}
          unbundleFromFeed={c.unbundleFromFeed}
          reviewedOf={c.reviewedOf}
          feedDraftFor={c.feedDraftFor}
          feedDirty={c.feedDirty}
          setFeedDraft={c.setFeedDraft}
          cancelFeedEdit={c.cancelFeedEdit}
          saveFeedEdit={c.saveFeedEdit}
          markReviewed={c.markReviewed}
          moveToNew={c.moveToNew}
          handleUpdateBugCategorization={c.handleUpdateBugCategorization}
          confirmBugCategorization={c.confirmBugCategorization}
          filedIssueDrafts={c.filedIssueDrafts}
          setFiledIssueDrafts={c.setFiledIssueDrafts}
          setSelectedImagePreviewUrl={c.setSelectedImagePreviewUrl}
          todayStr={c.todayStr}
          getLocalDateStr={getLocalDateStr}
          selectedPlanFilter={c.selectedPlanFilter}
          setSelectedPlanFilter={c.setSelectedPlanFilter}
          bugPlanOptions={c.bugPlanOptions}
          selectedDateFilter={c.selectedDateFilter}
          setSelectedDateFilter={c.setSelectedDateFilter}
          customDateInput={c.customDateInput}
          setCustomDateInput={c.setCustomDateInput}
          searchBugQuery={c.searchBugQuery}
          setSearchBugQuery={c.setSearchBugQuery}
          isBugFilterMenuOpen={c.isBugFilterMenuOpen}
          setIsBugFilterMenuOpen={c.setIsBugFilterMenuOpen}
          selectedFeatureFilter={c.selectedFeatureFilter}
          setSelectedFeatureFilter={c.setSelectedFeatureFilter}
          uniqueFeatures={c.uniqueFeatures}
          selectedDeviceFilter={c.selectedDeviceFilter}
          setSelectedDeviceFilter={c.setSelectedDeviceFilter}
          uniqueDevices={c.uniqueDevices}
          sortByDevice={c.sortByDevice}
          setSortByDevice={c.setSortByDevice}
          feedGroupBy={c.feedGroupBy}
          setFeedGroupBy={c.setFeedGroupBy}
          selectedTesterFilters={c.selectedTesterFilters}
          setSelectedTesterFilters={c.setSelectedTesterFilters}
          isTesterFilterOpen={c.isTesterFilterOpen}
          setIsTesterFilterOpen={c.setIsTesterFilterOpen}
          focusedBugId={c.focusedBugId}
          setFocusedBugId={c.setFocusedBugId}
          bugTesterOptions={c.bugTesterOptions}
        />
      )}

      {/* Portal Modals & Summary Toast */}
      <DashboardModals
        selectedImagePreviewUrl={c.selectedImagePreviewUrl}
        setSelectedImagePreviewUrl={c.setSelectedImagePreviewUrl}
        copiedImage={c.copiedImage}
        setCopiedImage={c.setCopiedImage}
        isApiKeyModalOpen={c.isApiKeyModalOpen}
        setIsApiKeyModalOpen={c.setIsApiKeyModalOpen}
        tempApiKey={c.tempApiKey}
        setTempApiKey={c.setTempApiKey}
        tempModel={c.tempModel}
        setTempModel={c.setTempModel}
        isTestingKey={c.isTestingKey}
        setIsTestingKey={c.setIsTestingKey}
        testKeyStatus={c.testKeyStatus}
        setTestKeyStatus={c.setTestKeyStatus}
        reportDisclaimer={c.reportDisclaimer}
        setReportDisclaimer={c.setReportDisclaimer}
        openChatSummary={c.openChatSummary}
        handleExecuteCopyReport={c.handleExecuteCopyReport}
        isChatSummaryOpen={c.isChatSummaryOpen}
        setIsChatSummaryOpen={c.setIsChatSummaryOpen}
        chatNotice={c.chatNotice}
        chatPromptCopied={c.chatPromptCopied}
        handleCopyChatPrompt={c.handleCopyChatPrompt}
        chatAutoOpenGemini={c.chatAutoOpenGemini}
        toggleChatAutoOpenGemini={c.toggleChatAutoOpenGemini}
        handlePasteChatReplyFromClipboard={c.handlePasteChatReplyFromClipboard}
        chatReplyText={c.chatReplyText}
        setChatReplyText={c.setChatReplyText}
        chatStatus={c.chatStatus}
        setChatStatus={c.setChatStatus}
        isGeneratingSummary={c.isGeneratingSummary}
        handleBuildReportFromChatReply={c.handleBuildReportFromChatReply}
        summaryToast={c.summaryToast}
      />
    </div>
  );
};
