import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, DevicePlanQuota, RefinedBugText, ReproMatches } from '../types';
import { REPROD, TRIAGE_STATUS_OPTIONS, currentReproMatches, effectiveFiled, effectiveStatus, filedPatch, filedStampLine, newFiled, normalizeIssueId } from '../utils/reproFollowUp';
import { ListChecks, Bug, Clock, Plus, Play, Trash2, Smartphone, CheckCircle2, AlertTriangle, XCircle, Download, User, Filter, ArrowUpDown, Tag, Activity, Copy, FileJson, Upload, Search, Image as ImageIcon, Sparkles, X, Calendar, Edit, BarChart2, Camera, TrendingUp, TrendingDown, History, ChevronDown, ChevronUp, RefreshCw, UserCheck, Timer, Layers, FileSpreadsheet, ExternalLink, MessageSquareText, ClipboardPaste, Bot } from 'lucide-react';
import { exportAllQADataToCSV, exportAllQADataToJSON } from '../utils/exportUtils';
import { TabBar, Rx95LiveChip, TAG_STYLE, chipCls, chipOff, chipOn, expandedCls, inputCls, labelCls, listBoxCls, priTagCls, rowActionCls, rowCls, rowOpenCls, smallBtnCls, tagCls } from './triageUi';
import { isReviewed, isStronglyReviewed, reviewedNow } from '../utils/bugReview';
import { currentRefinement } from '../utils/bugRefine';
import { isRunFullyCompleted, buildStepFirstSeenIndex } from '../utils/runUtils';
import { toLocalHHMM, withBugTime } from '../utils/bugTime';
import { ALL_PLANS, ALL_DATES, mergeRunsById, getKnownCujNames, computeCujReport, listReportDates, buildTimelinePoints, getPlanPickerOptions, buildCujReportText, buildReportScopeKey, formatReportDateLabel } from '../utils/cujReportUtils';
import type { CujMetric } from '../utils/cujReportUtils';
import { summarizeFeatureBugsWithGemini, summarizeOverallBugsWithGemini, generateBatchExecutiveSummaryWithGemini, getBriefIssueSummarySync, nlpCleanReword, getStoredGeminiApiKey, saveGeminiApiKey, GEMINI_MODELS, getStoredGeminiModel, saveGeminiModel, discoverAvailableGeminiModels, rankModelsForSummaries, DEFAULT_GEMINI_MODEL, getGeminiKeyErrorHint, buildChatSummaryPrompt, applyChatSummaryReply, isChatSummaryPrompt, getChatReplyReportId } from '../services/geminiService';
import { requestRx95Summary, isRx95Available } from '../services/rx95Service';
import BuganizerTriage from './BuganizerTriage';
import BundleSuggestionsPanel, { type GroupCategory } from './BundleSuggestionsPanel';
import { type ShownSuggestion, isBundleable, loadDismissed, newBundle, sameHotlist, shownSuggestions } from '../utils/bundleDraft';

/** Buganizer triage view: on by default; set VITE_BUGANIZER_ENABLED=0 to hide it. */
const BUGANIZER_ENABLED = ((import.meta as any).env?.VITE_BUGANIZER_ENABLED || '') !== '0';
import type { ExecutiveQAResult, SummaryScopeContext } from '../services/geminiService';
import { GOOGLE_APPS_SCRIPT_CODE } from '../googleAppsScriptCode';
import { toBlob } from 'html-to-image';
import type { Rx95SuggestionsData } from '../services/supabaseService';

/** Identifies an exact set of bugs and their notes, so a stored AI summary is invalidated when notes/titles change. */
const makeBugsKey = (bugs: BugLog[]): string =>
  bugs.map(b => `${b.id}:${b.stepTitle || ''}:${b.note || ''}`).sort().join('|');

/** Gemini web app used by the "AI Chat" summary flow (no API key needed). */
const GEMINI_CHAT_URL = 'https://gemini.google.com/app';
/** localStorage flag: open Gemini in a new tab whenever the AI chat flow starts. */
const CHAT_AUTO_OPEN_GEMINI_KEY = 'qa_chat_auto_open_gemini';

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
  onImportJSONData: (data: { testPlans?: TestPlan[]; testRuns?: TestRun[]; bugLogs?: BugLog[]; archivedRuns?: TestRun[] }) => void;
  onAddFeature?: (featureName: string) => void;
  onDeleteFeature?: (featureName: string) => void;
  onDeleteTestRun?: (runId: string) => void;
  onBootTester?: (runId: string, deviceId?: string, testerName?: string, deviceName?: string) => void;
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
}

const getLocalDateStr = (dateInput?: string | Date) => {
  if (dateInput === '') return '';
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const d = dateInput !== undefined ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  onClearAllData,
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
  onUpdateMinAppVersion
}) => {
  const defaultTodayStr = getLocalDateStr(new Date());
  const [activeTab, setActiveTab] = useState<'overview' | 'devices' | 'testers' | 'features' | 'bugs'>('overview');
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
  const liveInProgressRuns = useMemo(() => {
    const currentTodayStr = getLocalDateStr(new Date());
    return testRuns.filter(
      r =>
        r &&
        r.id &&
        !archivedIdSet.has(r.id) &&
        r.status === 'in_progress' &&
        getEffectiveRunStatus(r) === 'in_progress' &&
        (!r.startedAt || getLocalDateStr(r.startedAt) === currentTodayStr)
    );
  }, [testRuns, archivedIdSet]);

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
  const todayRunsMap = useMemo(() => {
    const todayStr = getLocalDateStr(new Date());
    const map: Record<string, Record<string, number>> = {};
    
    mergedRuns.forEach(run => {
      // Only runs that recorded every step that existed when they finished count toward quota
      if (!run.completedAt || !isRunFullyCompleted(run, testPlans, stepFirstSeen)) return;

      const runDate = getLocalDateStr(run.completedAt);
      if (runDate !== todayStr) return;
      
      const targetDev = devices.find(d => 
        (run.deviceId && d.id.toLowerCase().trim() === run.deviceId.toLowerCase().trim()) ||
        (run.deviceName && d.name && d.name.toLowerCase().trim() === run.deviceName.toLowerCase().trim())
      );
      if (targetDev) {
        if (!map[targetDev.id]) map[targetDev.id] = {};
        map[targetDev.id][run.planId] = (map[targetDev.id][run.planId] || 0) + 1;
      }
    });
    return map;
  }, [mergedRuns, devices, testPlans, stepFirstSeen]);

  const fleetProgress = useMemo(() => {
    const validPlanIds = new Set(testPlans.map(p => p.id));
    let totalTarget = 0;
    let totalCompleted = 0;
    devices.forEach(dev => {
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
  }, [devices, todayRunsMap, testPlans]);

  const toggleTesterExpand = (testerName: string) => {
    setExpandedTesters(prev => ({
      ...prev,
      [testerName]: !prev[testerName]
    }));
  };

  const [expandedBugIds, setExpandedBugIds] = useState<Record<string, boolean>>({});
  // Bugs Feed tabs (New / Bundle Suggestions / Reviewed) and links to and from the Buganizer tab
  const [feedTab, setFeedTab] = useState<'new' | 'suggestions' | 'reviewed'>('new');
  const [buganizerFocus, setBuganizerFocus] = useState<{ id: string; n: number } | null>(null);
  const [feedNow, setFeedNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setFeedNow(Date.now()), 10000); return () => clearInterval(t); }, []);
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
    onUpdateBugLog(withBugTime({ ...bug, title: title || undefined, note }, d.time));
    markReviewed(bug.id);
    cancelFeedEdit(bug.id);
  };

  // Bugs Feed review state (New / Reviewed). Written with the targeted patch (bug_logs.reviewed), never by RX95.
  const markReviewed = (bugId: string) => onPatchBugLog?.(bugId, { reviewed: reviewedNow('reviewed') });
  const moveToNew = (bugId: string) => onPatchBugLog?.(bugId, { reviewed: reviewedNow('new') });

  const toggleBugExpand = (bugId: string) => {
    setExpandedBugIds(prev => ({
      ...prev,
      [bugId]: !prev[bugId]
    }));
  };

  // Search & Filter State
  const [searchBugQuery, setSearchBugQuery] = useState<string>('');
  const [searchPlanQuery, setSearchPlanQuery] = useState<string>('');
  const [selectedDeviceFilter, setSelectedDeviceFilter] = useState<string>('all');
  const [selectedFeatureFilter, setSelectedFeatureFilter] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');
  const [selectedPlanFilter, setSelectedPlanFilter] = useState<string>('all');
  const [customDateInput, setCustomDateInput] = useState<string>('');
  const [sortByDevice, setSortByDevice] = useState<'newest' | 'oldest' | 'device-asc' | 'device-desc' | 'priority' | 'severity'>('newest');
  
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
  const [isVisualSnapshotModalOpen, setIsVisualSnapshotModalOpen] = useState<boolean>(false);
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState<string | null>(null);

  // Google Sheets Integration & Smart Categorization Settings
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
      // Setting type / priority / status is a review
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

  const [googleSheetUrl, setGoogleSheetUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('qa_google_sheet_url') || 'https://script.google.com/a/macros/google.com/s/AKfycbzMH5O3zxz5mHQrQzH5gqc62jssceuXszuKxxRmnHMuj4Pq0AyEVRzrrv_OUrM7B5GlsA/exec';
    } catch (e) {
      return 'https://script.google.com/a/macros/google.com/s/AKfycbzMH5O3zxz5mHQrQzH5gqc62jssceuXszuKxxRmnHMuj4Pq0AyEVRzrrv_OUrM7B5GlsA/exec';
    }
  });

  const [autoSyncSheet, setAutoSyncSheet] = useState<boolean>(() => {
    try {
      return localStorage.getItem('qa_auto_sync_sheet') === 'true';
    } catch (e) {
      return false;
    }
  });

  const [isSheetModalOpen, setIsSheetModalOpen] = useState<boolean>(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);
  const [sheetSyncStatus, setSheetSyncStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [copiedCodeGs, setCopiedCodeGs] = useState<boolean>(false);

  const handleSyncToGoogleSheet = async (bugsToSync: BugLog[] = bugLogs, silent = false) => {
    if (bugsToSync.length === 0) {
      if (!silent) setSheetSyncStatus({ success: false, message: 'No bugs found to sync.' });
      return;
    }
    const trimmedSheetUrl = (googleSheetUrl || '').trim();
    if (!trimmedSheetUrl.startsWith('https://script.google.com/')) {
      if (!silent) {
        setSheetSyncStatus({
          success: false,
          message: 'Invalid Google Apps Script URL. Must begin with https://script.google.com/.'
        });
      }
      return;
    }
    if (!silent) {
      setIsSyncingSheet(true);
      setSheetSyncStatus(null);
    }
    try {
      const planMap = new Map(testPlans.map(p => [p.id, p.name]));
      const enrichedPayload = bugsToSync.map(b => {
        const cat = bugCategorizations[b.id];
        const resolvedPlanName = (b.planId && planMap.get(b.planId)) || (b as any).planName || 'General QA';
        return {
          ...b,
          planName: resolvedPlanName,
          // Strip base64 data URLs so serverless proxy body limit is never exceeded
          imageUrl: (b.imageUrl && b.imageUrl.startsWith('data:')) ? undefined : b.imageUrl,
          bugType: cat?.bugType || b.bugType || 'Bug',
          priority: cat?.priority || b.priority || (b.severity === 'critical' ? 'P0' : b.severity === 'high' ? 'P1' : 'P2'),
          // Sheet column: 'Filed' when stamped (or legacy), else New / Repro'd Issue
          status: effectiveFiled(b) ? 'Filed' : effectiveStatus(cat?.status || b.status)
        };
      });

      let success = false;
      let respMsg = '';

      // 1. Try serverless proxy first
      try {
        const res = await fetch('/api/sync-sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptUrl: trimmedSheetUrl, bugs: enrichedPayload })
        });
        const data = await res.json();
        if (
          res.ok &&
          data.status === 'success' &&
          data.result?.status !== 'error' &&
          !data.result?.raw?.includes('Sign in')
        ) {
          success = true;
          respMsg = data.result?.message || `Successfully synced ${enrichedPayload.length} bug(s) to Google Sheets!`;
          if (onUpdateBugLog) {
            const markedSynced = bugsToSync.map(b => {
              const cat = bugCategorizations[b.id];
              return {
                ...b,
                syncedToSheet: true,
                // No defaults stamped onto the bug (they'd look like a person's triage); the sheet gets defaults above
                bugType: cat?.bugType || b.bugType,
                priority: cat?.priority || b.priority,
                status: cat?.status || b.status
              };
            });
            onUpdateBugLog(markedSynced);
          }
        } else if (data?.result?.message || data?.error) {
          respMsg = data?.result?.message || data?.error;
        }
      } catch (err) {
        if (!silent) console.warn('Proxy sync failed:', err);
      }

      if (!silent) {
        if (success) {
          setSheetSyncStatus({ success: true, message: respMsg || `Successfully synced ${enrichedPayload.length} bug(s)!` });
        } else {
          setSheetSyncStatus({
            success: false,
            message: respMsg || 'Could not reach Google Apps Script POST endpoint via /api/sync-sheet. Verify your Web App URL and deployment permissions.'
          });
        }
      }
    } catch (e: any) {
      if (!silent) {
        setSheetSyncStatus({ success: false, message: e.message || 'Sync failed.' });
      }
    } finally {
      if (!silent) {
        setIsSyncingSheet(false);
      }
    }
  };

  const bugLogsLatestRef = useRef<BugLog[]>(bugLogs);
  useEffect(() => {
    bugLogsLatestRef.current = bugLogs;
  }, [bugLogs]);

  const lastSyncedBugCountRef = useRef<number>(bugLogs.length);
  useEffect(() => {
    if (autoSyncSheet && googleSheetUrl && bugLogs.length > lastSyncedBugCountRef.current) {
      lastSyncedBugCountRef.current = bugLogs.length;
      handleSyncToGoogleSheet(bugLogs, true);
    } else {
      lastSyncedBugCountRef.current = bugLogs.length;
    }
  }, [bugLogs.length, autoSyncSheet, googleSheetUrl]);

  // 1-minute recurring auto-sync interval while dashboard is active (uses ref to avoid resetting timer on every bug edit)
  useEffect(() => {
    if (!autoSyncSheet || !googleSheetUrl) return;

    const intervalId = setInterval(() => {
      if (bugLogsLatestRef.current.length > 0) {
        handleSyncToGoogleSheet(bugLogsLatestRef.current, true);
      }
    }, 60000);

    return () => clearInterval(intervalId);
  }, [autoSyncSheet, googleSheetUrl]);

  // Global Escape key listener closes any active modal or popover
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedImagePreviewUrl) setSelectedImagePreviewUrl(null);
        if (isVisualSnapshotModalOpen) setIsVisualSnapshotModalOpen(false);
        if (isChatSummaryOpen) setIsChatSummaryOpen(false);
        if (isApiKeyModalOpen) setIsApiKeyModalOpen(false);
        if (isSheetModalOpen) setIsSheetModalOpen(false);
        if (isBugFilterMenuOpen) setIsBugFilterMenuOpen(false);
        if (inspectorTarget) setInspectorTarget(null);
        if (selectedInspectorTester) setSelectedInspectorTester('');
        if (isFloorMenuOpen) setIsFloorMenuOpen(false);
        if (isActivateTileOpen) setIsActivateTileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImagePreviewUrl, isVisualSnapshotModalOpen, isChatSummaryOpen, isApiKeyModalOpen, isSheetModalOpen, isBugFilterMenuOpen, inspectorTarget, selectedInspectorTester, isFloorMenuOpen, isActivateTileOpen]);

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

    list.sort((a, b) => {
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
  }, [bugLogs, bugCategorizations, selectedPlanFilter, bugPlanLookup, selectedDeviceFilter, selectedFeatureFilter, selectedDateFilter, customDateInput, searchBugQuery, sortByDevice]);

  // ---------- RX95 same-day duplicate groups (Bugs Feed) ----------
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => loadDismissed());
  const [expandedFeedBundles, setExpandedFeedBundles] = useState<Set<string>>(new Set());
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  // Bug ids being bundled right now (guards a fast double-click before React re-renders)
  const bundlingIdsRef = useRef<Set<string>>(new Set());
  const [feedToast, setFeedToast] = useState<string | null>(null);
  const flashFeed = (msg: string) => { setFeedToast(msg); setTimeout(() => setFeedToast(null), 4000); };
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
  const feedRows = useMemo<FeedRow[]>(() => buildFeedRows(feedTab === 'reviewed' ? reviewedFeedBugs : newFeedBugs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedTab, newFeedBugs, reviewedFeedBugs]);

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

  const renderFeedBundle = (row: { id: string; members: FeedBug[] }, renderBug: (b: FeedBug) => React.ReactNode) => {
    const open = expandedFeedBundles.has(row.id);
    const first = row.members[0];
    const bd = first.bundle!;
    const total = bd.memberIds?.length || row.members.length;
    // Header sums up all visible members: highest priority, most common type, Repro'd if any member is
    const rank = (p?: string) => (p === 'P0' || p === '0' ? 0 : p === 'P1' || p === '1' ? 1 : 2);
    const pri = ['P0', 'P1', 'P2'][Math.min(...row.members.map(m => rank(String(m.priority || 'P2'))))];
    const typeCounts = new Map<string, number>();
    row.members.forEach(m => { const t = m.bugType || 'Bug'; typeCounts.set(t, (typeCounts.get(t) || 0) + 1); });
    const bugTypeLabel = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Bug';
    const anyReprod = row.members.some(m => effectiveStatus(m.status) === REPROD);
    const testersN = new Set(row.members.map(m => (m.testerName || '').trim()).filter(Boolean)).size;
    const allFiled = row.members.every(m => effectiveFiled(bugById.get(m.id) || m));
    const waiting = !allFiled && row.members.some(m => (bugById.get(m.id) || m).filePending);
    return (
      <div key={`bundle-${row.id}`} data-testid="feed-bundle-row" id={`feed-bundle-${row.id}`}>
        <div onClick={() => setExpandedFeedBundles(prev => { const n = new Set(prev); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n; })}
          className={`${rowCls} flex-wrap ${open ? rowOpenCls : ''}`}>
          <span className={`${tagCls} ${TAG_STYLE.bundle}`}>Bundle ×{total}</span>
          <span className="flex-1 min-w-0 truncate text-slate-100 font-semibold">{bd.title}</span>
          <span className={`font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold uppercase ${pri === 'P0' || pri === '0' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : pri === 'P1' || pri === '1' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>{pri}</span>
          <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-300">{bugTypeLabel}</span>
          {anyReprod && <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold bg-violet-500/15 text-violet-200 border-violet-500/40">REPRO'D</span>}
          {allFiled && <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-black tracking-wider bg-green-500/15 text-green-300 border-green-500/40">FILED</span>}
          {waiting && <span className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold bg-amber-500/15 text-amber-200 border-amber-500/40">⏳ WAITING</span>}
          <span className="text-xs text-slate-400">{testersN} tester{testersN === 1 ? '' : 's'}{row.members.length < total ? ` · ${row.members.length} shown` : ''}</span>
          <button type="button" className={rowActionCls}>{open ? 'Close' : 'Open'}</button>
        </div>
        {open && (
          <div className={`${expandedCls} space-y-3`} data-testid="feed-bundle-expanded">
            <div className="flex flex-wrap items-center gap-2 pt-3">
              {!allFiled && !waiting && (
                <button type="button" data-testid="feed-unbundle" onClick={() => unbundleFromFeed(row.id)}
                  className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700">Unbundle</button>
              )}
              <span className="text-[11px] text-slate-500">Shows on the Buganizer tab as one bug. Change a single report's category below if needed.</span>
            </div>
            {row.members.map(m => renderBug(m))}
          </div>
        )}
      </div>
    );
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
        (s?.feature || '').toLowerCase().includes(q)
      )
    );
  }, [testPlans, searchPlanQuery]);

  // Stats calculation
  const totalPlans = testPlans.length;
  const activeRuns = liveInProgressRuns.length;
  const totalBugs = bugLogs.length;

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Hidden File Input for JSON Backup Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleJSONFileImport}
        accept=".json"
        className="hidden"
      />

      {/* Subagent Execution Toast / Banner */}
      {subagentToast && (
        <div className="bg-[#111827] border border-blue-500/40 p-4 rounded-3xl backdrop-blur-xl flex items-center justify-between text-xs font-semibold text-slate-100 animate-in fade-in slide-in-from-top-2 duration-300 shadow-lg">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span>{subagentToast}</span>
          </div>
          <button onClick={() => setSubagentToast(null)} className="text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Unified Top Navigation KPI Cards Row (4 Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        
        {/* Card 1: Overview / Test Plans */}
        <div
          onClick={() => setActiveTab('overview')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
            activeTab === 'overview'
              ? '!bg-[#162033] !border-blue-500 ring-1 ring-blue-500/30 shadow-md'
              : 'hover:border-slate-700'
          }`}
          title="Click to view Configured Test Plans & Active Runs"
        >
          <div>
            <div className={`text-xs font-semibold ${activeTab === 'overview' ? 'text-slate-200' : 'text-slate-400'} flex items-center gap-1.5`}>
              <span>Test Plans</span>
              {activeTab === 'overview' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </div>
            <div className="text-xl font-bold text-slate-50 mt-1 font-mono tracking-tight">{totalPlans}</div>
          </div>
          <div className={`p-2.5 rounded-2xl border transition-all ${
            activeTab === 'overview'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'bg-slate-800/90 text-slate-400 border-slate-700/80'
          }`}>
            <ListChecks className="w-4 h-4" />
          </div>
        </div>

        {/* Card 2: Unified Devices & Testers */}
        <div
          onClick={() => setActiveTab('devices')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
            activeTab === 'devices' || activeTab === 'testers'
              ? '!bg-[#162033] !border-blue-500 ring-1 ring-blue-500/30 shadow-md'
              : 'hover:border-slate-700'
          }`}
          title="Click to manage Active Devices, Daily Quotas & QA Testers"
        >
          <div>
            <div className={`text-xs font-semibold ${activeTab === 'devices' || activeTab === 'testers' ? 'text-slate-200' : 'text-slate-400'} flex items-center gap-1.5`}>
              <span>Devices &amp; Testers</span>
              {(activeTab === 'devices' || activeTab === 'testers') && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </div>
            <div className="text-xl font-bold text-slate-50 mt-1 font-mono tracking-tight">
              {`${activeOrTestedTodayCount} Tester${activeOrTestedTodayCount === 1 ? '' : 's'}`}
            </div>
          </div>
          <div className={`p-2.5 rounded-2xl border transition-all ${
            activeTab === 'devices' || activeTab === 'testers'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'bg-slate-800/90 text-slate-400 border-slate-700/80'
          }`}>
            <Smartphone className="w-4 h-4" />
          </div>
        </div>

        {/* Card 3: CUJ Quality Report */}
        <div
          onClick={() => setActiveTab('features')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
            activeTab === 'features'
              ? '!bg-[#162033] !border-blue-500 ring-1 ring-blue-500/30 shadow-md'
              : 'hover:border-slate-700'
          }`}
          title="Click to view CUJ Quality Report"
        >
          <div>
            <div className={`text-xs font-semibold ${activeTab === 'features' ? 'text-slate-200' : 'text-slate-400'} flex items-center gap-1.5`}>
              <span>CUJ Report</span>
              {activeTab === 'features' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </div>
            <div className="text-xl font-bold text-slate-50 mt-1 font-mono tracking-tight">{featureMetricsList.length} CUJs</div>
            {goldenRunsAnalysis.totalCount > 0 && (
              <div className="text-[11px] text-slate-400 font-mono font-medium mt-0.5">
                {goldenRunsAnalysis.goldenCount} Golden
              </div>
            )}
          </div>
          <div className={`p-2.5 rounded-2xl border transition-all ${
            activeTab === 'features'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'bg-slate-800/90 text-slate-400 border-slate-700/80'
          }`}>
            <Activity className="w-4 h-4" />
          </div>
        </div>

        {/* Card 4: Bugs Feed */}
        <div
          onClick={() => setActiveTab('bugs')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
            activeTab === 'bugs'
              ? '!bg-[#162033] !border-blue-500 ring-1 ring-blue-500/30 shadow-md'
              : 'hover:border-slate-700'
          }`}
          title="Click to view Reported Bugs"
        >
          <div>
            <div className={`text-xs font-semibold ${activeTab === 'bugs' ? 'text-slate-200' : 'text-slate-400'} flex items-center gap-1.5`}>
              <span>Bugs Feed</span>
              {activeTab === 'bugs' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </div>
            <div className="text-xl font-bold text-slate-50 mt-1 font-mono tracking-tight">{totalBugs} Bugs</div>
          </div>
          <div className={`p-2.5 rounded-2xl border transition-all ${
            activeTab === 'bugs'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'bg-slate-800/90 text-slate-400 border-slate-700/80'
          }`}>
            <Bug className="w-4 h-4" />
          </div>
        </div>

      </div>

      {/* Unified Tab: Single-Screen Devices & Testers */}
      {(activeTab === 'devices' || activeTab === 'testers') && (() => {
        const formatFloorDuration = (ms: number) => {
          if (!ms || ms <= 0) return '0m';
          const totalMins = Math.max(1, Math.round(ms / 60000));
          const hrs = Math.floor(totalMins / 60);
          const mins = totalMins % 60;
          return hrs > 0 ? `${hrs}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
        };

        // 1. Enrich testers with selectedQaDate stats, live session state, device quota attribution, and bugs
        const enrichedTesters = unifiedTesters.map(tester => {
          const testerKey = tester.name.toLowerCase().trim();
          const profile = tester.performanceProfile;
          const dayData = !profile
            ? { completedCount: 0, totalDurationMs: 0, completedRuns: [] as NonNullable<typeof profile>['dailyStats'][string]['completedRuns'], devicesUsedOnDay: new Set<string>() }
            : selectedQaDate === 'all'
              ? {
                  completedCount: profile.allTimeCompletedCount,
                  totalDurationMs: Object.values(profile.dailyStats).reduce((acc, d) => acc + d.totalDurationMs, 0),
                  completedRuns: Object.values(profile.dailyStats).flatMap(d => d.completedRuns),
                  devicesUsedOnDay: profile.devicesUsed
                }
              : profile.dailyStats[selectedQaDate] || {
                  completedCount: 0,
                  totalDurationMs: 0,
                  completedRuns: [],
                  devicesUsedOnDay: new Set<string>()
                };

          const completedRunsList = dayData.completedRuns;
          const avgMs = dayData.completedCount > 0 ? Math.round(dayData.totalDurationMs / dayData.completedCount) : 0;
          const avgMins = Math.floor(avgMs / 60000);
          const avgSecs = Math.floor((avgMs % 60000) / 1000);
          const avgFormatted = avgMs > 0 ? `${avgMins}m ${avgSecs < 10 ? '0' : ''}${avgSecs}s` : '—';
          const floorTimeFormatted = formatFloorDuration(dayData.totalDurationMs);

          const isActive = activeTesterMap.has(testerKey);
          const activeInfo = activeTesterMap.get(testerKey);

          // Per-device run counts for this tester on selectedQaDate
          const devCounts = new Map<string, { displayName: string; count: number }>();
          completedRunsList.forEach(r => {
            const devName = (r.deviceName || '').trim();
            if (!devName) return;
            const dKey = devName.toLowerCase();
            const prev = devCounts.get(dKey);
            if (prev) {
              prev.count += 1;
            } else {
              devCounts.set(dKey, { displayName: devName, count: 1 });
            }
          });
          if (isActive && activeInfo?.deviceName) {
            const activeDevName = activeInfo.deviceName.trim();
            const dKey = activeDevName.toLowerCase();
            if (activeDevName && !devCounts.has(dKey)) {
              devCounts.set(dKey, { displayName: activeDevName, count: 0 });
            }
          }

          const devicePills = Array.from(devCounts.values()).map(({ displayName, count }) => {
            const matchedDev = devices.find(d => d.name.toLowerCase().trim() === displayName.toLowerCase().trim());
            const assignedQuota = matchedDev?.quotas?.find(q => q.targetRunsPerDay > 0) || matchedDev?.quotas?.[0];
            if (selectedQaDate === todayStr && matchedDev && assignedQuota && assignedQuota.targetRunsPerDay > 0) {
              const target = assignedQuota.targetRunsPerDay;
              const doneOnDevToday = (todayRunsMap[matchedDev.id] && todayRunsMap[matchedDev.id][assignedQuota.planId]) || count;
              const displayDone = count > 0 ? count : doneOnDevToday;
              const isMet = doneOnDevToday >= target || count >= target;
              return {
                key: displayName,
                deviceId: matchedDev.id,
                deviceName: matchedDev.name,
                label: `${matchedDev.name} ${displayDone}/${target}${isMet ? '✓' : ''}`,
                isDone: isMet
              };
            }
            return {
              key: displayName,
              deviceId: matchedDev?.id,
              deviceName: displayName,
              label: count > 0 ? `${displayName} ×${count}` : displayName,
              isDone: count > 0
            };
          });

          const dayDevices = Array.from(devCounts.values()).map(d => d.displayName);

          const bugCount = bugLogs.filter(b => {
            const bTester = ((b.testerName || (b as any).reporter || '') as string).toLowerCase().trim();
            if (bTester !== testerKey) return false;
            if (selectedQaDate === 'all') return true;
            return getLocalDateStr(b.timestamp) === selectedQaDate;
          }).length;

          const lastRun = completedRunsList.length > 0 ? completedRunsList[completedRunsList.length - 1] : null;
          const allTimeRuns = profile?.allTimeCompletedCount || 0;

          return {
            ...tester,
            testerKey,
            dayData,
            completedRunsList,
            avgMs,
            avgFormatted,
            floorTimeFormatted,
            isActive,
            activeInfo,
            devicePills,
            dayDevices,
            bugCount,
            lastRun,
            allTimeRuns
          };
        });

        const sortedTesters = [...enrichedTesters].sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          if (b.dayData.completedCount !== a.dayData.completedCount) {
            return b.dayData.completedCount - a.dayData.completedCount;
          }
          if (b.bugCount !== a.bugCount) {
            return b.bugCount - a.bugCount;
          }
          return a.name.localeCompare(b.name);
        });

        const activeOrTestedTesters = sortedTesters.filter(
          t => t.isActive || t.dayData.completedCount > 0 || t.bugCount > 0
        );

        let liveNowCount = 0;
        let awayNowCount = 0;
        activeTesterMap.forEach(info => {
          if (info.isAway) awayNowCount += 1;
          else liveNowCount += 1;
        });

        const shiftTotalRuns = sortedTesters.reduce((acc, t) => acc + t.dayData.completedCount, 0);
        const shiftTotalFloorMs = sortedTesters.reduce((acc, t) => acc + t.dayData.totalDurationMs, 0);
        const shiftAvgPaceMs = shiftTotalRuns > 0 ? Math.round(shiftTotalFloorMs / shiftTotalRuns) : 0;
        const shiftAvgPaceMins = Math.floor(shiftAvgPaceMs / 60000);
        const shiftAvgPaceSecs = Math.floor((shiftAvgPaceMs % 60000) / 1000);
        const shiftAvgPaceFormatted = shiftAvgPaceMs > 0
          ? `${shiftAvgPaceMins}m ${shiftAvgPaceSecs < 10 ? '0' : ''}${shiftAvgPaceSecs}s`
          : '—';
        const shiftTotalBugs = sortedTesters.reduce((acc, t) => acc + t.bugCount, 0);

        // Filter testers by mode
        let displayedTesters = activeOrTestedTesters;
        if (testerViewMode === 'active') {
          displayedTesters = sortedTesters.filter(t => t.isActive);
        }

        // 2. Enrich devices with quota, today's completions, and live in-use tester
        const enrichedDevices = devices.map(device => {
          const validQuota =
            (device.quotas &&
              device.quotas.find(
                q => q.planId && (q.targetRunsPerDay || 0) > 0 && testPlans.some(p => p.id === q.planId)
              )) ||
            null;
          const assignedPlan = validQuota ? testPlans.find(p => p.id === validQuota.planId) || null : null;
          const assignedQuota = validQuota;
          const hasAssignedPlan = Boolean(validQuota && assignedPlan);
          const targetRuns = assignedQuota ? Math.max(1, assignedQuota.targetRunsPerDay || 1) : 2;
          const doneToday = (assignedQuota && todayRunsMap[device.id] && todayRunsMap[device.id][assignedQuota.planId]) || 0;
          const remaining = assignedQuota ? Math.max(0, targetRuns - doneToday) : 0;
          const pct = assignedQuota && targetRuns > 0 ? Math.min(100, Math.round((doneToday / targetRuns) * 100)) : 0;

          const activeRunForDevice = liveInProgressRuns.find(r =>
            (device.activeRunId && r.id === device.activeRunId) ||
            (r.deviceId && r.deviceId.toLowerCase().trim() === device.id.toLowerCase().trim()) ||
            (r.deviceName && r.deviceName.toLowerCase().trim() === device.name.toLowerCase().trim())
          );
          const isInUse = Boolean(activeRunForDevice);
          const inUseTesterName = activeRunForDevice?.testerName || device.activeTesterName || 'Tester';
          const activeTesterInfo = isInUse ? activeTesterMap.get(inUseTesterName.toLowerCase().trim()) : undefined;

          return {
            ...device,
            assignedQuota,
            hasAssignedPlan,
            assignedPlan,
            targetRuns,
            doneToday,
            remaining,
            pct,
            activeRunForDevice,
            isInUse,
            inUseTesterName,
            activeTesterInfo
          };
        });

        const inUseDevicesCount = enrichedDevices.filter(d => d.isInUse).length;

        const displayedDevices = enrichedDevices.filter(d => d.hasAssignedPlan || d.isInUse);

        // Quick-Activate defaults (unassigned devices for "+ Activate device" tile / start-of-day)
        const effectiveQuickDeviceId =
          (quickActivateDeviceId && unassignedDevices.some(d => d.id === quickActivateDeviceId))
            ? quickActivateDeviceId
            : (unassignedDevices[0]?.id || devices[0]?.id || '');
        const effectiveQuickPlanId =
          (quickActivatePlanId && testPlans.some(p => p.id === quickActivatePlanId))
            ? quickActivatePlanId
            : (testPlans[0]?.id || '');

        // 3. Resolve Slide-Over Detail Panel Target (Device OR Tester — null when nothing selected)
        let resolvedInspector:
          | { type: 'device'; device: (typeof enrichedDevices)[number] }
          | { type: 'tester'; tester: (typeof sortedTesters)[number] }
          | null = null;

        if (inspectorTarget?.type === 'device') {
          const foundDev = enrichedDevices.find(
            d => d.id === inspectorTarget.id || d.name.toLowerCase().trim() === inspectorTarget.id.toLowerCase().trim()
          );
          if (foundDev) resolvedInspector = { type: 'device', device: foundDev };
        } else if (inspectorTarget?.type === 'tester') {
          const foundTester = sortedTesters.find(
            t => t.testerKey === inspectorTarget.id.toLowerCase().trim() || t.id === inspectorTarget.id
          );
          if (foundTester) resolvedInspector = { type: 'tester', tester: foundTester };
        } else if (selectedInspectorTester) {
          const foundTester = sortedTesters.find(
            t => t.testerKey === selectedInspectorTester.toLowerCase().trim()
          );
          if (foundTester) resolvedInspector = { type: 'tester', tester: foundTester };
        }

        const dateScopeLabel = selectedQaDate === 'all' ? 'all time' : selectedQaDate;
        const isStartOfDay = displayedDevices.length === 0 && activeOrTestedTesters.length === 0;
        const hasMeaningfulActivity =
          !isStartOfDay ||
          fleetProgress.totalTarget > 0 ||
          fleetProgress.totalCompleted > 0 ||
          inUseDevicesCount > 0 ||
          liveNowCount > 0 ||
          awayNowCount > 0 ||
          shiftTotalBugs > 0;

        const formatShortDate = (dateStr: string) => {
          if (dateStr === 'all') return 'All-time';
          const parts = dateStr.split('-');
          if (parts.length === 3) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            if (!isNaN(d.getTime())) {
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }
          }
          return dateStr;
        };

        const handleQuickActivateDevice = () => {
          const targetDev =
            unassignedDevices.find(d => d.id === effectiveQuickDeviceId) ||
            devices.find(d => d.id === effectiveQuickDeviceId);
          if (!targetDev || !effectiveQuickPlanId) return;
          const quota = Math.min(50, Math.max(1, Number(quickActivateQuota) || 2));
          if (onSaveDevice) {
            onSaveDevice({
              ...targetDev,
              isReady: true,
              quotas: [{ planId: effectiveQuickPlanId, targetRunsPerDay: quota }]
            });
          }
          const nextUnassigned = unassignedDevices.find(d => d.id !== targetDev.id);
          setQuickActivateDeviceId(nextUnassigned?.id || '');
          setIsActivateTileOpen(false);
        };

        return (
          <div className="relative">
            {/* Single unified floor frame (Option A · Tile Board) */}
            <div className="bg-[#0e1526] border border-slate-800 rounded-2xl overflow-visible shadow-xl">
              {/* 1. Header row (single line, never wraps on >=1024px) */}
              <div className="px-5 py-3.5 border-b border-[#162036] flex items-center justify-between gap-4 flex-wrap lg:flex-nowrap">
                {/* Left + Middle: Title, compact date select, inline text KPIs */}
                <div className="flex items-center gap-5 min-w-0 flex-wrap lg:flex-nowrap">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] font-bold text-slate-100 tracking-tight whitespace-nowrap">
                      {selectedQaDate === todayStr
                        ? "Today's floor"
                        : selectedQaDate === 'all'
                          ? 'Floor · All-time'
                          : `Floor · ${formatShortDate(selectedQaDate)}`}
                    </span>
                    <div className="relative inline-flex items-center">
                      <select
                        value={selectedQaDate}
                        onChange={e => setSelectedQaDate(e.target.value)}
                        style={{ backgroundColor: 'transparent', WebkitAppearance: 'none' }}
                        className="w-auto appearance-none bg-transparent text-slate-400 hover:text-slate-200 text-xs font-medium pr-3 py-0.5 rounded focus:outline-none cursor-pointer"
                        title="Switch floor date scope"
                      >
                        <option value={todayStr} className="bg-[#0b1120] text-slate-100">
                          {formatShortDate(todayStr)}
                        </option>
                        {allQaDatesList
                          .filter(d => d !== todayStr)
                          .map(dateStr => (
                            <option key={dateStr} value={dateStr} className="bg-[#0b1120] text-slate-100">
                              {formatShortDate(dateStr)}
                            </option>
                          ))}
                        <option value="all" className="bg-[#0b1120] text-slate-100">
                          All-time
                        </option>
                      </select>
                      <span className="pointer-events-none absolute right-0 text-[10px] text-slate-500">
                        ▾
                      </span>
                    </div>
                  </div>

                  {/* Inline KPIs as text, no cards */}
                  <div className="flex items-center gap-4 text-xs text-slate-400 whitespace-nowrap overflow-x-auto">
                    {!hasMeaningfulActivity ? (
                      <>
                        <span>
                          <strong className="font-mono text-slate-200 font-bold">0/0</strong> runs
                        </span>
                        <span>
                          <strong className="font-mono text-slate-200 font-bold">0</strong> testers
                        </span>
                      </>
                    ) : (
                      <>
                        <span>
                          <strong className="font-mono text-slate-100 font-bold">
                            {fleetProgress.totalCompleted}/{fleetProgress.totalTarget}
                          </strong>{' '}
                          runs · {fleetProgress.pct}%
                        </span>
                        {inUseDevicesCount > 0 && (
                          <span>
                            <strong className="font-mono text-slate-100 font-bold">
                              {inUseDevicesCount}
                            </strong>{' '}
                            in use
                          </span>
                        )}
                        {(liveNowCount > 0 || awayNowCount > 0) && (
                          <span>
                            <strong className="font-mono text-slate-100 font-bold">
                              {liveNowCount}
                            </strong>{' '}
                            live
                            {awayNowCount > 0 ? ` · ${awayNowCount} away` : ''}
                          </span>
                        )}
                        {shiftAvgPaceFormatted !== '—' && (
                          <span>
                            <strong className="font-mono text-slate-100 font-bold">
                              {shiftAvgPaceFormatted}
                            </strong>{' '}
                            avg
                          </span>
                        )}
                        {shiftTotalBugs > 0 && (
                          <button
                            type="button"
                            onClick={() => setActiveTab('bugs')}
                            className="hover:underline cursor-pointer"
                            title="View bug reports"
                          >
                            <strong className="font-mono text-rose-300 font-bold">
                              {shiftTotalBugs}
                            </strong>{' '}
                            <span className="text-rose-300/80">
                              bug{shiftTotalBugs === 1 ? '' : 's'}
                            </span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Right: Ghost button Pool & Roster + ⋯ menu button */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowOffShiftTesters(prev => !prev)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer ${
                      showOffShiftTesters
                        ? 'bg-[#13203a] border-blue-500/50 text-blue-200'
                        : 'bg-transparent border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    Pool &amp; Roster
                  </button>

                  <div className="relative" ref={floorMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsFloorMenuOpen(prev => !prev)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer ${
                        isFloorMenuOpen
                          ? 'bg-[#13203a] border-blue-500/50 text-blue-200'
                          : 'bg-transparent border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                      title="Floor actions"
                    >
                      ⋯
                    </button>

                    {isFloorMenuOpen && (
                      <div className="absolute right-0 mt-1.5 w-52 bg-[#0b1120] border border-slate-800 rounded-xl shadow-2xl py-1.5 z-30 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setIsFloorMenuOpen(false);
                            if (
                              confirm(
                                "Reset today's completed run counters and today's test execution data across all devices?"
                              )
                            ) {
                              if (onResetActiveDay) onResetActiveDay(getLocalDateStr(new Date()));
                            }
                          }}
                          className="w-full px-3 py-1.5 text-left text-slate-300 hover:bg-[#13203a] hover:text-white flex items-center justify-between transition cursor-pointer"
                        >
                          <span>Reset counters</span>
                          <RefreshCw className="w-3 h-3 text-slate-500" />
                        </button>

                        {onResetDailyQuotas && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsFloorMenuOpen(false);
                              if (
                                confirm(
                                  'Reset all device quotas to "No Plan Assigned" for today? (This clears plan assignments so you can assign new ones for the day)'
                                )
                              ) {
                                onResetDailyQuotas();
                                setInspectorTarget(null);
                              }
                            }}
                            className="w-full px-3 py-1.5 text-left text-slate-300 hover:bg-[#13203a] hover:text-white flex items-center justify-between transition cursor-pointer"
                          >
                            <span>Clear plans</span>
                            <Layers className="w-3 h-3 text-slate-500" />
                          </button>
                        )}

                        {onUpdateMinAppVersion && (
                          <div className="border-t border-slate-800/80 mt-1 pt-1.5 px-3 py-1 flex items-center justify-between gap-2">
                            <span className="text-slate-400 whitespace-nowrap">Required APK ▸</span>
                            <select
                              value={minAppVersion || 1}
                              onChange={e => {
                                onUpdateMinAppVersion(parseInt(e.target.value, 10));
                                setIsFloorMenuOpen(false);
                              }}
                              style={{ backgroundColor: '#090d16', color: '#93c5fd' }}
                              className="bg-[#090d16] text-blue-300 font-mono font-bold border border-slate-700 rounded px-1.5 py-0.5 text-[11px] focus:outline-none cursor-pointer"
                            >
                              <option value={1}>v1.0</option>
                              <option value={2}>v2.0+</option>
                              <option value={3}>v2.1+</option>
                              <option value={4}>v2.2+</option>
                              <option value={5}>v2.3.0</option>
                              <option value={6}>v2.4.0</option>
                              <option value={7}>v2.5.0</option>
                              <option value={8}>v2.6.0</option>
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Optional Collapsible Pool & Roster Drawer (inside frame under header) */}
              {showOffShiftTesters && (
                <div className="px-5 py-3.5 bg-[#0b1120] border-b border-[#162036] grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left: Device Pool */}
                  <div className="space-y-2 lg:border-r lg:border-slate-800/80 lg:pr-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Device Pool · {devices.length} total ({unassignedDevices.length} unassigned)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="New device ID (e.g. WP06)..."
                        value={newDeviceName}
                        onChange={e => setNewDeviceName(e.target.value)}
                        className="flex-1 bg-[#090d16] border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = newDeviceName.trim();
                          if (!trimmed) return;
                          if (devices.some(d => d.name.trim().toLowerCase() === trimmed.toLowerCase())) {
                            alert(`Device "${trimmed}" already exists.`);
                            return;
                          }
                          const newDev: DeviceProfile = {
                            id: `dev-${Date.now()}`,
                            name: trimmed,
                            isReady: true,
                            quotas: []
                          };
                          if (onSaveDevice) onSaveDevice(newDev);
                          setQuickActivateDeviceId(newDev.id);
                          setNewDeviceName('');
                        }}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shrink-0"
                      >
                        ＋ Add
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-0.5 max-h-32 overflow-y-auto">
                      {enrichedDevices.map(dev => (
                        <div
                          key={dev.id}
                          onClick={() => {
                            setQuickActivateDeviceId(dev.id);
                            setInspectorTarget({ type: 'device', id: dev.id });
                          }}
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                            dev.hasAssignedPlan
                              ? 'bg-[#13203a] border-blue-500/40 text-blue-200'
                              : 'bg-[#090d16] border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              dev.isInUse
                                ? 'bg-rose-400'
                                : dev.hasAssignedPlan
                                  ? 'bg-emerald-400'
                                  : 'bg-slate-600'
                            }`}
                          />
                          <span className="font-bold">{dev.name}</span>
                          {dev.hasAssignedPlan && (
                            <span className="text-[10px] text-emerald-300">
                              {dev.doneToday}/{dev.targetRuns}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              if (confirm(`Delete device "${dev.name}"?`)) {
                                if (onDeleteDevice) onDeleteDevice(dev.id);
                              }
                            }}
                            className="text-slate-500 hover:text-rose-400 ml-0.5 cursor-pointer"
                            title={`Delete ${dev.name}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right: Saved Testers Roster */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Roster · {unifiedTesters.length} testers
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowOffShiftTesters(false)}
                        className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                      >
                        Close ✕
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Tester name..."
                        value={newPersonName}
                        onChange={e => setNewPersonName(e.target.value)}
                        className="flex-1 bg-[#090d16] border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="text"
                        placeholder="Role..."
                        value={newPersonRole}
                        onChange={e => setNewPersonRole(e.target.value)}
                        className="w-28 bg-[#090d16] border border-slate-800 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newPersonName.trim()) return;
                          const newTester: TesterProfile = {
                            id: `tester-${Date.now()}`,
                            name: newPersonName.trim(),
                            role: newPersonRole.trim() || 'Mobile Tester'
                          };
                          if (onSaveTester) onSaveTester(newTester);
                          setInspectorTarget({ type: 'tester', id: newTester.name });
                          setNewPersonName('');
                        }}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shrink-0"
                      >
                        ＋ Add
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-0.5 max-h-32 overflow-y-auto">
                      {sortedTesters.map(t => {
                        const hasActivity = t.isActive || t.dayData.completedCount > 0 || t.bugCount > 0;
                        return (
                          <div
                            key={t.id || t.name}
                            onClick={() => setInspectorTarget({ type: 'tester', id: t.name })}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] transition cursor-pointer ${
                              hasActivity
                                ? 'bg-[#13203a] border-blue-500/40 text-slate-100'
                                : 'bg-[#090d16] border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                t.isActive
                                  ? 'bg-emerald-400'
                                  : hasActivity
                                    ? 'bg-blue-400'
                                    : 'bg-slate-600'
                              }`}
                            />
                            <span className="font-medium text-slate-200">{t.name}</span>
                            {t.dayData.completedCount > 0 && (
                              <span className="font-mono text-[10px] text-blue-300">
                                {t.dayData.completedCount}d
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                if (
                                  confirm(
                                    `Delete tester "${t.name}" and all associated performance data?`
                                  )
                                ) {
                                  if (t.id && onDeleteTesterProfile) {
                                    onDeleteTesterProfile(t.id);
                                  }
                                  if (onDeleteTester) {
                                    onDeleteTester(t.name);
                                  } else if (onDeleteTestRun) {
                                    const runsToDelete = [...testRuns, ...archivedRuns].filter(
                                      r => r.testerName === t.name
                                    );
                                    runsToDelete.forEach(r => onDeleteTestRun(r.id));
                                  }
                                }
                              }}
                              className="text-slate-500 hover:text-rose-400 ml-0.5 cursor-pointer"
                              title={`Delete ${t.name}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Start of day (no assigned devices AND no active/tested testers) */}
              {isStartOfDay ? (
                <div className="px-5 py-9 flex flex-wrap items-center justify-center gap-2.5">
                  <span className="text-xs text-slate-400 mr-1">Start the day:</span>
                  <select
                    value={effectiveQuickDeviceId}
                    onChange={e => setQuickActivateDeviceId(e.target.value)}
                    style={{ backgroundColor: '#090d16', color: '#e2e8f0' }}
                    className="bg-[#090d16] border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {unassignedDevices.length === 0 && devices.length === 0 && (
                      <option value="">No devices in pool</option>
                    )}
                    {(unassignedDevices.length > 0 ? unassignedDevices : devices).map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={effectiveQuickPlanId}
                    onChange={e => setQuickActivatePlanId(e.target.value)}
                    style={{ backgroundColor: '#090d16', color: '#e2e8f0' }}
                    className="bg-[#090d16] border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-blue-500 cursor-pointer max-w-[260px]"
                  >
                    {testPlans.length === 0 ? (
                      <option value="">No test plans</option>
                    ) : (
                      testPlans.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.steps.length} steps)
                        </option>
                      ))
                    )}
                  </select>

                  <div className="inline-flex items-center bg-[#090d16] border border-slate-800 rounded-lg px-2 py-1 text-xs">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={quickActivateQuota}
                      onChange={e =>
                        setQuickActivateQuota(
                          Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1))
                        )
                      }
                      className="w-8 bg-transparent text-slate-200 font-mono font-bold text-xs text-center focus:outline-none"
                    />
                    <span className="text-slate-500 text-[11px] font-mono">/ day</span>
                  </div>

                  <button
                    type="button"
                    disabled={!effectiveQuickDeviceId || !effectiveQuickPlanId}
                    onClick={handleQuickActivateDevice}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                  >
                    ＋ Activate
                  </button>
                </div>
              ) : (
                <>
                  {/* 2. Devices section (tile grid) */}
                  <div className="px-5 pt-3.5 pb-4">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        DEVICES · {displayedDevices.length} ACTIVE
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 auto-rows-fr gap-2.5">
                      {displayedDevices.map(dev => {
                        const isSelected =
                          resolvedInspector?.type === 'device' &&
                          resolvedInspector.device.id === dev.id;

                        const shortTesterName = dev.inUseTesterName
                          ? (() => {
                              const parts = dev.inUseTesterName.trim().split(/\s+/);
                              return parts.length > 1
                                ? `${parts[0]} ${parts[1].charAt(0)}`
                                : parts[0];
                            })()
                          : '';

                        const stepTotal =
                          dev.activeTesterInfo?.totalSteps ||
                          dev.assignedPlan?.steps?.length ||
                          0;
                        const stepCurr = dev.activeTesterInfo?.currentStepIndex || 1;

                        return (
                          <div
                            key={dev.id}
                            onClick={() => setInspectorTarget({ type: 'device', id: dev.id })}
                            className={`bg-[#0b1120] border rounded-xl p-3 flex flex-col gap-1.5 min-h-[116px] transition cursor-pointer ${
                              isSelected
                                ? 'border-blue-500 ring-1 ring-blue-500/30'
                                : 'border-[#1b2740] hover:border-slate-700'
                            }`}
                          >
                            {/* Row 1: mono device name + status pill */}
                            <div className="flex items-center justify-between gap-1.5 min-w-0">
                              <span className="font-mono font-bold text-[13px] text-slate-100 truncate">
                                {dev.name}
                              </span>

                              {dev.isInUse ? (
                                dev.activeTesterInfo?.isAway ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-500/15 text-amber-300 truncate max-w-[130px]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                    <span className="truncate">
                                      Away · {shortTesterName.split(' ')[0]}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-rose-500/15 text-rose-300 truncate max-w-[130px]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                                    <span className="truncate">
                                      {shortTesterName}
                                      {dev.activeRunForDevice?.startedAt
                                        ? ` · ${formatOngoingDuration(
                                            dev.activeRunForDevice.startedAt
                                          )}`
                                        : ''}
                                    </span>
                                  </span>
                                )
                              ) : !dev.isReady ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-rose-500/15 text-rose-300">
                                  Maintenance
                                </span>
                              ) : dev.hasAssignedPlan && dev.doneToday >= dev.targetRuns ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-500/15 text-emerald-300">
                                  ✓ Quota met
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-slate-800/80 text-slate-400">
                                  Ready
                                </span>
                              )}
                            </div>

                            {/* Row 2: plan name truncated */}
                            <div className="text-[11.5px] text-slate-400 truncate">
                              {dev.assignedPlan?.name ||
                                dev.activeTesterInfo?.planName ||
                                'Unassigned'}
                            </div>

                            {/* Row 3: progress bar + done/target */}
                            <div className="flex items-center gap-2 mt-0.5">
                              <div className="flex-1 h-1 bg-[#1e293b] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    dev.doneToday >= dev.targetRuns && dev.targetRuns > 0
                                      ? 'bg-emerald-500'
                                      : 'bg-blue-500'
                                  }`}
                                  style={{ width: `${dev.pct}%` }}
                                />
                              </div>
                              <span
                                className={`font-mono text-[11px] font-semibold shrink-0 ${
                                  dev.doneToday >= dev.targetRuns && dev.targetRuns > 0
                                    ? 'text-emerald-400'
                                    : 'text-slate-300'
                                }`}
                              >
                                {dev.doneToday}/{dev.targetRuns}
                              </span>
                            </div>

                            {/* Row 4: Step x/y when in use (else blank spacer so tiles are equal height) */}
                            {dev.isInUse ? (
                              <div className="font-mono text-[10.5px] text-slate-500 truncate">
                                Step {stepCurr}/{stepTotal || 1}
                                {dev.activeTesterInfo?.currentStepTitle
                                  ? ` · ${dev.activeTesterInfo.currentStepTitle}`
                                  : ''}
                              </div>
                            ) : (
                              <div className="font-mono text-[10.5px] text-transparent select-none">
                                &nbsp;
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Last tile: dashed "+ Activate device" or inline mini-form */}
                      {isActivateTileOpen ? (
                        <div className="bg-[#0b1120] border border-blue-500/60 rounded-xl p-2.5 flex flex-col justify-between gap-1.5 min-h-[116px]">
                          <div className="flex items-center gap-1.5">
                            <select
                              value={effectiveQuickDeviceId}
                              onChange={e => setQuickActivateDeviceId(e.target.value)}
                              style={{ backgroundColor: '#090d16', color: '#f8fafc' }}
                              className="flex-1 min-w-0 bg-[#090d16] border border-slate-700 text-slate-100 rounded px-1.5 py-1 text-[11px] font-mono font-bold focus:outline-none focus:border-blue-500"
                            >
                              {unassignedDevices.length === 0 ? (
                                <option value="">No unassigned</option>
                              ) : (
                                unassignedDevices.map(d => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))
                              )}
                            </select>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={quickActivateQuota}
                              onChange={e =>
                                setQuickActivateQuota(
                                  Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1))
                                )
                              }
                              className="w-11 bg-[#090d16] border border-slate-700 text-blue-300 font-mono font-bold text-[11px] rounded px-1 py-1 text-center focus:outline-none focus:border-blue-500"
                              title="Daily target runs"
                            />
                            <button
                              type="button"
                              onClick={() => setIsActivateTileOpen(false)}
                              className="text-slate-500 hover:text-slate-200 px-1 text-xs cursor-pointer"
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </div>

                          <select
                            value={effectiveQuickPlanId}
                            onChange={e => setQuickActivatePlanId(e.target.value)}
                            style={{ backgroundColor: '#090d16', color: '#f8fafc' }}
                            className="w-full bg-[#090d16] border border-slate-700 text-slate-200 rounded px-1.5 py-1 text-[11px] truncate focus:outline-none focus:border-blue-500"
                          >
                            {testPlans.length === 0 ? (
                              <option value="">No plans</option>
                            ) : (
                              testPlans.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))
                            )}
                          </select>

                          <button
                            type="button"
                            disabled={unassignedDevices.length === 0 || !effectiveQuickPlanId}
                            onClick={handleQuickActivateDevice}
                            className="w-full py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-[11px] font-semibold transition cursor-pointer"
                          >
                            Activate
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsActivateTileOpen(true)}
                          className="bg-transparent border border-dashed border-[#1e2d4a] hover:border-slate-600 rounded-xl p-3 flex flex-col items-center justify-center gap-0.5 text-slate-500 hover:text-slate-300 transition cursor-pointer min-h-[116px]"
                        >
                          <span className="text-xs font-semibold">＋ Activate device</span>
                          <span className="text-[11px] text-slate-600 font-mono">
                            {unassignedDevices.length} in pool
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 3. Testers section (hidden entirely if no active/tested testers exist) */}
                  {activeOrTestedTesters.length > 0 && (
                    <div className="px-5 pt-3 pb-2 border-t border-[#162036]">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            TESTERS · {activeOrTestedTesters.length}{' '}
                            {selectedQaDate === todayStr
                              ? 'TODAY'
                              : selectedQaDate === 'all'
                                ? 'ALL-TIME'
                                : selectedQaDate}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setTesterViewMode(prev => (prev === 'active' ? 'tested' : 'active'))
                            }
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border transition cursor-pointer ${
                              testerViewMode === 'active'
                                ? 'bg-blue-600/20 border-blue-500/60 text-blue-200'
                                : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <span>Live Now ({activeTesterMap.size})</span>
                          </button>
                        </div>
                      </div>

                      <div className="divide-y divide-[#141d31]">
                        {displayedTesters.map(tester => {
                          const isSelected =
                            resolvedInspector?.type === 'tester' &&
                            resolvedInspector.tester.testerKey === tester.testerKey;

                          return (
                            <div
                              key={tester.id || tester.name}
                              onClick={() =>
                                setInspectorTarget({ type: 'tester', id: tester.name })
                              }
                              className={`grid grid-cols-1 md:grid-cols-[220px_1fr_80px_80px_100px] items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg text-xs transition cursor-pointer ${
                                isSelected ? 'bg-[#13203a]' : 'hover:bg-[#111b30]/70'
                              }`}
                            >
                              {/* Col 1: Avatar + Name + Live line */}
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className={`w-6 h-6 rounded-full text-[11px] font-bold inline-flex items-center justify-center border shrink-0 ${
                                    tester.isActive
                                      ? tester.activeInfo?.isAway
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/45'
                                        : 'bg-blue-600 text-white border-blue-400'
                                      : 'bg-slate-800 text-slate-300 border-slate-700'
                                  }`}
                                >
                                  {tester.name.charAt(0).toUpperCase()}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-slate-100 truncate">
                                    {tester.name}
                                  </div>
                                  {tester.isActive && tester.activeInfo ? (
                                    tester.activeInfo.isAway ? (
                                      <div className="text-[11px] text-amber-300 truncate">
                                        ● Away · {tester.activeInfo.deviceName || 'Device'} ·{' '}
                                        {tester.activeInfo.currentStepIndex}/
                                        {tester.activeInfo.totalSteps}
                                      </div>
                                    ) : (
                                      <div className="text-[11px] text-emerald-400 truncate">
                                        ● {tester.activeInfo.deviceName || 'Device'} ·{' '}
                                        {tester.activeInfo.currentStepIndex}/
                                        {tester.activeInfo.totalSteps}
                                      </div>
                                    )
                                  ) : (
                                    <div className="text-[11px] text-slate-500 truncate">
                                      Idle · last run {tester.lastRun?.completedAtFormatted || 'today'}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Col 2: Device quota chips (click -> device slide-over) */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {tester.devicePills.length > 0 ? (
                                  tester.devicePills.map(pill => (
                                    <span
                                      key={pill.key}
                                      onClick={e => {
                                        const targetDevId = pill.deviceId || pill.deviceName;
                                        if (targetDevId) {
                                          e.stopPropagation();
                                          setInspectorTarget({
                                            type: 'device',
                                            id: targetDevId
                                          });
                                        }
                                      }}
                                      className={`font-mono text-[11px] px-2 py-0.5 rounded-md cursor-pointer transition ${
                                        pill.isDone
                                          ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                          : 'bg-[#131d31] text-slate-300 hover:bg-[#1a2742]'
                                      }`}
                                      title={`Inspect ${pill.deviceName}`}
                                    >
                                      {pill.label}
                                    </span>
                                  ))
                                ) : (
                                  <span className="font-mono text-[11px] text-slate-600">—</span>
                                )}
                              </div>

                              {/* Col 3: Runs */}
                              <div className="font-mono text-slate-200">
                                {tester.dayData.completedCount} run
                                {tester.dayData.completedCount === 1 ? '' : 's'}
                              </div>

                              {/* Col 4: Bug pill or — */}
                              <div>
                                {tester.bugCount > 0 ? (
                                  <button
                                    type="button"
                                    onClick={e => {
                                      e.stopPropagation();
                                      setActiveTab('bugs');
                                    }}
                                    className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 transition cursor-pointer"
                                    title={`View bugs logged by ${tester.name}`}
                                  >
                                    🐛 {tester.bugCount}
                                  </button>
                                ) : (
                                  <span className="font-mono text-slate-600">—</span>
                                )}
                              </div>

                              {/* Col 5: Avg time right-aligned mono */}
                              <div className="text-right font-mono text-slate-400">
                                {tester.avgFormatted !== '—' ? `${tester.avgFormatted} avg` : '—'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 5. Slide-over detail panel (only rendered when resolvedInspector !== null) */}
            {resolvedInspector && (
              <>
                {/* Light backdrop */}
                <div
                  onClick={() => {
                    setInspectorTarget(null);
                    setSelectedInspectorTester('');
                  }}
                  className="fixed inset-0 bg-black/30 z-30"
                />

                {/* Slide-over drawer */}
                <div className="fixed top-0 right-0 h-full w-full max-w-[380px] bg-[#0f182b] border-l border-[#263859] shadow-2xl z-40 p-5 flex flex-col gap-3.5 overflow-y-auto">
                  {resolvedInspector.type === 'device' ? (
                    (() => {
                      const dev = resolvedInspector.device;
                      const deviceCompletedRuns = enrichedTesters.flatMap(t =>
                        t.completedRunsList
                          .filter(
                            r =>
                              r.deviceName.toLowerCase().trim() ===
                              dev.name.toLowerCase().trim()
                          )
                          .map(r => ({ ...r, testerName: t.name }))
                      );

                      const statusLabel = dev.isInUse
                        ? dev.activeTesterInfo?.isAway
                          ? `Away · ${dev.inUseTesterName}`
                          : `In use by ${dev.inUseTesterName}`
                        : !dev.isReady
                          ? 'Maintenance'
                          : dev.hasAssignedPlan && dev.doneToday >= dev.targetRuns
                            ? 'Quota met'
                            : 'Ready';

                      return (
                        <>
                          {/* Top header with trash + ✕ button */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                                DEVICE
                              </div>
                              <div className="font-mono text-[17px] font-bold text-slate-100 truncate">
                                {dev.name}
                              </div>
                              <div className="text-xs text-slate-400 truncate">
                                {dev.hasAssignedPlan
                                  ? `${dev.doneToday}/${dev.targetRuns} quota`
                                  : 'No plan assigned'}{' '}
                                · {statusLabel}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`Delete device "${dev.name}"?`)) {
                                    if (onDeleteDevice) onDeleteDevice(dev.id);
                                    setInspectorTarget(null);
                                  }
                                }}
                                className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition cursor-pointer"
                                title={`Delete ${dev.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setInspectorTarget(null);
                                  setSelectedInspectorTester('');
                                }}
                                className="text-slate-400 hover:text-white text-sm px-1.5 py-0.5 cursor-pointer"
                                title="Close (Esc)"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          {/* Actions row: Unlock (in use only), Ready/Maintenance toggle, Unassign */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {dev.isInUse && (
                              <button
                                type="button"
                                onClick={() => {
                                  onBootTester?.(
                                    dev.activeRunForDevice?.id || dev.activeRunId || '',
                                    dev.id,
                                    dev.inUseTesterName,
                                    dev.name
                                  );
                                  onSaveDevice?.({
                                    ...dev,
                                    activeRunId: undefined,
                                    activeTesterName: undefined
                                  });
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/35 hover:bg-amber-500/25 transition cursor-pointer"
                              >
                                Unlock
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                const nextReady = !dev.isReady;
                                if (!nextReady && dev.isInUse && onBootTester) {
                                  onBootTester(
                                    dev.activeRunForDevice?.id || dev.activeRunId || '',
                                    dev.id,
                                    dev.inUseTesterName,
                                    dev.name
                                  );
                                }
                                const updated: DeviceProfile = {
                                  ...dev,
                                  isReady: nextReady,
                                  ...(nextReady
                                    ? {}
                                    : { activeRunId: undefined, activeTesterName: undefined })
                                };
                                if (onSaveDevice) onSaveDevice(updated);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                                dev.isReady
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                                  : 'bg-rose-500/15 text-rose-300 border-rose-500/35 hover:bg-rose-500/25'
                              }`}
                            >
                              {dev.isReady ? 'Ready' : 'Maintenance'}
                            </button>

                            {dev.hasAssignedPlan && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (onSaveDevice) onSaveDevice({ ...dev, quotas: [] });
                                  if (!dev.isInUse) setInspectorTarget(null);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-transparent text-slate-400 border border-slate-800 hover:text-slate-200 transition cursor-pointer"
                              >
                                Unassign
                              </button>
                            )}
                          </div>

                          {/* Editable plan select + quota input live HERE */}
                          <div className="flex items-center gap-2">
                            <select
                              value={dev.assignedQuota?.planId || ''}
                              onChange={e => {
                                const newPlanId = e.target.value;
                                if (!newPlanId) {
                                  if (onSaveDevice) onSaveDevice({ ...dev, quotas: [] });
                                  if (!dev.isInUse) setInspectorTarget(null);
                                } else {
                                  const currentTarget = dev.assignedQuota?.targetRunsPerDay || 2;
                                  if (onSaveDevice) {
                                    onSaveDevice({
                                      ...dev,
                                      quotas: [
                                        { planId: newPlanId, targetRunsPerDay: currentTarget }
                                      ]
                                    });
                                  }
                                }
                              }}
                              style={{ backgroundColor: '#090d16', color: '#e2e8f0' }}
                              className="flex-1 min-w-0 bg-[#090d16] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                            >
                              <option value="">-- Unassign plan --</option>
                              {testPlans.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.steps.length} steps)
                                </option>
                              ))}
                            </select>

                            {dev.assignedQuota && (
                              <input
                                type="number"
                                min={1}
                                max={50}
                                value={dev.targetRuns}
                                onChange={e => {
                                  const val = Math.min(
                                    50,
                                    Math.max(1, parseInt(e.target.value, 10) || 1)
                                  );
                                  if (onSaveDevice && dev.assignedQuota) {
                                    onSaveDevice({
                                      ...dev,
                                      quotas: [
                                        {
                                          planId: dev.assignedQuota.planId,
                                          targetRunsPerDay: val
                                        }
                                      ]
                                    });
                                  }
                                }}
                                className="w-14 bg-[#090d16] border border-slate-800 text-xs text-slate-100 font-mono font-bold rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-blue-500"
                                title="Daily quota"
                              />
                            )}
                          </div>

                          {/* Live run card (click tester -> switch to tester view) */}
                          {dev.isInUse && (
                            <div
                              onClick={() =>
                                setInspectorTarget({ type: 'tester', id: dev.inUseTesterName })
                              }
                              className="bg-[#0b1222] border border-[#1e3258] rounded-xl p-3 text-xs space-y-1.5 cursor-pointer hover:border-blue-500/60 transition"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-blue-300 truncate">
                                  ● {dev.activeTesterInfo?.isAway ? 'AWAY' : 'LIVE'} ·{' '}
                                  {dev.inUseTesterName}
                                </span>
                                <span className="font-mono text-slate-200 text-[11px] shrink-0">
                                  Step {dev.activeTesterInfo?.currentStepIndex || 1}/
                                  {dev.activeTesterInfo?.totalSteps ||
                                    dev.assignedPlan?.steps?.length ||
                                    1}
                                  {dev.activeRunForDevice?.startedAt
                                    ? ` · ${formatOngoingDuration(
                                        dev.activeRunForDevice.startedAt
                                      )}`
                                    : ''}
                                </span>
                              </div>
                              {dev.activeTesterInfo?.currentStepTitle && (
                                <div className="text-[11px] text-slate-400 truncate">
                                  ↳ {dev.activeTesterInfo.currentStepTitle}
                                </div>
                              )}
                              <div className="font-mono text-[11px] flex items-center gap-2">
                                <span className="text-emerald-400">
                                  ✓{dev.activeTesterInfo?.greenCount || 0}
                                </span>
                                <span className="text-amber-400">
                                  !{dev.activeTesterInfo?.yellowCount || 0}
                                </span>
                                <span className="text-rose-400">
                                  ✗{dev.activeTesterInfo?.redCount || 0}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Completed runs on this device for the selected date */}
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 pt-1">
                            COMPLETED{' '}
                            {selectedQaDate === todayStr ? 'TODAY' : `(${dateScopeLabel})`} (
                            {deviceCompletedRuns.length})
                          </div>

                          <div className="space-y-1.5 flex-1 overflow-y-auto">
                            {deviceCompletedRuns.map((runItem, idx) => (
                              <div
                                key={runItem.runId + idx}
                                className="bg-[#0b1120] border border-[#1a2540] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">
                                    <span
                                      onClick={() =>
                                        setInspectorTarget({
                                          type: 'tester',
                                          id: runItem.testerName
                                        })
                                      }
                                      className="font-semibold text-slate-200 hover:text-blue-300 cursor-pointer"
                                    >
                                      {runItem.testerName}
                                    </span>
                                    <span className="text-slate-500 text-[11px]">
                                      {' '}
                                      · {runItem.planName}
                                    </span>
                                  </div>
                                  <div className="font-mono text-[11px] text-slate-500">
                                    {runItem.completedAtFormatted} ·{' '}
                                    <span className="text-slate-300">
                                      {runItem.durationFormatted}
                                    </span>
                                  </div>
                                </div>

                                <div className="font-mono text-[11px] flex items-center gap-1.5 shrink-0">
                                  <span className="text-emerald-400">✓{runItem.greenCount}</span>
                                  {runItem.yellowCount > 0 && (
                                    <span className="text-amber-400">!{runItem.yellowCount}</span>
                                  )}
                                  {runItem.redCount > 0 && (
                                    <span className="text-rose-400">✗{runItem.redCount}</span>
                                  )}
                                  {onDeleteTestRun && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (
                                          confirm(
                                            `Delete run record for "${runItem.planName}"?`
                                          )
                                        ) {
                                          onDeleteTestRun(runItem.runId);
                                        }
                                      }}
                                      className="p-0.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer ml-1"
                                      title="Delete run"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    (() => {
                      const inspectedTester = resolvedInspector.tester;
                      return (
                        <>
                          {/* Tester view header with trash + ✕ */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                                TESTER
                              </div>
                              <div className="text-[17px] font-bold text-slate-100 truncate">
                                {inspectedTester.name}
                              </div>
                              <div className="text-xs text-slate-400 truncate">
                                {inspectedTester.dayData.completedCount} completed ·{' '}
                                {inspectedTester.isActive
                                  ? `Active on ${
                                      inspectedTester.activeInfo?.deviceName || 'Device'
                                    }`
                                  : 'Idle'}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Delete tester "${inspectedTester.name}" and all associated performance data?`
                                    )
                                  ) {
                                    if (inspectedTester.id && onDeleteTesterProfile) {
                                      onDeleteTesterProfile(inspectedTester.id);
                                    }
                                    if (onDeleteTester) {
                                      onDeleteTester(inspectedTester.name);
                                    } else if (onDeleteTestRun) {
                                      const runsToDelete = [...testRuns, ...archivedRuns].filter(
                                        r => r.testerName === inspectedTester.name
                                      );
                                      runsToDelete.forEach(r => onDeleteTestRun(r.id));
                                    }
                                    setInspectorTarget(null);
                                    setSelectedInspectorTester('');
                                  }
                                }}
                                className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition cursor-pointer"
                                title={`Delete ${inspectedTester.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setInspectorTarget(null);
                                  setSelectedInspectorTester('');
                                }}
                                className="text-slate-400 hover:text-white text-sm px-1.5 py-0.5 cursor-pointer"
                                title="Close (Esc)"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          {/* Actions row: Boot {device} when active */}
                          {inspectedTester.isActive && onBootTester && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Remote Boot: Kick "${inspectedTester.name}" off "${
                                        inspectedTester.activeInfo?.deviceName || 'device'
                                      }" and release device?`
                                    )
                                  ) {
                                    onBootTester(
                                      inspectedTester.activeInfo?.runId || '',
                                      inspectedTester.activeInfo?.deviceId,
                                      inspectedTester.name,
                                      inspectedTester.activeInfo?.deviceName
                                    );
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 transition cursor-pointer"
                              >
                                Boot {inspectedTester.activeInfo?.deviceName || ''}
                              </button>
                            </div>
                          )}

                          {/* Live run card (click device -> device view) */}
                          {inspectedTester.isActive && inspectedTester.activeInfo && (
                            <div
                              onClick={() =>
                                setInspectorTarget({
                                  type: 'device',
                                  id:
                                    inspectedTester.activeInfo?.deviceId ||
                                    inspectedTester.activeInfo?.deviceName ||
                                    ''
                                })
                              }
                              className="bg-[#0b1222] border border-[#1e3258] rounded-xl p-3 text-xs space-y-1.5 cursor-pointer hover:border-blue-500/60 transition"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-blue-300 truncate">
                                  ● {inspectedTester.activeInfo.isAway ? 'AWAY' : 'LIVE'} ·{' '}
                                  {inspectedTester.activeInfo.deviceName || 'Device'}
                                </span>
                                <span className="font-mono text-slate-200 text-[11px] shrink-0">
                                  Step {inspectedTester.activeInfo.currentStepIndex}/
                                  {inspectedTester.activeInfo.totalSteps}
                                  {inspectedTester.activeInfo.startedAt
                                    ? ` · ${formatOngoingDuration(
                                        inspectedTester.activeInfo.startedAt
                                      )}`
                                    : ''}
                                </span>
                              </div>
                              {inspectedTester.activeInfo.currentStepTitle && (
                                <div className="text-[11px] text-slate-400 truncate">
                                  ↳ {inspectedTester.activeInfo.currentStepTitle}
                                </div>
                              )}
                              <div className="font-mono text-[11px] flex items-center gap-2">
                                <span className="text-emerald-400">
                                  ✓{inspectedTester.activeInfo.greenCount || 0}
                                </span>
                                <span className="text-amber-400">
                                  !{inspectedTester.activeInfo.yellowCount || 0}
                                </span>
                                <span className="text-rose-400">
                                  ✗{inspectedTester.activeInfo.redCount || 0}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Completed runs for selected date */}
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 pt-1">
                            COMPLETED{' '}
                            {selectedQaDate === todayStr ? 'TODAY' : `(${dateScopeLabel})`} (
                            {inspectedTester.completedRunsList.length})
                          </div>

                          <div className="space-y-1.5 flex-1 overflow-y-auto">
                            {inspectedTester.completedRunsList.map((runItem, idx) => (
                              <div
                                key={runItem.runId + idx}
                                className="bg-[#0b1120] border border-[#1a2540] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-slate-200 truncate">
                                    {runItem.planName}
                                  </div>
                                  <div className="font-mono text-[11px] text-slate-500 truncate">
                                    <span
                                      onClick={() =>
                                        setInspectorTarget({
                                          type: 'device',
                                          id: runItem.deviceName
                                        })
                                      }
                                      className="text-slate-300 hover:text-blue-300 cursor-pointer"
                                    >
                                      {runItem.deviceName}
                                    </span>{' '}
                                    · {runItem.completedAtFormatted} ·{' '}
                                    <span className="text-slate-300">
                                      {runItem.durationFormatted}
                                    </span>
                                  </div>
                                </div>

                                <div className="font-mono text-[11px] flex items-center gap-1.5 shrink-0">
                                  <span className="text-emerald-400">✓{runItem.greenCount}</span>
                                  {runItem.yellowCount > 0 && (
                                    <span className="text-amber-400">!{runItem.yellowCount}</span>
                                  )}
                                  {runItem.redCount > 0 && (
                                    <span className="text-rose-400">✗{runItem.redCount}</span>
                                  )}
                                  {onDeleteTestRun && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (
                                          confirm(
                                            `Delete run record for "${runItem.planName}"?`
                                          )
                                        ) {
                                          onDeleteTestRun(runItem.runId);
                                        }
                                      }}
                                      className="p-0.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer ml-1"
                                      title="Delete run"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}


      {/* Tab 1: Overview - Test Plans & Active Runs */}
      {activeTab === 'overview' && (
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
                <span className="text-xs text-slate-400 font-normal">({filteredPlans.length} / {testPlans.length} plans)</span>
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
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${expandedPlanSteps[plan.id] ? 'rotate-180 text-blue-400' : ''}`} />
                          <span>{plan.steps.length} Steps {expandedPlanSteps[plan.id] ? '(Collapse)' : '(View Steps)'}</span>
                        </button>
                        <span>•</span>
                        <span className="font-mono text-[11px]">Created {new Date(plan.createdAt).toLocaleDateString()}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {onRunSubagentTest && (
                          <button
                            type="button"
                            onClick={() => {
                              onRunSubagentTest(plan.id);
                              setActiveTab('features');
                              setSubagentToast(`Subagent executed all ${plan.steps.length} steps in "${plan.name}" for Today! Features populated.`);
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
                          <span className="uppercase tracking-wider text-blue-400">Test Flow Step Sequence ({plan.steps.length} Steps)</span>
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
                                  <p className="text-slate-300 text-[11px] leading-relaxed pl-1">
                                    {step.description}
                                  </p>
                                )}
                                {step.expectedOutcome && (
                                  <div className="text-[11px] text-emerald-300 bg-emerald-950/40 p-2 rounded-lg border border-emerald-800/40">
                                    <span className="text-emerald-400 font-bold uppercase tracking-wider text-[9px] block">Expected Outcome:</span>
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
                      <p className="text-[11px] text-slate-500">Testers will appear here automatically when they begin execution.</p>
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
                    const t = typeof r.timestamp === 'number' ? r.timestamp : r.timestamp ? new Date(r.timestamp).getTime() : 0;
                    return !isNaN(t) ? Math.max(max, t) : max;
                  }, 0);
                  const startedAtMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
                  const refTs = run.lastActivityTimestamp || lastResultTs || (!isNaN(startedAtMs) ? startedAtMs : 0);
                  const isAway = Boolean(refTs && (Date.now() - refTs > 3 * 60 * 1000));

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
                        <span className="truncate max-w-[140px] text-slate-300 font-medium">{plan?.name || run.planName}</span>
                        <span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded font-mono border border-slate-700 flex items-center gap-1">
                          <Smartphone className="w-3 h-3 text-blue-400" />
                          {run.deviceName || 'Device Unset'}
                        </span>
                      </div>

                      {/* Current Step being tested */}
                      {(() => {
                        const currentStepIdx = (run.currentStepIndex !== undefined) ? run.currentStepIndex : completedSteps;
                        const currentStep = plan?.steps[Math.min(currentStepIdx, totalSteps - 1)];
                        const stepTitle = currentStep ? (currentStep.title || currentStep.feature || `Step ${currentStepIdx + 1}`) : undefined;
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
                          <span>{completedSteps} / {totalSteps} steps ({progressPct}%)</span>
                        </div>
                        <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-blue-500 h-full transition-all"
                            style={{ width: `${progressPct}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Delete Session / Boot Tester Button */}
                      {(onBootTester || onDeleteTestRun) && (
                        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Boot tester "${run.testerName || 'Tester'}" off phone mode and terminate this active session?`)) {
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
      )}



      {/* Tab 4: Feature Health Metrics & CUJ Quality Report */}
      {activeTab === 'features' && (
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
                                          <span>{redCount > 0 ? `Non-Golden (${redCount} Red)` : `Non-Golden (${yellowCount} Yellows)`}</span>
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
      )}

      {/* Bugs Feed / Buganizer toggle (hidden only when VITE_BUGANIZER_ENABLED=0) */}
      {activeTab === 'bugs' && BUGANIZER_ENABLED && (
        <div className="inline-flex items-center bg-[#0f172a] border border-slate-800 rounded-2xl p-0.5 gap-0.5 h-8">
          <button type="button" onClick={() => setBugsView('feed')}
            className={`px-3 h-7 rounded-xl text-xs font-semibold ${bugsView === 'feed' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>Bugs Feed</button>
          <button type="button" data-testid="buganizer-tab" onClick={() => setBugsView('buganizer')}
            className={`px-3 h-7 rounded-xl text-xs font-semibold ${bugsView === 'buganizer' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>Buganizer</button>
        </div>
      )}
      {activeTab === 'bugs' && BUGANIZER_ENABLED && (
        <div className={bugsView === 'buganizer' ? '' : 'hidden'}>
          <BuganizerTriage bugs={buganizerBugs} bugCategorizations={bugCategorizations} dismissed={dismissedSuggestions} onDismissedChange={setDismissedSuggestions} nowMs={feedNow} plans={testPlans} onApplyRefinements={onApplyBugRefinements} onPatchBugLog={onPatchBugLog} onPatchBugLogs={onPatchBugLogs} onApplyReproMatches={onApplyReproMatches} rx95Suggestions={rx95Suggestions} onOpenBugsFeed={openInFeed} focusBug={buganizerFocus} onFocused={() => setBuganizerFocus(null)} />
        </div>
      )}

      {/* Tab 3: Bugs Feed (Layout B look: status chips + plan/day/search, tabs New / Bundle Suggestions / Reviewed, one-line rows) */}
      {activeTab === 'bugs' && (!BUGANIZER_ENABLED || bugsView === 'feed') && (() => {
        const fmtT = (iso?: string) => {
          const d = new Date(iso || '');
          return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        };
        const renderFeedBug = (bug: FeedBug) => {
          const isBugExpanded = !!expandedBugIds[bug.id];
          const raw = (bugById.get(bug.id) || bug) as BugLog;
          const filed = effectiveFiled(raw);
          const pending = !filed && raw.filePending;
          const reprod = !filed && effectiveStatus(bug.status) === REPROD;
          const refined = currentRefinement(raw);
          const rowTitle = (refined?.title || bug.title || (bug.note || '').replace(/\s+/g, ' ').trim() || 'No description').slice(0, 200);
          const reviewed = reviewedOf(bug);
          const strong = isStronglyReviewed(raw);
          const sg = suggestionByBugId.get(bug.id);
          return (
            <div key={bug.id} id={`feed-row-${bug.id}`}>
              <div data-testid="feed-row" data-bug-id={bug.id} role="button" tabIndex={0}
                onClick={() => toggleBugExpand(bug.id)} onKeyDown={e => { if (e.key === 'Enter') toggleBugExpand(bug.id); }}
                className={`${rowCls} ${isBugExpanded ? rowOpenCls : ''}`}>
                <span className="text-[10.5px] text-slate-400 w-[58px] whitespace-nowrap">{fmtT(bug.timestamp)}</span>
                <span className="hidden md:inline text-[11.5px] text-slate-400 truncate max-w-[150px]">{bug.testerName || 'Unknown'} · {bug.deviceName || '?'}</span>
                <span className="flex-1 min-w-0 truncate text-slate-100" title={bug.note}>{rowTitle}</span>
                {bug.imageUrl && <ImageIcon className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />}
                <span className="hidden lg:inline text-[11.5px] text-slate-400 truncate max-w-[170px]">{bug.feature || 'General'}</span>
                <span className={`${tagCls} ${TAG_STYLE.new}`}>{bug.bugType || 'Bug'}</span>
                <span className={priTagCls(String(bug.priority || 'P2'))}>{bug.priority || 'P2'}</span>
                {filed && <span data-testid="feed-filed-chip" className={`${tagCls} ${TAG_STYLE.filed} font-black`}>FILED</span>}
                {pending && (
                  <span data-testid="feed-waiting-chip" title="Opened in Buganizer - RX95 stamps it FILED once it finds it there" className={`${tagCls} ${raw.filePending!.expired ? TAG_STYLE.expired : TAG_STYLE.waiting}`}>
                    {raw.filePending!.expired ? '⚠ NOT FOUND' : '⏳ WAITING'}
                  </span>
                )}
                {reprod && <span data-testid="feed-reprod-chip" className={`${tagCls} ${TAG_STYLE.repro}`}>REPRO'D</span>}
                {raw.bundle && <span className={`${tagCls} ${TAG_STYLE.bundle}`}>BUNDLED</span>}
                {sg && (
                  <button type="button" data-testid="feed-dupe-chip" onClick={e => { e.stopPropagation(); jumpToSuggestion(sg.suggestion.id); }}
                    className={`${tagCls} border border-violet-500/50 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20`}
                    title="RX95 thinks this is the same issue as other reports - review it in Bundle Suggestions">
                    🧩 dupe of {sg.members.length - 1}
                  </button>
                )}
                <button type="button" className={rowActionCls} onClick={e => { e.stopPropagation(); toggleBugExpand(bug.id); }}>{isBugExpanded ? 'Close' : 'Open'}</button>
              </div>
              {isBugExpanded && (
                <div data-testid="feed-row-expanded" className={expandedCls}>
                  {(() => {
                    const d = feedDraftFor(bug);
                    const dirty = feedDirty(bug);
                    const canEditText = !!onUpdateBugLog;
                    const loggedAt = new Date(bug.timestamp);
                    const meta = [bug.testerName, bug.deviceName, bug.stepTitle, bug.feature && bug.feature !== 'General' ? bug.feature : ''].filter(Boolean);
                    const hasPhoto = !!(bug.imageUrl && /^(data:image\/|https?:\/\/|blob:|\/)/i.test(bug.imageUrl));
                    const fieldCls = 'w-full bg-[#0f172a] border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-blue-500 read-only:opacity-80 placeholder:text-slate-500 placeholder:font-normal';
                    return (
                      <>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {!strong && (reviewed ? (
                            <button type="button" data-testid="move-to-new" className={smallBtnCls} onClick={() => { moveToNew(bug.id); flashFeed('Moved back to New.'); }}>↩ Move back to New</button>
                          ) : (
                            <button type="button" data-testid="mark-reviewed" className="px-2.5 h-7 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white" onClick={() => { markReviewed(bug.id); flashFeed('Marked reviewed.'); }}>✓ Mark reviewed</button>
                          ))}
                          {BUGANIZER_ENABLED && (
                            <button type="button" data-testid="feed-open-buganizer" className={smallBtnCls} onClick={() => openInBuganizer(bug.id)}>Open in Buganizer tab ↗</button>
                          )}
                          <button type="button" data-testid="feed-delete-bug" onClick={() => {
                              const label = (bug.title || '').trim() || (bug.note || '').trim().slice(0, 80) || 'this bug';
                              if (confirm(`Delete bug "${label}"? This can't be undone.`)) onDeleteBug(bug.id);
                            }}
                            className="ml-auto px-2 h-7 rounded-xl text-[11px] font-semibold text-slate-400 hover:text-rose-300 hover:bg-rose-950/40" title="Delete Bug Log">
                            <Trash2 className="w-3.5 h-3.5 inline mr-1" />Delete
                          </button>
                        </div>
                        <p data-testid="feed-meta" className="text-[11px] text-slate-400 mb-3">
                          {meta.join(' · ')}{meta.length ? ' · ' : ''}Logged {fmtT(bug.timestamp)} {loggedAt.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          {bug.originalTimestamp ? ` (first logged ${new Date(bug.originalTimestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : ''}
                          {refined ? ' · title cleaned up by RX95' : ''}
                        </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="md:col-span-2 space-y-3">
                <div className="space-y-2.5" data-testid="feed-edit-form">
                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <label className={labelCls}>Title</label>
                        <span className="text-[10px] text-slate-500 mb-1">{d.title.length}/120</span>
                      </div>
                      <input
                        data-testid="feed-edit-title"
                        value={d.title}
                        maxLength={120}
                        readOnly={!canEditText}
                        onChange={e => setFeedDraft(bug, { title: e.target.value })}
                        placeholder="Short summary of the bug"
                        className={`${fieldCls} text-sm font-semibold`}
                      />
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <label className={labelCls} title="Same day only">Time</label>
                      <input
                        type="time"
                        data-testid="feed-edit-time"
                        value={d.time}
                        readOnly={!canEditText}
                        onChange={e => setFeedDraft(bug, { time: e.target.value })}
                        className={`${fieldCls} text-xs [color-scheme:dark]`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <textarea
                      data-testid="feed-edit-description"
                      rows={4}
                      value={d.note}
                      readOnly={!canEditText}
                      onChange={e => setFeedDraft(bug, { note: e.target.value })}
                      placeholder="Steps to reproduce, expected vs. actual"
                      className={`${fieldCls} text-xs leading-relaxed`}
                    />
                  </div>
                  {dirty && (
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-[10px] text-slate-400 mr-auto">Unsaved changes · save to carry over to the Buganizer tab.</span>
                      <button type="button" data-testid="feed-edit-cancel" onClick={() => cancelFeedEdit(bug.id)} className="px-3 h-7 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
                      <button type="button" data-testid="feed-edit-save" disabled={!d.title.trim() && !d.note.trim()} onClick={() => saveFeedEdit(bug)} className="px-3 h-7 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">Save</button>
                    </div>
                  )}
                </div>

                {/* Bug Triage Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelCls}>Bug Type</label>
                    <select
                      value={bugCategorizations[bug.id]?.bugType || bug.bugType || 'Bug'}
                      onChange={e => handleUpdateBugCategorization(bug.id, 'bugType', e.target.value)}
                      className={`${inputCls} cursor-pointer`}
                    >
                      {(['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'] as const).map(opt => (
                        <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Priority</label>
                    <select
                      value={bugCategorizations[bug.id]?.priority || bug.priority || 'P2'}
                      onChange={e => handleUpdateBugCategorization(bug.id, 'priority', e.target.value)}
                      className={`${inputCls} cursor-pointer`}
                    >
                      {(['P0', 'P1', 'P2'] as const).map(opt => (
                        <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Status</label>
                    <select
                      data-testid="feed-status"
                      value={effectiveStatus(bugCategorizations[bug.id]?.status || bug.status)}
                      onChange={e => handleUpdateBugCategorization(bug.id, 'status', e.target.value)}
                      className={`w-full bg-[#0f172a] border rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500 cursor-pointer ${effectiveStatus(bugCategorizations[bug.id]?.status || bug.status) === REPROD ? 'border-violet-500/70 text-violet-200 bg-violet-500/10' : 'border-slate-700 text-slate-100'}`}
                    >
                      {TRIAGE_STATUS_OPTIONS.map(opt => (
                        <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {effectiveStatus(bugCategorizations[bug.id]?.status || bug.status) === REPROD && (
                  <p className="text-[11px] text-slate-400" data-testid="feed-repro-hint">
                    💡 "Repro'd Issue" tells RX95 to look for an existing Buganizer bug in this plan's hotlist (shown on the Buganizer tab).
                  </p>
                )}
              </div>

              {/* Evidence photo + Filed */}
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Photo</label>
                  {hasPhoto ? (
                    <div
                      data-testid="feed-photo"
                      onClick={() => setSelectedImagePreviewUrl(bug.imageUrl!)}
                      className="relative group rounded-xl overflow-hidden border border-slate-700 cursor-pointer bg-slate-900 max-h-32 flex items-center justify-center"
                      title="Click for full image"
                    >
                      <img src={bug.imageUrl} alt="Bug screenshot" className="w-full object-cover max-h-32" />
                      <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <span className="px-2.5 py-1 bg-slate-900/95 text-slate-100 border border-slate-600 rounded-xl text-[11px] font-semibold flex items-center gap-1.5">
                          <ImageIcon className="w-3.5 h-3.5 text-blue-400" /> Full image
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p data-testid="feed-no-photo" className="text-[11px] text-slate-500">No photo</p>
                  )}
                </div>
                {(() => {
                  // Filed stamp: from the stored bug (a legacy stored status 'Filed' counts as filed)
                  const rawBug = bugById.get(bug.id) || bug;
                  const filed = effectiveFiled(rawBug);
                  const canEdit = !!(onPatchBugLog || onUpdateBugLog);
                  const setFiled = (next: ReturnType<typeof effectiveFiled>) => {
                    const patch = { ...filedPatch(rawBug, next), reviewed: reviewedNow('reviewed') };
                    if (onPatchBugLog) onPatchBugLog(bug.id, patch);
                    else if (onUpdateBugLog) onUpdateBugLog({ ...rawBug, ...patch });
                  };
                  const draftId = filedIssueDrafts[bug.id] ?? '';
                  const isReprod = effectiveStatus(bugCategorizations[bug.id]?.status || rawBug.status) === REPROD;
                  // RX95's likely existing bugs, offered as one-click picks for the b/ field
                  const followUpPicks = isReprod
                    ? (currentReproMatches(rawBug as BugLog)?.candidates || []).filter(c => c.verdict !== 'unlikely').slice(0, 3)
                    : [];
                  return (
                    <div data-testid="feed-filed" className={`rounded-2xl border p-3 ${filed ? 'border-green-500/40 bg-green-500/[0.05]' : 'border-slate-800 bg-[#111827]'}`}>
                      {filed && (
                        <div data-testid="feed-filed-stamp" className="mb-2.5 border-4 border-green-500 text-green-500 rounded-[14px] py-2.5 text-center font-black text-[28px] tracking-[0.25em] -rotate-3 bg-green-500/[0.08] shadow-[0_0_30px_rgba(34,197,94,0.25)] select-none">
                          FILED
                          {filedStampLine(filed) && <small className="block text-[11px] tracking-normal font-bold text-green-300 mt-0.5">{filedStampLine(filed)}</small>}
                        </div>
                      )}
                      {/* Not a <label>: a label would re-dispatch the click to the switch and toggle it twice */}
                      <div className={`flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200 ${canEdit ? '' : 'opacity-60'}`}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!filed}
                          data-testid="feed-filed-toggle"
                          disabled={!canEdit}
                          onClick={() => {
                            if (filed) setFiled(undefined);
                            else {
                              // A b/ on a Repro'd bug is the existing bug it was followed up on (summary: "(KI, updated)")
                              setFiled(newFiled(isReprod && draftId ? 'follow-up' : 'manual', draftId));
                              setFiledIssueDrafts(prev => { const n = { ...prev }; delete n[bug.id]; return n; });
                            }
                          }}
                          className={`relative w-10 h-[22px] rounded-full transition flex-shrink-0 ${filed ? 'bg-green-500' : 'bg-slate-700'}`}
                        >
                          <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${filed ? 'right-[3px]' : 'left-[3px]'}`} />
                        </button>
                        {filed ? <>Filed <span className="text-[11px] font-medium text-slate-400">(hidden from the Buganizer tab)</span></> : 'Mark as filed'}
                        {!filed && canEdit && (
                          <input
                            data-testid="feed-filed-issue"
                            aria-label="Filed b/ issue number"
                            value={draftId}
                            inputMode="numeric"
                            onChange={e => setFiledIssueDrafts(prev => ({ ...prev, [bug.id]: normalizeIssueId(e.target.value) }))}
                            placeholder={isReprod ? 'b/ followed up on' : 'b/ (optional)'}
                            className="ml-auto w-36 bg-[#0f172a] border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 font-mono font-normal focus:outline-none focus:border-green-500"
                          />
                        )}
                      </div>
                      {!filed && canEdit && isReprod && followUpPicks.length > 0 && (
                        <div data-testid="feed-filed-picks" className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] text-slate-400">Followed up on:</span>
                          {followUpPicks.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              data-testid="feed-filed-pick"
                              title={c.title}
                              onClick={() => setFiledIssueDrafts(prev => ({ ...prev, [bug.id]: normalizeIssueId(String(c.id)) }))}
                              className={`max-w-full truncate text-[10px] px-2 py-0.5 rounded-full border font-mono ${draftId === String(c.id) ? 'border-green-500 bg-green-500/15 text-green-200' : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-green-500/60'}`}
                            >
                              b/{c.id} · {(c.title || '').replace(/^(\[[^\]]*\]\s*)+/, '').slice(0, 48)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        };

        const dayValue = selectedDateFilter === 'custom' ? customDateInput : '';
        const moreActive = selectedFeatureFilter !== 'all' || selectedDeviceFilter !== 'all' || sortByDevice !== 'newest' || (selectedDateFilter !== 'all' && selectedDateFilter !== 'custom');
        const feedTabs = [
          { key: 'new' as const, label: 'New', count: newFeedBugs.length, testid: 'feed-tab-new' },
          { key: 'suggestions' as const, label: 'Bundle Suggestions', count: feedSuggestions.length, testid: 'feed-tab-suggestions' },
          { key: 'reviewed' as const, label: 'Reviewed', count: reviewedFeedBugs.length, testid: 'feed-tab-reviewed' },
        ];
        return (
          <div className="space-y-4" data-testid="bugs-feed">
            {/* Header: status chips + plan / day / search (same look as the Buganizer tab) */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2" data-testid="feed-status-chips">
                <Rx95LiveChip
                  heartbeatAt={rx95Suggestions?.heartbeat?.at}
                  nowMs={feedNow}
                  jobsInProgress={(rx95Suggestions?.heartbeat?.queues?.refine || 0) + (rx95Suggestions?.heartbeat?.queues?.match || 0) + (rx95Suggestions?.heartbeat?.queues?.bundle || 0)}
                  testid="feed-rx95-chip"
                />
                <button type="button" data-testid="feed-chip-new" className={`${chipCls} ${feedTab === 'new' ? chipOn : chipOff}`} onClick={() => setFeedTab('new')}>🆕 <b className="text-white">{newFeedBugs.length}</b> new</button>
                <button type="button" data-testid="feed-chip-suggestions" className={`${chipCls} ${feedTab === 'suggestions' ? chipOn : chipOff}`} onClick={() => setFeedTab('suggestions')}>🧩 <b className="text-white">{feedSuggestions.length}</b> suggestion{feedSuggestions.length === 1 ? '' : 's'}</button>
                <button type="button" data-testid="feed-chip-reviewed" className={`${chipCls} ${feedTab === 'reviewed' ? chipOn : chipOff}`} onClick={() => setFeedTab('reviewed')}>✓ <b className="text-white">{reviewedFeedBugs.length}</b> reviewed</button>
              </div>
              <div className="flex-1" />
              <select aria-label="Plan filter" data-testid="feed-plan" className={`${inputCls} !w-auto max-w-[170px]`} value={selectedPlanFilter} onChange={e => setSelectedPlanFilter(e.target.value)}>
                <option value="all">All plans ({bugLogs.length})</option>
                {bugPlanOptions.map(opt => <option key={opt.planId} value={opt.planId}>{opt.planName} ({opt.count})</option>)}
              </select>
              <input aria-label="Day filter" data-testid="feed-day" type="date" className={`${inputCls} !w-[132px] [color-scheme:dark]`} value={dayValue}
                onChange={e => { const v = e.target.value; if (v) { setSelectedDateFilter('custom'); setCustomDateInput(v); } else { setSelectedDateFilter('all'); setCustomDateInput(''); } }} />
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input aria-label="Search bugs" data-testid="feed-search" className={`${inputCls} pl-7 !w-32`} value={searchBugQuery} onChange={e => setSearchBugQuery(e.target.value)} placeholder="Search…" />
              </div>
              <div className="relative">
                <button type="button" data-testid="feed-more-toggle" className={`${chipCls} ${isBugFilterMenuOpen || moreActive ? chipOn : chipOff}`} onClick={() => setIsBugFilterMenuOpen(!isBugFilterMenuOpen)}>
                  <Filter className="w-3.5 h-3.5" /> More ▾
                </button>
                {isBugFilterMenuOpen && (
                  <div data-testid="feed-more-popover" className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-700 bg-[#0f172a] p-3 space-y-2.5 shadow-2xl">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Date range</label>
                      <select className={inputCls} value={selectedDateFilter} onChange={e => setSelectedDateFilter(e.target.value)}>
                        <option value="all">All dates</option>
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="7days">Last 7 days</option>
                        <option value="30days">Last 30 days</option>
                        <option value="custom">Specific date (header)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">CUJ</label>
                      <select className={inputCls} value={selectedFeatureFilter} onChange={e => setSelectedFeatureFilter(e.target.value)}>
                        <option value="all">All CUJs</option>
                        {uniqueFeatures.map(feat => <option key={feat} value={feat}>{feat}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Device</label>
                      <select className={inputCls} value={selectedDeviceFilter} onChange={e => setSelectedDeviceFilter(e.target.value)}>
                        <option value="all">All devices</option>
                        {uniqueDevices.map(dev => <option key={dev} value={dev}>{dev}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Sort</label>
                      <select className={inputCls} value={sortByDevice} onChange={e => setSortByDevice(e.target.value as any)}>
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="priority">Priority (P0 first)</option>
                        <option value="device-asc">Device (A → Z)</option>
                        <option value="device-desc">Device (Z → A)</option>
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                      <button type="button" className={smallBtnCls} onClick={() => { setSelectedDateFilter('all'); setSelectedFeatureFilter('all'); setSelectedDeviceFilter('all'); setSelectedPlanFilter('all'); setSortByDevice('newest'); setCustomDateInput(''); }}>Reset filters</button>
                      <button type="button" className={smallBtnCls} onClick={() => { setIsBugFilterMenuOpen(false); setIsSheetModalOpen(true); }}>
                        <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1 text-emerald-400" />Sheets sync{autoSyncSheet ? ' · on' : ''}
                      </button>
                      {bugLogs.length > 0 && onWipeAllBugs && (
                        <button type="button" className="px-2.5 h-7 rounded-xl text-xs font-semibold border border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                          onClick={() => { if (window.confirm(`Are you sure you want to wipe all ${bugLogs.length} logged bug(s)? This will permanently remove all defect logs.`)) onWipeAllBugs(); }}>
                          <Trash2 className="w-3.5 h-3.5 inline mr-1" />Wipe all bugs
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <TabBar tabs={feedTabs} active={feedTab} onChange={setFeedTab} testid="feed-tabs" />

            {feedTab === 'suggestions' ? (
              feedSuggestions.length === 0 ? (
                <div className={`${listBoxCls} p-8 text-center text-sm text-slate-400`}>No bundle suggestions for these filters. RX95 suggests them as same-day duplicates come in.</div>
              ) : (
                <BundleSuggestionsPanel
                  shown={feedSuggestions}
                  bugsById={processedBugById}
                  plans={testPlans}
                  dismissed={dismissedSuggestions}
                  onDismissedChange={setDismissedSuggestions}
                  onApply={handleCategorizeAndBundle}
                  collapsed={suggestionsCollapsed}
                  onCollapsedChange={setSuggestionsCollapsed}
                />
              )
            ) : (
              <div className={listBoxCls} data-testid="feed-list">
                {feedRows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-400">
                    {feedTab === 'new' ? (processedBugs.length ? 'Nothing new - every report here has been reviewed.' : 'No matching bugs for these filters.') : 'No reviewed reports for these filters yet.'}
                  </div>
                ) : feedRows.map(row => (row.kind === 'bundle' ? renderFeedBundle(row, renderFeedBug) : renderFeedBug(row.bug)))}
              </div>
            )}
          </div>
        );
      })()}

      {feedToast && activeTab === 'bugs' && (
        <div data-testid="feed-toast" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-2xl bg-slate-800 border border-slate-600 text-xs text-slate-100 shadow-2xl">
          {feedToast}
        </div>
      )}

      {/* Image Lightbox Preview Modal via Dedicated Portal */}
      {selectedImagePreviewUrl && createPortal(
        <div
          onClick={() => setSelectedImagePreviewUrl(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 9999999,
            backgroundColor: 'rgba(2, 6, 23, 0.96)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)'
          }}
        >
          {/* Top Bar - ALWAYS Visible at Top of Screen Viewport */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '1.25rem',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100vw - 2.5rem)',
              maxWidth: '1000px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(51, 65, 85, 0.8)',
              borderRadius: '1rem',
              padding: '0.75rem 1.25rem',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
              zIndex: 10
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedImagePreviewUrl(null)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 transition-all"
            >
              <span>← Back to Dashboard</span>
            </button>

            <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-blue-400" /> Bug Screenshot Preview
            </span>

            <button
              type="button"
              onClick={() => setSelectedImagePreviewUrl(null)}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              title="Close Preview (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Center Image Container - Absolutely positioned to prevent ANY auto-expansion */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '6rem',
              bottom: '6rem',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100vw - 2.5rem)',
              maxWidth: '1000px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#030712',
              borderRadius: '1.25rem',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              padding: '0.75rem',
              overflow: 'hidden',
              boxShadow: '0 20px 40px -10px rgba(0,0,0,0.9)'
            }}
          >
            <img
              src={selectedImagePreviewUrl}
              alt="Evidence Screenshot"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '0.75rem',
                boxShadow: '0 10px 30px rgba(0,0,0,0.9)'
              }}
            />
          </div>

          {/* Bottom Bar - Pinned at Bottom of Screen Viewport */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: '1.25rem',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100vw - 2.5rem)',
              maxWidth: '1000px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid rgba(51, 65, 85, 0.8)',
              borderRadius: '1rem',
              padding: '0.75rem 1.25rem',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
              zIndex: 10
            }}
          >
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              Tap anywhere outside image or press Esc to close
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.src = selectedImagePreviewUrl;
                    await new Promise((resolve, reject) => {
                      img.onload = resolve;
                      img.onerror = reject;
                    });
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0);
                    canvas.toBlob(async (blob) => {
                      if (!blob) {
                        console.warn('Could not export image blob for clipboard.');
                        return;
                      }
                      if (navigator.clipboard && window.ClipboardItem) {
                        await navigator.clipboard.write([
                          new ClipboardItem({ 'image/png': blob })
                        ]);
                        setCopiedImage(true);
                        setTimeout(() => setCopiedImage(false), 2000);
                      }
                    }, 'image/png');
                  } catch (err) {
                    console.error('Failed to copy image to clipboard:', err);
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl border border-blue-500 cursor-pointer transition active:scale-95 flex items-center gap-1.5 shadow-sm"
                title="Copy raw image to clipboard"
              >
                {copiedImage ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                    <span className="text-emerald-200">Image Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-white" />
                    <span>Copy Image</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSelectedImagePreviewUrl(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl border border-slate-700 cursor-pointer transition active:scale-95"
              >
                ← Back
              </button>
            </div>
          </div>
        </div>,
        document.getElementById('modal-portal') || document.body
      )}

      {/* Gemini AI Key Configuration Modal Portal */}
      {isApiKeyModalOpen && createPortal(
        <div
          onClick={() => setIsApiKeyModalOpen(false)}
          className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="liquid-glass-panel rounded-3xl p-6 max-w-md w-full border border-slate-700 shadow-2xl bg-[#111827] space-y-4 text-left animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-500/15 text-blue-300 rounded-xl border border-blue-500/30">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Gemini AI Summarization Key</h4>
                  <p className="text-[11px] text-slate-400 font-medium">Power executive QA summaries with Gemini</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsApiKeyModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed space-y-2">
              <p>
                To generate accurate executive defect summaries without conversational noise, enter your Gemini API Key.
              </p>
              <p className="text-[11px] text-slate-400">
                Keys are stored locally in your browser (<code className="text-blue-300 font-mono">localStorage</code>). You can generate a free key at{' '}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline font-semibold hover:text-blue-300"
                >
                  Google AI Studio
                </a>.
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsApiKeyModalOpen(false);
                  openChatSummary();
                }}
                className="text-[11px] text-blue-300 hover:text-blue-200 font-semibold underline underline-offset-2 transition"
              >
                Can't get a key? Summarize with an AI chat instead →
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-300">Gemini API Key</label>
                <button
                  type="button"
                  disabled={isTestingKey || !tempApiKey.trim()}
                  onClick={async () => {
                    if (!tempApiKey.trim()) return;
                    setIsTestingKey(true);
                    setTestKeyStatus(null);
                    try {
                      const res = await discoverAvailableGeminiModels(tempApiKey.trim());
                      if (res.success && res.models.length > 0) {
                        // Only text models that can write summaries, best first (no TTS/image/retired models)
                        const ranked = rankModelsForSummaries(res.models);
                        const keepCurrent = ranked.includes(tempModel.trim());
                        const chosen = keepCurrent ? tempModel.trim() : ranked[0];
                        setTestKeyStatus({
                          success: true,
                          message: chosen
                            ? `✅ Key verified! ${ranked.length} summary-capable model(s) available - using ${chosen}.`
                            : `✅ Key verified, but no text model suitable for summaries was found (${res.models.slice(0, 3).join(', ')}${res.models.length > 3 ? '...' : ''}).`,
                          models: ranked.length > 0 ? ranked : res.models
                        });
                        if (chosen) setTempModel(chosen);
                      } else {
                        const keyHint = getGeminiKeyErrorHint(res.error);
                        setTestKeyStatus({
                          success: false,
                          message: keyHint
                            ? `❌ ${keyHint} (Google said: ${res.error})`
                            : `❌ ${res.error || 'No supported models found for this key.'}`
                        });
                      }
                    } catch (e: any) {
                      setTestKeyStatus({
                        success: false,
                        message: `❌ ${e?.message || 'Connection test failed.'}`
                      });
                    } finally {
                      setIsTestingKey(false);
                    }
                  }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 disabled:opacity-50 transition cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isTestingKey ? 'animate-spin text-blue-300' : ''}`} />
                  <span>{isTestingKey ? 'Testing...' : 'Test Key & Detect Models'}</span>
                </button>
              </div>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={tempApiKey}
                onChange={e => {
                  setTempApiKey(e.target.value);
                  setTestKeyStatus(null);
                }}
                className="w-full bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none"
              />
              {testKeyStatus && (
                <div className={`p-2 rounded-lg text-[10.5px] border leading-relaxed ${
                  testKeyStatus.success
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                }`}>
                  {testKeyStatus.message}
                </div>
              )}
            </div>

            {/* Model Selector */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                <span>Gemini Model</span>
                <span className="text-[10px] text-blue-400 font-semibold">Customizable</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={`e.g. ${DEFAULT_GEMINI_MODEL}`}
                  value={tempModel}
                  onChange={e => setTempModel(e.target.value)}
                  className="flex-1 bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none"
                />
                <select
                  value={tempModel}
                  onChange={e => setTempModel(e.target.value)}
                  className="bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-2.5 py-2 text-xs text-blue-300 font-medium focus:outline-none cursor-pointer max-w-[150px] truncate"
                >
                  {testKeyStatus?.models && testKeyStatus.models.length > 0 ? (
                    testKeyStatus.models.map(m => (
                      <option key={m} value={m} className="bg-slate-900 text-slate-200">
                        {m}
                      </option>
                    ))
                  ) : (
                    GEMINI_MODELS.map(m => (
                      <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                        {m.id}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <p className="text-[10.5px] text-slate-400">
                Default: <code className="text-blue-300 font-mono">{DEFAULT_GEMINI_MODEL}</code>. You can select an auto-detected model or type any model ID. Retired models (Gemini 1.5 / 2.0) are switched to the default automatically.
              </p>
            </div>

            {/* Optional Disclaimer / Test Notes */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300">Test Context / Disclaimer (Optional)</label>
              <input
                type="text"
                placeholder="e.g. During these tests, we removed local flag overrides for Maps and Instacart."
                value={reportDisclaimer}
                onChange={e => {
                  setReportDisclaimer(e.target.value);
                  localStorage.setItem('qa_report_disclaimer', e.target.value);
                }}
                className="w-full bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsApiKeyModalOpen(false);
                  handleExecuteCopyReport(true); // run standard summary without key
                }}
                className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
              >
                Skip / Use Standard
              </button>
              <button
                type="button"
                onClick={() => {
                  saveGeminiApiKey(tempApiKey.trim());
                  saveGeminiModel(tempModel);
                  setIsApiKeyModalOpen(false);
                  handleExecuteCopyReport(false);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm border border-blue-500 active:scale-95 transition"
              >
                Save & Run AI Summary
              </button>
            </div>
          </div>
        </div>,
        document.getElementById('modal-portal') || document.body
      )}

      {/* AI Chat (no API key) Modal Portal */}
      {isChatSummaryOpen && createPortal(
        <div
          onClick={() => setIsChatSummaryOpen(false)}
          className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="liquid-glass-panel rounded-3xl p-6 max-w-lg w-full border border-slate-700 shadow-2xl bg-[#111827] space-y-4 text-left animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-500/15 text-blue-300 rounded-xl border border-blue-500/30">
                  <MessageSquareText className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Summarize with an AI chat</h4>
                  <p className="text-[11px] text-slate-400 font-medium">No API key needed - use any AI chat you're allowed to use</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsChatSummaryOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {chatNotice && (
              <div className="p-2 rounded-lg text-[10.5px] border leading-relaxed bg-amber-950/50 border-amber-500/40 text-amber-200">
                {chatNotice}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-slate-300">1. The prompt is already on your clipboard (the bugs in this report plus instructions)</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyChatPrompt}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition active:scale-95 ${
                    chatPromptCopied
                      ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40'
                      : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 border-blue-500/40'
                  }`}
                >
                  {chatPromptCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{chatPromptCopied ? 'Prompt copied - copy again' : 'Copy prompt'}</span>
                </button>
                <a
                  href={GEMINI_CHAT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 transition active:scale-95"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Gemini</span>
                </a>
                <label className="flex items-center gap-1.5 text-[10.5px] text-slate-400 hover:text-slate-200 cursor-pointer select-none transition">
                  <input
                    type="checkbox"
                    checked={chatAutoOpenGemini}
                    onChange={e => toggleChatAutoOpenGemini(e.target.checked)}
                    className="accent-blue-500 w-3.5 h-3.5 cursor-pointer"
                  />
                  <span>Open Gemini automatically</span>
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-300">2. Paste it into Gemini or Antigravity and send it</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Then copy the AI's whole reply - it's a block of JSON.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-300">3. Come back to this tab - the report builds itself</p>
                <button
                  type="button"
                  onClick={handlePasteChatReplyFromClipboard}
                  className="text-[10px] text-blue-300 hover:text-blue-200 font-semibold flex items-center gap-1 transition"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span>Paste from clipboard</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                It's copied for you as soon as it's built. If Chrome asks, allow clipboard access - or just press ⌘V (Ctrl+V) on this page.
              </p>
              <textarea
                value={chatReplyText}
                onChange={e => {
                  setChatReplyText(e.target.value);
                  setChatStatus(null);
                }}
                placeholder='Or paste the reply here: {"reportId": "QA-...", "features": [...], "overallSummary": "..."}'
                rows={4}
                className="w-full bg-[#0f172a] border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-[11px] text-white font-mono placeholder-slate-500 focus:outline-none resize-y"
              />
            </div>

            {chatStatus && (
              <div className={`p-2 rounded-lg text-[10.5px] border leading-relaxed ${
                chatStatus.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
              }`}>
                {chatStatus.message}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsChatSummaryOpen(false);
                    handleExecuteCopyReport(true); // basic offline summary, no AI
                  }}
                  className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-200 transition"
                >
                  Use basic summary
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsChatSummaryOpen(false);
                    setTempApiKey(getStoredGeminiApiKey());
                    setTempModel(getStoredGeminiModel());
                    setIsApiKeyModalOpen(true);
                  }}
                  className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-200 transition"
                >
                  {getStoredGeminiApiKey() ? 'Change API key' : 'Add API key'}
                </button>
              </div>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsChatSummaryOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!chatReplyText.trim() || isGeneratingSummary}
                onClick={handleBuildReportFromChatReply}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm border border-blue-500 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Build Report
              </button>
              </div>
            </div>
          </div>
        </div>,
        document.getElementById('modal-portal') || document.body
      )}

      {/* Google Sheets Integration Modal Portal */}
      {isSheetModalOpen && createPortal(
        <div
          onClick={() => setIsSheetModalOpen(false)}
          className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="liquid-glass-panel rounded-3xl p-6 max-w-lg w-full border border-slate-700 shadow-2xl bg-[#111827] space-y-4 text-left animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/20 text-emerald-300 rounded-xl border border-emerald-500/30">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Google Sheets Bug Integration</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Live
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400 font-medium">Automatic multi-tab spreadsheet sync with smart dropdowns</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSheetModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sync Feedback Alert */}
            {sheetSyncStatus && (
              <div className={`p-3 rounded-2xl border text-xs font-semibold flex items-center gap-2 ${
                sheetSyncStatus.success 
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                  : 'bg-rose-950/80 text-rose-300 border-rose-500/40'
              }`}>
                {sheetSyncStatus.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
                <span>{sheetSyncStatus.message}</span>
              </div>
            )}

            {/* Webhook URL Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                <span>Google Apps Script Web App URL</span>
                <span className="text-[10px] text-slate-400 font-normal">Deployed Webhook URL</span>
              </label>
              <input
                type="url"
                value={googleSheetUrl}
                onChange={e => {
                  setGoogleSheetUrl(e.target.value);
                  localStorage.setItem('qa_google_sheet_url', e.target.value);
                }}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full liquid-glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
              />
            </div>

            {/* Controls: Auto-Sync Toggle & Sync Now Button */}
            <div className="p-3.5 rounded-2xl bg-[#0f172a] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">Auto-Sync Every 1 Minute</div>
                  <div className="text-[11px] text-slate-400">Automatically sync fresh bugs to Google Sheets every 60 seconds while viewing the dashboard</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !autoSyncSheet;
                    setAutoSyncSheet(next);
                    localStorage.setItem('qa_auto_sync_sheet', String(next));
                  }}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                    autoSyncSheet ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      autoSyncSheet ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                <a
                  href="https://docs.google.com/spreadsheets/d/1p5VfZLm5w9w5XGtbmKxroWwUxgWNxcwU8a0DnCoqCBk/edit"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700 active:scale-95"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                  <span>Open Spreadsheet</span>
                </a>
                <button
                  type="button"
                  disabled={isSyncingSheet || !googleSheetUrl.trim()}
                  onClick={() => handleSyncToGoogleSheet(processedBugs)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm border border-blue-500 active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {isSyncingSheet ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Syncing...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-3.5 h-3.5 text-white" />
                      <span>Sync All {processedBugs.length} Bugs</span>
                    </>
                  )}
                </button>
              </div>

              {/* In-Sheet Direct Control Tip */}
              <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-500/20 text-[11px] text-blue-200 leading-relaxed">
                <b>24/7 Cloud Background Sync:</b> Inside your Google Sheet, click the top menu <b>QA Manager</b> &gt; <b>Enable Auto-Sync (Every 1 Min)</b>. Google's cloud will automatically pull fresh bugs from the database every 60 seconds even when this app is closed!
              </div>
            </div>

            {/* Smart Dropdown Explanation & Features */}
            <div className="space-y-2 text-xs text-slate-300">
              <div className="font-bold text-white flex items-center gap-1.5">
                <span>Features Configured in Google Sheets:</span>
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-400">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span><b>Individual Tester Smart Tables:</b> Creates a separate page for each tester (e.g. Eric, Gianna D, Ed, John) + All Bugs master table.</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                  <span><b>Smart Table Features:</b> Interactive filter/sort dropdowns on every column, alternating banded rows, and frozen headers.</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  <span><b>Smart Dropdowns:</b> Pre-configured with Bug Type, Priority (P0, P1, P2 / 0, 1, 2), and Status chips with color pills.</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                  <span><b>Clean 10-Column Smart Table:</b> Severity, Screenshot Preview, and Bug ID removed for maximum clarity; screenshots open via clean clickable links.</span>
                </li>
              </ul>
            </div>

            {/* Google Apps Script Code Accordion / Copy */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Google Sheet Apps Script (Code.gs)</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
                    setCopiedCodeGs(true);
                    setTimeout(() => setCopiedCodeGs(false), 3000);
                  }}
                  className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 flex items-center gap-1.5 transition cursor-pointer active:scale-95"
                >
                  {copiedCodeGs ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-blue-300" />
                      <span>Copy Code.gs</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Paste this into your Google Sheet under <b>Extensions &gt; Apps Script &gt; Code.gs</b> and deploy as a Web App with access set to <i>Anyone</i>.
              </p>
            </div>
          </div>
        </div>,
        document.getElementById('modal-portal') || document.body
      )}

      {/* Summary Status Toast */}
      {summaryToast && createPortal(
        <div className="fixed top-5 left-1/2 transform -translate-x-1/2 z-[9999999] max-w-lg w-full px-4 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`p-3.5 rounded-2xl border shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs font-semibold ${
            summaryToast.type === 'success'
              ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/40 shadow-emerald-950/50'
              : summaryToast.type === 'error'
              ? 'bg-rose-950/95 text-rose-200 border-rose-500/40 shadow-rose-950/50'
              : 'bg-amber-950/95 text-amber-200 border-amber-500/40 shadow-amber-950/50'
          }`}>
            <Sparkles className={`w-4 h-4 flex-shrink-0 ${
              summaryToast.type === 'success' ? 'text-emerald-400' : summaryToast.type === 'error' ? 'text-rose-400' : 'text-amber-400'
            }`} />
            <span className="leading-snug">{summaryToast.message}</span>
          </div>
        </div>,
        document.getElementById('modal-portal') || document.body
      )}

    </div>
  );
};
