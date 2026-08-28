import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, DevicePlanQuota } from '../types';
import { ListChecks, Bug, Clock, Plus, Play, Trash2, Smartphone, CheckCircle2, AlertTriangle, XCircle, Download, User, Filter, ArrowUpDown, Tag, Activity, Copy, FileJson, Upload, Search, Image as ImageIcon, Sparkles, X, Calendar, Edit, BarChart2, Camera, TrendingUp, TrendingDown, History, ChevronDown, ChevronUp, RefreshCw, UserCheck, Timer } from 'lucide-react';
import { exportAllQADataToCSV, exportAllQADataToJSON, exportBugsToCSV, copyBugsToClipboard } from '../utils/exportUtils';
import { summarizeFeatureBugsWithGemini, summarizeOverallBugsWithGemini, getBriefIssueSummarySync, getStoredGeminiApiKey, saveGeminiApiKey } from '../services/geminiService';
import { toBlob } from 'html-to-image';

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
  onClonePlan: (planId: string) => void;
  onEditPlan?: (plan: TestPlan) => void;
  onLoadSampleData: () => void;
  onClearAllData?: () => void;
  onImportJSONData: (data: { testPlans?: TestPlan[]; testRuns?: TestRun[]; bugLogs?: BugLog[] }) => void;
  onAddFeature?: (featureName: string) => void;
  onDeleteFeature?: (featureName: string) => void;
  onDeleteTestRun?: (runId: string) => void;
  onDeleteTester?: (testerName: string) => void;
  onResetActiveDay?: (dateStr: string) => void;
  onSaveDevice?: (device: DeviceProfile) => void;
  onDeleteDevice?: (deviceId: string) => void;
  onSaveTester?: (tester: TesterProfile) => void;
  onDeleteTesterProfile?: (testerId: string) => void;
  archivedRuns?: TestRun[];
}

interface FeatureMetric {
  featureName: string;
  totalStepsExecuted: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  bugCount: number;
  healthScorePct: number;
  status: 'healthy' | 'warning' | 'critical';
  associatedBugs?: BugLog[];
}

const getLocalDateStr = (dateInput?: string | Date) => {
  const d = dateInput ? new Date(dateInput) : new Date();
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
  onClonePlan,
  onEditPlan,
  onLoadSampleData,
  onClearAllData,
  onImportJSONData,
  onAddFeature,
  onDeleteFeature,
  onDeleteTestRun,
  onDeleteTester,
  onResetActiveDay,
  onSaveDevice,
  onDeleteDevice,
  onSaveTester,
  onDeleteTesterProfile
}) => {
  const defaultTodayStr = getLocalDateStr(new Date());
  const [activeTab, setActiveTab] = useState<'overview' | 'devices' | 'testers' | 'features' | 'bugs'>('overview');
  const [selectedQaDate, setSelectedQaDate] = useState<string>(defaultTodayStr);
  const [expandedTesters, setExpandedTesters] = useState<Record<string, boolean>>({});

  const [newDeviceName, setNewDeviceName] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRole, setNewPersonRole] = useState('Mobile Tester');
  const [quotaPlanMap, setQuotaPlanMap] = useState<Record<string, string>>({});
  const [quotaRunsMap, setQuotaRunsMap] = useState<Record<string, number>>({});

  // Calculate completed runs today per device ID and plan ID
  const todayRunsMap = useMemo(() => {
    const todayStr = getLocalDateStr(new Date());
    const map: Record<string, Record<string, number>> = {};
    const allRuns = [...archivedRuns, ...testRuns];
    
    allRuns.forEach(run => {
      if (run.status !== 'completed' || !run.completedAt) return;
      const runDate = getLocalDateStr(run.completedAt);
      if (runDate !== todayStr) return;
      
      const devId = run.deviceId || (run.deviceName ? `dev-${run.deviceName.toLowerCase().replace(/\s+/g, '-')}` : '');
      const devName = run.deviceName?.toLowerCase().trim();
      
      devices.forEach(d => {
        const matchesId = devId && (d.id === devId || devId.includes(d.id));
        const matchesName = devName && d.name.toLowerCase().trim() === devName;
        if (matchesId || matchesName) {
          if (!map[d.id]) map[d.id] = {};
          map[d.id][run.planId] = (map[d.id][run.planId] || 0) + 1;
        }
      });
    });
    return map;
  }, [archivedRuns, testRuns, devices]);

  const fleetProgress = useMemo(() => {
    let totalTarget = 0;
    let totalCompleted = 0;
    devices.forEach(dev => {
      dev.quotas.forEach(q => {
        totalTarget += q.targetRunsPerDay;
        const doneToday = (todayRunsMap[dev.id] && todayRunsMap[dev.id][q.planId]) || 0;
        totalCompleted += Math.min(doneToday, q.targetRunsPerDay);
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
  const [customDateInput, setCustomDateInput] = useState<string>('');
  const [sortByDevice, setSortByDevice] = useState<'newest' | 'oldest' | 'device-asc' | 'device-desc' | 'severity'>('newest');
  
  // Feature Creation, Report Expand, Copy Report & Bug Filter Menu state on Dashboard
  const visualCardRef = useRef<HTMLDivElement>(null);
  const modalCardRef = useRef<HTMLDivElement>(null);
  const [newFeatureInput, setNewFeatureInput] = useState<string>('');
  const [isFeatureReportExpanded, setIsFeatureReportExpanded] = useState<boolean>(false);
  const [isBugFilterMenuOpen, setIsBugFilterMenuOpen] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [copiedImage, setCopiedImage] = useState<boolean>(false);
  const [copiedBugs, setCopiedBugs] = useState<boolean>(false);
  const [isVisualSnapshotModalOpen, setIsVisualSnapshotModalOpen] = useState<boolean>(false);
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState<string | null>(null);

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
      searchQuery: searchBugQuery.trim() || undefined
    });

    if (success) {
      setCopiedBugs(true);
      setTimeout(() => setCopiedBugs(false), 2500);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedImagePreviewUrl) {
        setSelectedImagePreviewUrl(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImagePreviewUrl]);

  // Helper to determine real, effective run status
  const getEffectiveRunStatus = (run: TestRun) => {
    const plan = testPlans.find(p => p.id === run.planId);
    const totalSteps = plan?.steps.length || 0;
    const completedCount = Object.keys(run.results || {}).length;

    if (run.status === 'completed' || (totalSteps > 0 && completedCount >= totalSteps)) {
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

  const handleCreateFeatureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeatureInput.trim() || !onAddFeature) return;
    onAddFeature(newFeatureInput.trim());
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

  // Filter runs to ONLY include fully finished test plan executions (executed from start to finish)
  const completedRuns = useMemo(() => {
    const map = new Map<string, TestRun>();
    
    const combined = [...archivedRuns, ...testRuns];
    combined.forEach(run => {
      const plan = testPlans.find(p => p.id === run.planId);
      const totalSteps = plan?.steps.length || 0;
      const completedCount = Object.keys(run.results || {}).length;
      const isDone = run.status === 'completed' || (totalSteps > 0 && completedCount >= totalSteps);

      if (isDone) {
        map.set(run.id, run);
      }
    });

    return Array.from(map.values());
  }, [testRuns, archivedRuns, testPlans]);

  // Unique devices populated across bug logs and completed test runs
  const uniqueDevices = Array.from(
    new Set(
      bugLogs.map(b => b.deviceName).concat(completedRuns.map(r => r.deviceName)).filter(Boolean)
    )
  ) as string[];

  // Unique features populated across test steps, bug logs, and populatedFeatures (excluding 'General')
  const uniqueFeatures = Array.from(
    new Set(
      populatedFeatures
        .concat(testPlans.flatMap(p => p.steps.map(s => s.feature || '')))
        .concat(bugLogs.map(b => b.feature || ''))
        .filter(f => f && f.trim() !== '' && f.toLowerCase() !== 'general')
    )
  ) as string[];

  // Calculate Feature Health Metrics
  const featureMetricsMap: Record<string, FeatureMetric> = {};

  // Populate map with all populated features first
  uniqueFeatures.forEach(fName => {
    featureMetricsMap[fName] = {
      featureName: fName,
      totalStepsExecuted: 0,
      greenCount: 0,
      yellowCount: 0,
      redCount: 0,
      bugCount: 0,
      healthScorePct: 100,
      status: 'healthy'
    };
  });

  // Gather steps from plans
  testPlans.forEach(plan => {
    plan.steps.forEach(step => {
      const featureName = step.feature;
      if (!featureName || featureName.toLowerCase() === 'general') return;
      if (!featureMetricsMap[featureName]) {
        featureMetricsMap[featureName] = {
          featureName,
          totalStepsExecuted: 0,
          greenCount: 0,
          yellowCount: 0,
          redCount: 0,
          bugCount: 0,
          healthScorePct: 100,
          status: 'healthy'
        };
      }
    });
  });

  // Today Local Date string (YYYY-MM-DD)
  const todayStr = useMemo(() => getLocalDateStr(new Date()), []);

  // Selected Daily QA Session Date (defaults to Today, or specific saved day YYYY-MM-DD, or 'all')
  const [selectedDailySessionDate, setSelectedDailySessionDate] = useState<string>(todayStr);

  // List of Saved Historical Days with execution counts
  const recordedDailySessions = useMemo(() => {
    const datesMap: Record<string, { dateStr: string; label: string; stepCount: number; bugCount: number }> = {};
    
    // Always include Today
    const todayLabel = `Today (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
    datesMap[todayStr] = { dateStr: todayStr, label: todayLabel, stepCount: 0, bugCount: 0 };

    const formatDisplayLabel = (dStr: string) => {
      const [y, m, d] = dStr.split('-').map(Number);
      if (y && m && d) {
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      return dStr;
    };

    completedRuns.forEach(run => {
      Object.values(run.results || {}).forEach(res => {
        if (!res.timestamp || res.status === 'pending') return;
        const dStr = getLocalDateStr(res.timestamp);
        if (!dStr) return;
        if (!datesMap[dStr]) {
          const label = dStr === todayStr ? todayLabel : formatDisplayLabel(dStr);
          datesMap[dStr] = { dateStr: dStr, label, stepCount: 0, bugCount: 0 };
        }
        datesMap[dStr].stepCount += 1;
      });
    });

    bugLogs.forEach(b => {
      if (!b.timestamp) return;
      const dStr = getLocalDateStr(b.timestamp);
      if (!dStr) return;
      if (!datesMap[dStr]) {
        const label = dStr === todayStr ? todayLabel : formatDisplayLabel(dStr);
        datesMap[dStr] = { dateStr: dStr, label, stepCount: 0, bugCount: 0 };
      }
      datesMap[dStr].bugCount += 1;
    });

    return Object.values(datesMap).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  }, [completedRuns, bugLogs, todayStr]);

  // Aggregate step results from ALL runs (active & completed) for the selected Daily Session Date
  const allRunsList = [...archivedRuns, ...testRuns];
  allRunsList.forEach(run => {
    const plan = testPlans.find(p => p.id === run.planId);
    if (!plan) return;
    plan.steps.forEach(step => {
      const res = run.results[step.id];
      if (!res || !res.status || res.status === 'pending') return;

      // Filter by selected Daily QA Session Date (unless 'all' is selected)
      if (selectedDailySessionDate !== 'all') {
        const stepDate = res.timestamp ? getLocalDateStr(res.timestamp) : getLocalDateStr(run.startedAt || new Date());
        if (stepDate && stepDate !== selectedDailySessionDate) return;
      }

      const featureName = step.feature;
      if (!featureName || featureName.toLowerCase() === 'general') return;
      if (!featureMetricsMap[featureName]) {
        featureMetricsMap[featureName] = {
          featureName,
          totalStepsExecuted: 0,
          greenCount: 0,
          yellowCount: 0,
          redCount: 0,
          bugCount: 0,
          healthScorePct: 100,
          status: 'healthy',
          associatedBugs: []
        };
      }

      const metric = featureMetricsMap[featureName];
      metric.totalStepsExecuted += 1;
      if (res.status === 'green') metric.greenCount += 1;
      if (res.status === 'yellow') metric.yellowCount += 1;
      if (res.status === 'red') metric.redCount += 1;
    });
  });

  // Aggregate bug counts for the selected Daily Session Date
  bugLogs.forEach(bug => {
    if (selectedDailySessionDate !== 'all') {
      const bugDate = bug.timestamp ? getLocalDateStr(bug.timestamp) : '';
      if (bugDate && bugDate !== selectedDailySessionDate) return;
    }

    const featureName = bug.feature;
    if (!featureName || featureName.toLowerCase() === 'general') return;
    if (!featureMetricsMap[featureName]) {
      featureMetricsMap[featureName] = {
        featureName,
        totalStepsExecuted: 0,
        greenCount: 0,
        yellowCount: 0,
        redCount: 0,
        bugCount: 0,
        healthScorePct: 100,
        status: 'healthy',
        associatedBugs: []
      };
    }
    featureMetricsMap[featureName].bugCount += 1;
    if (!featureMetricsMap[featureName].associatedBugs) {
      featureMetricsMap[featureName].associatedBugs = [];
    }
    featureMetricsMap[featureName].associatedBugs!.push(bug);
  });

  // Re-calculate health score & status per feature
  Object.values(featureMetricsMap).forEach(metric => {
    const total = metric.totalStepsExecuted;
    if (total > 0) {
      metric.healthScorePct = Math.round((metric.greenCount / total) * 100);
    } else {
      metric.healthScorePct = 100;
    }

    if (metric.healthScorePct <= 59) {
      metric.status = 'critical';
    } else if (metric.healthScorePct <= 94) {
      metric.status = 'warning';
    } else {
      metric.status = 'healthy';
    }
  });

  // Historical Quality Evolution Timeline Points (Only fully finished runs)
  const historicalTimelinePoints = useMemo(() => {
    const pointsMap: Record<string, { dateStr: string; displayDate: string; totalSteps: number; green: number; yellow: number; red: number; bugs: number }> = {};

    const formatDisplayLabel = (dStr: string) => {
      const [y, m, d] = dStr.split('-').map(Number);
      if (y && m && d) {
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      return dStr;
    };

    completedRuns.forEach(run => {
      Object.values(run.results || {}).forEach(res => {
        if (!res.timestamp || res.status === 'pending') return;
        const dStr = getLocalDateStr(res.timestamp);
        if (!dStr) return;
        if (!pointsMap[dStr]) {
          const displayDate = formatDisplayLabel(dStr);
          pointsMap[dStr] = { dateStr: dStr, displayDate, totalSteps: 0, green: 0, yellow: 0, red: 0, bugs: 0 };
        }
        pointsMap[dStr].totalSteps += 1;
        if (res.status === 'green') pointsMap[dStr].green += 1;
        if (res.status === 'yellow') pointsMap[dStr].yellow += 1;
        if (res.status === 'red') pointsMap[dStr].red += 1;
      });
    });

    bugLogs.forEach(bug => {
      if (!bug.timestamp) return;
      const dStr = getLocalDateStr(bug.timestamp);
      if (!dStr) return;
      if (!pointsMap[dStr]) {
        const displayDate = formatDisplayLabel(dStr);
        pointsMap[dStr] = { dateStr: dStr, displayDate, totalSteps: 0, green: 0, yellow: 0, red: 0, bugs: 0 };
      }
      pointsMap[dStr].bugs += 1;
    });

    const sorted = Object.values(pointsMap).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    return sorted.map(p => {
      const scorePct = p.totalSteps > 0 ? Math.round((p.green / p.totalSteps) * 100) : 100;
      return { ...p, scorePct };
    });
  }, [completedRuns, bugLogs]);

  // Compute final health scores & statuses
  const featureMetricsList = Object.values(featureMetricsMap).map(metric => {
    const executed = metric.totalStepsExecuted;
    if (executed > 0) {
      metric.healthScorePct = Math.round((metric.greenCount / executed) * 100);
    } else {
      metric.healthScorePct = 100;
    }

    if (metric.healthScorePct <= 59) {
      metric.status = 'critical';
    } else if (metric.healthScorePct <= 94) {
      metric.status = 'warning';
    } else {
      metric.status = 'healthy';
    }

    return metric;
  });

  // Compute QA Status metrics for individual tester profiles & daily tracking
  const testerProfilesMap = useMemo(() => {
    const runsMap = new Map<string, TestRun>();
    [...archivedRuns, ...testRuns].forEach(r => {
      if (r && r.id) runsMap.set(r.id, r);
    });
    const combinedRuns = Array.from(runsMap.values());
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
      const tester = run.testerName?.trim() || 'Unassigned Tester';
      if (!map.has(tester)) {
        map.set(tester, {
          testerName: tester,
          devicesUsed: new Set<string>(),
          allTimeCompletedCount: 0,
          dailyStats: {}
        });
      }
      const profile = map.get(tester)!;
      if (run.deviceName) profile.devicesUsed.add(run.deviceName);

      const effectiveStatus = getEffectiveRunStatus(run);
      const isCompleted = effectiveStatus === 'completed';
      const isInProgress = effectiveStatus === 'in_progress';

      if (isCompleted || isInProgress) {
        if (isCompleted) {
          profile.allTimeCompletedCount++;
        }

        const runDate = (isCompleted && run.completedAt) ? new Date(run.completedAt) : (run.startedAt ? new Date(run.startedAt) : new Date());
        const dateStr = getLocalDateStr(runDate);
        const timeFormatted = runDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const resultsArray = Object.values(run.results || {});
        const stepTimestamps = resultsArray
          .map(r => r.timestamp ? new Date(r.timestamp).getTime() : NaN)
          .filter(t => !isNaN(t));

        let durationMs = run.durationMs || 0;
        if (!durationMs) {
          const startMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
          const endMs = (isCompleted && run.completedAt) ? new Date(run.completedAt).getTime() : Date.now();

          if (startMs > 0 && endMs > startMs) {
            durationMs = endMs - startMs;
          } else if (stepTimestamps.length > 0) {
            const minStepTime = Math.min(...stepTimestamps);
            const maxStepTime = Math.max(...stepTimestamps);
            if (maxStepTime > minStepTime) {
              durationMs = maxStepTime - minStepTime;
            }
          }
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

        if (!profile.dailyStats[dateStr]) {
          profile.dailyStats[dateStr] = {
            dateStr,
            completedCount: 0,
            totalDurationMs: 0,
            devicesUsedOnDay: new Set<string>(),
            completedRuns: []
          };
        }

        if (isCompleted) {
          profile.dailyStats[dateStr].completedCount++;
          profile.dailyStats[dateStr].totalDurationMs += durationMs;
        }

        profile.dailyStats[dateStr].devicesUsedOnDay.add(deviceNameStr);
        profile.dailyStats[dateStr].completedRuns.push({
          runId: run.id,
          planName: run.planName,
          deviceName: deviceNameStr,
          completedAtFormatted: isCompleted ? timeFormatted : `In Progress (${timeFormatted})`,
          durationMs,
          durationFormatted: isCompleted ? durationFormatted : 'Active Now',
          greenCount,
          yellowCount,
          redCount
        });
      }
    });

    return Array.from(map.values());
  }, [testRuns, archivedRuns]);

  // Extract all unique dates for QA Status dropdown
  const allQaDatesList = useMemo(() => {
    const set = new Set<string>();
    testerProfilesMap.forEach(p => {
      Object.keys(p.dailyStats).forEach(d => set.add(d));
    });
    return Array.from(set).sort().reverse();
  }, [testerProfilesMap]);

  // Sort Feature Metrics: Critical (Red) first -> Warning (Yellow) -> Healthy (Green)
  const statusPriority: Record<string, number> = { critical: 1, warning: 2, healthy: 3 };
  featureMetricsList.sort((a, b) => {
    const pA = statusPriority[a.status] || 4;
    const pB = statusPriority[b.status] || 4;
    if (pA !== pB) return pA - pB;
    if (a.healthScorePct !== b.healthScorePct) return a.healthScorePct - b.healthScorePct;
    return a.featureName.localeCompare(b.featureName);
  });

  // Calculate Executive Feature Health Visual Aggregates
  const totalFeaturesCount = featureMetricsList.length;
  const criticalFeaturesCount = featureMetricsList.filter(f => f.status === 'critical').length;
  const warningFeaturesCount = featureMetricsList.filter(f => f.status === 'warning').length;
  const healthyFeaturesCount = featureMetricsList.filter(f => f.status === 'healthy').length;

  const criticalPct = totalFeaturesCount > 0 ? Math.round((criticalFeaturesCount / totalFeaturesCount) * 100) : 0;
  const warningPct = totalFeaturesCount > 0 ? Math.round((warningFeaturesCount / totalFeaturesCount) * 100) : 0;
  const healthyPct = totalFeaturesCount > 0 ? Math.max(0, 100 - criticalPct - warningPct) : 100;

  const avgHealthScore = totalFeaturesCount > 0
    ? Math.round(featureMetricsList.reduce((acc, f) => acc + f.healthScorePct, 0) / totalFeaturesCount)
    : 100;

  const totalStepsAcrossFeatures = featureMetricsList.reduce((acc, f) => acc + f.totalStepsExecuted, 0);
  const totalBugsAcrossFeatures = featureMetricsList.reduce((acc, f) => acc + f.bugCount, 0);

  const handleCopyReportToClipboard = async () => {
    const riskStatus = criticalFeaturesCount > 0 || avgHealthScore < 80
      ? '🔴 High Risk'
      : warningFeaturesCount > 0 || avgHealthScore < 95
      ? '🟡 Moderate Risk'
      : '🟢 System Healthy';

    const criticalList = featureMetricsList.filter(m => m.status === 'critical');
    const warningList = featureMetricsList.filter(m => m.status === 'warning');
    const healthyList = featureMetricsList.filter(m => m.status === 'healthy');

    // Fetch overall Gemini bug summary across features if bugs exist
    const allBugs = featureMetricsList.flatMap(m => m.associatedBugs || []);
    const overallGeminiSummary = await summarizeOverallBugsWithGemini(allBugs.length > 0 ? allBugs : bugLogs);

    // Plain text format
    let plainText = `📊 CUJ Report (${new Date().toLocaleDateString()})\n`;
    plainText += `• Coverage: ${totalFeaturesCount} CUJs (${totalStepsAcrossFeatures} steps)\n`;
    plainText += `• Status: 🟢 ${healthyFeaturesCount} Healthy | 🟡 ${warningFeaturesCount} Degraded | 🔴 ${criticalFeaturesCount} Critical (${totalBugsAcrossFeatures} Bugs)\n`;
    if (overallGeminiSummary) {
      plainText += `• Gemini Issue Overview: ${overallGeminiSummary}\n`;
    }
    plainText += `\n`;

    if (criticalList.length > 0) {
      plainText += `🔴 Critical CUJs:\n`;
      criticalList.forEach(m => {
        const bugText = m.bugCount > 0 ? `, ${m.bugCount} bugs` : '';
        const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
        plainText += `• ${m.featureName}: ${m.healthScorePct}% (${stepDetail}${bugText})\n`;
      });
      plainText += `\n`;
    }

    if (warningList.length > 0) {
      plainText += `🟡 Degraded CUJs:\n`;
      warningList.forEach(m => {
        const bugText = m.bugCount > 0 ? `, ${m.bugCount} bugs` : '';
        const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
        plainText += `• ${m.featureName}: ${m.healthScorePct}% (${stepDetail}${bugText})\n`;
      });
      plainText += `\n`;
    }

    if (healthyList.length > 0) {
      plainText += `🟢 Healthy CUJs:\n`;
      healthyList.forEach(m => {
        const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
        plainText += `• ${m.featureName}: ${m.healthScorePct}% (${stepDetail})\n`;
      });
    }

    // Rich HTML format (for Slack, Teams, Google Docs, Word, Apple Notes, Email)
    let htmlText = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.5;">`;
    htmlText += `<p style="margin: 0 0 6px 0;">📊 <b>CUJ Report</b> (${new Date().toLocaleDateString()})</p>`;
    htmlText += `<p style="margin: 0 0 4px 0;">• <b>Coverage</b>: ${totalFeaturesCount} CUJs (${totalStepsAcrossFeatures} steps)</p>`;
    htmlText += `<p style="margin: 0 0 8px 0;">• <b>Status</b>: 🟢 ${healthyFeaturesCount} Healthy | 🟡 ${warningFeaturesCount} Degraded | 🔴 ${criticalFeaturesCount} Critical (${totalBugsAcrossFeatures} Bugs)</p>`;
    if (overallGeminiSummary) {
      htmlText += `<div style="background-color: #f1f5f9; border-left: 3px solid #6366f1; padding: 8px 12px; margin: 8px 0 12px 0; border-radius: 6px; font-size: 12.5px; color: #1e293b;">🤖 <b>Gemini Executive Issue Summary:</b> ${overallGeminiSummary}</div>`;
    }

    if (criticalList.length > 0) {
      htmlText += `<p style="margin: 8px 0 4px 0; color: #dc2626; font-weight: 700;">🔴 Critical CUJs:</p>`;
      htmlText += `<ul style="margin: 0 0 8px 0; padding-left: 18px;">`;
      criticalList.forEach(m => {
        const bugText = m.bugCount > 0 ? `, ${m.bugCount} bugs` : '';
        const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
        htmlText += `<li style="margin-bottom: 3px;"><b>${m.featureName}</b>: ${m.healthScorePct}% (${stepDetail}${bugText})</li>`;
      });
      htmlText += `</ul>`;
    }

    if (warningList.length > 0) {
      htmlText += `<p style="margin: 8px 0 4px 0; color: #d97706; font-weight: 700;">🟡 Degraded CUJs:</p>`;
      htmlText += `<ul style="margin: 0 0 8px 0; padding-left: 18px;">`;
      warningList.forEach(m => {
        const bugText = m.bugCount > 0 ? `, ${m.bugCount} bugs` : '';
        const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
        htmlText += `<li style="margin-bottom: 3px;"><b>${m.featureName}</b>: ${m.healthScorePct}% (${stepDetail}${bugText})</li>`;
      });
      htmlText += `</ul>`;
    }

    if (healthyList.length > 0) {
      htmlText += `<p style="margin: 8px 0 4px 0; color: #16a34a; font-weight: 700;">🟢 Healthy CUJs:</p>`;
      htmlText += `<ul style="margin: 0 0 4px 0; padding-left: 18px;">`;
      healthyList.forEach(m => {
        const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
        htmlText += `<li style="margin-bottom: 3px;"><b>${m.featureName}</b>: ${m.healthScorePct}% (${stepDetail})</li>`;
      });
      htmlText += `</ul>`;
    }

    htmlText += `</div>`;

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
    } catch (err) {
      await navigator.clipboard.writeText(plainText);
    }

    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const handleCopyVisualImageToClipboard = async () => {
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
          backgroundColor: '#020617',
        },
        filter: (node) => {
          if (node instanceof HTMLElement && node.classList.contains('no-capture')) {
            return false;
          }
          return true;
        }
      });

      if (!blob) return;

      // Download PNG file directly so user gets a real high-res PNG file
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `QA_Quality_Profile_${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      URL.revokeObjectURL(url);

      // Also copy PNG blob to clipboard if browser allows
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
        }
      } catch (err) {
        // Clipboard write fallback handled by PNG download
      }

      setCopiedImage(true);
      setTimeout(() => setCopiedImage(false), 2500);
    } catch (err) {
      console.error('Failed to export PNG image:', err);
    }
  };

  // Filter & Sort Bug Logs
  let processedBugs = [...bugLogs];

  if (selectedDeviceFilter !== 'all') {
    processedBugs = processedBugs.filter(
      b => (b.deviceName || 'Unspecified').toLowerCase() === selectedDeviceFilter.toLowerCase()
    );
  }

  if (selectedFeatureFilter !== 'all') {
    processedBugs = processedBugs.filter(
      b => (b.feature || 'General').toLowerCase() === selectedFeatureFilter.toLowerCase()
    );
  }

  // Date Filter logic
  if (selectedDateFilter !== 'all') {
    const now = new Date();
    processedBugs = processedBugs.filter(b => {
      if (!b.timestamp) return false;
      const bugDate = new Date(b.timestamp);

      if (selectedDateFilter === 'today') {
        return bugDate.toDateString() === now.toDateString();
      }

      if (selectedDateFilter === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return bugDate.toDateString() === yesterday.toDateString();
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
        const targetDate = new Date(customDateInput);
        return bugDate.toDateString() === targetDate.toDateString();
      }

      return true;
    });
  }

  processedBugs.sort((a, b) => {
    if (sortByDevice === 'device-asc') {
      return (a.deviceName || 'Unspecified').localeCompare(b.deviceName || 'Unspecified');
    }
    if (sortByDevice === 'device-desc') {
      return (b.deviceName || 'Unspecified').localeCompare(a.deviceName || 'Unspecified');
    }
    if (sortByDevice === 'oldest') {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    }
    if (sortByDevice === 'severity') {
      const sevMap = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sevMap[b.severity] || 0) - (sevMap[a.severity] || 0);
    }
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Filter plans by search query
  const filteredPlans = testPlans.filter(p => 
    !searchPlanQuery || 
    p.name.toLowerCase().includes(searchPlanQuery.toLowerCase()) || 
    p.description.toLowerCase().includes(searchPlanQuery.toLowerCase()) ||
    p.steps.some(s => s.title.toLowerCase().includes(searchPlanQuery.toLowerCase()) || (s.feature && s.feature.toLowerCase().includes(searchPlanQuery.toLowerCase())))
  );

  // Filter bugs by text search query
  if (searchBugQuery.trim()) {
    const q = searchBugQuery.toLowerCase();
    processedBugs = processedBugs.filter(b => 
      b.note.toLowerCase().includes(q) ||
      b.stepTitle.toLowerCase().includes(q) ||
      b.testerName.toLowerCase().includes(q) ||
      (b.feature || '').toLowerCase().includes(q) ||
      (b.deviceName || '').toLowerCase().includes(q)
    );
  }

  // Stats calculation
  const totalPlans = testPlans.length;
  const activeRuns = testRuns.filter(r => getEffectiveRunStatus(r) === 'in_progress').length;
  const totalBugs = bugLogs.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Top Welcome & Actions Header (Apple Liquid Glass Banner) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 liquid-glass-panel rounded-3xl p-6 shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl font-black text-white tracking-tight">Test Plans & Feature Health Monitor</h2>
          <p className="text-xs text-slate-300 mt-1 font-medium">
            Design test templates, track individual feature health metrics, and organize bug logs by device model.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 relative z-10">
          <button
            onClick={onSelectPlanToBuild}
            className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:to-pink-400 text-white text-xs font-extrabold rounded-2xl shadow-xl shadow-purple-500/30 border border-white/30 flex items-center gap-1.5 transition-all duration-300 hover:scale-[1.03] active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Plan
          </button>
        </div>
      </div>

      {/* Unified Top Navigation KPI Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        
        {/* Card 1: Overview / Test Plans */}
        <div
          onClick={() => setActiveTab('overview')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeTab === 'overview'
              ? 'bg-indigo-500/25 border-indigo-400/80 ring-2 ring-indigo-400/60 shadow-lg scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view Configured Test Plans & Active Runs"
        >
          <div>
            <div className="text-[11px] font-extrabold text-slate-300 flex items-center gap-1.5">
              <span>Test Plans</span>
              {activeTab === 'overview' && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>}
            </div>
            <div className="text-xl font-black text-white mt-1 font-mono tracking-tight">{totalPlans}</div>
          </div>
          <div className={`p-2.5 rounded-xl border transition-all ${
            activeTab === 'overview'
              ? 'bg-indigo-500 text-white border-indigo-300 shadow-md shadow-indigo-500/50'
              : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30 backdrop-blur-md'
          }`}>
            <ListChecks className="w-4 h-4" />
          </div>
        </div>

        {/* Card 2: Devices & Quotas */}
        <div
          onClick={() => setActiveTab('devices')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeTab === 'devices'
              ? 'bg-purple-500/25 border-purple-400/80 ring-2 ring-purple-400/60 shadow-lg scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to manage Devices & Daily Test Quotas"
        >
          <div>
            <div className="text-[11px] font-extrabold text-slate-300 flex items-center gap-1.5">
              <span>Devices & Quotas</span>
              {activeTab === 'devices' && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>}
            </div>
            <div className="text-xl font-black text-purple-300 mt-1 font-mono tracking-tight">{devices.length} Devices</div>
          </div>
          <div className={`p-2.5 rounded-xl border transition-all ${
            activeTab === 'devices'
              ? 'bg-purple-500 text-white border-purple-300 shadow-md shadow-purple-500/50'
              : 'bg-purple-500/20 text-purple-300 border-purple-400/30 backdrop-blur-md'
          }`}>
            <Smartphone className="w-4 h-4" />
          </div>
        </div>

        {/* Card 3: QA Testers */}
        <div
          onClick={() => setActiveTab('testers')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeTab === 'testers'
              ? 'bg-emerald-500/25 border-emerald-400/80 ring-2 ring-emerald-400/60 shadow-lg scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view & create QA Tester Profiles"
        >
          <div>
            <div className="text-[11px] font-extrabold text-slate-300 flex items-center gap-1.5">
              <span>QA Testers</span>
              {activeTab === 'testers' && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>}
            </div>
            <div className="text-xl font-black text-emerald-300 mt-1 font-mono tracking-tight">{testers.length} Testers</div>
          </div>
          <div className={`p-2.5 rounded-xl border transition-all ${
            activeTab === 'testers'
              ? 'bg-emerald-500 text-white border-emerald-300 shadow-md shadow-emerald-500/50'
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30 backdrop-blur-md'
          }`}>
            <UserCheck className="w-4 h-4" />
          </div>
        </div>

        {/* Card 4: CUJ Quality Report */}
        <div
          onClick={() => setActiveTab('features')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeTab === 'features'
              ? 'bg-amber-500/25 border-amber-400/80 ring-2 ring-amber-400/60 shadow-lg scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view CUJ Quality Report"
        >
          <div>
            <div className="text-[11px] font-extrabold text-slate-300 flex items-center gap-1.5">
              <span>CUJ Report</span>
              {activeTab === 'features' && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>}
            </div>
            <div className="text-xl font-black text-amber-300 mt-1 font-mono tracking-tight">{featureMetricsList.length} CUJs</div>
          </div>
          <div className={`p-2.5 rounded-xl border transition-all ${
            activeTab === 'features'
              ? 'bg-amber-500 text-white border-amber-300 shadow-md shadow-amber-500/50'
              : 'bg-amber-500/20 text-amber-300 border-amber-400/30 backdrop-blur-md'
          }`}>
            <Activity className="w-4 h-4" />
          </div>
        </div>

        {/* Card 5: Bugs Feed */}
        <div
          onClick={() => setActiveTab('bugs')}
          className={`liquid-glass-card rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeTab === 'bugs'
              ? 'bg-rose-500/25 border-rose-400/80 ring-2 ring-rose-400/60 shadow-lg scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view Reported Bugs"
        >
          <div>
            <div className="text-[11px] font-extrabold text-slate-300 flex items-center gap-1.5">
              <span>Bugs Feed</span>
              {activeTab === 'bugs' && <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>}
            </div>
            <div className="text-xl font-black text-rose-300 mt-1 font-mono tracking-tight">{totalBugs} Bugs</div>
          </div>
          <div className={`p-2.5 rounded-xl border transition-all ${
            activeTab === 'bugs'
              ? 'bg-rose-500 text-white border-rose-300 shadow-md shadow-rose-500/50'
              : 'bg-rose-500/20 text-rose-300 border-rose-400/30 backdrop-blur-md'
          }`}>
            <Bug className="w-4 h-4" />
          </div>
        </div>

      </div>

      {/* Tab 2: Devices & Daily Target Quotas */}
      {activeTab === 'devices' && (
        <div className="space-y-8 animate-liquid-fade">
          
          {/* Fleet Daily Quota Overview Badge Banner */}
          <div className="liquid-glass-panel rounded-3xl p-6 bg-gradient-to-r from-purple-950/70 via-slate-900/80 to-indigo-950/70 border-purple-500/20 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-purple-400" />
                <h3 className="text-lg font-black text-white tracking-tight">Fleet Daily Quota Progress</h3>
              </div>
              <p className="text-xs text-slate-300">
                Preset device targets enforce daily test run quotas on mobile devices.
              </p>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-2xl font-black text-purple-300 font-mono">
                  {fleetProgress.totalCompleted} / {fleetProgress.totalTarget} <span className="text-xs text-slate-400 font-sans font-normal">runs completed</span>
                </div>
                <div className="text-xs font-bold text-slate-400">{fleetProgress.pct}% Fleet Goal Reached</div>
              </div>
              
              <button
                type="button"
                onClick={() => {
                  if (confirm('Reset daily run progress counters for all devices?')) {
                    if (onResetActiveDay) onResetActiveDay(getLocalDateStr(new Date()));
                  }
                }}
                className="px-4 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-400/40 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-md active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
                <span>Reset Daily Progress</span>
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-purple-400" />
                <span>Registered Devices ({devices.length})</span>
              </h3>
            </div>

            {/* Add Device Form */}
            <div className="liquid-glass-card rounded-2xl p-4 border border-white/10 flex items-center gap-3">
              <input
                type="text"
                placeholder="Enter device model or name (e.g. Google Pixel 8)..."
                value={newDeviceName}
                onChange={e => setNewDeviceName(e.target.value)}
                className="flex-1 bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-medium"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newDeviceName.trim()) return;
                  const newDev: DeviceProfile = {
                    id: `dev-${Date.now()}`,
                    name: newDeviceName.trim(),
                    isReady: true,
                    quotas: []
                  };
                  if (onSaveDevice) onSaveDevice(newDev);
                  setNewDeviceName('');
                }}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all shadow-md active:scale-95"
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
                  const selectedPlanForDev = quotaPlanMap[device.id] || (testPlans[0]?.id || '');
                  const selectedRunsForDev = quotaRunsMap[device.id] || 3;

                  return (
                    <div key={device.id} className="liquid-glass-panel rounded-2xl p-5 border border-white/10 space-y-4 bg-slate-900/60 shadow-lg">
                      
                      {/* Device Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-400/30">
                            <Smartphone className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-extrabold text-white">{device.name}</h4>
                              {device.activeRunId && (
                                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-extrabold flex items-center gap-1 animate-pulse">
                                  <Timer className="w-3 h-3" />
                                  <span>In Use by {device.activeTesterName || 'Tester'}</span>
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono">ID: {device.id}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Readiness Toggle Button */}
                          <button
                            type="button"
                            onClick={() => {
                              const updated: DeviceProfile = { ...device, isReady: !device.isReady };
                              if (onSaveDevice) onSaveDevice(updated);
                            }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border transition-all ${
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

                      {/* Quotas List for this device */}
                      <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800 space-y-3">
                        <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
                          <span>Daily Test Plan Quotas</span>
                          <span className="text-[10px] text-purple-400 font-mono font-normal">Controls Mobile Availability</span>
                        </div>

                        {device.quotas.length === 0 ? (
                          <div className="text-[11px] text-slate-500 italic">No plan quotas set for this device. Assign a plan below.</div>
                        ) : (
                          <div className="space-y-2">
                            {device.quotas.map(quota => {
                              const plan = testPlans.find(p => p.id === quota.planId);
                              const doneToday = (todayRunsMap[device.id] && todayRunsMap[device.id][quota.planId]) || 0;
                              const remaining = Math.max(0, quota.targetRunsPerDay - doneToday);
                              const pct = Math.min(100, Math.round((doneToday / quota.targetRunsPerDay) * 100));

                              return (
                                <div key={quota.planId} className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center justify-between font-bold">
                                      <span className="text-white">{plan?.name || `Plan (${quota.planId})`}</span>
                                      <span className="text-slate-300 font-mono">
                                        {doneToday} / {quota.targetRunsPerDay} done
                                        {remaining > 0 ? (
                                          <span className="text-purple-400 ml-1.5 font-sans font-extrabold">({remaining} remaining ⚡)</span>
                                        ) : (
                                          <span className="text-emerald-400 ml-1.5 font-sans font-extrabold">(Quota Reached ✅)</span>
                                        )}
                                      </span>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full transition-all duration-500 ${remaining === 0 ? 'bg-emerald-400' : 'bg-purple-500'}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextQuotas = device.quotas.filter(q => q.planId !== quota.planId);
                                      if (onSaveDevice) onSaveDevice({ ...device, quotas: nextQuotas });
                                    }}
                                    className="p-1 text-slate-500 hover:text-rose-400 self-end sm:self-center transition-colors"
                                    title="Remove Quota"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Add/Edit Quota Inline Form */}
                        {testPlans.length > 0 && (
                          <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-2">
                            <select
                              value={selectedPlanForDev}
                              onChange={e => setQuotaPlanMap(prev => ({ ...prev, [device.id]: e.target.value }))}
                              className="bg-slate-900 border border-slate-800 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-purple-500"
                            >
                              {testPlans.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-slate-400">Target Runs/Day:</span>
                              <input
                                type="number"
                                min="1"
                                max="50"
                                value={selectedRunsForDev}
                                onChange={e => setQuotaRunsMap(prev => ({ ...prev, [device.id]: parseInt(e.target.value) || 1 }))}
                                className="w-16 bg-slate-900 border border-slate-800 text-xs text-white font-mono rounded-lg px-2 py-1 focus:outline-none focus:border-purple-500 text-center"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                if (!selectedPlanForDev) return;
                                const existingIdx = device.quotas.findIndex(q => q.planId === selectedPlanForDev);
                                let nextQuotas = [...device.quotas];
                                if (existingIdx >= 0) {
                                  nextQuotas[existingIdx] = { planId: selectedPlanForDev, targetRunsPerDay: selectedRunsForDev };
                                } else {
                                  nextQuotas.push({ planId: selectedPlanForDev, targetRunsPerDay: selectedRunsForDev });
                                }
                                if (onSaveDevice) onSaveDevice({ ...device, quotas: nextQuotas });
                              }}
                              className="px-3 py-1 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-400/40 text-xs font-bold rounded-lg transition-all"
                            >
                              + Set Quota
                            </button>
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

      {/* Tab 3: QA Testers & Tester Profiles */}
      {activeTab === 'testers' && (
        <div className="space-y-8 animate-liquid-fade">
          
          {/* Header Banner */}
          <div className="liquid-glass-panel rounded-3xl p-6 bg-gradient-to-r from-emerald-950/70 via-slate-900/80 to-teal-950/70 border-emerald-500/20 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-black text-white tracking-tight">QA Tester Profiles</h3>
              </div>
              <p className="text-xs text-slate-300">
                Pre-register testers so field engineers can instantly select their name on mobile apps.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Form: Add Tester Profile */}
            <div className="space-y-6">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>Create Tester Profile</span>
              </h3>

              <div className="liquid-glass-panel rounded-3xl p-5 border border-white/10 space-y-4 bg-slate-900/60 shadow-xl">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Kevin Huang..."
                    value={newPersonName}
                    onChange={e => setNewPersonName(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Role / Specialization</label>
                  <input
                    type="text"
                    placeholder="e.g. Lead QA / Mobile Specialist..."
                    value={newPersonRole}
                    onChange={e => setNewPersonRole(e.target.value)}
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-medium"
                  />
                </div>

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
                  }}
                  className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save Tester Profile</span>
                </button>
              </div>
            </div>

            {/* Right List: Registered Testers Grid */}
            <div className="lg:col-span-2 space-y-6">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                <span>Registered Testers ({testers.length})</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {testers.length === 0 ? (
                  <div className="sm:col-span-2 liquid-glass-card rounded-2xl p-8 text-center text-slate-400 text-xs italic">
                    No QA testers registered. Add testers using the form on the left.
                  </div>
                ) : (
                  testers.map(tester => (
                    <div key={tester.id} className="liquid-glass-panel rounded-2xl p-5 border border-white/10 flex items-center justify-between bg-slate-900/60 shadow-lg">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-300 font-black text-sm flex items-center justify-center border border-emerald-400/40 shadow-inner">
                          {tester.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-black text-white">{tester.name}</div>
                          <div className="text-xs text-emerald-400 font-semibold">{tester.role || 'Mobile Tester'}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">ID: {tester.id}</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete tester profile "${tester.name}"?`)) {
                            if (onDeleteTesterProfile) onDeleteTesterProfile(tester.id);
                          }
                        }}
                        className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
                        title="Delete Tester"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </div>
      )}


      {/* Tab 1: Overview - Test Plans & Active Runs */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-liquid-fade">
          
          {/* Test Plans List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
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
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
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
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
                <div className="p-3 bg-slate-950 rounded-full border border-slate-800 text-slate-500 w-fit mx-auto">
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
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Create Test Plan
                  </button>
                </div>
              </div>
            ) : filteredPlans.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                No test plans matching "{searchPlanQuery}".
              </div>
            ) : (
              <div className="space-y-4">
                {filteredPlans.map(plan => (
                  <div key={plan.id} className="glass-card rounded-3xl p-6 space-y-4 transition-all duration-300 hover:-translate-y-0.5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="text-lg font-bold text-white tracking-tight">{plan.name}</h4>
                        <p className="text-xs text-slate-400 mt-1">{plan.description}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {onEditPlan && (
                          <button
                            onClick={() => onEditPlan(plan)}
                            className="p-2 text-slate-400 hover:text-purple-300 glass-button rounded-xl transition-all"
                            title="Edit Test Plan & Steps"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => onClonePlan(plan.id)}
                          className="p-2 text-slate-400 hover:text-indigo-300 glass-button rounded-xl transition-all"
                          title="Duplicate / Clone Test Plan"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeletePlan(plan.id)}
                          className="p-2 text-slate-500 hover:text-rose-400 glass-button hover:bg-rose-500/10 rounded-xl transition-all"
                          title="Delete Test Plan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Step Count & Action Buttons */}
                    <div className="flex items-center justify-between pt-3.5 border-t border-white/10 text-xs text-slate-400 font-medium">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-200">{plan.steps.length} Steps</span>
                        <span>•</span>
                        <span className="font-mono text-[11px]">Created {new Date(plan.createdAt).toLocaleDateString()}</span>
                      </div>

                      <button
                        onClick={() => onOpenMobileView(plan.id)}
                        className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-purple-200 text-xs font-bold rounded-2xl flex items-center gap-1.5 transition-all duration-300 shadow-md shadow-purple-500/10 backdrop-blur-md hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <Smartphone className="w-3.5 h-3.5 text-purple-300" />
                        Test on Phone App
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Real-time Field Activity (Apple Glass Side Panel) */}
          <div id="field-qa-progress-section" className="liquid-glass-panel rounded-3xl p-6 space-y-6 h-fit shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2 tracking-tight">
              <Clock className="w-4 h-4 text-emerald-400" />
              Live Field QA Progress
            </h3>

            <div className="space-y-4">
              {testRuns.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-6 font-medium">No active test runs recorded yet.</div>
              ) : (
                testRuns.map(run => {
                  const plan = testPlans.find(p => p.id === run.planId);
                  const totalSteps = plan?.steps.length || 1;
                  const completedResults = Object.values(run.results || {});
                  const completedSteps = completedResults.length;
                  const progressPct = Math.round((completedSteps / totalSteps) * 100);
                  const effectiveStatus = getEffectiveRunStatus(run);

                  const greenCount = completedResults.filter(r => r.status === 'green').length;
                  const yellowCount = completedResults.filter(r => r.status === 'yellow').length;
                  const redCount = completedResults.filter(r => r.status === 'red').length;

                  return (
                    <div key={run.id} className="liquid-glass-card rounded-2xl p-4 space-y-3 shadow-md">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-indigo-400" />
                          {run.testerName || 'Unassigned Tester'}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-extrabold border ${
                          effectiveStatus === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                            : effectiveStatus === 'in_progress'
                            ? 'bg-purple-500/20 text-purple-300 border-purple-400/30 animate-pulse'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {effectiveStatus === 'completed' ? 'Finished' : effectiveStatus === 'in_progress' ? 'In Progress' : 'Idle'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/60 pb-2">
                        <span className="truncate max-w-[140px] text-slate-300 font-medium">{run.planName}</span>
                        <span className="bg-purple-950 text-purple-300 px-2 py-0.5 rounded font-mono border border-purple-800/40 flex items-center gap-1">
                          <Smartphone className="w-3 h-3 text-purple-400" />
                          {run.deviceName || 'Device Unset'}
                        </span>
                      </div>

                      {/* Status Pills */}
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

                      {/* Progress bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono text-slate-400">
                          <span>Progress</span>
                          <span>{completedSteps} / {totalSteps} steps ({progressPct}%)</span>
                        </div>
                        <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-indigo-500 h-full transition-all"
                            style={{ width: `${progressPct}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Delete Session / Boot Tester Button */}
                      {onDeleteTestRun && (
                        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Boot tester "${run.testerName || 'Tester'}" off phone mode and delete this active session?`)) {
                                onDeleteTestRun(run.id);
                              }
                            }}
                            className="px-2.5 py-1 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-white text-[10px] font-bold rounded-xl border border-rose-500/30 flex items-center gap-1 transition-all"
                            title="Boot tester off phone mode and delete this test session"
                          >
                            <Trash2 className="w-3 h-3 text-rose-400" />
                            Boot Tester & Delete Session
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      )}

      {/* Tab: QA Testers Performance & Daily Metrics */}
      {activeTab === 'testers' && (
        <div className="space-y-6 animate-liquid-fade">
          
          {/* Header & Date Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 liquid-glass-panel rounded-3xl p-6 shadow-2xl">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 backdrop-blur-md">Tester Performance</span>
                <span className="text-xs text-emerald-400 font-mono font-bold">Daily Tracking Log</span>
              </div>
              <h3 className="text-2xl font-extrabold text-white mt-1.5 tracking-tight flex items-center gap-2">
                <UserCheck className="w-6 h-6 text-emerald-400" />
                <span>QA Status & Daily Execution Metrics</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1 font-medium">
                Profiles of individual QA testers, test plan completion counts, and time taken per test run. Resets daily while preserving historical logs.
              </p>
            </div>

            {/* Date Selector */}
            <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 p-2.5 rounded-2xl">
              <Calendar className="w-4 h-4 text-emerald-400 ml-1" />
              <span className="text-xs font-bold text-slate-300">Log Date:</span>
              <select
                value={selectedQaDate}
                onChange={e => setSelectedQaDate(e.target.value)}
                style={{ backgroundColor: '#0b101d', color: '#e0e7ff', WebkitAppearance: 'none' }}
                className="bg-slate-950 text-indigo-200 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
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
          </div>

          {/* Tester Profiles List */}
          {testerProfilesMap.length === 0 ? (
            <div className="liquid-glass-panel rounded-3xl p-12 text-center space-y-3">
              <div className="p-3 bg-slate-950 rounded-full border border-slate-800 text-slate-500 w-fit mx-auto">
                <UserCheck className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-white">No Tester Activity Recorded</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Deploy a test plan to a mobile device and complete a walkthrough to populate QA tester status profiles.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {testerProfilesMap.map(profile => {
                const dayData = selectedQaDate === 'all'
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
                const avgFormatted = avgMs > 0 ? `${avgMins}m ${avgSecs < 10 ? '0' : ''}${avgSecs}s` : 'N/A';

                const dayDevices = selectedQaDate === 'all'
                  ? Array.from(profile.devicesUsed)
                  : Array.from(('devicesUsedOnDay' in dayData && dayData.devicesUsedOnDay instanceof Set) ? dayData.devicesUsedOnDay : []);
                const devicesStr = dayDevices.join(', ') || 'Mobile Device';

                const isExpanded = !!expandedTesters[profile.testerName];

                return (
                  <div key={profile.testerName} className="liquid-glass-panel rounded-2xl p-4 shadow-xl border-white/10 transition-all duration-300">
                    
                    {/* Compact Tester Header Row */}
                    <div className="flex items-center justify-between gap-3">
                      
                      {/* Left: Avatar + Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-extrabold flex items-center justify-center text-sm shadow-md border border-white/20 flex-shrink-0">
                          {profile.testerName.charAt(0).toUpperCase()}
                        </div>
                        <div className="truncate">
                          <h4 className="text-sm font-bold text-white truncate">{profile.testerName}</h4>
                        </div>
                      </div>

                      {/* Middle: Compact Day Stats (Plans Finished) */}
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <div className="text-right hidden sm:block">
                          <span className="text-[9px] uppercase text-slate-400 block">Finished</span>
                          <span className="font-extrabold text-emerald-300">{dayData.completedCount} Plans</span>
                        </div>
                      </div>

                      {/* Right: Expand Accordion Chevron & Delete Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleTesterExpand(profile.testerName)}
                          className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl border border-slate-700 text-xs font-semibold transition-all duration-300 flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                        >
                          <span>{isExpanded ? 'Hide' : 'Details'}</span>
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-500 ease-out ${isExpanded ? 'rotate-180 text-emerald-400' : 'rotate-0'}`} />
                        </button>

                        {(onDeleteTester || onDeleteTestRun) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Delete all QA test performance data for tester "${profile.testerName}"?`)) {
                                if (onDeleteTester) {
                                  onDeleteTester(profile.testerName);
                                } else if (onDeleteTestRun) {
                                  const runsToDelete = [...testRuns, ...archivedRuns].filter(r => r.testerName === profile.testerName);
                                  runsToDelete.forEach(r => onDeleteTestRun(r.id));
                                }
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 rounded-xl transition-all active:scale-95 cursor-pointer"
                            title={`Delete all QA performance data for ${profile.testerName}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                    </div>

                    {/* Fluid Liquid Glass Accordion Expandable Details Section */}
                    <div className={`liquid-accordion-wrapper ${isExpanded ? 'expanded' : ''}`}>
                      <div className="liquid-accordion-inner">
                        <div className="mt-4 pt-3 border-t border-white/10 space-y-3">
                          {/* Devices Tested Banner */}
                          <div className="flex items-center justify-between bg-slate-950/70 p-2.5 rounded-xl border border-white/10 text-xs">
                            <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
                              <Smartphone className="w-3 h-3 text-purple-400" />
                              Devices Tested ({selectedQaDate === todayStr ? 'Today' : selectedQaDate}):
                            </span>
                            <span className="font-bold text-purple-300 font-mono truncate max-w-[220px]" title={devicesStr}>{devicesStr}</span>
                          </div>

                          {/* Day Key Stats Summary for Mobile */}
                          <div className="grid grid-cols-2 gap-2 sm:hidden text-xs">
                            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-white/10">
                              <span className="text-[10px] text-slate-400 block font-bold uppercase">Finished</span>
                              <span className="text-base font-extrabold text-emerald-300 font-mono">{dayData.completedCount} Plans</span>
                            </div>
                            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-white/10">
                              <span className="text-[10px] text-slate-400 block font-bold uppercase">Avg Time</span>
                              <span className="text-base font-extrabold text-indigo-300 font-mono">{avgFormatted}</span>
                            </div>
                          </div>

                          <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
                            <span>Completed Test Plans Breakdown ({selectedQaDate === todayStr ? 'Today' : selectedQaDate}):</span>
                            <span className="text-[10px] text-slate-400 font-mono">{completedRunsList.length} executed</span>
                          </div>

                          {completedRunsList.length === 0 ? (
                            <div className="bg-slate-950/40 p-3 rounded-xl text-center text-xs text-slate-500 font-medium">
                              No test plans completed on {selectedQaDate === todayStr ? 'today' : selectedQaDate}.
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                              {completedRunsList.map((runItem, idx) => (
                                <div key={runItem.runId + idx} className="bg-slate-950/80 p-2.5 rounded-xl border border-white/10 flex items-center justify-between text-xs space-x-2">
                                  <div className="truncate flex-1">
                                    <div className="font-bold text-slate-200 truncate">{runItem.planName}</div>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                      <span className="text-purple-300 font-mono flex items-center gap-1">
                                        <Smartphone className="w-2.5 h-2.5" /> {runItem.deviceName}
                                      </span>
                                      <span>•</span>
                                      <span className="font-mono text-slate-400">{runItem.completedAtFormatted}</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <div className="bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-lg font-mono text-[10px] font-extrabold flex items-center gap-1">
                                      <Clock className="w-3 h-3 text-indigo-400" />
                                      <span>{runItem.durationFormatted}</span>
                                    </div>

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
                                        className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors ml-1"
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
          )}

        </div>
      )}

      {/* Tab 2: Feature Health Metrics */}
      {activeTab === 'features' && (
        <div className="space-y-6 animate-liquid-fade">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 liquid-glass-panel rounded-3xl px-5 py-3.5 shadow-2xl">
            <h3 className="text-base font-extrabold text-white flex items-center gap-2 tracking-tight flex-shrink-0">
              <Tag className="w-4 h-4 text-purple-400" />
              Feature Health
            </h3>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Day Selector Dropdown */}
              <div className="flex items-center gap-2 liquid-glass-input px-3.5 h-9 rounded-2xl text-xs shadow-inner">
                <Calendar className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                <span className="text-slate-300 font-semibold text-[11px] whitespace-nowrap">Session Day:</span>
                <select
                  value={selectedDailySessionDate}
                  onChange={e => setSelectedDailySessionDate(e.target.value)}
                  className="bg-transparent text-purple-200 font-extrabold focus:outline-none cursor-pointer text-xs h-full flex items-center"
                >
                  {recordedDailySessions.map(session => (
                    <option key={session.dateStr} value={session.dateStr} className="bg-slate-900 text-slate-200">
                      📅 {session.label} {session.dateStr === todayStr ? '' : `(${session.stepCount} steps)`}
                    </option>
                  ))}
                  <option value="all" className="bg-slate-900 text-purple-300 font-bold">
                    🌐 All Historical Days Combined
                  </option>
                </select>
              </div>

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
                    className={`px-3.5 h-9 rounded-2xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all border ${
                      isTodayActive
                        ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border-rose-400/40 shadow-md cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
                        : 'bg-slate-900/40 text-slate-500 border-slate-800 opacity-40 cursor-not-allowed'
                    }`}
                    title={isTodayActive ? "Reset test step results & bugs for Today" : "Reset is only available when viewing Today's active session."}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 ${isTodayActive ? 'text-rose-400' : 'text-slate-600'}`} />
                    <span className="leading-none">Reset Active Day</span>
                  </button>
                );
              })()}

              {/* Inline Feature Creation Form */}
              <form onSubmit={handleCreateFeatureSubmit} className="flex items-center gap-2">
                <div className="relative flex items-center">
                  <Tag className="w-3.5 h-3.5 text-purple-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="New feature name..."
                    value={newFeatureInput}
                    onChange={e => setNewFeatureInput(e.target.value)}
                    className="liquid-glass-input rounded-2xl pl-8 pr-3 h-9 text-xs text-white placeholder-slate-400 font-medium w-36 sm:w-44 focus:outline-none"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 h-9 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white text-xs font-extrabold rounded-2xl shadow-lg shadow-purple-500/25 border border-white/20 flex items-center justify-center gap-1 transition-all duration-300 hover:scale-[1.02]"
                >
                  <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="leading-none">Add</span>
                </button>
              </form>
            </div>
          </div>

          {/* Feature Quality & Risk Profile Card */}
          {totalFeaturesCount > 0 && (
            <div ref={visualCardRef} data-visual-card="true" className="liquid-glass-panel rounded-3xl p-6 pb-10 shadow-2xl space-y-6 bg-gradient-to-br from-slate-950/90 via-slate-900/70 to-purple-950/40 border-white/15">
              
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-mono">Live Snapshot • {new Date().toLocaleDateString()}</span>
                  </div>
                  <h3 className="text-xl font-extrabold text-white mt-1 flex items-center gap-2 tracking-tight">
                    CUJ Quality Report
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Copy Text Summary Button */}
                  <button
                    type="button"
                    onClick={handleCopyReportToClipboard}
                    className="no-capture px-3.5 h-9 bg-gradient-to-r from-purple-500/20 to-indigo-500/20 hover:from-purple-500/30 hover:to-indigo-500/30 text-purple-200 border border-purple-400/40 rounded-2xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-md hover:scale-[1.02] active:scale-[0.98]"
                    title="Copy formatted text report to clipboard for chat spaces or documents"
                  >
                    {copiedReport ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span className="text-emerald-300 font-bold leading-none">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                        <span className="leading-none">Copy Summary</span>
                      </>
                    )}
                  </button>

                  {/* Export PNG Image Button */}
                  <button
                    type="button"
                    onClick={handleCopyVisualImageToClipboard}
                    className="no-capture px-3.5 h-9 bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/30 hover:to-purple-500/30 text-pink-200 border border-pink-400/40 rounded-2xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-md hover:scale-[1.02] active:scale-[0.98]"
                    title="Export 1400px wide crisp PNG image to file and clipboard"
                  >
                    {copiedImage ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span className="text-emerald-300 font-bold leading-none">PNG Exported!</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
                        <span className="leading-none">Export PNG Image</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-2 bg-slate-950/80 px-3.5 h-9 rounded-2xl border border-white/10 shadow-inner whitespace-nowrap flex-shrink-0">
                    <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap flex-shrink-0">Overall Quality:</span>
                    <span className="text-sm font-black font-mono text-white flex-shrink-0">{avgHealthScore}%</span>
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-extrabold uppercase whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1 leading-none ${
                      criticalFeaturesCount > 0 || avgHealthScore < 80
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-800/80'
                        : warningFeaturesCount > 0 || avgHealthScore < 95
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-800/80'
                        : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80'
                    }`}>
                      {criticalFeaturesCount > 0 || avgHealthScore < 80
                        ? '🔴 High Risk'
                        : warningFeaturesCount > 0 || avgHealthScore < 95
                        ? '🟡 Moderate Risk'
                        : '🟢 System Healthy'}
                    </span>
                  </div>
                </div>
              </div>

              {/* KPI Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400 font-medium">Total Features Tracked</div>
                  <div className="text-2xl font-extrabold text-white mt-1 font-mono">{totalFeaturesCount}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{totalStepsAcrossFeatures} Total Test Steps</div>
                </div>

                <div className="bg-rose-950/40 border border-rose-800/50 rounded-xl p-3.5">
                  <div className="text-[11px] text-rose-400 font-semibold uppercase flex items-center justify-between">
                    <span>Critical (Red)</span>
                    <span className="font-mono text-xs">{criticalPct}%</span>
                  </div>
                  <div className="text-2xl font-extrabold text-rose-300 mt-1 font-mono">{criticalFeaturesCount}</div>
                  <div className="text-[10px] text-rose-400/80 mt-0.5">Requires immediate attention</div>
                </div>

                <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl p-3.5">
                  <div className="text-[11px] text-amber-400 font-semibold uppercase flex items-center justify-between">
                    <span>Degraded (Yellow)</span>
                    <span className="font-mono text-xs">{warningPct}%</span>
                  </div>
                  <div className="text-2xl font-extrabold text-amber-300 mt-1 font-mono">{warningFeaturesCount}</div>
                  <div className="text-[10px] text-amber-400/80 mt-0.5">Minor defects reported</div>
                </div>

                <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl p-3.5">
                  <div className="text-[11px] text-emerald-400 font-semibold uppercase flex items-center justify-between">
                    <span>Healthy (Green)</span>
                    <span className="font-mono text-xs">{healthyPct}%</span>
                  </div>
                  <div className="text-2xl font-extrabold text-emerald-300 mt-1 font-mono">{healthyFeaturesCount}</div>
                  <div className="text-[10px] text-emerald-400/80 mt-0.5">100% Passing test steps</div>
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
                      className="px-3 py-1.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-400/30 text-purple-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-md"
                    >
                      <ChevronDown className={`w-3.5 h-3.5 text-purple-400 transition-transform duration-500 ease-out ${isFeatureReportExpanded ? 'rotate-180' : 'rotate-0'}`} />
                      <span>{isFeatureReportExpanded ? 'Hide Report Breakdown' : 'Expand Report Breakdown'}</span>
                    </button>
                  </div>
                </div>

                <div className="w-full bg-slate-950 h-3.5 rounded-xl overflow-hidden border border-slate-800 flex">
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
                </div>
              </div>

              {/* Fluid Liquid Glass Expandable Feature Breakdown Report Table */}
              <div className={`liquid-accordion-wrapper ${isFeatureReportExpanded ? 'expanded' : ''}`}>
                <div className="liquid-accordion-inner">
                  <div className="pt-4 pb-4 border-t border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 text-purple-400" />
                        Feature Health Breakdown Report ({featureMetricsList.length} Features)
                      </h4>
                      <span className="text-[10px] font-mono text-slate-400">Live Snapshot Table</span>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/90 shadow-inner">
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
                          {featureMetricsList.map(metric => {
                            const issueSummary = getBriefIssueSummarySync(metric.featureName, metric.associatedBugs, metric.yellowCount, metric.redCount);
                            return (
                              <tr key={metric.featureName} className="hover:bg-slate-900/50 transition">
                                <td className="py-2.5 px-4 font-bold text-white whitespace-nowrap">{metric.featureName}</td>
                                <td className="py-2.5 px-4 whitespace-nowrap">
                                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider uppercase border ${
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
                                </td>
                                <td className="py-2.5 px-4 font-bold text-purple-300 font-mono whitespace-nowrap">{metric.healthScorePct}%</td>
                                <td className="py-2.5 px-4 font-mono font-semibold whitespace-nowrap">{metric.totalStepsExecuted}</td>
                                <td className="py-2.5 px-4 text-emerald-400 font-bold font-mono whitespace-nowrap">{metric.greenCount}</td>
                                <td className="py-2.5 px-4 text-amber-400 font-bold font-mono whitespace-nowrap">{metric.yellowCount}</td>
                                <td className="py-2.5 px-4 text-rose-400 font-bold font-mono whitespace-nowrap">{metric.redCount}</td>
                                <td className="py-2.5 px-4 text-rose-400 font-bold font-mono whitespace-nowrap">{metric.bugCount}</td>
                                <td className="py-2.5 px-4 text-xs font-sans text-slate-100 max-w-xs truncate" title={issueSummary || 'No issues encountered'}>
                                  {issueSummary ? (
                                    <span className="text-amber-200 font-semibold">{issueSummary}</span>
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
                </div>
              </div>

            </div>
          )}

          {/* Separate Standalone Card: Historical Quality Evolution Timeline */}
          {historicalTimelinePoints.length > 0 && (
            <div className="liquid-glass-panel rounded-3xl p-6 shadow-2xl space-y-4 border-white/15 bg-gradient-to-br from-slate-950/90 via-slate-900/80 to-indigo-950/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3.5">
                <div>
                  <h4 className="text-base font-extrabold text-white flex items-center gap-2 tracking-tight">
                    <History className="w-4.5 h-4.5 text-purple-400" />
                    Historical Quality Evolution Timeline
                  </h4>
                  <p className="text-xs text-slate-300 font-medium mt-0.5">
                    Click any date bar below to time-travel snapshot and view that day's QA metrics.
                  </p>
                </div>
                <span className="text-[11px] text-purple-300 font-mono bg-purple-500/20 px-3 py-1 rounded-xl border border-purple-500/30 font-bold w-fit">
                  {historicalTimelinePoints.length} Recorded Sessions
                </span>
              </div>

              {/* Sparkline / Bar chart per date */}
              <div className="flex items-end gap-3 overflow-x-auto pb-2 pt-3 px-3 bg-slate-950/60 rounded-2xl border border-white/10 min-h-[120px]">
                {historicalTimelinePoints.map(point => (
                  <div
                    key={point.dateStr}
                    onClick={() => setSelectedDailySessionDate(point.dateStr)}
                    className={`flex-1 min-w-[85px] max-w-[120px] flex flex-col items-center gap-1.5 group cursor-pointer transition-all duration-300 p-2.5 rounded-2xl border ${
                      selectedDailySessionDate === point.dateStr
                        ? 'bg-purple-500/20 border-purple-400 shadow-xl shadow-purple-500/20 font-bold scale-[1.02] ring-2 ring-purple-400/40'
                        : 'liquid-glass-button hover:bg-slate-900/80 border-white/10'
                    }`}
                    title={`Click to inspect ${point.displayDate}: ${point.scorePct}% Score, ${point.totalSteps} Steps, ${point.bugs} Bugs`}
                  >
                    <div className="text-[11px] font-bold font-mono text-purple-300 group-hover:text-white">
                      {point.scorePct}%
                    </div>

                    {/* Vertical Bar Representation */}
                    <div className="w-full bg-slate-950 h-16 rounded-xl overflow-hidden flex flex-col justify-end p-0.5 border border-white/10 shadow-inner">
                      <div
                        style={{ height: `${point.scorePct}%` }}
                        className={`w-full rounded-lg transition-all duration-300 ${
                          point.scorePct >= 95
                            ? 'bg-emerald-400 shadow-md shadow-emerald-500/30'
                            : point.scorePct >= 80
                            ? 'bg-amber-400 shadow-md shadow-amber-500/30'
                            : 'bg-rose-400 shadow-md shadow-rose-500/30'
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

          {featureMetricsList.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-500">
              No features tracked yet. Use the form above to add your first Feature Tag.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {featureMetricsList.map(metric => (
                <div
                  key={metric.featureName}
                  className={`liquid-glass-card rounded-3xl p-4 flex flex-col justify-between space-y-3 relative group ${
                    metric.status === 'critical'
                      ? 'border-rose-500/40 bg-rose-950/20'
                      : metric.status === 'warning'
                      ? 'border-amber-500/40 bg-amber-950/20'
                      : ''
                  }`}
                >
                  {/* Top Header: Full Title & Status Badge */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <span className="p-1.5 bg-purple-500/10 text-purple-400 rounded-lg border border-purple-500/20 shrink-0 mt-0.5">
                        <Tag className="w-3.5 h-3.5" />
                      </span>
                      <h4 className="text-sm font-bold text-white break-words leading-snug">
                        {metric.featureName}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        metric.status === 'healthy'
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                          : metric.status === 'warning'
                          ? 'bg-amber-950 text-amber-400 border-amber-800'
                          : 'bg-rose-950 text-rose-400 border-rose-800'
                      }`}>
                        {metric.status === 'healthy' ? '🟢 Healthy' : metric.status === 'warning' ? '🟡 Degraded' : '🔴 Critical'}
                      </span>

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
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-medium">
                      <span className="text-slate-400">Health Score</span>
                      <span className="text-white font-mono font-bold">{metric.healthScorePct}%</span>
                    </div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          metric.healthScorePct >= 90
                            ? 'bg-emerald-500'
                            : metric.healthScorePct >= 60
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${metric.healthScorePct}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Inline Execution Stats & Bugs pill */}
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80 font-mono">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-emerald-400 font-semibold" title={`${metric.greenCount} Green Steps`}>🟢 {metric.greenCount}</span>
                      <span className="text-amber-400 font-semibold" title={`${metric.yellowCount} Yellow Steps`}>🟡 {metric.yellowCount}</span>
                      <span className="text-rose-400 font-semibold" title={`${metric.redCount} Red Steps`}>🔴 {metric.redCount}</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                      metric.bugCount > 0
                        ? 'bg-rose-950/80 text-rose-300 border-rose-800/60'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}>
                      🐛 {metric.bugCount} bugs
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Bugs Feed */}
      {activeTab === 'bugs' && (
        <div className="space-y-6 animate-liquid-fade">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Bug className="w-5 h-5 text-rose-400" />
                Bugs
              </h3>
              <p className="text-xs text-slate-400">
                Live log feed received from mobile field testers organized by device model and feature.
              </p>
            </div>

            {/* Filter & Sort Controls Bar (Condensed Liquid Glass Menu UI) */}
            <div className="flex items-center gap-3">
              
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

              {/* Copy Filtered Bugs Button (for Messages / Email / Slack / Teams) */}
              <button
                type="button"
                onClick={handleCopyBugsToClipboard}
                className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-2xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg border border-white/20 active:scale-95 cursor-pointer"
                title="Copy filtered bugs list as well-organized text for message or email"
              >
                {copiedBugs ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300 font-extrabold">Bugs Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-purple-200" />
                    <span>Copy Bugs (Message / Email)</span>
                  </>
                )}
              </button>

              {/* Single Condensed Filter & Sort Menu Button & Popover */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsBugFilterMenuOpen(!isBugFilterMenuOpen)}
                  className={`px-3.5 py-1.5 liquid-glass-button rounded-2xl text-xs font-bold flex items-center gap-2 transition-all duration-300 ${
                    (selectedDateFilter !== 'all' || selectedFeatureFilter !== 'all' || selectedDeviceFilter !== 'all' || sortByDevice !== 'newest')
                      ? 'bg-purple-500/30 border-purple-400/50 text-purple-200 shadow-lg shadow-purple-500/20'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5 text-purple-400" />
                  <span>Filter & Sort</span>
                  {((selectedDateFilter !== 'all' ? 1 : 0) + (selectedFeatureFilter !== 'all' ? 1 : 0) + (selectedDeviceFilter !== 'all' ? 1 : 0) + (sortByDevice !== 'newest' ? 1 : 0)) > 0 && (
                    <span className="bg-purple-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold font-mono">
                      {(selectedDateFilter !== 'all' ? 1 : 0) + (selectedFeatureFilter !== 'all' ? 1 : 0) + (selectedDeviceFilter !== 'all' ? 1 : 0) + (sortByDevice !== 'newest' ? 1 : 0)}
                    </span>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isBugFilterMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Popover Menu Dropdown */}
                {isBugFilterMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 liquid-glass-panel rounded-3xl p-4 space-y-4 shadow-2xl z-50 border-white/20">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Filter className="w-3.5 h-3.5 text-purple-400" />
                        Filter & Sort Menu
                      </span>
                      {(selectedDateFilter !== 'all' || selectedFeatureFilter !== 'all' || selectedDeviceFilter !== 'all' || sortByDevice !== 'newest') && (
                        <button
                          onClick={() => {
                            setSelectedDateFilter('all');
                            setSelectedFeatureFilter('all');
                            setSelectedDeviceFilter('all');
                            setSortByDevice('newest');
                            setCustomDateInput('');
                          }}
                          className="text-[10px] text-purple-300 hover:text-white font-bold bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30 transition"
                        >
                          Reset All
                        </button>
                      )}
                    </div>

                    {/* Date Filter */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-indigo-400" /> Date Range
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
                          className="w-full liquid-glass-input rounded-xl px-3 py-1 text-xs text-indigo-200 focus:outline-none mt-1 font-mono"
                        />
                      )}
                    </div>

                    {/* Feature Filter */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <Tag className="w-3 h-3 text-purple-400" /> Feature Tag
                      </label>
                      <select
                        value={selectedFeatureFilter}
                        onChange={e => setSelectedFeatureFilter(e.target.value)}
                        className="w-full liquid-glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="all" className="bg-slate-900">All Features</option>
                        {uniqueFeatures.map(feat => (
                          <option key={feat} value={feat} className="bg-slate-900">
                            🏷️ {feat}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Device Filter */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-purple-400" /> Device Model
                      </label>
                      <select
                        value={selectedDeviceFilter}
                        onChange={e => setSelectedDeviceFilter(e.target.value)}
                        className="w-full liquid-glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="all" className="bg-slate-900">All Devices ({bugLogs.length})</option>
                        {uniqueDevices.map(dev => (
                          <option key={dev} value={dev} className="bg-slate-900">
                            📱 {dev}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Sort Order */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                        <ArrowUpDown className="w-3 h-3 text-indigo-400" /> Sort Order
                      </label>
                      <select
                        value={sortByDevice}
                        onChange={e => setSortByDevice(e.target.value as any)}
                        className="w-full liquid-glass-input rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-medium cursor-pointer"
                      >
                        <option value="newest" className="bg-slate-900">Timestamp (Newest First)</option>
                        <option value="oldest" className="bg-slate-900">Timestamp (Oldest First)</option>
                        <option value="severity" className="bg-slate-900">Severity (Critical First)</option>
                        <option value="device-asc" className="bg-slate-900">Device Name (A → Z)</option>
                        <option value="device-desc" className="bg-slate-900">Device Name (Z → A)</option>
                      </select>
                    </div>

                    <div className="pt-2 border-t border-white/10 space-y-2 text-center">
                      <button
                        type="button"
                        onClick={() => exportBugsToCSV(processedBugs)}
                        className="w-full py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5"
                        title="Download CSV file for Excel / Sheets"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-300" />
                        <span>Export to CSV File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsBugFilterMenuOpen(false)}
                        className="w-full py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl transition"
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
                    className="liquid-glass-panel rounded-3xl border border-white/15 overflow-hidden transition-all duration-300 shadow-xl hover:border-purple-500/40"
                  >
                    {/* Liquid Glass Header Bar (Always Visible) */}
                    <div 
                      onClick={() => toggleBugExpand(bug.id)}
                      className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer bg-slate-900/40 hover:bg-slate-850/60 transition"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <button 
                          type="button"
                          className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-indigo-300 transition"
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isBugExpanded ? 'rotate-180 text-purple-400' : 'text-slate-400'}`} />
                        </button>

                        <div className="flex items-center gap-1.5 font-mono text-xs text-indigo-300 font-bold bg-indigo-950/60 px-3 py-1 rounded-xl border border-indigo-800/40">
                          <Clock className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{formatted12HrTime}</span>
                          <span className="text-[10px] text-slate-400 font-normal ml-0.5">({new Date(bug.timestamp).toLocaleDateString()})</span>
                        </div>

                        <span className="bg-purple-950/80 text-purple-300 font-mono text-xs px-3 py-1 rounded-xl border border-purple-800/40 flex items-center gap-1.5 font-bold">
                          <Tag className="w-3.5 h-3.5 text-purple-400" />
                          {bug.feature || 'General'}
                        </span>

                        <span className="bg-slate-950/80 text-slate-300 font-mono text-xs px-3 py-1 rounded-xl border border-slate-800 flex items-center gap-1.5 font-medium">
                          <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                          {bug.deviceName || 'Unspecified'}
                        </span>

                        <span className="bg-slate-950/80 text-indigo-200 font-mono text-xs px-3 py-1 rounded-xl border border-slate-800 flex items-center gap-1.5 font-medium">
                          <User className="w-3.5 h-3.5 text-indigo-400" />
                          {bug.testerName}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 ml-auto">
                        <div className="text-xs text-slate-300 max-w-xs md:max-w-md truncate font-medium">
                          {bug.note}
                        </div>

                        {bug.imageUrl && (
                          <span className="px-2.5 py-1 bg-purple-500/20 text-purple-200 border border-purple-500/30 rounded-xl text-[11px] font-mono font-bold flex items-center gap-1">
                            <ImageIcon className="w-3 h-3 text-purple-300" /> Photo
                          </span>
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

                    {/* Fluid Liquid Glass Accordion Content */}
                    <div className={`liquid-accordion-wrapper ${isBugExpanded ? 'expanded' : ''}`}>
                      <div className="liquid-accordion-inner">
                        <div className="p-4 pt-0 border-t border-white/10 bg-slate-950/60">
                          <div className="liquid-glass-card rounded-2xl p-5 space-y-4 border-purple-500/30 text-left bg-slate-950/80 shadow-2xl mt-3">
                            
                            <div className="flex items-center justify-between border-b border-white/10 pb-3">
                              <span className="text-xs font-bold text-white flex items-center gap-2 font-mono">
                                <Tag className="w-4 h-4 text-purple-400" />
                                Feature Category: <span className="text-purple-300">{bug.feature || 'General'}</span>
                              </span>
                              <span className="text-xs font-mono text-indigo-300 flex items-center gap-1.5 bg-indigo-950/80 px-3 py-1 rounded-xl border border-indigo-800/40">
                                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                                Logged at {formatted12HrTime} on {new Date(bug.timestamp).toLocaleDateString()}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
                              <div className="md:col-span-2 space-y-3">
                                <div>
                                  <span className="text-[11px] uppercase font-mono text-purple-300 block font-bold mb-1.5 flex items-center gap-1.5">
                                    Observation / Bug Description Log:
                                  </span>
                                  <div className="liquid-glass-input p-4 rounded-2xl text-slate-100 text-xs leading-relaxed whitespace-pre-wrap font-medium shadow-inner">
                                    {bug.note || 'No description attached.'}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                                  <div className="liquid-glass-panel p-3 rounded-2xl border border-white/10">
                                    <span className="text-[10px] uppercase text-slate-400 block font-semibold">Step Target</span>
                                    <span className="text-white font-bold">{bug.stepTitle || 'N/A'}</span>
                                  </div>
                                  <div className="liquid-glass-panel p-3 rounded-2xl border border-white/10">
                                    <span className="text-[10px] uppercase text-slate-400 block font-semibold">Reporter & Device</span>
                                    <span className="text-indigo-300 font-bold">{bug.testerName} ({bug.deviceName})</span>
                                  </div>
                                </div>
                              </div>

                              {/* Evidence Image Preview Box */}
                              <div>
                                <span className="text-[11px] uppercase font-mono text-purple-300 block font-bold mb-1.5">
                                  Evidence Photo:
                                </span>
                                {bug.imageUrl ? (
                                  <div 
                                    onClick={() => setSelectedImagePreviewUrl(bug.imageUrl!)}
                                    className="relative group rounded-2xl overflow-hidden border border-white/20 cursor-pointer bg-slate-900 max-h-56 flex items-center justify-center shadow-2xl"
                                  >
                                    <img src={bug.imageUrl} alt="Bug screenshot" className="w-full object-cover max-h-52 group-hover:scale-105 transition duration-300" />
                                    <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center backdrop-blur-[3px]">
                                      <span className="px-4 py-2 bg-slate-950/90 text-purple-200 border border-purple-400/50 rounded-2xl text-xs font-bold font-mono flex items-center gap-2 shadow-2xl">
                                        <ImageIcon className="w-4 h-4 text-purple-400" /> Click for Full Image
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="h-36 rounded-2xl border border-white/10 bg-slate-900/40 flex items-center justify-center text-xs text-slate-500 font-mono">
                                    No Photo Attached
                                  </div>
                                )}
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
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '1rem',
              padding: '0.75rem 1.25rem',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
              zIndex: 10
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedImagePreviewUrl(null)}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-lg active:scale-95 transition-all"
            >
              <span>← Back to Dashboard</span>
            </button>

            <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-purple-400" /> Bug Screenshot Preview
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
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '1rem',
              padding: '0.75rem 1.25rem',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
              zIndex: 10
            }}
          >
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              Tap anywhere outside image or press Esc to close
            </span>
            <button
              type="button"
              onClick={() => setSelectedImagePreviewUrl(null)}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-extrabold rounded-xl border border-white/15 cursor-pointer transition active:scale-95 ml-auto"
            >
              ← Back
            </button>
          </div>
        </div>,
        document.getElementById('modal-portal') || document.body
      )}

    </div>
  );
};
