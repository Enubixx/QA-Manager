import React, { useState, useRef, useMemo, useEffect } from "react";
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, RefinedBugText, ReproMatches } from "../../types";
import { isReviewed, reviewedNow } from "../../utils/bugReview";
import { isRunFullyCompleted, buildStepFirstSeenIndex, computeLiveInProgressRuns, computeTodayRunsMap, computeFleetProgress } from "../../utils/runUtils";
import { toLocalHHMM, withBugTime } from "../../utils/bugTime";
import { ALL_PLANS, ALL_DATES, mergeRunsById, getKnownCujNames, computeCujReport, listReportDates, buildTimelinePoints, getPlanPickerOptions, buildCujReportText, buildReportScopeKey, formatReportDateLabel } from "../../utils/cujReportUtils";
import type { CujMetric } from "../../utils/cujReportUtils";
import { generateBatchExecutiveSummaryWithGemini, nlpCleanReword, getStoredGeminiApiKey, getStoredGeminiModel, getGeminiKeyErrorHint, buildChatSummaryPrompt, applyChatSummaryReply, isChatSummaryPrompt, getChatReplyReportId } from "../../services/geminiService";
import type { ExecutiveQAResult, SummaryScopeContext } from "../../services/geminiService";
import { requestRx95Summary } from "../../services/rx95Service";
import type { GroupCategory } from "../BundleSuggestionsPanel";
import { type ShownSuggestion, isBundleable, loadDismissed, newBundle, sameHotlist, shownSuggestions } from "../../utils/bundleDraft";
import { toBlob } from "html-to-image";
import type { Rx95SuggestionsData } from "../../services/supabaseService";

export const makeBugsKey = (bugs: BugLog[]): string =>
  bugs.map(b => `${b.id}:${b.stepTitle || ""}:${b.note || ""}`).sort().join("|");

const GEMINI_CHAT_URL = "https://gemini.google.com/app";
const CHAT_AUTO_OPEN_GEMINI_KEY = "qa_chat_auto_open_gemini";

export const getLocalDateStr = (dateInput?: string | Date) => {
  if (dateInput === "") return "";
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const d = dateInput !== undefined ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export interface DashboardControllerInput {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  bugLogs: BugLog[];
  populatedFeatures: string[];
  devices: DeviceProfile[];
  testers: TesterProfile[];
  archivedRuns: TestRun[];
  onUpdateBugLog?: (updatedBug: BugLog | BugLog[]) => void;
  onPatchBugLog?: (bugId: string, patch: Partial<BugLog>) => void;
  onPatchBugLogs?: (patches: Record<string, Partial<BugLog>>) => void;
  rx95Suggestions?: Rx95SuggestionsData;
  onImportJSONData: (data: { testPlans?: TestPlan[]; testRuns?: TestRun[]; bugLogs?: BugLog[]; archivedRuns?: TestRun[] }) => void;
  onAddFeature?: (featureName: string) => void;
  activeTabProp?: 'overview' | 'devices' | 'testers' | 'features' | 'bugs';
  onActiveTabChange?: (tab: 'overview' | 'devices' | 'testers' | 'features' | 'bugs') => void;
}

export function useDashboardController({
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
}: DashboardControllerInput) {
  const defaultTodayStr = getLocalDateStr(new Date());
  const [internalActiveTab, setInternalActiveTab] = useState<'overview' | 'devices' | 'testers' | 'features' | 'bugs'>('overview');
  const activeTab = activeTabProp ?? internalActiveTab;
  const setActiveTab: React.Dispatch<React.SetStateAction<'overview' | 'devices' | 'testers' | 'features' | 'bugs'>> = (val) => {
    const next = typeof val === 'function' ? val(activeTab) : val;
    setInternalActiveTab(next);
    onActiveTabChange?.(next);
  };
  const [bugsView, setBugsView] = useState<'feed' | 'buganizer'>('feed');
  const [selectedQaDate, setSelectedQaDate] = useState<string>(defaultTodayStr);
  const [expandedTesters, setExpandedTesters] = useState<Record<string, boolean>>({});
  const [expandedPlanSteps, setExpandedPlanSteps] = useState<Record<string, boolean>>({});
  const [subagentToast, setSubagentToast] = useState<string | null>(null);
  const [reportDisclaimer, setReportDisclaimer] = useState<string>(() => {
    try {
      return localStorage.getItem('qa_report_disclaimer') || '';
    } catch (e) {
      return '';
    }
  });

  const [newDeviceName, setNewDeviceName] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRole, setNewPersonRole] = useState('Mobile Tester');
  const [quotaPlanMap, setQuotaPlanMap] = useState<Record<string, string>>({});
  const [quotaRunsMap, setQuotaRunsMap] = useState<Record<string, number>>({});
  const [showCreateTesterForm, setShowCreateTesterForm] = useState(false);
  const [testerViewMode, setTesterViewMode] = useState<'tested' | 'active' | 'idle' | 'all'>('tested');
  const [searchTesterQuery, setSearchTesterQuery] = useState('');
  const [selectedInspectorTester, setSelectedInspectorTester] = useState<string>('');
  const [showOffShiftTesters, setShowOffShiftTesters] = useState<boolean>(false);
  const [quickActivateDeviceId, setQuickActivateDeviceId] = useState<string>('');
  const [quickActivatePlanId, setQuickActivatePlanId] = useState<string>('');
  const [quickActivateQuota, setQuickActivateQuota] = useState<number>(2);
  const [inspectorTarget, setInspectorTarget] = useState<{ type: 'device' | 'tester'; id: string } | null>(null);
  const [isFloorMenuOpen, setIsFloorMenuOpen] = useState<boolean>(false);
  const [isActivateTileOpen, setIsActivateTileOpen] = useState<boolean>(false);
  const floorMenuRef = useRef<HTMLDivElement>(null);

  // Live ongoing test duration ticker (gated on active in-progress runs & relevant tabs to prevent 1Hz full-tree re-renders)
  const [liveTickerTime, setLiveTickerTime] = useState(() => Date.now());
  const hasActiveInProgressRun = useMemo(() => {
    return testRuns.some(r => r && r.status === 'in_progress') || devices.some(d => Boolean(d.activeRunId || d.activeTesterName));
  }, [testRuns, devices]);

  useEffect(() => {
    if (!hasActiveInProgressRun || (activeTab !== 'overview' && activeTab !== 'devices' && activeTab !== 'testers')) {
      return;
    }
    setLiveTickerTime(Date.now());
    const timer = setInterval(() => {
      setLiveTickerTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [hasActiveInProgressRun, activeTab]);

  const formatOngoingDuration = (startedAt?: string): string => {
    if (!startedAt) return '0s';
    const startMs = new Date(startedAt).getTime();
    if (isNaN(startMs) || startMs <= 0) return '0s';
    const diffMs = Math.max(0, liveTickerTime - startMs);
    const totalSecs = Math.floor(diffMs / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs.toString().padStart(2, '0')}s`;
    }
    if (mins > 0) {
      return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${secs}s`;
  };

  // Helper to determine real, effective run status
  const getEffectiveRunStatus = (run: TestRun) => {
    if ((run.status as any) === 'terminated') return 'terminated';
    const plan = testPlans.find(p => p.id === run.planId);
    const totalSteps = plan?.steps?.length || 0;
    const stepEntries = Object.entries(run.results || {}).filter(
      ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
    );
    const completedCount = stepEntries.length;

    // A run with zero recorded step results has no data recorded and must NEVER be treated as completed
    if (completedCount === 0) {
      if (run.status === 'in_progress' || (run.testerName && run.deviceName && run.status !== 'not_started')) {
        return 'in_progress';
      }
      return 'not_started';
    }

    if (run.status === 'completed' || (totalSteps > 0 && (completedCount >= totalSteps || (run.currentStepIndex !== undefined && run.currentStepIndex >= totalSteps)))) {
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

  // Archived + active runs, one per id (completed archived copy protected from stale in_progress overwrites),
  // and when each plan step was first recorded - the history-aware "finished run" rule judges runs against the steps that existed then.
  const mergedRuns = useMemo(() => mergeRunsById(archivedRuns, testRuns), [archivedRuns, testRuns]);
  const stepFirstSeen = useMemo(() => buildStepFirstSeenIndex(mergedRuns), [mergedRuns]);
  const archivedIdSet = useMemo(() => new Set(archivedRuns.map(r => r.id)), [archivedRuns]);
  const liveInProgressRuns = useMemo(
    () => computeLiveInProgressRuns(testRuns, archivedIdSet, testPlans),
    [testRuns, archivedIdSet, testPlans]
  );

  // Determine active testers currently running a test session on a device (with live step and status metrics)
  const activeTesterMap = useMemo(() => {
    const map = new Map<string, { 
      deviceName: string; 
      deviceId?: string;
      planName?: string; 
      runId?: string;
      startedAt?: string;
      currentStepIndex: number;
      totalSteps: number;
      currentStepTitle?: string;
      greenCount: number;
      yellowCount: number;
      redCount: number;
      progressPct: number;
      isAway: boolean;
    }>();

    const computeMetrics = (testerName: string, devName: string, run: TestRun, devId?: string) => {
      if (!testerName || !run) return;
      const key = testerName.toLowerCase().trim();
      const plan = testPlans.find(p => p.id === run.planId);
      const totalSteps = Math.max(1, plan?.steps?.length || 1);
      const stepEntries = Object.entries(run.results || {}).filter(
        ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
      );
      const completedResults = stepEntries.map(([_, v]) => v as any);
      const completedSteps = completedResults.length;
      const progressPct = Math.min(100, Math.round((completedSteps / totalSteps) * 100));

      const greenCount = completedResults.filter(r => r.status === 'green').length;
      const yellowCount = completedResults.filter(r => r.status === 'yellow').length;
      const redCount = completedResults.filter(r => r.status === 'red').length;

      const currentStepIdx = (run.currentStepIndex !== undefined) ? run.currentStepIndex : completedSteps;
      const currentStep = plan?.steps?.[Math.min(currentStepIdx, totalSteps - 1)];
      const currentStepTitle = currentStep ? (currentStep.title || currentStep.feature || `Step ${currentStepIdx + 1}`) : undefined;

      const lastResultTimestamp = completedResults
        .map((r: any) => (r && r.timestamp) ? new Date(r.timestamp).getTime() : 0)
        .filter((t: number) => t > 0 && !isNaN(t))
        .sort((a: number, b: number) => b - a)[0];
      const lastActivityTime = lastResultTimestamp || (run.startedAt ? new Date(run.startedAt).getTime() : 0);
      const isAway = lastActivityTime > 0 && !isNaN(lastActivityTime) && (Date.now() - lastActivityTime > 3 * 60 * 1000);

      map.set(key, {
        deviceName: devName || run.deviceName || 'Mobile Device',
        deviceId: devId || run.deviceId,
        planName: plan?.name || run.planName || 'Test Plan',
        runId: run.id,
        startedAt: run.startedAt,
        currentStepIndex: Math.min(currentStepIdx + 1, totalSteps),
        totalSteps,
        currentStepTitle,
        greenCount,
        yellowCount,
        redCount,
        progressPct,
        isAway
      });
    };

    // 1. Check devices that are currently locked by a tester WITH an actual live in_progress run on that device
    devices.forEach(d => {
      const activeTester = d.activeTesterName?.trim();
      if (activeTester) {
        const activeRun = liveInProgressRuns.find(r => 
          (d.activeRunId && r.id === d.activeRunId) || 
          (r.deviceId && r.deviceId.toLowerCase().trim() === d.id.toLowerCase().trim()) ||
          (r.deviceName && r.deviceName.toLowerCase().trim() === d.name.toLowerCase().trim())
        );
        if (activeRun) {
          computeMetrics(activeRun.testerName || activeTester, d.name, activeRun, d.id);
        }
      }
    });

    // 2. Also check live in_progress runs directly so step changes sync with zero lag
    liveInProgressRuns.forEach(r => {
      if (r.testerName && r.testerName.trim()) {
        const key = r.testerName.toLowerCase().trim();
        const existing = map.get(key);
        const currentEntriesCount = Object.entries(r.results || {}).filter(
          ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
        ).length;
        const existingCount = existing ? (existing.greenCount + existing.yellowCount + existing.redCount) : -1;
        if (!existing || currentEntriesCount >= existingCount) {
          computeMetrics(r.testerName, r.deviceName || 'Mobile Device', r, r.deviceId);
        }
      }
    });

    return map;
  }, [devices, liveInProgressRuns, testPlans]);

  // Calculate completed runs today per device ID and plan ID (deduplicated by run.id using mergeRunsById)
  const todayRunsMap = useMemo(
    () => computeTodayRunsMap(mergedRuns, devices, testPlans, stepFirstSeen),
    [mergedRuns, devices, testPlans, stepFirstSeen]
  );

  const fleetProgress = useMemo(
    () => computeFleetProgress(devices, todayRunsMap, testPlans),
    [devices, todayRunsMap, testPlans]
  );

  const toggleTesterExpand = (testerName: string) => {
    setExpandedTesters(prev => ({
      ...prev,
      [testerName]: !prev[testerName]
    }));
  };

  const [expandedBugIds, setExpandedBugIds] = useState<Record<string, boolean>>({});
  // Bugs Feed tabs (New / Bundle Suggestions / Reviewed) and links to and from the Buganizer tab
  const [feedTab, setFeedTab] = useState<'new' | 'suggestions' | 'reviewed'>('new');
  // Keep expanded rows on the New tab visible while the user edits Type/Priority/Status/text until they close the row or switch tabs
  const [stickyNewBugIds, setStickyNewBugIds] = useState<Set<string>>(new Set());
  const [feedToast, setFeedToast] = useState<string | null>(null);
  const flashFeed = (msg: string) => { setFeedToast(msg); setTimeout(() => setFeedToast(null), 4000); };
  const [buganizerFocus, setBuganizerFocus] = useState<{ id: string; n: number } | null>(null);
  const [feedNow, setFeedNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setFeedNow(Date.now()), 10000); return () => clearInterval(t); }, []);
  useEffect(() => { setStickyNewBugIds(new Set()); }, [feedTab, bugsView, activeTab]);
  // Bugs Feed inline edit (title, time, description), always shown on an expanded row so bugs can be
  // tidied before the Buganizer tab. A draft exists per bug only while it has unsaved changes.
  type FeedDraft = { title: string; note: string; time: string };
  const [feedDrafts, setFeedDrafts] = useState<Record<string, FeedDraft>>({});
  const feedBase = (bug: BugLog): FeedDraft => ({ title: bug.title || '', note: bug.title && bug.note === bug.title ? '' : (bug.note || ''), time: toLocalHHMM(bug.timestamp) });
  const feedDraftFor = (bug: BugLog): FeedDraft => feedDrafts[bug.id] || feedBase(bug);
  const feedDirty = (bug: BugLog) => {
    const d = feedDrafts[bug.id]; if (!d) return false;
    const b = feedBase(bug);
    return d.title !== b.title || d.note !== b.note || d.time !== b.time;
  };
  const setFeedDraft = (bug: BugLog, patch: Partial<FeedDraft>) =>
    setFeedDrafts(prev => ({ ...prev, [bug.id]: { ...(prev[bug.id] || feedBase(bug)), ...patch } }));
  const cancelFeedEdit = (bugId: string) => setFeedDrafts(prev => { const n = { ...prev }; delete n[bugId]; return n; });
  const saveFeedEdit = (bug: BugLog) => {
    const d = feedDrafts[bug.id];
    if (!d || !onUpdateBugLog) return;
    const title = d.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    const note = d.note.trim() || title;
    if (!title && !note) return;
    if (feedTab === 'new' && expandedBugIds[bug.id]) {
      setStickyNewBugIds(prev => new Set(prev).add(bug.id));
    }
    onUpdateBugLog(withBugTime({ ...bug, title: title || undefined, note }, d.time));
    markReviewed(bug.id);
    cancelFeedEdit(bug.id);
  };

  // Bugs Feed review state (New / Reviewed). Written with the targeted patch (bug_logs.reviewed), never by RX95.
  const markReviewed = (bugId: string) => onPatchBugLog?.(bugId, { reviewed: reviewedNow('reviewed') });
  const moveToNew = (bugId: string) => onPatchBugLog?.(bugId, { reviewed: reviewedNow('new') });

  const toggleBugExpand = (bugId: string) => {
    setExpandedBugIds(prev => {
      const willClose = !!prev[bugId];
      if (willClose) {
        setStickyNewBugIds(s => {
          if (!s.has(bugId)) return s;
          const next = new Set(s);
          next.delete(bugId);
          return next;
        });
      }
      return {
        ...prev,
        [bugId]: !prev[bugId]
      };
    });
  };

  // Search & Filter State
  const [searchBugQuery, setSearchBugQuery] = useState<string>('');
  const [searchPlanQuery, setSearchPlanQuery] = useState<string>('');
  const [selectedDeviceFilter, setSelectedDeviceFilter] = useState<string>('all');
  const [selectedFeatureFilter, setSelectedFeatureFilter] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');
  const [selectedPlanFilter, setSelectedPlanFilter] = useState<string>('all');
  const [customDateInput, setCustomDateInput] = useState<string>('');
  const [sortByDevice, setSortByDevice] = useState<'newest' | 'oldest' | 'device-asc' | 'device-desc' | 'priority' | 'severity' | 'tester-asc' | 'tester-most'>('newest');
  const [feedGroupBy, setFeedGroupBy] = useState<'time' | 'tester' | 'device' | 'cuj'>('time');
  const [selectedTesterFilters, setSelectedTesterFilters] = useState<string[]>([]);
  const [isTesterFilterOpen, setIsTesterFilterOpen] = useState<boolean>(false);
  const [focusedBugId, setFocusedBugId] = useState<string | null>(null);
  
  // Feature Creation, Report Expand, Copy Report & Bug Filter Menu state on Dashboard
  const visualCardRef = useRef<HTMLDivElement>(null);
  const modalCardRef = useRef<HTMLDivElement>(null);
  const [newFeatureInput, setNewFeatureInput] = useState<string>('');
  const [isFeatureReportExpanded, setIsFeatureReportExpanded] = useState<boolean>(false);
  const [isBugFilterMenuOpen, setIsBugFilterMenuOpen] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [copiedImage, setCopiedImage] = useState<boolean>(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);
  /** Seconds RX95 has been working on a summary, or null when idle. */
  const [rx95Elapsed, setRx95Elapsed] = useState<number | null>(null);
  const [generatedReport, setGeneratedReport] = useState<{
    plainText: string;
    htmlText: string;
    generatedAt: number;
    scopeKey: string;
    modelUsed?: string;
    aiError?: string;
    featureSummaries?: Record<string, { summary: string; bugsKey: string }>;
  } | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [tempApiKey, setTempApiKey] = useState<string>(() => getStoredGeminiApiKey());
  const [tempModel, setTempModel] = useState<string>(() => getStoredGeminiModel());
  const [isTestingKey, setIsTestingKey] = useState<boolean>(false);
  const [testKeyStatus, setTestKeyStatus] = useState<{ success: boolean; message: string; models?: string[] } | null>(null);
  const [summaryToast, setSummaryToast] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [isChatSummaryOpen, setIsChatSummaryOpen] = useState<boolean>(false);
  const [chatReplyText, setChatReplyText] = useState<string>('');
  const [chatPromptCopied, setChatPromptCopied] = useState<boolean>(false);
  const [chatStatus, setChatStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [chatAutoOpenGemini, setChatAutoOpenGemini] = useState<boolean>(() => localStorage.getItem(CHAT_AUTO_OPEN_GEMINI_KEY) === '1');
  const chatReplyHandlerRef = useRef<((text: string, source: 'auto' | 'paste') => void) | null>(null);
  const lastAutoCheckedReplyRef = useRef<string>('');
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState<string | null>(null);

  // Smart Categorization Settings
  const [bugCategorizations, setBugCategorizations] = useState<Record<string, {
    bugType?: 'Bug' | 'Setup Issue' | 'Known Issue' | 'Feature Request' | 'Misc Issue';
    priority?: 'P0' | 'P1' | 'P2';
    status?: 'Filed' | 'New' | "Repro'd Issue";
  }>>(() => {
    try {
      const saved = localStorage.getItem('qa_bug_categorizations');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  // Stored bugs by id (the Filed stamp reads the stored status, not the categorization override)
  const bugById = useMemo(() => new Map(bugLogs.map(b => [b.id, b])), [bugLogs]);
  // Unsaved "b/ issue number" inputs next to the Filed switch (per bug)
  const [filedIssueDrafts, setFiledIssueDrafts] = useState<Record<string, string>>({});

  const handleUpdateBugCategorization = (bugId: string, field: 'bugType' | 'priority' | 'status', value: any) => {
    const nextCat = { ...(bugCategorizations[bugId] || {}), [field]: value };
    setBugCategorizations(prev => {
      const updated = { ...prev, [bugId]: { ...(prev[bugId] || {}), [field]: value } };
      try {
        localStorage.setItem('qa_bug_categorizations', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
    // Outside the state updater: updating App's state while React renders Dashboard is not allowed
    const targetBug = bugLogs.find(b => b.id === bugId);
    if (targetBug && onUpdateBugLog) {
      // A status change on a bug with the legacy stored status 'Filed' keeps its Filed stamp as real data.
      const keepLegacyFiled = field === 'status' && targetBug.status === 'Filed' && !targetBug.filed
        ? { filed: { via: 'legacy' as const, at: targetBug.timestamp } }
        : {};
      // Setting type / priority / status is a review; keep expanded row open on the New tab until closed
      if (feedTab === 'new' && expandedBugIds[bugId]) {
        setStickyNewBugIds(prev => new Set(prev).add(bugId));
        flashFeed('Marked reviewed · stays open until you close this row.');
      }
      markReviewed(bugId);
      // filed is worker-owned: it can only change through the targeted patch handler
      if (keepLegacyFiled.filed && onPatchBugLog) onPatchBugLog(bugId, keepLegacyFiled);
      onUpdateBugLog({
        ...targetBug,
        bugType: nextCat.bugType || targetBug.bugType || 'Bug',
        priority: nextCat.priority || targetBug.priority || (targetBug.severity === 'critical' ? 'P0' : targetBug.severity === 'high' ? 'P1' : 'P2'),
        // No default: 'Filed' used to be written here even when only type/priority changed
        status: nextCat.status || targetBug.status
      });
    }
  };

  // Global Escape key listener closes any active modal or popover
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedImagePreviewUrl) setSelectedImagePreviewUrl(null);
        if (isChatSummaryOpen) setIsChatSummaryOpen(false);
        if (isApiKeyModalOpen) setIsApiKeyModalOpen(false);
        if (isBugFilterMenuOpen) setIsBugFilterMenuOpen(false);
        if (isTesterFilterOpen) setIsTesterFilterOpen(false);
        if (inspectorTarget) setInspectorTarget(null);
        if (selectedInspectorTester) setSelectedInspectorTester('');
        if (isFloorMenuOpen) setIsFloorMenuOpen(false);
        if (isActivateTileOpen) setIsActivateTileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImagePreviewUrl, isChatSummaryOpen, isApiKeyModalOpen, isBugFilterMenuOpen, isTesterFilterOpen, inspectorTarget, selectedInspectorTester, isFloorMenuOpen, isActivateTileOpen]);

  // Close floor ⋯ menu on outside click
  useEffect(() => {
    if (!isFloorMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (floorMenuRef.current && !floorMenuRef.current.contains(e.target as Node)) {
        setIsFloorMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isFloorMenuOpen]);

  const handleCreateFeatureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFeatureInput.trim();
    if (!trimmed || trimmed.toLowerCase() === 'general' || trimmed.startsWith('__') || !onAddFeature) return;
    onAddFeature(trimmed);
    setNewFeatureInput('');
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleJSONFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        onImportJSONData(parsed);
        alert('QA Data successfully imported!');
      } catch (err) {
        alert('Failed to parse JSON file. Please ensure it is a valid QA backup JSON.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Filter runs to ONLY include fully finished test plan executions (100% of steps completed)
  const completedRuns = useMemo(() => {
    return mergedRuns.filter(run => isRunFullyCompleted(run, testPlans, stepFirstSeen));
  }, [mergedRuns, testPlans, stepFirstSeen]);

  // Unique devices populated across bug logs and completed test runs (memoized)
  const uniqueDevices = useMemo(() => Array.from(
    new Set(
      bugLogs.map(b => b.deviceName).concat(completedRuns.map(r => r.deviceName)).filter(Boolean)
    )
  ) as string[], [bugLogs, completedRuns]);

  // Unique features populated across test steps, bug logs, and populatedFeatures (excluding 'General' and '__*')
  const uniqueFeatures = useMemo(() => Array.from(
    new Set(
      populatedFeatures
        .concat(testPlans.flatMap(p => (p.steps || []).map(s => s.feature || '')))
        .concat(bugLogs.map(b => b.feature || ''))
        .filter(f => typeof f === 'string' && f.trim() !== '' && f.toLowerCase() !== 'general' && !f.startsWith('__'))
    )
  ) as string[], [populatedFeatures, testPlans, bugLogs]);

  // Which test plan each bug belongs to. Uses the bug's own planId, falling back to the
  // plan of the run it was logged in (older bugs may not carry a planId).
  const bugPlanLookup = useMemo(() => {
    const runPlan = new Map<string, { planId: string; planName: string }>();
    mergedRuns.forEach(r => {
      if (r && r.id) runPlan.set(r.id, { planId: r.planId || '', planName: r.planName || '' });
    });
    const planNames = new Map<string, string>();
    testPlans.forEach(p => { if (p && p.id) planNames.set(p.id, p.name || 'Untitled Plan'); });
    const resolve = (bug: BugLog): { planId: string; planName: string } => {
      const fromRun = bug.testRunId ? runPlan.get(bug.testRunId) : undefined;
      const planId = bug.planId || fromRun?.planId || '';
      if (!planId) return { planId: '__none__', planName: 'No Test Plan' };
      const planName = planNames.get(planId) || fromRun?.planName || 'Deleted Plan';
      return { planId, planName };
    };
    return resolve;
  }, [mergedRuns, testPlans]);

  // Test plan options for the Bugs tab plan filter, with bug counts (sorted by name)
  const bugPlanOptions = useMemo(() => {
    const counts = new Map<string, { planId: string; planName: string; count: number }>();
    testPlans.forEach(p => {
      if (p && p.id) counts.set(p.id, { planId: p.id, planName: p.name || 'Untitled Plan', count: 0 });
    });
    bugLogs.forEach(b => {
      const { planId, planName } = bugPlanLookup(b);
      const entry = counts.get(planId) || { planId, planName, count: 0 };
      entry.count += 1;
      counts.set(planId, entry);
    });
    return Array.from(counts.values()).sort((a, b) =>
      a.planName.localeCompare(b.planName, undefined, { sensitivity: 'base' })
    );
  }, [testPlans, bugLogs, bugPlanLookup]);

  const selectedPlanFilterName = useMemo(() => {
    if (selectedPlanFilter === 'all') return '';
    return bugPlanOptions.find(o => o.planId === selectedPlanFilter)?.planName || '';
  }, [selectedPlanFilter, bugPlanOptions]);

  // If the selected plan disappears (deleted / data reset), fall back to all plans
  useEffect(() => {
    if (selectedPlanFilter !== 'all' && !bugPlanOptions.some(o => o.planId === selectedPlanFilter)) {
      setSelectedPlanFilter('all');
    }
  }, [selectedPlanFilter, bugPlanOptions]);

  // Today Local Date string (YYYY-MM-DD)
  const todayStr = useMemo(() => getLocalDateStr(new Date()), [testRuns, archivedRuns, devices]);

  // Selected Daily QA Session Date (defaults to Today, or specific saved day YYYY-MM-DD, or 'all')
  const [selectedDailySessionDate, setSelectedDailySessionDate] = useState<string>(todayStr);

  // Test plan the CUJ report is scoped to (always opens on "All plans"; not persisted).
  const [selectedReportPlanId, setSelectedReportPlanId] = useState<string>(ALL_PLANS);
  const reportPlanId = selectedReportPlanId === ALL_PLANS || testPlans.some(p => p.id === selectedReportPlanId)
    ? selectedReportPlanId
    : ALL_PLANS;
  useEffect(() => {
    if (reportPlanId !== selectedReportPlanId) setSelectedReportPlanId(ALL_PLANS);
  }, [reportPlanId, selectedReportPlanId]);

  // Days with data (counted steps or bugs) for the selected plan, newest first
  const reportDates = useMemo(
    () => listReportDates({ plans: testPlans, runs: mergedRuns, bugs: bugLogs, planId: reportPlanId, firstSeen: stepFirstSeen }),
    [testPlans, mergedRuns, bugLogs, reportPlanId, stepFirstSeen]
  );
  const latestReportDate = reportDates.length > 0 ? reportDates[0].dateStr : '';

  // List of Saved Historical Days with execution counts: Today, then the selected plan's days
  const recordedDailySessions = useMemo(() => {
    const todayLabel = `Today (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;

    const formatDisplayLabel = (dStr: string) => {
      const [y, m, d] = dStr.split('-').map(Number);
      if (y && m && d) {
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      return dStr;
    };

    const todayEntry = reportDates.find(d => d.dateStr === todayStr);
    const otherDays = reportDates
      .filter(d => d.dateStr !== todayStr)
      .map(d => ({ dateStr: d.dateStr, label: formatDisplayLabel(d.dateStr), stepCount: d.stepCount, bugCount: d.bugCount }));
    if (selectedDailySessionDate !== ALL_DATES && selectedDailySessionDate !== todayStr && !otherDays.some(d => d.dateStr === selectedDailySessionDate)) {
      otherDays.push({ dateStr: selectedDailySessionDate, label: formatDisplayLabel(selectedDailySessionDate), stepCount: 0, bugCount: 0 });
      otherDays.sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    }

    return [
      { dateStr: todayStr, label: todayLabel, stepCount: todayEntry ? todayEntry.stepCount : 0, bugCount: todayEntry ? todayEntry.bugCount : 0 },
      ...otherDays
    ];
  }, [reportDates, todayStr, selectedDailySessionDate]);

  // Test Plan picker options for the selected day, most recently run plan first
  const planPickerOptions = useMemo(
    () => getPlanPickerOptions({ plans: testPlans, runs: mergedRuns, bugs: bugLogs, date: selectedDailySessionDate, firstSeen: stepFirstSeen }),
    [testPlans, mergedRuns, bugLogs, selectedDailySessionDate, stepFirstSeen]
  );
  const allPlansRunCount = planPickerOptions.reduce((sum, o) => sum + o.runCount, 0);

  // CUJ report for the selected plan + day
  const reportScope = useMemo(() => ({ planId: reportPlanId, date: selectedDailySessionDate }), [reportPlanId, selectedDailySessionDate]);
  const reportScopeKey = buildReportScopeKey(reportScope);
  const knownCujNames = useMemo(() => getKnownCujNames(testPlans, bugLogs, populatedFeatures), [testPlans, bugLogs, populatedFeatures]);
  const cujReport = useMemo(
    () => computeCujReport({ plans: testPlans, runs: mergedRuns, bugs: bugLogs, scope: reportScope, knownCujNames, firstSeen: stepFirstSeen }),
    [testPlans, mergedRuns, bugLogs, reportScope, knownCujNames, stepFirstSeen]
  );
  const reportPlanLabel = cujReport.planLabel;
  const reportDateLabel = formatReportDateLabel(selectedDailySessionDate);
  const reportDayDisplayLabel = selectedDailySessionDate === todayStr ? 'Today' : reportDateLabel;
  const reportDayPhrase = selectedDailySessionDate === ALL_DATES ? 'across all days' : `on ${reportDayDisplayLabel}`;
  const reportScopeContext: SummaryScopeContext = {
    scopeKey: reportScopeKey,
    scopeLabel: reportPlanId === ALL_PLANS ? `all test plans (${reportDateLabel})` : `the "${reportPlanLabel}" test plan (${reportDateLabel})`
  };

  // Invalidate stored report when scope, underlying CUJ report data, or disclaimer changes
  const reportDataSignature = useMemo(() => {
    const bugsSig = [...cujReport.testedMetrics, ...cujReport.bugOnlyMetrics]
      .map(m => `${m.featureName}:${m.greenCount}/${m.yellowCount}/${m.redCount}:${makeBugsKey(m.associatedBugs)}`)
      .join('||');
    return `${reportScopeKey}::${cujReport.totals.stepsExecuted}::${cujReport.golden.goldenCount}/${cujReport.golden.totalCount}::${reportDisclaimer}::${bugsSig}`;
  }, [reportScopeKey, cujReport, reportDisclaimer]);

  const reportScopeKeyRef = useRef(reportScopeKey);
  reportScopeKeyRef.current = reportScopeKey;
  useEffect(() => {
    setGeneratedReport(null);
  }, [reportDataSignature]);
  const hasCurrentReport = !!generatedReport && generatedReport.scopeKey === reportScopeKey;

  // Historical Quality Evolution Timeline Points (Only fully finished runs of the selected plan)
  const historicalTimelinePoints = useMemo(
    () => buildTimelinePoints({ plans: testPlans, runs: mergedRuns, bugs: bugLogs, planId: reportPlanId, firstSeen: stepFirstSeen }),
    [testPlans, mergedRuns, bugLogs, reportPlanId, stepFirstSeen]
  );

  const featureMetricsList = cujReport.testedMetrics;
  const bugOnlyMetrics = cujReport.bugOnlyMetrics;
  const untestedCujNames = cujReport.untestedCujNames;

  // Compute QA Status metrics for individual tester profiles & daily tracking (case-insensitive grouping)
  const testerProfilesMap = useMemo(() => {
    const combinedRuns = mergedRuns;
    const planTitleMap = new Map(testPlans.map(p => [p.id, p.name]));
    const map = new Map<string, {
      testerName: string;
      devicesUsed: Set<string>;
      allTimeCompletedCount: number;
      dailyStats: Record<string, {
        dateStr: string;
        completedCount: number;
        totalDurationMs: number;
        devicesUsedOnDay: Set<string>;
        completedRuns: {
          runId: string;
          planName: string;
          deviceName: string;
          completedAtFormatted: string;
          durationMs: number;
          durationFormatted: string;
          greenCount: number;
          yellowCount: number;
          redCount: number;
        }[];
      }>;
    }>();

    combinedRuns.forEach(run => {
      const displayTester = run.testerName?.trim() || 'Unassigned Tester';
      const normKey = displayTester.toLowerCase();
      if (!map.has(normKey)) {
        map.set(normKey, {
          testerName: displayTester,
          devicesUsed: new Set<string>(),
          allTimeCompletedCount: 0,
          dailyStats: {}
        });
      }
      const profile = map.get(normKey)!;
      if (run.deviceName) profile.devicesUsed.add(run.deviceName);

      const effectiveStatus = getEffectiveRunStatus(run);
      const stepEntries = Object.entries(run.results || {}).filter(
        ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
      );
      const isCompleted = effectiveStatus === 'completed' && stepEntries.length > 0;

      if (isCompleted) {
        profile.allTimeCompletedCount++;

        const resultsArray = stepEntries.map(([_, v]) => v as any);
        const stepTimestamps = resultsArray
          .map(r => (r && r.timestamp) ? new Date(r.timestamp).getTime() : NaN)
          .filter(t => !isNaN(t) && t > 0)
          .sort((a, b) => a - b);

        const maxStepTime = stepTimestamps.length > 0 ? stepTimestamps[stepTimestamps.length - 1] : 0;
        const minStepTime = stepTimestamps.length > 0 ? stepTimestamps[0] : 0;

        const runDate = run.completedAt
          ? new Date(run.completedAt)
          : (maxStepTime > 0 ? new Date(maxStepTime) : (run.startedAt ? new Date(run.startedAt) : new Date()));
        const dateStr = getLocalDateStr(runDate) || defaultTodayStr;
        const timeFormatted = !isNaN(runDate.getTime())
          ? runDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';

        let durationMs = (typeof run.durationMs === 'number' && !isNaN(run.durationMs) && run.durationMs > 0) ? run.durationMs : 0;
        if (!durationMs) {
          const startMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
          const endMs = run.completedAt ? new Date(run.completedAt).getTime() : (maxStepTime || startMs);

          if (startMs > 0 && endMs > startMs) {
            durationMs = endMs - startMs;
          } else if (maxStepTime > minStepTime) {
            durationMs = maxStepTime - minStepTime;
          }
        }

        // Cap multi-hour overnight idle gaps between steps so average run time isn't skewed
        const MAX_STEP_GAP_MS = 30 * 60 * 1000;
        if (durationMs > 2 * 3600 * 1000 && stepTimestamps.length > 1) {
          let cappedSum = 0;
          for (let i = 1; i < stepTimestamps.length; i++) {
            const delta = Math.max(0, stepTimestamps[i] - stepTimestamps[i - 1]);
            cappedSum += Math.min(delta, MAX_STEP_GAP_MS);
          }
          if (cappedSum > 0) durationMs = cappedSum;
        }

        const durationSecs = Math.max(1, Math.round(durationMs / 1000));
        const mins = Math.floor(durationSecs / 60);
        const secs = durationSecs % 60;
        const durationFormatted = mins > 0 
          ? `${mins}m ${secs < 10 ? '0' : ''}${secs}s` 
          : `${secs}s`;

        const greenCount = resultsArray.filter(r => r.status === 'green').length;
        const yellowCount = resultsArray.filter(r => r.status === 'yellow').length;
        const redCount = resultsArray.filter(r => r.status === 'red').length;
        const deviceNameStr = run.deviceName?.trim() || 'Mobile Device';
        const latestPlanName = planTitleMap.get(run.planId) || run.planName || 'Test Plan';

        if (!profile.dailyStats[dateStr]) {
          profile.dailyStats[dateStr] = {
            dateStr,
            completedCount: 0,
            totalDurationMs: 0,
            devicesUsedOnDay: new Set<string>(),
            completedRuns: []
          };
        }

        profile.dailyStats[dateStr].completedCount++;
        profile.dailyStats[dateStr].totalDurationMs += durationMs;
        profile.dailyStats[dateStr].devicesUsedOnDay.add(deviceNameStr);
        profile.dailyStats[dateStr].completedRuns.push({
          runId: run.id,
          planName: latestPlanName,
          deviceName: deviceNameStr,
          completedAtFormatted: timeFormatted,
          durationMs,
          durationFormatted,
          greenCount,
          yellowCount,
          redCount
        });
      }
    });

    return Array.from(map.values());
  }, [testRuns, archivedRuns, testPlans, defaultTodayStr]);

  // Extract all unique dates for QA Status dropdown
  const allQaDatesList = useMemo(() => {
    const set = new Set<string>();
    testerProfilesMap.forEach(p => {
      Object.keys(p.dailyStats).forEach(d => set.add(d));
    });
    return Array.from(set).sort().reverse();
  }, [testerProfilesMap]);

  // Unified list combining registered tester profiles with live performance tracking data
  const unifiedTesters = useMemo(() => {
    const map = new Map<string, {
      id?: string;
      name: string;
      role: string;
      performanceProfile?: typeof testerProfilesMap[0];
    }>();

    // 1. Add all registered testers
    testers.forEach(t => {
      if (!t || !t.name) return;
      map.set(t.name.toLowerCase().trim(), {
        id: t.id,
        name: t.name,
        role: t.role || 'Mobile Tester'
      });
    });

    // 2. Attach performance data from runs and include any extra testers found in runs
    testerProfilesMap.forEach(p => {
      const key = p.testerName.toLowerCase().trim();
      if (map.has(key)) {
        map.get(key)!.performanceProfile = p;
      } else {
        map.set(key, {
          name: p.testerName,
          role: 'QA Tester',
          performanceProfile: p
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [testers, testerProfilesMap]);

  const reportTotals = cujReport.totals;
  const totalFeaturesCount = reportTotals.testedCujCount;
  const criticalFeaturesCount = reportTotals.criticalCount;
  const warningFeaturesCount = reportTotals.warningCount;
  const healthyFeaturesCount = reportTotals.healthyCount;

  const criticalPct = reportTotals.criticalPct;
  const warningPct = reportTotals.warningPct;
  const healthyPct = reportTotals.healthyPct;

  const avgHealthScore = reportTotals.avgHealthScore;

  const totalStepsAcrossFeatures = reportTotals.stepsExecuted;
  const totalBugsAcrossFeatures = reportTotals.bugCount;

  const goldenRunsAnalysis = cujReport.golden;

  const buildDailySummaryPayload = () => {
    const featuresPayload = [...cujReport.testedMetrics, ...cujReport.bugOnlyMetrics].map(m => ({
      featureName: m.featureName,
      status: m.status,
      healthScorePct: m.healthScorePct,
      greenCount: m.greenCount,
      totalStepsExecuted: m.totalStepsExecuted,
      bugCount: m.associatedBugs.length,
      bugs: m.associatedBugs
    }));

    const allBugs = featuresPayload.flatMap(f => f.bugs);
    return { featuresPayload, allBugs, scopeContext: reportScopeContext };
  };

  /**
   * Builds the CUJ report. Pass `precomputedResult` (a pasted AI-chat reply) to skip
   * the Gemini API entirely - no key needed. When 0 bugs exist in scope, generates immediately without requiring an API key.
   */
  const handleExecuteCopyReport = async (
    skipKeyCheck: boolean = false,
    precomputedResult?: ExecutiveQAResult
  ): Promise<{ plainText: string; htmlText: string } | null> => {
    const { featuresPayload, allBugs, scopeContext } = buildDailySummaryPayload();

    // No API key: if there are bugs with notes to summarize, open AI Chat; if 0 bugs, generate directly!
    if (!skipKeyCheck && !precomputedResult && !getStoredGeminiApiKey() && allBugs.some(b => b.note && b.note.trim())) {
      openChatSummary();
      return null;
    }

    if (isGeneratingSummary) return null;
    setIsGeneratingSummary(true);

    const requestScopeKey = reportScopeKey;

    try {
      const result = precomputedResult ?? await generateBatchExecutiveSummaryWithGemini(featuresPayload, allBugs, scopeContext);

      if (reportScopeKeyRef.current !== requestScopeKey) {
        setSummaryToast({
          type: 'warning',
          message: '⚠️ The test plan or day changed while the summary was being generated, so it was discarded. Click "Generate Summary" again for the current view.'
        });
        setTimeout(() => setSummaryToast(null), 7000);
        return null;
      }

      const rejectedKeyHint = !precomputedResult && !skipKeyCheck && !result.modelUsed && allBugs.length > 0
        ? getGeminiKeyErrorHint(result.error)
        : null;
      if (rejectedKeyHint) {
        openChatSummary(`Your saved Gemini API key didn't work, so an AI chat is used instead. ${rejectedKeyHint}`);
        return null;
      }

      const overallGeminiSummary = result.overallSummary;
      const featureSummaryMap = result.featureSummaries;

      const getFeatureSummary = (metric: CujMetric): string => {
        const bugs = metric.associatedBugs;
        if (bugs.length === 0) {
          if (metric.redCount > 0 || metric.yellowCount > 0) {
            const count = metric.redCount + metric.yellowCount;
            return `${count} step failure${count > 1 ? 's' : ''}`;
          }
          return '';
        }

        let summary = featureSummaryMap[metric.featureName];
        if (!summary) {
          const match = Object.entries(featureSummaryMap).find(
            ([k]) => k.trim().toLowerCase() === metric.featureName.trim().toLowerCase()
          );
          if (match && match[1]) summary = match[1];
        }
        if (!summary) {
          summary = nlpCleanReword(bugs.map(b => b.note).filter(Boolean), metric.featureName);
        }
        return summary || '';
      };

      if (result.error && getStoredGeminiApiKey()) {
        console.warn('Gemini executive summary notice:', result.error);
      }

      const lookupByCuj = <T,>(map: Record<string, T> | undefined, name: string): T | undefined => {
        if (!map) return undefined;
        if (map[name] !== undefined) return map[name];
        const key = name.trim().toLowerCase();
        const match = Object.entries(map).find(([k]) => k.trim().toLowerCase() === key);
        return match ? match[1] : undefined;
      };

      const { plainText, htmlText } = buildCujReportText(cujReport, {
        dateLabel: reportDateLabel,
        disclaimer: reportDisclaimer,
        overallSummary: overallGeminiSummary,
        getSummary: getFeatureSummary,
        getIssues: metric => (metric.associatedBugs.length > 0 ? lookupByCuj(result.featureIssues, metric.featureName) : undefined),
        getFiledBugs: metric => lookupByCuj(result.featureFiledBugs, metric.featureName),
        otherFiledBugs: result.otherFiledBugs
      });

      const aiFeatureSummaries: Record<string, { summary: string; bugsKey: string }> = {};
      if (result.modelUsed) {
        [...cujReport.testedMetrics, ...cujReport.bugOnlyMetrics].forEach(m => {
          const summary = m.associatedBugs.length > 0 ? getFeatureSummary(m) : '';
          if (summary) aiFeatureSummaries[m.featureName] = { summary, bugsKey: makeBugsKey(m.associatedBugs) };
        });
      }

      setGeneratedReport({
        plainText,
        htmlText,
        generatedAt: Date.now(),
        scopeKey: requestScopeKey,
        modelUsed: result.modelUsed,
        aiError: result.modelUsed ? undefined : result.error,
        featureSummaries: aiFeatureSummaries
      });

      const cacheNote = result.fromCache ? ' (instant, cached)' : '';
      const hasApiKey = !!getStoredGeminiApiKey();
      const aiFailed = !result.modelUsed && !!result.error && hasApiKey;

      if (result.modelUsed) {
        setSummaryToast({
          type: 'success',
          message: `✨ AI Executive Summary generated with ${result.modelUsed}${cacheNote}. Click "Copy Report" when you're ready.`
        });
      } else if (aiFailed) {
        const keyHint = getGeminiKeyErrorHint(result.error);
        const shortError = result.error!.length > 180 ? `${result.error!.slice(0, 177)}...` : result.error;
        setSummaryToast({
          type: 'error',
          message: keyHint
            ? `⚠️ AI summary failed: ${keyHint} A basic offline summary was used - or click "AI Chat" to summarize without a key.`
            : `⚠️ AI summary failed (${shortError}). A basic offline summary was used instead - check your key and model in Gemini AI settings.`
        });
      } else if (!hasApiKey) {
        setSummaryToast({
          type: 'success',
          message: `📋 Synthesized CUJ report is ready to copy!`
        });
      } else {
        setSummaryToast({
          type: 'success',
          message: `📋 Clean synthesized CUJ report is ready to copy!`
        });
      }
      setTimeout(() => setSummaryToast(null), aiFailed ? 9000 : 5000);
      return { plainText, htmlText };
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleGenerateSummary = () => {
    handleExecuteCopyReport(false);
  };

  /** Has RX95 (the user's Jetski agent on their Cloudtop) write the executive summary. */
  const handleAskRx95 = async () => {
    if (rx95Elapsed !== null || isGeneratingSummary) return;
    const { featuresPayload, allBugs, scopeContext } = buildDailySummaryPayload();
    if (!allBugs.some(b => b.note && b.note.trim())) {
      // Nothing for an AI to summarize - build the clean report directly.
      await handleExecuteCopyReport(true);
      return;
    }
    const scopeAtStart = reportScopeKey;
    setRx95Elapsed(0);
    try {
      const { reply } = await requestRx95Summary(featuresPayload, scopeContext, s => setRx95Elapsed(s), undefined, { planId: reportScope.planId, date: reportScope.date });
      if (reportScopeKeyRef.current !== scopeAtStart) {
        setSummaryToast({ type: 'warning', message: '⚠️ The test plan or day changed while RX95 was writing, so its summary was discarded. Ask RX95 again for the current view.' });
        setTimeout(() => setSummaryToast(null), 7000);
        return;
      }
      const result = applyChatSummaryReply(featuresPayload, allBugs, reply, scopeContext);
      result.modelUsed = 'RX95';
      const report = await handleExecuteCopyReport(true, result);
      if (report) {
        setSummaryToast({ type: 'success', message: '🤖 RX95 wrote the executive summary. Click "Copy" when you\'re ready.' });
        setTimeout(() => setSummaryToast(null), 6000);
      }
    } catch (e: any) {
      setSummaryToast({ type: 'error', message: `⚠️ ${e?.message || 'RX95 could not write the summary.'} You can still use "AI Chat".` });
      setTimeout(() => setSummaryToast(null), 9000);
    } finally {
      setRx95Elapsed(null);
    }
  };

  /** Copies plain text, falling back to a hidden textarea when the async clipboard API is blocked. */
  const copyPlainText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
      return ok;
    }
  };

  const openChatSummary = (notice?: string) => {
    setChatStatus(null);
    setChatNotice(notice || null);
    setChatPromptCopied(false);
    setChatReplyText('');
    lastAutoCheckedReplyRef.current = '';
    setIsChatSummaryOpen(true);
    void handleCopyChatPrompt().then(copied => {
      if (copied && chatAutoOpenGemini) openGeminiChat();
    });
  };

  const openGeminiChat = () => {
    try {
      const tab = window.open(GEMINI_CHAT_URL, '_blank');
      if (tab) tab.opener = null;
    } catch (e) {}
  };

  const toggleChatAutoOpenGemini = (on: boolean) => {
    setChatAutoOpenGemini(on);
    try {
      localStorage.setItem(CHAT_AUTO_OPEN_GEMINI_KEY, on ? '1' : '0');
    } catch (e) {}
  };

  const handleCopyChatPrompt = async (): Promise<boolean> => {
    const { featuresPayload, allBugs, scopeContext } = buildDailySummaryPayload();
    const built = buildChatSummaryPrompt(featuresPayload, allBugs, scopeContext);
    if (!built) {
      setChatStatus({ type: 'error', message: `No bug notes were logged for ${scopeContext.scopeLabel}, so there is nothing for the AI to summarize.` });
      return false;
    }
    const copied = await copyPlainText(built.prompt);
    setChatPromptCopied(copied);
    setChatStatus(copied
      ? { type: 'success', message: `Prompt copied - ${built.bugCount} bug${built.bugCount === 1 ? '' : 's'} across ${built.cujCount} CUJ${built.cujCount === 1 ? '' : 's'} from ${scopeContext.scopeLabel}. Paste it into Gemini or Antigravity and send it.` }
      : { type: 'error', message: 'Your browser blocked the copy. Click "Copy prompt" again.' });
    return copied;
  };

  const handlePasteChatReplyFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setChatReplyText(text);
        setChatStatus(null);
        void handleChatReplyText(text, 'paste');
      } else {
        setChatStatus({ type: 'error', message: "Your clipboard is empty - copy the AI's reply first." });
      }
    } catch (e) {
      setChatStatus({ type: 'error', message: 'Your browser blocked clipboard access - click in the box and paste (⌘V / Ctrl+V) instead.' });
    }
  };

  const handleChatReplyText = async (text: string, source: 'auto' | 'paste') => {
    if (!text || !text.trim()) return;
    const { featuresPayload, allBugs, scopeContext } = buildDailySummaryPayload();

    if (source === 'auto') {
      if (text === lastAutoCheckedReplyRef.current) return;
      lastAutoCheckedReplyRef.current = text;
      if (isChatSummaryPrompt(text)) return;
      const replyId = getChatReplyReportId(text);
      if (!replyId) return;
      const current = buildChatSummaryPrompt(featuresPayload, allBugs, scopeContext);
      if (!current) return;
      if (replyId !== current.reportId) {
        setChatStatus({ type: 'error', message: 'The reply on your clipboard is for an older prompt - the test plan, day or bugs changed since it was copied. Copy the prompt again (step 1) and send the new one to the AI.' });
        return;
      }
    }

    let result: ExecutiveQAResult;
    try {
      result = applyChatSummaryReply(featuresPayload, allBugs, text, scopeContext);
    } catch (e: any) {
      setChatStatus({ type: 'error', message: e?.message || "Couldn't read the AI's reply." });
      return;
    }

    setIsChatSummaryOpen(false);
    setChatReplyText('');
    setChatStatus(null);
    setChatPromptCopied(false);
    const report = await handleExecuteCopyReport(true, result);
    if (report && await writeReportToClipboard(report.plainText, report.htmlText)) {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
      setSummaryToast({ type: 'success', message: '✨ AI summary built from the chat reply and copied to your clipboard - paste it anywhere.' });
    }
  };
  chatReplyHandlerRef.current = handleChatReplyText;

  const handleBuildReportFromChatReply = () => {
    void handleChatReplyText(chatReplyText, 'paste');
  };

  useEffect(() => {
    if (!isChatSummaryOpen) return;
    const checkClipboard = async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) chatReplyHandlerRef.current?.(text, 'auto');
      } catch (e) {}
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') || '';
      if (text.trim()) setTimeout(() => chatReplyHandlerRef.current?.(text, 'paste'), 0);
    };
    window.addEventListener('focus', checkClipboard);
    document.addEventListener('visibilitychange', checkClipboard);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('focus', checkClipboard);
      document.removeEventListener('visibilitychange', checkClipboard);
      document.removeEventListener('paste', onPaste);
    };
  }, [isChatSummaryOpen]);

  const writeReportToClipboard = async (plainText: string, htmlText: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        const htmlBlob = new Blob([htmlText], { type: 'text/html' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          })
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      return true;
    } catch (clipboardErr) {
      try {
        await navigator.clipboard.writeText(plainText);
        return true;
      } catch (fallbackErr) {
        const ta = document.createElement('textarea');
        ta.value = plainText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        return ok;
      }
    }
  };

  const handleCopyGeneratedReport = async () => {
    if (!generatedReport || generatedReport.scopeKey !== reportScopeKey) {
      handleGenerateSummary();
      return;
    }

    await writeReportToClipboard(generatedReport.plainText, generatedReport.htmlText);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2500);
  };

  const handleCopyVisualImageToClipboard = async () => {
    if (!isFeatureReportExpanded) {
      setIsFeatureReportExpanded(true);
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    if (!visualCardRef.current) return;
    try {
      const blob = await toBlob(visualCardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        width: 1400,
        style: {
          width: '1400px',
          maxWidth: '1400px',
          padding: '40px',
          borderRadius: '32px',
          backgroundColor: '#111827',
        },
        filter: (node) => {
          if (node instanceof HTMLElement && node.classList.contains('no-capture')) {
            return false;
          }
          return true;
        }
      });

      if (!blob) return;

      // Download PNG file directly (append to DOM for cross-browser compatibility)
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `QA_Quality_Profile_${getLocalDateStr(new Date())}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      // Also copy PNG blob to clipboard if browser allows
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
        }
      } catch (err) {}

      setCopiedImage(true);
      setTimeout(() => setCopiedImage(false), 2500);
    } catch (err) {
      console.error('Failed to export PNG image:', err);
    }
  };

  // Tester options for the Bugs tab Tester multi-select filter, with bug counts (sorted by count descending)
  const bugTesterOptions = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; devices: Set<string>; p0Count: number; p1Count: number }>();
    bugLogs.forEach(b => {
      const rawName = (b.testerName || (b as any).reporter || '').trim() || 'Unknown';
      const key = rawName.toLowerCase();
      let entry = counts.get(key);
      if (!entry) {
        entry = { name: rawName, count: 0, devices: new Set<string>(), p0Count: 0, p1Count: 0 };
        counts.set(key, entry);
      }
      entry.count += 1;
      if (b.deviceName && b.deviceName.trim()) entry.devices.add(b.deviceName.trim());
      const prio = bugCategorizations[b.id]?.priority || b.priority || (b.severity === 'critical' ? 'P0' : b.severity === 'high' ? 'P1' : 'P2');
      if (prio === 'P0' || String(prio) === '0') entry.p0Count += 1;
      else if (prio === 'P1' || String(prio) === '1') entry.p1Count += 1;
    });
    return Array.from(counts.values())
      .map(x => ({
        name: x.name,
        count: x.count,
        devices: Array.from(x.devices),
        p0Count: x.p0Count,
        p1Count: x.p1Count
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [bugLogs, bugCategorizations]);

  // Filter & Sort Bug Logs (memoized and null-safe)
  const processedBugs = useMemo(() => {
    let list = bugLogs.map(b => {
      const cat = bugCategorizations[b.id];
      return {
        ...b,
        bugType: cat?.bugType || b.bugType || 'Bug',
        priority: cat?.priority || b.priority || (b.severity === 'critical' ? 'P0' : b.severity === 'high' ? 'P1' : 'P2'),
        status: cat?.status || b.status
      };
    });

    if (selectedPlanFilter !== 'all') {
      list = list.filter(b => bugPlanLookup(b).planId === selectedPlanFilter);
    }

    if (selectedTesterFilters.length > 0) {
      const wanted = new Set(selectedTesterFilters.map(t => t.toLowerCase().trim()));
      list = list.filter(b => {
        const tName = ((b.testerName || (b as any).reporter || '').trim() || 'Unknown').toLowerCase();
        return wanted.has(tName);
      });
    }

    if (selectedDeviceFilter !== 'all') {
      list = list.filter(
        b => (b.deviceName || 'Unspecified').toLowerCase() === selectedDeviceFilter.toLowerCase()
      );
    }

    if (selectedFeatureFilter !== 'all') {
      list = list.filter(
        b => (b.feature || 'General').toLowerCase() === selectedFeatureFilter.toLowerCase()
      );
    }

    if (selectedDateFilter !== 'all') {
      const now = new Date();
      const todayDateStr = getLocalDateStr(now);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDateStr = getLocalDateStr(yesterday);

      list = list.filter(b => {
        if (!b.timestamp) return false;
        const bugDate = new Date(b.timestamp);
        if (isNaN(bugDate.getTime())) return false;
        const bugLocalDay = getLocalDateStr(bugDate);

        if (selectedDateFilter === 'today') {
          return bugLocalDay === todayDateStr;
        }
        if (selectedDateFilter === 'yesterday') {
          return bugLocalDay === yesterdayDateStr;
        }
        if (selectedDateFilter === '7days') {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
          return bugDate >= sevenDaysAgo;
        }
        if (selectedDateFilter === '30days') {
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
          return bugDate >= thirtyDaysAgo;
        }
        if (selectedDateFilter === 'custom' && customDateInput) {
          return bugLocalDay === customDateInput.trim();
        }
        return true;
      });
    }

    if (searchBugQuery.trim()) {
      const q = searchBugQuery.toLowerCase();
      list = list.filter(b =>
        (b.title || '').toLowerCase().includes(q) ||
        (b.note || '').toLowerCase().includes(q) ||
        (b.stepTitle || '').toLowerCase().includes(q) ||
        (b.testerName || '').toLowerCase().includes(q) ||
        (b.feature || '').toLowerCase().includes(q) ||
        (b.deviceName || '').toLowerCase().includes(q)
      );
    }

    const testerCounts = new Map<string, number>();
    if (sortByDevice === 'tester-most') {
      list.forEach(b => {
        const k = ((b.testerName || (b as any).reporter || '').trim() || 'Unknown').toLowerCase();
        testerCounts.set(k, (testerCounts.get(k) || 0) + 1);
      });
    }

    list.sort((a, b) => {
      if (sortByDevice === 'tester-asc') {
        const aT = (a.testerName || (a as any).reporter || 'Unknown').trim();
        const bT = (b.testerName || (b as any).reporter || 'Unknown').trim();
        const cmp = aT.localeCompare(bT, undefined, { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
      }
      if (sortByDevice === 'tester-most') {
        const aT = ((a.testerName || (a as any).reporter || '').trim() || 'Unknown').toLowerCase();
        const bT = ((b.testerName || (b as any).reporter || '').trim() || 'Unknown').toLowerCase();
        const diff = (testerCounts.get(bT) || 0) - (testerCounts.get(aT) || 0);
        if (diff !== 0) return diff;
        const nameCmp = aT.localeCompare(bT, undefined, { sensitivity: 'base' });
        if (nameCmp !== 0) return nameCmp;
      }
      if (sortByDevice === 'device-asc') {
        return (a.deviceName || 'Unspecified').localeCompare(b.deviceName || 'Unspecified');
      }
      if (sortByDevice === 'device-desc') {
        return (b.deviceName || 'Unspecified').localeCompare(a.deviceName || 'Unspecified');
      }
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      const safeATime = isNaN(aTime) ? 0 : aTime;
      const safeBTime = isNaN(bTime) ? 0 : bTime;
      if (sortByDevice === 'oldest') {
        return safeATime - safeBTime;
      }
      if (sortByDevice === 'priority' || (sortByDevice as any) === 'severity') {
        const prioMap: Record<string, number> = { P0: 3, '0': 3, P1: 2, '1': 2, P2: 1, '2': 1 };
        const aPrio = bugCategorizations[a.id]?.priority || a.priority || (a.severity === 'critical' ? 'P0' : a.severity === 'high' ? 'P1' : 'P2');
        const bPrio = bugCategorizations[b.id]?.priority || b.priority || (b.severity === 'critical' ? 'P0' : b.severity === 'high' ? 'P1' : 'P2');
        return (prioMap[bPrio] || 0) - (prioMap[aPrio] || 0);
      }
      return safeBTime - safeATime;
    });

    return list;
  }, [bugLogs, bugCategorizations, selectedPlanFilter, bugPlanLookup, selectedTesterFilters, selectedDeviceFilter, selectedFeatureFilter, selectedDateFilter, customDateInput, searchBugQuery, sortByDevice]);

  // ---------- RX95 same-day duplicate groups (Bugs Feed) ----------
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => loadDismissed());
  const [expandedFeedBundles, setExpandedFeedBundles] = useState<Set<string>>(new Set());
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  // Bug ids being bundled right now (guards a fast double-click before React re-renders)
  const bundlingIdsRef = useRef<Set<string>>(new Set());
  const planNameById = (id?: string) => testPlans.find(p => p.id === id)?.name;

  /** Suggestions limited to the reports the feed currently shows (plan/date/search filters), hotlist-safe. */
  const feedSuggestions = useMemo<ShownSuggestion[]>(() => {
    const visibleIds = new Set(processedBugs.map(b => b.id));
    return shownSuggestions(rx95Suggestions?.sets || [], bugLogs.filter(b => visibleIds.has(b.id)), dismissedSuggestions, planNameById);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rx95Suggestions, bugLogs, dismissedSuggestions, processedBugs, testPlans]);
  const processedBugById = useMemo(() => new Map<string, BugLog>(processedBugs.map(b => [b.id, b as BugLog])), [processedBugs]);
  /** Buganizer tab gets the feed's Bug Type / Priority / Status (this browser's choices win), so mega-bug drafts and Repro'd status use them. */
  const buganizerBugs = useMemo(() => bugLogs.map(b => {
    const cat = bugCategorizations[b.id];
    if (!cat || (!cat.bugType && !cat.priority && !cat.status)) return b;
    return { ...b, bugType: cat.bugType || b.bugType, priority: cat.priority || b.priority, status: cat.status || b.status };
  }), [bugLogs, bugCategorizations]);
  const suggestionByBugId = useMemo(() => {
    const m = new Map<string, ShownSuggestion>();
    feedSuggestions.forEach(x => x.members.forEach(b => m.set(b.id, x)));
    return m;
  }, [feedSuggestions]);

  const jumpToSuggestion = (sugId: string) => {
    const go = () => {
      const el = document.getElementById(`feed-sug-${sugId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-violet-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-violet-400'), 1400);
    };
    setFeedTab('suggestions');
    if (suggestionsCollapsed) setSuggestionsCollapsed(false);
    setTimeout(go, 80);
  };

  /** Option A: one category for every ticked report, then bundle them into one bug. */
  const handleCategorizeAndBundle = (members: BugLog[], title: string, summary: string | undefined, cat: GroupCategory) => {
    const current = members.map(m => bugById.get(m.id) || m).filter(isBundleable);
    if (current.some(m => bundlingIdsRef.current.has(m.id))) return; // second click of a double-click
    if (current.length < 2) return flashFeed('Pick at least two unfiled reports to bundle.');
    if (!sameHotlist(current, planNameById)) return flashFeed("Can't bundle these: they're from test plans linked to different hotlists.");
    current.forEach(m => bundlingIdsRef.current.add(m.id));
    setTimeout(() => current.forEach(m => bundlingIdsRef.current.delete(m.id)), 3000);
    const bundle = newBundle(current.map(m => m.id), title, summary, 'rx95');
    setBugCategorizations(prev => {
      const updated = { ...prev };
      current.forEach(m => { updated[m.id] = { ...(prev[m.id] || {}), bugType: cat.bugType, priority: cat.priority, status: cat.status }; });
      try { localStorage.setItem('qa_bug_categorizations', JSON.stringify(updated)); } catch (e) {}
      return updated;
    });
    const patch = { bugType: cat.bugType, priority: cat.priority, status: cat.status, bundle, reviewed: reviewedNow('reviewed') };
    if (onPatchBugLogs) onPatchBugLogs(Object.fromEntries(current.map(m => [m.id, patch])));
    else if (onUpdateBugLog) onUpdateBugLog(current.map(m => ({ ...m, ...patch })));
    flashFeed(`Set ${cat.bugType} · ${cat.priority} · ${cat.status} on ${current.length} reports and bundled them into one bug.`);
  };

  const unbundleFromFeed = (bundleId: string) => {
    const members = bugLogs.filter(b => b.bundle?.id === bundleId);
    if (!members.length) return;
    if (onPatchBugLogs) onPatchBugLogs(Object.fromEntries(members.map(m => [m.id, { bundle: undefined }])));
    else if (onUpdateBugLog) onUpdateBugLog(members.map(m => ({ ...m, bundle: undefined })));
    flashFeed(`Unbundled ${members.length} reports. Their categories stay as set.`);
  };

  type FeedBug = (typeof processedBugs)[number];
  type FeedRow = { kind: 'bug'; bug: FeedBug } | { kind: 'bundle'; id: string; members: FeedBug[] };
  const reviewedOf = (b: BugLog) => isReviewed(bugById.get(b.id) || b, bugCategorizations[b.id]);
  /** Bundled reports collapse into one row (placed where the first visible member would be). */
  const buildFeedRows = (list: FeedBug[]): FeedRow[] => {
    const rows: FeedRow[] = [];
    const bundleRows = new Map<string, { kind: 'bundle'; id: string; members: FeedBug[] }>();
    list.forEach(b => {
      const bid = b.bundle?.id;
      if (!bid) { rows.push({ kind: 'bug', bug: b }); return; }
      let row = bundleRows.get(bid);
      if (!row) { row = { kind: 'bundle', id: bid, members: [] }; bundleRows.set(bid, row); rows.push(row); }
      row.members.push(b);
    });
    // A bundle with only one visible member (others filtered out) shows as a normal row
    return rows.map(r => (r.kind === 'bundle' && r.members.length === 1 ? { kind: 'bug', bug: r.members[0] } as FeedRow : r));
  };
  const newFeedBugs = useMemo(() => processedBugs.filter(b => !reviewedOf(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [processedBugs, bugById, bugCategorizations]);
  const reviewedFeedBugs = useMemo(() => processedBugs.filter(b => reviewedOf(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [processedBugs, bugById, bugCategorizations]);
  const feedRows = useMemo<FeedRow[]>(() => {
    if (feedTab === 'reviewed') return buildFeedRows(reviewedFeedBugs);
    const visibleNew = processedBugs.filter(
      b =>
        !reviewedOf(b) ||
        (stickyNewBugIds.has(b.id) && (!!expandedBugIds[b.id] || focusedBugId === b.id))
    );
    return buildFeedRows(visibleNew);
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedTab, newFeedBugs, reviewedFeedBugs, processedBugs, stickyNewBugIds, expandedBugIds, focusedBugId]);

  /** Opens a report on the Bugs Feed (from the Buganizer tab): its tab, expanded, scrolled into view. */
  const openInFeed = (bugId?: string) => {
    setBugsView('feed');
    if (!bugId) { setFeedTab('suggestions'); setSuggestionsCollapsed(false); return; }
    const b = bugById.get(bugId);
    if (!b) return;
    if (!processedBugs.some(x => x.id === bugId)) flashFeed('That report is hidden by the current plan / day / search filters.');
    setFeedTab(reviewedOf(b) ? 'reviewed' : 'new');
    setExpandedBugIds(prev => ({ ...prev, [bugId]: true }));
    if (b.bundle?.id) setExpandedFeedBundles(prev => new Set(prev).add(b.bundle!.id));
    setTimeout(() => {
      const el = document.getElementById(`feed-row-${bugId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-2', 'ring-blue-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 1600);
    }, 120);
  };
  const openInBuganizer = (bugId: string) => {
    setBugsView('buganizer');
    setBuganizerFocus({ id: bugId, n: Date.now() });
  };

  // Filter plans by search query (memoized and null-safe)
  const filteredPlans = useMemo(() => {
    const q = searchPlanQuery.trim().toLowerCase();
    if (!q) return testPlans;
    return testPlans.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.steps || []).some(s =>
        (s?.title || '').toLowerCase().includes(q) ||
        (s?.feature || '').toLowerCase().includes(q) ||
        (s?.description || '').toLowerCase().includes(q) ||
        (s?.expectedOutcome || (s as any)?.expectedResult || '').toLowerCase().includes(q)
      )
    );
  }, [testPlans, searchPlanQuery]);

  // Stats calculation
  const totalPlans = testPlans.length;
  const activeRuns = liveInProgressRuns.length;
  const totalBugs = bugLogs.length;
  const unreviewedBugsCount = useMemo(
    () => bugLogs.filter(b => !isReviewed(b, bugCategorizations[b.id])).length,
    [bugLogs, bugCategorizations]
  );

  const assignedDevices = useMemo(
    () =>
      devices.filter(
        d =>
          d.quotas &&
          d.quotas.some(
            q => q.planId && (q.targetRunsPerDay || 0) > 0 && testPlans.some(p => p.id === q.planId)
          )
      ),
    [devices, testPlans]
  );
  const unassignedDevices = useMemo(
    () =>
      devices.filter(
        d =>
          !d.quotas ||
          !d.quotas.some(
            q => q.planId && (q.targetRunsPerDay || 0) > 0 && testPlans.some(p => p.id === q.planId)
          )
      ),
    [devices, testPlans]
  );
  const activeOrTestedTodayCount = useMemo(() => {
    return unifiedTesters.filter(t => {
      const testerKey = t.name.toLowerCase().trim();
      if (activeTesterMap.has(testerKey)) return true;
      const profile = t.performanceProfile;
      const dayRuns = selectedQaDate === 'all'
        ? (profile?.allTimeCompletedCount || 0)
        : (profile?.dailyStats[selectedQaDate]?.completedCount || 0);
      if (dayRuns > 0) return true;
      return bugLogs.some(b => {
        const bTester = ((b.testerName || (b as any).reporter || '') as string).toLowerCase().trim();
        if (bTester !== testerKey) return false;
        return selectedQaDate === 'all' ? true : getLocalDateStr(b.timestamp) === selectedQaDate;
      });
    }).length;
  }, [unifiedTesters, activeTesterMap, selectedQaDate, bugLogs]);


  return {
    activeTab,
    setActiveTab,
    bugsView,
    setBugsView,
    selectedQaDate,
    setSelectedQaDate,
    expandedPlanSteps,
    setExpandedPlanSteps,
    subagentToast,
    setSubagentToast,
    reportDisclaimer,
    setReportDisclaimer,
    newDeviceName,
    setNewDeviceName,
    newPersonName,
    setNewPersonName,
    newPersonRole,
    setNewPersonRole,
    testerViewMode,
    setTesterViewMode,
    selectedInspectorTester,
    setSelectedInspectorTester,
    showOffShiftTesters,
    setShowOffShiftTesters,
    quickActivateDeviceId,
    setQuickActivateDeviceId,
    quickActivatePlanId,
    setQuickActivatePlanId,
    quickActivateQuota,
    setQuickActivateQuota,
    inspectorTarget,
    setInspectorTarget,
    isFloorMenuOpen,
    setIsFloorMenuOpen,
    isActivateTileOpen,
    setIsActivateTileOpen,
    floorMenuRef,
    formatOngoingDuration,
    liveInProgressRuns,
    activeTesterMap,
    todayRunsMap,
    fleetProgress,
    expandedBugIds,
    feedTab,
    setFeedTab,
    setStickyNewBugIds,
    feedToast,
    flashFeed,
    buganizerFocus,
    setBuganizerFocus,
    feedNow,
    feedDraftFor,
    feedDirty,
    setFeedDraft,
    cancelFeedEdit,
    saveFeedEdit,
    markReviewed,
    moveToNew,
    toggleBugExpand,
    searchBugQuery,
    setSearchBugQuery,
    searchPlanQuery,
    setSearchPlanQuery,
    selectedDeviceFilter,
    setSelectedDeviceFilter,
    selectedFeatureFilter,
    setSelectedFeatureFilter,
    selectedDateFilter,
    setSelectedDateFilter,
    selectedPlanFilter,
    setSelectedPlanFilter,
    customDateInput,
    setCustomDateInput,
    sortByDevice,
    setSortByDevice,
    feedGroupBy,
    setFeedGroupBy,
    selectedTesterFilters,
    setSelectedTesterFilters,
    isTesterFilterOpen,
    setIsTesterFilterOpen,
    focusedBugId,
    setFocusedBugId,
    bugTesterOptions,
    visualCardRef,
    newFeatureInput,
    setNewFeatureInput,
    isFeatureReportExpanded,
    setIsFeatureReportExpanded,
    isBugFilterMenuOpen,
    setIsBugFilterMenuOpen,
    copiedReport,
    copiedImage,
    setCopiedImage,
    isGeneratingSummary,
    rx95Elapsed,
    generatedReport,
    isApiKeyModalOpen,
    setIsApiKeyModalOpen,
    tempApiKey,
    setTempApiKey,
    tempModel,
    setTempModel,
    isTestingKey,
    setIsTestingKey,
    testKeyStatus,
    setTestKeyStatus,
    summaryToast,
    isChatSummaryOpen,
    setIsChatSummaryOpen,
    chatReplyText,
    setChatReplyText,
    chatPromptCopied,
    chatStatus,
    setChatStatus,
    chatNotice,
    chatAutoOpenGemini,
    selectedImagePreviewUrl,
    setSelectedImagePreviewUrl,
    bugCategorizations,
    bugById,
    filedIssueDrafts,
    setFiledIssueDrafts,
    handleUpdateBugCategorization,
    handleCreateFeatureSubmit,
    fileInputRef,
    handleJSONFileImport,
    uniqueDevices,
    uniqueFeatures,
    bugPlanOptions,
    todayStr,
    selectedDailySessionDate,
    setSelectedDailySessionDate,
    setSelectedReportPlanId,
    reportPlanId,
    latestReportDate,
    recordedDailySessions,
    planPickerOptions,
    allPlansRunCount,
    reportPlanLabel,
    reportDayDisplayLabel,
    reportDayPhrase,
    hasCurrentReport,
    historicalTimelinePoints,
    featureMetricsList,
    bugOnlyMetrics,
    untestedCujNames,
    allQaDatesList,
    unifiedTesters,
    totalFeaturesCount,
    criticalFeaturesCount,
    warningFeaturesCount,
    healthyFeaturesCount,
    criticalPct,
    warningPct,
    healthyPct,
    avgHealthScore,
    totalStepsAcrossFeatures,
    totalBugsAcrossFeatures,
    goldenRunsAnalysis,
    handleExecuteCopyReport,
    handleGenerateSummary,
    handleAskRx95,
    openChatSummary,
    toggleChatAutoOpenGemini,
    handleCopyChatPrompt,
    handlePasteChatReplyFromClipboard,
    handleBuildReportFromChatReply,
    handleCopyGeneratedReport,
    handleCopyVisualImageToClipboard,
    processedBugs,
    dismissedSuggestions,
    setDismissedSuggestions,
    expandedFeedBundles,
    setExpandedFeedBundles,
    suggestionsCollapsed,
    setSuggestionsCollapsed,
    feedSuggestions,
    processedBugById,
    buganizerBugs,
    suggestionByBugId,
    jumpToSuggestion,
    handleCategorizeAndBundle,
    unbundleFromFeed,
    reviewedOf,
    newFeedBugs,
    reviewedFeedBugs,
    feedRows,
    openInFeed,
    openInBuganizer,
    filteredPlans,
    totalPlans,
    activeRuns,
    totalBugs,
    unreviewedBugsCount,
    unassignedDevices,
    activeOrTestedTodayCount
  };
}
