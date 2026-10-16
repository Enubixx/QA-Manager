import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, DevicePlanQuota, RefinedBugText, ReproMatches } from '../types';
import { REPROD, TRIAGE_STATUS_OPTIONS, effectiveFiled, effectiveStatus, filedPatch, filedStampLine, newFiled, normalizeIssueId } from '../utils/reproFollowUp';
import { ListChecks, Bug, Clock, Plus, Play, Trash2, Smartphone, CheckCircle2, AlertTriangle, XCircle, Download, User, Filter, ArrowUpDown, Tag, Activity, Copy, FileJson, Upload, Search, Image as ImageIcon, Sparkles, X, Calendar, Edit, BarChart2, Camera, TrendingUp, TrendingDown, History, ChevronDown, ChevronUp, RefreshCw, UserCheck, Timer, Layers, FileSpreadsheet, ExternalLink, MessageSquareText, ClipboardPaste, Bot } from 'lucide-react';
import { exportAllQADataToCSV, exportAllQADataToJSON, exportBugsToCSV, copyBugsToClipboard, copySingleBugToClipboard } from '../utils/exportUtils';
import { isRunFullyCompleted, buildStepFirstSeenIndex } from '../utils/runUtils';
import { toLocalHHMM, withBugTime } from '../utils/bugTime';
import { ALL_PLANS, ALL_DATES, mergeRunsById, getKnownCujNames, computeCujReport, listReportDates, buildTimelinePoints, getPlanPickerOptions, buildCujReportText, buildReportScopeKey, formatReportDateLabel } from '../utils/cujReportUtils';
import type { CujMetric } from '../utils/cujReportUtils';
import { summarizeFeatureBugsWithGemini, summarizeOverallBugsWithGemini, generateBatchExecutiveSummaryWithGemini, getBriefIssueSummarySync, nlpCleanReword, getStoredGeminiApiKey, saveGeminiApiKey, GEMINI_MODELS, getStoredGeminiModel, saveGeminiModel, discoverAvailableGeminiModels, rankModelsForSummaries, DEFAULT_GEMINI_MODEL, getGeminiKeyErrorHint, buildChatSummaryPrompt, applyChatSummaryReply, isChatSummaryPrompt, getChatReplyReportId } from '../services/geminiService';
import { requestRx95Summary, isRx95Available } from '../services/rx95Service';
import BuganizerTriage from './BuganizerTriage';

/** Buganizer triage view: on by default; set VITE_BUGANIZER_ENABLED=0 to hide it. */
const BUGANIZER_ENABLED = ((import.meta as any).env?.VITE_BUGANIZER_ENABLED || '') !== '0';
import type { ExecutiveQAResult, SummaryScopeContext } from '../services/geminiService';
import { GOOGLE_APPS_SCRIPT_CODE } from '../googleAppsScriptCode';
import { toBlob } from 'html-to-image';

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
  const [testerViewMode, setTesterViewMode] = useState<'all' | 'active'>('all');
  const [searchTesterQuery, setSearchTesterQuery] = useState('');

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

    // 1. Check devices that are currently locked by a tester WITH an actual in_progress run
    devices.forEach(d => {
      const activeTester = d.activeTesterName?.trim();
      if (activeTester) {
        const activeRun = testRuns.find(r => 
          r.status === 'in_progress' && (
            (d.activeRunId && r.id === d.activeRunId) || 
            (r.deviceId && r.deviceId.toLowerCase().trim() === d.id.toLowerCase().trim()) ||
            (r.deviceName && r.deviceName.toLowerCase().trim() === d.name.toLowerCase().trim()) ||
            (r.testerName && r.testerName.toLowerCase().trim() === activeTester.toLowerCase())
          )
        );
        if (activeRun) {
          computeMetrics(activeTester, d.name, activeRun, d.id);
        }
      }
    });

    // 2. Also check in_progress runs directly so step changes sync with zero lag
    testRuns.forEach(r => {
      if (r.status === 'in_progress' && r.testerName && r.testerName.trim()) {
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
  }, [devices, testRuns, testPlans]);

  // Archived + active runs, one per id (active copy wins), and when each plan step was first
  // recorded - the history-aware "finished run" rule judges runs against the steps that existed then.
  const mergedRuns = useMemo(() => mergeRunsById(archivedRuns, testRuns), [archivedRuns, testRuns]);
  const stepFirstSeen = useMemo(() => buildStepFirstSeenIndex(mergedRuns), [mergedRuns]);

  // Calculate completed runs today per device ID and plan ID (deduplicated by run.id)
  const todayRunsMap = useMemo(() => {
    const todayStr = getLocalDateStr(new Date());
    const map: Record<string, Record<string, number>> = {};
    const runMap = new Map<string, TestRun>();
    [...archivedRuns, ...testRuns].forEach(r => {
      if (r && r.id) runMap.set(r.id, r);
    });
    
    runMap.forEach(run => {
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
  }, [archivedRuns, testRuns, devices, testPlans, stepFirstSeen]);

  const fleetProgress = useMemo(() => {
    let totalTarget = 0;
    let totalCompleted = 0;
    devices.forEach(dev => {
      const seenPlans = new Set<string>();
      (dev.quotas || []).forEach(q => {
        if (!q || !q.planId || seenPlans.has(q.planId)) return;
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
  }, [devices, todayRunsMap]);

  const toggleTesterExpand = (testerName: string) => {
    setExpandedTesters(prev => ({
      ...prev,
      [testerName]: !prev[testerName]
    }));
  };

  const [expandedBugIds, setExpandedBugIds] = useState<Record<string, boolean>>({});
  // Bugs Feed inline edit (title + description) so bugs can be tidied before the Buganizer tab
  const [feedEdit, setFeedEdit] = useState<{ bugId: string; title: string; note: string; time: string } | null>(null);
  const startFeedEdit = (bug: BugLog) => {
    setExpandedBugIds(prev => ({ ...prev, [bug.id]: true }));
    setFeedEdit({ bugId: bug.id, title: bug.title || '', note: bug.title && bug.note === bug.title ? '' : (bug.note || ''), time: toLocalHHMM(bug.timestamp) });
  };
  const saveFeedEdit = (bug: BugLog) => {
    if (!feedEdit || !onUpdateBugLog) return;
    const title = feedEdit.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    const note = feedEdit.note.trim() || title;
    if (!title && !note) return;
    onUpdateBugLog(withBugTime({ ...bug, title: title || undefined, note }, feedEdit.time));
    setFeedEdit(null);
  };

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
  const [copiedBugs, setCopiedBugs] = useState<boolean>(false);
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
      onUpdateBugLog({
        ...targetBug,
        ...keepLegacyFiled,
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
                bugType: cat?.bugType || b.bugType || 'Bug',
                priority: cat?.priority || b.priority || (b.severity === 'critical' ? 'P0' : b.severity === 'high' ? 'P1' : 'P2'),
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

  const handleCopyBugsToClipboard = async () => {
    const filterLabelDate = selectedDateFilter === 'all' 
      ? 'All Dates' 
      : selectedDateFilter === 'today' 
      ? 'Today' 
      : selectedDateFilter === 'yesterday' 
      ? 'Yesterday' 
      : selectedDateFilter === '7days' 
      ? 'Last 7 Days' 
      : selectedDateFilter === '30days' 
      ? 'Last 30 Days' 
      : customDateInput || 'Custom Date';

    const success = await copyBugsToClipboard(processedBugs, {
      dateFilter: filterLabelDate,
      featureFilter: selectedFeatureFilter,
      deviceFilter: selectedDeviceFilter,
      planFilter: selectedPlanFilterName || undefined,
      searchQuery: searchBugQuery.trim() || undefined
    });

    if (success) {
      setCopiedBugs(true);
      setTimeout(() => setCopiedBugs(false), 2500);
    }
  };

  const [copiedSingleBugId, setCopiedSingleBugId] = useState<string | null>(null);

  const handleCopySingleBug = async (bug: BugLog) => {
    const success = await copySingleBugToClipboard(bug);
    if (success) {
      setCopiedSingleBugId(bug.id);
      setTimeout(() => setCopiedSingleBugId(null), 2500);
    }
  };

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImagePreviewUrl, isVisualSnapshotModalOpen, isChatSummaryOpen, isApiKeyModalOpen, isSheetModalOpen, isBugFilterMenuOpen]);

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
    const map = new Map<string, TestRun>();
    const combined = [...archivedRuns, ...testRuns];
    combined.forEach(run => {
      if (isRunFullyCompleted(run, testPlans, stepFirstSeen)) {
        map.set(run.id, run);
      }
    });
    return Array.from(map.values());
  }, [testRuns, archivedRuns, testPlans, stepFirstSeen]);

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
  const todayStr = useMemo(() => getLocalDateStr(new Date()), []);

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
    const runsMap = new Map<string, TestRun>();
    [...archivedRuns, ...testRuns].forEach(r => {
      if (r && r.id) runsMap.set(r.id, r);
    });
    const combinedRuns = Array.from(runsMap.values());
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
  const activeRuns = testRuns.filter(r => getEffectiveRunStatus(r) === 'in_progress').length;
  const totalBugs = bugLogs.length;

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



      {/* Unified Top Navigation KPI Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        
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

        {/* Card 2: Devices & Quotas */}
        <div
          onClick={() => setActiveTab('devices')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
            activeTab === 'devices'
              ? '!bg-[#162033] !border-blue-500 ring-1 ring-blue-500/30 shadow-md'
              : 'hover:border-slate-700'
          }`}
          title="Click to manage Devices & Daily Test Quotas"
        >
          <div>
            <div className={`text-xs font-semibold ${activeTab === 'devices' ? 'text-slate-200' : 'text-slate-400'} flex items-center gap-1.5`}>
              <span>Devices & Quotas</span>
              {activeTab === 'devices' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </div>
            <div className="text-xl font-bold text-slate-50 mt-1 font-mono tracking-tight">{devices.length} Devices</div>
          </div>
          <div className={`p-2.5 rounded-2xl border transition-all ${
            activeTab === 'devices'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'bg-slate-800/90 text-slate-400 border-slate-700/80'
          }`}>
            <Smartphone className="w-4 h-4" />
          </div>
        </div>

        {/* Card 3: QA Testers */}
        <div
          onClick={() => setActiveTab('testers')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
            activeTab === 'testers'
              ? '!bg-[#162033] !border-blue-500 ring-1 ring-blue-500/30 shadow-md'
              : 'hover:border-slate-700'
          }`}
          title="Click to view & create QA Tester Profiles"
        >
          <div>
            <div className={`text-xs font-semibold ${activeTab === 'testers' ? 'text-slate-200' : 'text-slate-400'} flex items-center gap-1.5`}>
              <span>QA Testers</span>
              {activeTab === 'testers' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </div>
            <div className="text-xl font-bold text-slate-50 mt-1 font-mono tracking-tight">{unifiedTesters.length} Testers</div>
          </div>
          <div className={`p-2.5 rounded-2xl border transition-all ${
            activeTab === 'testers'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'bg-slate-800/90 text-slate-400 border-slate-700/80'
          }`}>
            <UserCheck className="w-4 h-4" />
          </div>
        </div>

        {/* Card 4: CUJ Quality Report */}
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

        {/* Card 5: Bugs Feed */}
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

      {/* Tab 2: Devices & Daily Target Quotas */}
      {activeTab === 'devices' && (
        <div className="space-y-8">
          
          {/* Fleet Daily Quota Overview Badge Banner */}
          <div className="liquid-glass-panel rounded-3xl p-6 bg-[#111827] border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-bold text-slate-50 tracking-tight">Fleet Daily Quota Progress</h3>
              </div>
              <p className="text-xs text-slate-400">
                Preset device targets enforce daily test run quotas on mobile devices.
              </p>
            </div>

            <div className="flex items-center gap-4 flex-wrap justify-end">
              <div className="text-right">
                <div className="text-2xl font-bold text-slate-50 font-mono">
                  {fleetProgress.totalCompleted} / {fleetProgress.totalTarget} <span className="text-xs text-slate-400 font-sans font-normal">runs completed</span>
                </div>
                <div className="text-xs font-semibold text-slate-400">{fleetProgress.pct}% Fleet Goal Reached</div>
              </div>
              
              <button
                type="button"
                onClick={() => {
                  if (confirm("Reset today's completed run counters and today's test execution data across all devices?")) {
                    if (onResetActiveDay) onResetActiveDay(getLocalDateStr(new Date()));
                  }
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                <span>Reset Counters</span>
              </button>

              {onResetDailyQuotas && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Reset all device quotas to "No Plan Assigned" for today? (This clears plan assignments so you can assign new ones for the day)')) {
                      onResetDailyQuotas();
                    }
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                  title="Clear all device assignments to No Plan Assigned"
                >
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <span>Clear to No Plan</span>
                </button>
              )}

              {onUpdateMinAppVersion && (
                <div className="flex items-center gap-1.5 bg-[#0f172a] border border-slate-700/80 px-3 py-1.5 rounded-2xl text-xs">
                  <span className="text-[11px] text-slate-400 font-semibold">Required APK:</span>
                  <select
                    value={minAppVersion || 1}
                    onChange={(e) => onUpdateMinAppVersion(parseInt(e.target.value, 10))}
                    className="bg-slate-800 text-blue-300 font-bold border border-slate-700 rounded-lg px-2 py-0.5 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value={1}>v1.0 (Allow All)</option>
                    <option value={2}>v2.0+</option>
                    <option value={3}>v2.1+</option>
                    <option value={4}>v2.2+</option>
                    <option value={5}>v2.3.0 (Latest)</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-50 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-400" />
                <span>Registered Devices ({devices.length})</span>
              </h3>
            </div>

            {/* Add Device Form */}
            <div className="liquid-glass-card rounded-2xl p-4 border border-slate-800 flex items-center gap-3">
              <input
                type="text"
                placeholder="Enter device model or name (e.g. Google Pixel 8)..."
                value={newDeviceName}
                onChange={e => setNewDeviceName(e.target.value)}
                className="flex-1 bg-[#0f172a] border border-slate-700/80 rounded-2xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
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
                  setNewDeviceName('');
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 rounded-2xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Device</span>
              </button>
            </div>

            {/* Devices Cards List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devices.length === 0 ? (
                <div className="md:col-span-2 liquid-glass-card rounded-2xl p-8 text-center text-slate-400 text-xs font-medium">
                  No devices registered. Add a device above to set daily test quotas.
                </div>
              ) : (
                devices.map(device => {
                  const assignedQuota = device.quotas && device.quotas.length > 0 ? device.quotas[0] : null;
                  const assignedPlan = assignedQuota ? testPlans.find(p => p.id === assignedQuota.planId) : null;
                  const targetRuns = assignedQuota ? Math.max(1, assignedQuota.targetRunsPerDay || 1) : 3;
                  const doneToday = (assignedQuota && todayRunsMap[device.id] && todayRunsMap[device.id][assignedQuota.planId]) || 0;
                  const remaining = assignedQuota ? Math.max(0, targetRuns - doneToday) : 0;
                  const pct = assignedQuota && targetRuns > 0 ? Math.min(100, Math.round((doneToday / targetRuns) * 100)) : 0;

                  const activeRunForDevice = testRuns.find(r => 
                    getEffectiveRunStatus(r) === 'in_progress' && 
                    (r.id === device.activeRunId || (r.deviceId && r.deviceId === device.id) || (r.deviceName && r.deviceName.toLowerCase().trim() === device.name.toLowerCase().trim()))
                  );
                  const isInUse = Boolean(activeRunForDevice || (device.activeRunId && device.activeTesterName));
                  const inUseTesterName = activeRunForDevice?.testerName || device.activeTesterName || 'Tester';

                  return (
                    <div key={device.id} className="liquid-glass-panel rounded-2xl p-5 border border-slate-800 space-y-4 bg-[#111827] shadow-lg">
                      
                      {/* Device Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-2xl bg-slate-800/90 text-blue-400 border border-slate-700/80">
                            <Smartphone className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-slate-50">{device.name}</h4>
                              {isInUse ? (
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 ${
                                  activeTesterMap.get(inUseTesterName.toLowerCase().trim())?.isAway
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse'
                                }`}>
                                  {activeTesterMap.get(inUseTesterName.toLowerCase().trim())?.isAway ? (
                                    <Clock className="w-3 h-3 text-amber-400" />
                                  ) : (
                                    <Timer className="w-3 h-3 text-rose-400" />
                                  )}
                                  <span>
                                    {activeTesterMap.get(inUseTesterName.toLowerCase().trim())?.isAway ? 'Away: ' : 'In Use by '}
                                    {inUseTesterName}
                                    {activeRunForDevice?.startedAt && (
                                      <span className="ml-1.5 font-mono text-[9px] text-rose-200/90 font-bold">
                                        ({formatOngoingDuration(activeRunForDevice.startedAt)})
                                      </span>
                                    )}
                                  </span>
                                </span>
                              ) : device.isReady && assignedQuota && doneToday >= targetRuns ? (
                                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>Quota Met</span>
                                </span>
                              ) : null}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono">ID: {device.id}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isInUse && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const updated: DeviceProfile = { ...device, activeRunId: undefined, activeTesterName: undefined };
                                if (onSaveDevice) onSaveDevice(updated);
                              }}
                              className="px-2.5 py-1.5 rounded-2xl text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all"
                              title="Force unlock stale device session"
                            >
                              Unlock
                            </button>
                          )}
                          {/* Readiness Toggle Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const nextReady = !device.isReady;
                              const updated: DeviceProfile = {
                                ...device,
                                isReady: nextReady,
                                ...(nextReady ? {} : { activeRunId: undefined, activeTesterName: undefined })
                              };
                              if (onSaveDevice) onSaveDevice(updated);
                            }}
                            className={`px-3 py-1.5 rounded-2xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                              device.isReady
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                            }`}
                          >
                            {device.isReady ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Ready</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                                <span>Maintenance</span>
                              </>
                            )}
                          </button>

                          {/* Delete Device */}
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Delete device "${device.name}"?`)) {
                                if (onDeleteDevice) onDeleteDevice(device.id);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                            title="Delete Device"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Dedicated Single Test Plan Configuration */}
                      <div className="bg-[#0f172a] rounded-2xl p-4 border border-slate-800 space-y-3.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-blue-400" />
                            <span>Configured Test Plan</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">1 Plan Per Device</span>
                        </div>

                        {/* Plan Selector */}
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-400 block">
                            Assigned Plan for this Device:
                          </label>
                          <select
                            value={assignedQuota?.planId || ''}
                            onChange={e => {
                              const newPlanId = e.target.value;
                              if (!newPlanId) {
                                if (onSaveDevice) onSaveDevice({ ...device, quotas: [] });
                              } else {
                                const currentTarget = assignedQuota?.targetRunsPerDay || 3;
                                if (onSaveDevice) onSaveDevice({ ...device, quotas: [{ planId: newPlanId, targetRunsPerDay: currentTarget }] });
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-blue-500 cursor-pointer shadow-inner"
                          >
                            <option value="">-- No Test Plan Assigned --</option>
                            {testPlans.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.steps.length} steps)
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Quota & Today's Progress */}
                        {assignedQuota && assignedPlan ? (
                          <div className="pt-2 border-t border-slate-800/80 space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-400 font-medium">Daily Target Runs:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="50"
                                  value={assignedQuota.targetRunsPerDay}
                                  onChange={e => {
                                    const val = Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1));
                                    if (onSaveDevice) {
                                      onSaveDevice({
                                        ...device,
                                        quotas: [{ planId: assignedQuota.planId, targetRunsPerDay: val }]
                                      });
                                    }
                                  }}
                                  className="w-14 bg-slate-900 border border-slate-700 text-xs text-blue-300 font-mono font-bold rounded-lg px-2 py-1 text-center focus:outline-none focus:border-blue-500"
                                  title="Edit daily quota"
                                />
                                <span className="text-[11px] text-slate-500 font-mono">runs/day</span>
                              </div>

                              <div className="flex items-center gap-1.5 font-mono text-xs">
                                <span className="text-slate-300 font-bold">{doneToday} / {targetRuns}</span>
                                {remaining > 0 ? (
                                  <span className="text-blue-400 font-sans font-bold text-[11px]">({remaining} left today)</span>
                                ) : (
                                  <span className="text-emerald-400 font-sans font-bold text-[11px]">(Target Reached)</span>
                                )}
                              </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                              <div
                                className={`h-full transition-all duration-500 ${remaining === 0 ? 'bg-emerald-500' : 'bg-blue-600'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="pt-2 border-t border-slate-800/80 text-[11px] text-amber-300/80 font-medium flex items-center gap-1.5">
                            <span>Assign a test plan above to make this device active for testing on the mobile app.</span>
                          </div>
                        )}
                      </div>

                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      )}

      {/* Tab: Unified QA Testers Directory & Live Performance Tracking */}
      {activeTab === 'testers' && (
        <div className="space-y-4">
          
          {/* Unified Compact Header, Filter & Date Control Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 liquid-glass-panel rounded-2xl p-3.5 shadow-xl border border-slate-800">
            {/* Left: Title + Active Badge + View Toggle */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-slate-800/90 border border-slate-700/80 text-blue-400">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-50 tracking-tight">Testers & Performance</h2>
                    {activeTesterMap.size > 0 && (
                      <span className="text-[10px] font-bold text-emerald-400 font-mono flex items-center gap-1 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        {activeTesterMap.size} Active
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 hidden sm:block">
                    Daily execution speed, completed plans & live device telemetry
                  </p>
                </div>
              </div>

              {/* All / Active Toggle Pills */}
              <div className="flex items-center bg-[#0f172a] border border-slate-800 rounded-xl p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setTesterViewMode('all')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                    testerViewMode === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({unifiedTesters.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTesterViewMode('active')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition flex items-center gap-1 cursor-pointer ${
                    testerViewMode === 'active'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span>Active ({activeTesterMap.size})</span>
                </button>
              </div>
            </div>

            {/* Right: Search + Log Date + New Tester Button */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Compact Search */}
              <div className="relative w-36 sm:w-44">
                <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search tester..."
                  value={searchTesterQuery}
                  onChange={e => setSearchTesterQuery(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-700/80 rounded-xl pl-7 pr-6 py-1 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                {searchTesterQuery && (
                  <button
                    onClick={() => setSearchTesterQuery('')}
                    className="absolute right-2 top-1.5 text-slate-500 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Date Selector */}
              <div className="flex items-center gap-1.5 bg-[#0f172a] border border-slate-700/80 rounded-xl px-2.5 py-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-[10px] font-bold text-slate-400 uppercase">Date:</span>
                <select
                  value={selectedQaDate}
                  onChange={e => setSelectedQaDate(e.target.value)}
                  style={{ backgroundColor: '#0f172a', color: '#f1f5f9', WebkitAppearance: 'none' }}
                  className="bg-[#0f172a] text-slate-100 border border-slate-800 rounded-lg px-2 py-0.5 text-[11px] font-semibold focus:outline-none cursor-pointer"
                >
                  <option value={todayStr}>Today ({todayStr})</option>
                  {allQaDatesList.filter(d => d !== todayStr).map(dateStr => (
                    <option key={dateStr} value={dateStr}>
                      {dateStr}
                    </option>
                  ))}
                  <option value="all">All-Time Combined</option>
                </select>
              </div>

              {/* Add Tester Button */}
              <button
                type="button"
                onClick={() => setShowCreateTesterForm(prev => !prev)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 rounded-xl text-[11px] font-semibold flex items-center gap-1 transition-all shadow-sm active:scale-95 cursor-pointer"
              >
                <Plus className={`w-3.5 h-3.5 transition-transform duration-200 ${showCreateTesterForm ? 'rotate-45' : ''}`} />
                <span>{showCreateTesterForm ? 'Close' : 'New Tester'}</span>
              </button>
            </div>
          </div>

          {/* Compact Collapsible Create Tester Profile Form */}
          {showCreateTesterForm && (
            <div className="liquid-glass-panel rounded-2xl p-4 border border-slate-700 bg-[#111827] shadow-xl space-y-3 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-xs font-bold text-slate-50 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  <span>Create New QA Tester Profile</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateTesterForm(false)}
                  className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Kevin Huang..."
                    value={newPersonName}
                    onChange={e => setNewPersonName(e.target.value)}
                    className="w-full bg-[#0f172a] border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Role / Specialization</label>
                  <input
                    type="text"
                    placeholder="e.g. Lead QA / Mobile Specialist..."
                    value={newPersonRole}
                    onChange={e => setNewPersonRole(e.target.value)}
                    className="w-full bg-[#0f172a] border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>

                <div className="flex justify-end">
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
                      setNewPersonName('');
                      setShowCreateTesterForm(false);
                    }}
                    className="w-full sm:w-auto px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Save Profile</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Condensed High-Density 3-Column Testers Grid */}
          {(() => {
            let displayed = unifiedTesters;
            if (testerViewMode === 'active') {
              displayed = displayed.filter(t => activeTesterMap.has(t.name.toLowerCase().trim()));
            }
            if (searchTesterQuery.trim()) {
              const q = searchTesterQuery.toLowerCase().trim();
              displayed = displayed.filter(t => t.name.toLowerCase().includes(q) || t.role.toLowerCase().includes(q));
            }

            if (displayed.length === 0) {
              return (
                <div className="liquid-glass-panel rounded-2xl p-8 text-center space-y-2 border border-slate-800">
                  <UserCheck className="w-6 h-6 text-slate-500 mx-auto" />
                  <h4 className="text-sm font-bold text-white">
                    {testerViewMode === 'active' ? 'No Testers Currently Active' : 'No Testers Found'}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {testerViewMode === 'active'
                      ? 'No tester is actively running a walkthrough on a device right now.'
                      : 'Create a tester profile above to begin tracking.'}
                  </p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                {displayed.map(tester => {
                  const profile = tester.performanceProfile;
                  const dayData = !profile
                    ? { completedCount: 0, totalDurationMs: 0, completedRuns: [] }
                    : selectedQaDate === 'all'
                      ? {
                          completedCount: profile.allTimeCompletedCount,
                          totalDurationMs: Object.values(profile.dailyStats).reduce((acc, d) => acc + d.totalDurationMs, 0),
                          completedRuns: Object.values(profile.dailyStats).flatMap(d => d.completedRuns)
                        }
                      : profile.dailyStats[selectedQaDate] || {
                          completedCount: 0,
                          totalDurationMs: 0,
                          completedRuns: []
                        };

                  const completedRunsList = dayData.completedRuns;
                  const avgMs = dayData.completedCount > 0 ? Math.round(dayData.totalDurationMs / dayData.completedCount) : 0;
                  const avgMins = Math.floor(avgMs / 60000);
                  const avgSecs = Math.floor((avgMs % 60000) / 1000);
                  const avgFormatted = avgMs > 0 ? `${avgMins}m ${avgSecs < 10 ? '0' : ''}${avgSecs}s` : '—';

                  const dayDevices = !profile
                    ? []
                    : selectedQaDate === 'all'
                      ? Array.from(profile.devicesUsed)
                      : Array.from(('devicesUsedOnDay' in dayData && dayData.devicesUsedOnDay instanceof Set) ? dayData.devicesUsedOnDay : []);
                  const devicesStr = dayDevices.join(', ') || '—';

                  const isActive = activeTesterMap.has(tester.name.toLowerCase().trim());
                  const activeInfo = activeTesterMap.get(tester.name.toLowerCase().trim());
                  const isExpanded = !!expandedTesters[tester.name];

                  return (
                    <div
                      key={tester.id || tester.name}
                      className={`liquid-glass-panel rounded-2xl p-3.5 border transition-all duration-200 shadow-lg ${
                        isActive
                          ? 'border-blue-500/40 bg-[#162033] ring-1 ring-blue-500/25'
                          : 'border-slate-800 bg-[#111827] hover:border-slate-700'
                      }`}
                    >
                      {/* Compact Card Row 1: Avatar + Name/Role + Live Status Badge & Actions */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-xl font-bold text-xs flex items-center justify-center border flex-shrink-0 ${
                            isActive
                              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                              : 'bg-slate-800 text-slate-200 border-slate-700'
                          }`}>
                            {tester.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-bold text-slate-50 truncate">{tester.name}</h4>
                              <span className="text-[10px] text-slate-400 font-medium truncate hidden sm:inline">• {tester.role || 'QA'}</span>
                            </div>
                            {/* Active or Idle Status Line */}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {isActive ? (
                                activeInfo?.isAway ? (
                                  <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5 text-amber-400" />
                                    Away on {activeInfo?.deviceName || 'Device'}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    Active on {activeInfo?.deviceName || 'Device'}
                                  </span>
                                )
                              ) : (
                                <span className="text-[10px] font-medium text-slate-500">Idle</span>
                              )}
                              {isActive && activeInfo?.startedAt && (
                                <span className="text-[10px] font-mono font-bold text-blue-300 bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-500/30">
                                  {formatOngoingDuration(activeInfo.startedAt)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right Actions: Boot & Delete */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isActive && onBootTester && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Remote Boot: Kick "${tester.name}" off "${activeInfo?.deviceName || 'device'}" and release device? (Completed runs today will NOT be deleted)`)) {
                                  onBootTester(activeInfo?.runId || '', activeInfo?.deviceId, tester.name, activeInfo?.deviceName);
                                }
                              }}
                              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 flex items-center gap-1 transition cursor-pointer"
                              title={`Remote boot ${tester.name} off session`}
                            >
                              <Trash2 className="w-2.5 h-2.5 text-rose-400" />
                              <span>Boot</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Delete tester "${tester.name}" and all associated performance data?`)) {
                                if (tester.id && onDeleteTesterProfile) {
                                  onDeleteTesterProfile(tester.id);
                                }
                                if (onDeleteTester) {
                                  onDeleteTester(tester.name);
                                } else if (onDeleteTestRun) {
                                  const runsToDelete = [...testRuns, ...archivedRuns].filter(r => r.testerName === tester.name);
                                  runsToDelete.forEach(r => onDeleteTestRun(r.id));
                                }
                              }
                            }}
                            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                            title={`Delete tester ${tester.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Compact Live Active Test Walkthrough Strip (Only when actively testing) */}
                      {isActive && activeInfo && (
                        <div className="mt-2.5 bg-[#0f172a] border border-slate-800 rounded-xl p-2 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] gap-2">
                            <span className="text-blue-300 font-bold truncate flex items-center gap-1">
                              <Layers className="w-3 h-3 text-blue-400 shrink-0" />
                              <span className="truncate">{activeInfo.planName || 'Walkthrough'}</span>
                            </span>
                            <span className="font-mono font-bold text-slate-300 shrink-0">
                              Step {activeInfo.currentStepIndex}/{activeInfo.totalSteps} ({activeInfo.progressPct || 0}%)
                            </span>
                          </div>

                          {activeInfo.currentStepTitle && (
                            <div className="text-[10px] text-slate-300 font-medium truncate" title={activeInfo.currentStepTitle}>
                              ↳ {activeInfo.currentStepTitle}
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <div className="flex items-center gap-1 text-[9px] font-mono">
                              <span className="text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/50">✓{activeInfo.greenCount || 0}</span>
                              <span className="text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/50">!{activeInfo.yellowCount || 0}</span>
                              <span className="text-rose-400 bg-rose-950/80 px-1.5 py-0.5 rounded border border-rose-800/50">✗{activeInfo.redCount || 0}</span>
                            </div>
                            <div className="flex-1 bg-slate-900 h-1.5 rounded-full overflow-hidden">
                              <div
                                className="bg-blue-500 h-full transition-all duration-300"
                                style={{ width: `${activeInfo.progressPct || 0}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Compact Inline KPI & Accordion Trigger Strip */}
                      <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400 font-semibold">Plans:</span>
                            <span className="font-bold text-slate-100 font-mono">{dayData.completedCount}</span>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400 font-semibold">Avg:</span>
                            <span className="font-bold text-blue-300 font-mono">{avgFormatted}</span>
                          </div>

                          <div className="flex items-center gap-1 truncate min-w-0">
                            <span className="text-[10px] text-slate-400 font-semibold">Dev:</span>
                            <span className="font-bold text-slate-300 font-mono truncate" title={devicesStr}>{devicesStr}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleTesterExpand(tester.name)}
                          className="px-2 py-0.5 bg-[#0f172a] hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-800 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer shrink-0"
                        >
                          <span>{isExpanded ? 'Hide' : `Runs (${completedRunsList.length})`}</span>
                          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-blue-400' : ''}`} />
                        </button>
                      </div>

                      {/* Expandable Compact Accordion: Completed Test Runs Breakdown */}
                      <div className={`liquid-accordion-wrapper ${isExpanded ? 'expanded' : ''}`}>
                        <div className="liquid-accordion-inner">
                          <div className="mt-2 pt-2 border-t border-slate-800 space-y-1.5">
                            {completedRunsList.length === 0 ? (
                              <div className="bg-[#0f172a] py-2 px-3 rounded-lg text-center text-[11px] text-slate-500">
                                No runs recorded for {selectedQaDate === todayStr ? 'today' : selectedQaDate}.
                              </div>
                            ) : (
                              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                                {completedRunsList.map((runItem, idx) => (
                                  <div key={runItem.runId + idx} className="bg-[#0f172a] px-2.5 py-1.5 rounded-lg border border-slate-800/80 flex items-center justify-between text-[11px] gap-2">
                                    <div className="truncate flex-1">
                                      <div className="font-bold text-slate-200 truncate">{runItem.planName}</div>
                                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                                        <span className="text-slate-300">{runItem.deviceName}</span>
                                        <span>•</span>
                                        <span>{runItem.completedAtFormatted}</span>
                                        <span>•</span>
                                        <span className="text-blue-300">{runItem.durationFormatted}</span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <div className="flex items-center gap-1 text-[10px] font-mono">
                                        <span className="text-emerald-400 font-bold">✓{runItem.greenCount}</span>
                                        {runItem.yellowCount > 0 && <span className="text-amber-400 font-bold">!{runItem.yellowCount}</span>}
                                        {runItem.redCount > 0 && <span className="text-rose-400 font-bold">✗{runItem.redCount}</span>}
                                      </div>

                                      {onDeleteTestRun && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (confirm(`Delete run record for "${runItem.planName}"?`)) {
                                              onDeleteTestRun(runItem.runId);
                                            }
                                          }}
                                          className="p-0.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                                          title="Delete this test run record"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            );
          })()}

        </div>
      )}


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
                          onClick={() => onDeletePlan(plan.id)}
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
                const ongoingRuns = testRuns.filter(r => getEffectiveRunStatus(r) === 'in_progress');
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
      {activeTab === 'bugs' && BUGANIZER_ENABLED && bugsView === 'buganizer' && (
        <BuganizerTriage bugs={bugLogs} plans={testPlans} onApplyRefinements={onApplyBugRefinements} onPatchBugLog={onPatchBugLog} onApplyReproMatches={onApplyReproMatches} />
      )}

      {/* Tab 3: Bugs Feed */}
      {activeTab === 'bugs' && (!BUGANIZER_ENABLED || bugsView === 'feed') && (
        <div className="space-y-6">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-50 flex items-center gap-2">
                <Bug className="w-5 h-5 text-rose-400" />
                Bugs
              </h3>
              <p className="text-xs text-slate-400">
                Live log feed received from mobile field testers organized by device model and feature.
              </p>
            </div>

            {/* Filter & Sort Controls Bar */}
            <div className="flex flex-wrap items-center gap-2.5">
              
              {/* Keyword Search Input */}
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search bugs..."
                  value={searchBugQuery}
                  onChange={e => setSearchBugQuery(e.target.value)}
                  className="w-full liquid-glass-input rounded-2xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none font-medium"
                />
                {searchBugQuery && (
                  <button
                    onClick={() => setSearchBugQuery('')}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-xs"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Test Plan Filter (scopes the list, Copy Bugs, and CSV export to one plan) */}
              <div className="relative">
                <ListChecks className="w-3.5 h-3.5 text-blue-400 absolute left-3 top-2.5 pointer-events-none" />
                <select
                  value={selectedPlanFilter}
                  onChange={e => setSelectedPlanFilter(e.target.value)}
                  className={`liquid-glass-input rounded-2xl pl-8 pr-3 py-1.5 text-xs font-semibold focus:outline-none cursor-pointer max-w-[14rem] ${
                    selectedPlanFilter !== 'all' ? '!border-blue-500/50 text-blue-200' : 'text-slate-200'
                  }`}
                  title="Show, copy, and export only the bugs from one test plan"
                >
                  <option value="all" className="bg-slate-900">All Test Plans ({bugLogs.length})</option>
                  {bugPlanOptions.map(opt => (
                    <option key={opt.planId} value={opt.planId} className="bg-slate-900">
                      {opt.planName} ({opt.count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Copy Filtered Bugs Button (with screenshots for Google Docs / Email) */}
              <button
                type="button"
                onClick={handleCopyBugsToClipboard}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm border border-blue-500 active:scale-95 cursor-pointer"
                title="Copy filtered bugs list with inline screenshots formatted for Google Docs, Word, Slack, or Email"
              >
                {copiedBugs ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                    <span className="text-emerald-200 font-bold">Bugs Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-white" />
                    <span>{selectedPlanFilterName ? 'Copy Plan Bugs (Google Docs)' : 'Copy Bugs (Google Docs)'}</span>
                  </>
                )}
              </button>

              {/* Google Sheets Sync & Settings Button */}
              <button
                type="button"
                onClick={() => setIsSheetModalOpen(true)}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm border border-slate-700 active:scale-95 cursor-pointer"
                title="Google Sheets automatic sync and spreadsheet integration settings"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Google Sheets Sync</span>
                {autoSyncSheet && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" title="Auto-sync is enabled"></span>
                )}
              </button>

              {/* Wipe All Bugs Button */}
              {bugLogs.length > 0 && onWipeAllBugs && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Are you sure you want to wipe all ${bugLogs.length} logged bug(s)? This will permanently remove all defect logs.`)) {
                      onWipeAllBugs();
                    }
                  }}
                  className="px-3.5 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-2xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                  title="Permanently wipe all logged bugs"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Wipe All Bugs</span>
                </button>
              )}

              {/* Single Condensed Filter & Sort Menu Button & Popover */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsBugFilterMenuOpen(!isBugFilterMenuOpen)}
                  className={`px-3.5 py-1.5 liquid-glass-button rounded-2xl text-xs font-semibold flex items-center gap-2 transition-all duration-200 ${
                    (selectedDateFilter !== 'all' || selectedFeatureFilter !== 'all' || selectedDeviceFilter !== 'all' || sortByDevice !== 'newest')
                      ? '!bg-blue-600/20 !border-blue-500/50 text-blue-200 shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5 text-blue-400" />
                  <span>Filter & Sort</span>
                  {((selectedDateFilter !== 'all' ? 1 : 0) + (selectedFeatureFilter !== 'all' ? 1 : 0) + (selectedDeviceFilter !== 'all' ? 1 : 0) + (sortByDevice !== 'newest' ? 1 : 0)) > 0 && (
                    <span className="bg-blue-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold font-mono">
                      {(selectedDateFilter !== 'all' ? 1 : 0) + (selectedFeatureFilter !== 'all' ? 1 : 0) + (selectedDeviceFilter !== 'all' ? 1 : 0) + (sortByDevice !== 'newest' ? 1 : 0)}
                    </span>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isBugFilterMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Popover Menu Dropdown */}
                {isBugFilterMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] liquid-glass-panel rounded-3xl p-4 space-y-4 shadow-2xl z-50 border-slate-700">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Filter className="w-3.5 h-3.5 text-blue-400" />
                        Filter & Sort Menu
                      </span>
                      {(selectedDateFilter !== 'all' || selectedFeatureFilter !== 'all' || selectedDeviceFilter !== 'all' || sortByDevice !== 'newest') && (
                        <button
                          onClick={() => {
                            setSelectedDateFilter('all');
                            setSelectedFeatureFilter('all');
                            setSelectedDeviceFilter('all');
                            setSelectedPlanFilter('all');
                            setSortByDevice('newest');
                            setCustomDateInput('');
                          }}
                          className="text-[10px] text-blue-300 hover:text-white font-bold bg-blue-500/20 px-2 py-0.5 rounded-lg border border-blue-500/30 transition"
                        >
                          Reset All
                        </button>
                      )}
                    </div>

                    {/* Date Filter */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-blue-400" /> Date Range
                      </label>
                      <select
                        value={selectedDateFilter}
                        onChange={e => setSelectedDateFilter(e.target.value)}
                        className="w-full liquid-glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="all" className="bg-slate-900">All Dates</option>
                        <option value="today" className="bg-slate-900">Today</option>
                        <option value="yesterday" className="bg-slate-900">Yesterday</option>
                        <option value="7days" className="bg-slate-900">Last 7 Days</option>
                        <option value="30days" className="bg-slate-900">Last 30 Days</option>
                        <option value="custom" className="bg-slate-900">Specific Date...</option>
                      </select>
                      {selectedDateFilter === 'custom' && (
                        <input
                          type="date"
                          value={customDateInput}
                          onChange={e => setCustomDateInput(e.target.value)}
                          className="w-full liquid-glass-input rounded-xl px-3 py-1 text-xs text-blue-200 focus:outline-none mt-1 font-mono"
                        />
                      )}
                    </div>

                    {/* Feature Filter */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <Tag className="w-3 h-3 text-blue-400" /> Feature Tag
                      </label>
                      <select
                        value={selectedFeatureFilter}
                        onChange={e => setSelectedFeatureFilter(e.target.value)}
                        className="w-full liquid-glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="all" className="bg-slate-900">All Features</option>
                        {uniqueFeatures.map(feat => (
                          <option key={feat} value={feat} className="bg-slate-900">
                            {feat}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Device Filter */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-blue-400" /> Device Model
                      </label>
                      <select
                        value={selectedDeviceFilter}
                        onChange={e => setSelectedDeviceFilter(e.target.value)}
                        className="w-full liquid-glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="all" className="bg-slate-900">All Devices ({bugLogs.length})</option>
                        {uniqueDevices.map(dev => (
                          <option key={dev} value={dev} className="bg-slate-900">
                            {dev}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Sort Order */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <ArrowUpDown className="w-3 h-3 text-blue-400" /> Sort Order
                      </label>
                      <select
                        value={sortByDevice}
                        onChange={e => setSortByDevice(e.target.value as any)}
                        className="w-full liquid-glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="newest" className="bg-slate-900">Timestamp (Newest First)</option>
                        <option value="oldest" className="bg-slate-900">Timestamp (Oldest First)</option>
                        <option value="priority" className="bg-slate-900">Priority (P0 First)</option>
                        <option value="device-asc" className="bg-slate-900">Device Name (A → Z)</option>
                        <option value="device-desc" className="bg-slate-900">Device Name (Z → A)</option>
                      </select>
                    </div>

                    <div className="pt-2 border-t border-slate-800 space-y-2 text-center">
                      <button
                        type="button"
                        onClick={() => exportBugsToCSV(processedBugs, { planName: selectedPlanFilterName || undefined, getPlanName: b => bugPlanLookup(b).planName })}
                        className="w-full py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5"
                        title="Download CSV file for Excel / Sheets"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-300" />
                        <span>{selectedPlanFilterName ? 'Export Plan Bugs to CSV' : 'Export to CSV File'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsBugFilterMenuOpen(false)}
                        className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>

          <div className="space-y-3.5">
            {processedBugs.length === 0 ? (
              <div className="liquid-glass-panel rounded-3xl p-8 text-center text-xs text-slate-400 font-medium">
                No matching bugs found for selected search query and filters.
              </div>
            ) : (
              processedBugs.map(bug => {
                const isBugExpanded = !!expandedBugIds[bug.id];
                const formatted12HrTime = (() => {
                  try {
                    const d = bug.timestamp ? new Date(bug.timestamp) : new Date();
                    if (!isNaN(d.getTime())) {
                      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
                    }
                  } catch (e) {}
                  return bug.formattedTime || 'N/A';
                })();

                return (
                  <div 
                    key={bug.id} 
                    className="liquid-glass-panel rounded-3xl border border-slate-800 overflow-hidden transition-all duration-200 shadow-xl hover:border-slate-700"
                  >
                    {/* Header Bar (Always Visible) */}
                    <div 
                      onClick={() => toggleBugExpand(bug.id)}
                      className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer bg-[#111827] hover:bg-[#162033] transition"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <button 
                          type="button"
                          className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 transition"
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isBugExpanded ? 'rotate-180 text-blue-400' : 'text-slate-400'}`} />
                        </button>

                        <div className="flex items-center gap-1.5 font-mono text-xs text-slate-200 font-bold bg-[#0f172a] px-3 py-1 rounded-xl border border-slate-800">
                          <Clock className="w-3.5 h-3.5 text-blue-400" />
                          <span>{formatted12HrTime}</span>
                          <span className="text-[10px] text-slate-400 font-normal ml-0.5">({new Date(bug.timestamp).toLocaleDateString()})</span>
                        </div>

                        <span className="bg-blue-500/15 text-blue-300 font-mono text-xs px-3 py-1 rounded-xl border border-blue-500/30 flex items-center gap-1.5 font-bold">
                          <Tag className="w-3.5 h-3.5 text-blue-400" />
                          {bug.feature || 'General'}
                        </span>

                        <span className="bg-[#0f172a] text-slate-300 font-mono text-xs px-3 py-1 rounded-xl border border-slate-800 flex items-center gap-1.5 font-medium">
                          <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                          {bug.deviceName || 'Unspecified'}
                        </span>

                        <span className="bg-[#0f172a] text-slate-200 font-mono text-xs px-3 py-1 rounded-xl border border-slate-800 flex items-center gap-1.5 font-medium">
                          <User className="w-3.5 h-3.5 text-blue-400" />
                          {bug.testerName}
                        </span>

                        {bug.priority && (
                          <span className={`font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold uppercase ${
                            bug.priority === 'P0' || bug.priority === '0'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : bug.priority === 'P1' || bug.priority === '1'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>
                            {bug.priority}
                          </span>
                        )}
                        {effectiveFiled(bugById.get(bug.id) || bug) && (
                          <span data-testid="feed-filed-chip" className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-black tracking-wider bg-green-500/15 text-green-300 border-green-500/40">
                            FILED
                          </span>
                        )}
                        {!effectiveFiled(bugById.get(bug.id) || bug) && effectiveStatus(bug.status) === REPROD && (
                          <span data-testid="feed-reprod-chip" className="font-mono text-[10px] px-2.5 py-0.5 rounded-full border font-bold bg-violet-500/15 text-violet-200 border-violet-500/40">
                            REPRO'D
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 ml-auto">
                        <div className="text-xs text-slate-300 max-w-xs md:max-w-md truncate font-medium">
                          {bug.title ? <span className="text-white font-semibold">{bug.title}</span> : bug.note}
                        </div>

                        {bug.imageUrl && (
                          <span className="px-2.5 py-1 bg-blue-500/15 text-blue-200 border border-blue-500/30 rounded-xl text-[11px] font-mono font-bold flex items-center gap-1">
                            <ImageIcon className="w-3 h-3 text-blue-300" /> Photo
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopySingleBug(bug);
                          }}
                          className={`p-2 rounded-xl border transition flex items-center gap-1 text-xs font-medium cursor-pointer ${
                            copiedSingleBugId === bug.id
                              ? 'text-emerald-300 bg-emerald-950/60 border-emerald-500/40'
                              : 'text-slate-400 hover:text-blue-300 hover:bg-slate-800 border-transparent hover:border-slate-700'
                          }`}
                          title="Copy this bug & screenshot formatted for Google Docs"
                        >
                          {copiedSingleBugId === bug.id ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        {onUpdateBugLog && (
                          <button
                            type="button"
                            data-testid="feed-edit-bug"
                            onClick={(e) => {
                              e.stopPropagation();
                              startFeedEdit(bug);
                            }}
                            className="p-2 text-slate-400 hover:text-blue-300 hover:bg-slate-800 rounded-xl border border-transparent hover:border-slate-700 transition"
                            title="Edit title & description"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteBug(bug.id);
                          }}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-xl border border-transparent hover:border-rose-800/50 transition"
                          title="Delete Bug Log"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Accordion Content */}
                    <div className={`liquid-accordion-wrapper ${isBugExpanded ? 'expanded' : ''}`}>
                      <div className="liquid-accordion-inner">
                        <div className="p-4 pt-0 border-t border-slate-800 bg-[#0b0f19]">
                          <div className="liquid-glass-card rounded-2xl p-5 space-y-4 border-slate-800 text-left bg-[#111827] shadow-2xl mt-3">
                            
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                              <span className="text-xs font-bold text-white flex items-center gap-2 font-mono">
                                <Tag className="w-4 h-4 text-blue-400" />
                                Feature Category: <span className="text-blue-300">{bug.feature || 'General'}</span>
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopySingleBug(bug)}
                                  className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 transition active:scale-95 border cursor-pointer ${
                                    copiedSingleBugId === bug.id
                                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 shadow-lg'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                                  }`}
                                  title="Copy this bug & screenshot formatted for Google Docs, Word, or Email"
                                >
                                  {copiedSingleBugId === bug.id ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                      <span className="text-emerald-300">Copied to Clipboard!</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5 text-blue-300" />
                                      <span>Copy for Google Docs</span>
                                    </>
                                  )}
                                </button>
                                <span className="text-xs font-mono text-slate-300 flex items-center gap-1.5 bg-[#0f172a] px-3 py-1 rounded-xl border border-slate-800">
                                  <Clock className="w-3.5 h-3.5 text-blue-400" />
                                  Logged at {formatted12HrTime} on {new Date(bug.timestamp).toLocaleDateString()}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
                              <div className="md:col-span-2 space-y-3">
                                {feedEdit?.bugId === bug.id ? (
                                  <div className="space-y-2.5 rounded-2xl border border-blue-500/40 bg-blue-950/20 p-3" data-testid="feed-edit-form">
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="text-[11px] uppercase font-mono text-slate-300 font-bold">Title</label>
                                        <span className="text-[10px] font-mono text-slate-500">{feedEdit.title.length}/120</span>
                                      </div>
                                      <input
                                        data-testid="feed-edit-title"
                                        value={feedEdit.title}
                                        maxLength={120}
                                        onChange={e => setFeedEdit({ ...feedEdit, title: e.target.value })}
                                        placeholder="Short summary of the bug"
                                        className="w-full bg-[#0f172a] border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-semibold focus:outline-none focus:border-blue-500"
                                      />
                                    </div>
                                    <div className="flex flex-wrap items-end gap-3">
                                      <div>
                                        <label className="text-[11px] uppercase font-mono text-slate-300 font-bold block mb-1">Time it happened</label>
                                        <input
                                          type="time"
                                          data-testid="feed-edit-time"
                                          value={feedEdit.time}
                                          onChange={e => setFeedEdit({ ...feedEdit, time: e.target.value })}
                                          className="bg-[#0f172a] border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500 [color-scheme:dark]"
                                        />
                                      </div>
                                      <span className="text-[10px] text-slate-400 pb-2">
                                        Same day only{bug.originalTimestamp ? ` · first logged ${new Date(bug.originalTimestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                                      </span>
                                    </div>
                                    <div>
                                      <label className="text-[11px] uppercase font-mono text-slate-300 font-bold block mb-1">Description</label>
                                      <textarea
                                        data-testid="feed-edit-description"
                                        rows={6}
                                        value={feedEdit.note}
                                        onChange={e => setFeedEdit({ ...feedEdit, note: e.target.value })}
                                        placeholder="Steps to reproduce, expected vs. actual"
                                        className="w-full bg-[#0f172a] border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-blue-500"
                                      />
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] text-slate-400">Changes carry over to the Buganizer tab.</span>
                                      <div className="flex gap-2">
                                        <button type="button" onClick={() => setFeedEdit(null)} className="px-3 h-8 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
                                        <button type="button" data-testid="feed-edit-save" disabled={!feedEdit.title.trim() && !feedEdit.note.trim()} onClick={() => saveFeedEdit(bug)} className="px-3 h-8 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">Save changes</button>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-[11px] uppercase font-mono text-slate-300 font-bold flex items-center gap-1.5">
                                        Observation / Bug Description Log:
                                      </span>
                                      {onUpdateBugLog && (
                                        <button type="button" onClick={() => startFeedEdit(bug)} className="px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">
                                          <Edit className="w-3 h-3 text-blue-300" /> Edit
                                        </button>
                                      )}
                                    </div>
                                    {bug.title && <div className="text-sm font-bold text-white mb-1.5">{bug.title}</div>}
                                    <div className="liquid-glass-input p-4 rounded-2xl text-slate-100 text-xs leading-relaxed whitespace-pre-wrap font-medium shadow-inner">
                                      {bug.note || 'No description attached.'}
                                    </div>
                                  </div>
                                )}

                                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                                  <div className="liquid-glass-panel p-3 rounded-2xl border border-slate-800">
                                    <span className="text-[10px] uppercase text-slate-400 block font-semibold">Step Target</span>
                                    <span className="text-white font-bold">{bug.stepTitle || 'N/A'}</span>
                                  </div>
                                  <div className="liquid-glass-panel p-3 rounded-2xl border border-slate-800">
                                    <span className="text-[10px] uppercase text-slate-400 block font-semibold">Reporter & Device</span>
                                    <span className="text-blue-300 font-bold">{bug.testerName} ({bug.deviceName})</span>
                                  </div>
                                </div>

                                {/* Bug Triage Controls */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                                  <div>
                                    <label className="text-[10px] uppercase font-mono text-slate-400 block font-semibold mb-1">Bug Type</label>
                                    <select
                                      value={bugCategorizations[bug.id]?.bugType || bug.bugType || 'Bug'}
                                      onChange={e => handleUpdateBugCategorization(bug.id, 'bugType', e.target.value)}
                                      className="w-full bg-[#0f172a] border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer"
                                    >
                                      {(['Bug', 'Setup Issue', 'Known Issue', 'Feature Request', 'Misc Issue'] as const).map(opt => (
                                        <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] uppercase font-mono text-slate-400 block font-semibold mb-1">Priority</label>
                                    <select
                                      value={bugCategorizations[bug.id]?.priority || bug.priority || 'P2'}
                                      onChange={e => handleUpdateBugCategorization(bug.id, 'priority', e.target.value)}
                                      className="w-full bg-[#0f172a] border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer"
                                    >
                                      {(['P0', 'P1', 'P2'] as const).map(opt => (
                                        <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] uppercase font-mono text-slate-400 block font-semibold mb-1">Status</label>
                                    <select
                                      data-testid="feed-status"
                                      value={effectiveStatus(bugCategorizations[bug.id]?.status || bug.status)}
                                      onChange={e => handleUpdateBugCategorization(bug.id, 'status', e.target.value)}
                                      className={`w-full bg-[#0f172a] border rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-blue-500 cursor-pointer ${effectiveStatus(bugCategorizations[bug.id]?.status || bug.status) === REPROD ? 'border-violet-500/70 text-violet-200 bg-violet-500/10' : 'border-slate-700/80 text-slate-200'}`}
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

                              {/* Evidence Image Preview Box */}
                              <div>
                                <span className="text-[11px] uppercase font-mono text-slate-300 block font-bold mb-1.5">
                                  Evidence Photo:
                                </span>
                                {bug.imageUrl && /^(data:image\/|https?:\/\/|blob:|\/)/i.test(bug.imageUrl) ? (
                                  <div 
                                    onClick={() => setSelectedImagePreviewUrl(bug.imageUrl!)}
                                    className="relative group rounded-2xl overflow-hidden border border-slate-700 cursor-pointer bg-slate-900 max-h-56 flex items-center justify-center shadow-2xl"
                                  >
                                    <img src={bug.imageUrl} alt="Bug screenshot" className="w-full object-cover max-h-52 group-hover:scale-105 transition duration-300" />
                                    <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center backdrop-blur-[3px]">
                                      <span className="px-4 py-2 bg-slate-900/95 text-slate-100 border border-blue-500/50 rounded-2xl text-xs font-bold font-mono flex items-center gap-2 shadow-2xl">
                                        <ImageIcon className="w-4 h-4 text-blue-400" /> Click for Full Image
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="h-36 rounded-2xl border border-slate-800 bg-[#0f172a] flex items-center justify-center text-xs text-slate-500 font-mono">
                                    No Photo Attached
                                  </div>
                                )}
                                {(() => {
                                  // Filed stamp: from the stored bug (a legacy stored status 'Filed' counts as filed)
                                  const rawBug = bugById.get(bug.id) || bug;
                                  const filed = effectiveFiled(rawBug);
                                  const canEdit = !!(onPatchBugLog || onUpdateBugLog);
                                  const setFiled = (next: ReturnType<typeof effectiveFiled>) => {
                                    const patch = filedPatch(rawBug, next);
                                    if (onPatchBugLog) onPatchBugLog(bug.id, patch);
                                    else if (onUpdateBugLog) onUpdateBugLog({ ...rawBug, ...patch });
                                  };
                                  const draftId = filedIssueDrafts[bug.id] ?? '';
                                  return (
                                    <div data-testid="feed-filed" className="mt-3">
                                      {filed && (
                                        <div data-testid="feed-filed-stamp" className="mt-1 mb-2 border-4 border-green-500 text-green-500 rounded-[14px] py-2.5 text-center font-black text-[34px] tracking-[0.25em] -rotate-3 bg-green-500/[0.08] shadow-[0_0_30px_rgba(34,197,94,0.25)] select-none">
                                          FILED
                                          {filedStampLine(filed) && <small className="block text-[11px] tracking-normal font-bold text-green-300 mt-0.5">{filedStampLine(filed)}</small>}
                                        </div>
                                      )}
                                      {/* Not a <label>: a label would re-dispatch the click to the switch and toggle it twice */}
                                      <div className={`flex items-center gap-2.5 mt-2 text-xs font-bold text-slate-200 ${canEdit ? '' : 'opacity-60'}`}>
                                        <button
                                          type="button"
                                          role="switch"
                                          aria-checked={!!filed}
                                          data-testid="feed-filed-toggle"
                                          disabled={!canEdit}
                                          onClick={() => {
                                            if (filed) setFiled(undefined);
                                            else {
                                              setFiled(newFiled('manual', draftId));
                                              setFiledIssueDrafts(prev => { const n = { ...prev }; delete n[bug.id]; return n; });
                                            }
                                          }}
                                          className={`relative w-10 h-[22px] rounded-full transition flex-shrink-0 ${filed ? 'bg-green-500' : 'bg-slate-700'}`}
                                        >
                                          <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${filed ? 'right-[3px]' : 'left-[3px]'}`} />
                                        </button>
                                        {filed ? <>Filed <span className="text-[11px] font-medium text-slate-400">(hidden from the Buganizer tab)</span></> : 'Mark as filed'}
                                      </div>
                                      {!filed && canEdit && (
                                        <input
                                          data-testid="feed-filed-issue"
                                          aria-label="Filed b/ issue number"
                                          value={draftId}
                                          inputMode="numeric"
                                          onChange={e => setFiledIssueDrafts(prev => ({ ...prev, [bug.id]: normalizeIssueId(e.target.value) }))}
                                          placeholder="b/ issue number (optional)"
                                          className="mt-2 w-full bg-[#0f172a] border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-green-500"
                                        />
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>

                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
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
