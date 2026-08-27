import React, { useState, useRef, useMemo } from 'react';
import { TestPlan, TestRun, BugLog } from '../types';
import { ListChecks, Bug, Clock, Plus, Play, Trash2, Smartphone, CheckCircle2, AlertTriangle, XCircle, Download, User, Filter, ArrowUpDown, Tag, Activity, Copy, FileJson, Upload, Search, Image as ImageIcon, Sparkles, X, Calendar, Edit, BarChart2, Camera, TrendingUp, TrendingDown, History, ChevronDown, ChevronUp, RefreshCw, UserCheck, Timer } from 'lucide-react';
import { exportAllQADataToCSV, exportAllQADataToJSON } from '../utils/exportUtils';
import { toBlob } from 'html-to-image';

interface DashboardProps {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  bugLogs: BugLog[];
  populatedFeatures?: string[];
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
  onResetActiveDay?: (dateStr: string) => void;
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
}

export const Dashboard: React.FC<DashboardProps> = ({
  testPlans,
  testRuns,
  bugLogs,
  populatedFeatures = [],
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
  onResetActiveDay
}) => {
  const defaultTodayStr = new Date().toISOString().split('T')[0];
  const [activeTab, setActiveTab] = useState<'overview' | 'qa-status' | 'features' | 'bugs'>('overview');
  const [activeKpiCard, setActiveKpiCard] = useState<'plans' | 'features' | 'runs' | 'bugs'>('plans');
  const [selectedQaDate, setSelectedQaDate] = useState<string>(defaultTodayStr);
  const [expandedTesters, setExpandedTesters] = useState<Record<string, boolean>>({});

  const toggleTesterExpand = (testerName: string) => {
    setExpandedTesters(prev => ({
      ...prev,
      [testerName]: !prev[testerName]
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
  const [isVisualSnapshotModalOpen, setIsVisualSnapshotModalOpen] = useState<boolean>(false);

  // Helper to determine real, effective run status
  const getEffectiveRunStatus = (run: TestRun) => {
    const plan = testPlans.find(p => p.id === run.planId);
    const totalSteps = plan?.steps.length || 0;
    const completedCount = Object.keys(run.results || {}).length;

    if (run.status === 'completed' || (totalSteps > 0 && completedCount >= totalSteps)) {
      return 'completed';
    }
    if (run.status === 'not_started' || completedCount === 0 || !run.testerName) {
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

  // Image Lightbox Modal State
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState<string | null>(null);

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

  // Unique features populated across test steps, bug logs, and populatedFeatures
  const uniqueFeatures = Array.from(
    new Set(
      populatedFeatures
        .concat(testPlans.flatMap(p => p.steps.map(s => s.feature || 'General')))
        .concat(bugLogs.map(b => b.feature || 'General'))
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
      const featureName = step.feature || 'General';
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

  // Today ISO Date string (YYYY-MM-DD)
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Selected Daily QA Session Date (defaults to Today, or specific saved day YYYY-MM-DD, or 'all')
  const [selectedDailySessionDate, setSelectedDailySessionDate] = useState<string>(todayStr);

  // List of Saved Historical Days with execution counts
  const recordedDailySessions = useMemo(() => {
    const datesMap: Record<string, { dateStr: string; label: string; stepCount: number; bugCount: number }> = {};
    
    // Always include Today
    const todayLabel = `Today (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
    datesMap[todayStr] = { dateStr: todayStr, label: todayLabel, stepCount: 0, bugCount: 0 };

    completedRuns.forEach(run => {
      Object.values(run.results || {}).forEach(res => {
        if (!res.timestamp || res.status === 'pending') return;
        const dStr = res.timestamp.slice(0, 10);
        if (!datesMap[dStr]) {
          const label = new Date(dStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          datesMap[dStr] = { dateStr: dStr, label, stepCount: 0, bugCount: 0 };
        }
        datesMap[dStr].stepCount += 1;
      });
    });

    bugLogs.forEach(b => {
      if (!b.timestamp) return;
      const dStr = b.timestamp.slice(0, 10);
      if (!datesMap[dStr]) {
        const label = new Date(dStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        datesMap[dStr] = { dateStr: dStr, label, stepCount: 0, bugCount: 0 };
      }
      datesMap[dStr].bugCount += 1;
    });

    return Object.values(datesMap).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  }, [completedRuns, bugLogs, todayStr]);

  // Aggregate step results from FULLY COMPLETED runs for the selected Daily Session Date
  completedRuns.forEach(run => {
    const plan = testPlans.find(p => p.id === run.planId);
    if (!plan) return;
    plan.steps.forEach(step => {
      const res = run.results[step.id];
      if (!res || !res.status || res.status === 'pending') return;

      // Filter by selected Daily QA Session Date (unless 'all' is selected)
      if (selectedDailySessionDate !== 'all') {
        const stepDate = res.timestamp ? res.timestamp.slice(0, 10) : '';
        if (stepDate !== selectedDailySessionDate) return;
      }

      const featureName = step.feature || 'General';
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
      const bugDate = bug.timestamp ? bug.timestamp.slice(0, 10) : '';
      if (bugDate !== selectedDailySessionDate) return;
    }

    const featureName = bug.feature || 'General';
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
    featureMetricsMap[featureName].bugCount += 1;
  });

  // Historical Quality Evolution Timeline Points (Only fully finished runs)
  const historicalTimelinePoints = useMemo(() => {
    const pointsMap: Record<string, { dateStr: string; displayDate: string; totalSteps: number; green: number; yellow: number; red: number; bugs: number }> = {};

    completedRuns.forEach(run => {
      Object.values(run.results || {}).forEach(res => {
        if (!res.timestamp || res.status === 'pending') return;
        const dStr = res.timestamp.slice(0, 10);
        if (!pointsMap[dStr]) {
          const displayDate = new Date(dStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
      const dStr = bug.timestamp.slice(0, 10);
      if (!pointsMap[dStr]) {
        const displayDate = new Date(dStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

    if (metric.redCount > 0 || metric.healthScorePct < 80) {
      metric.status = 'critical';
    } else if (metric.yellowCount > 0 || metric.healthScorePct < 95) {
      metric.status = 'warning';
    } else {
      metric.status = 'healthy';
    }

    return metric;
  });

  // Compute QA Status metrics for individual tester profiles & daily tracking
  const testerProfilesMap = useMemo(() => {
    const combinedRuns = [...archivedRuns, ...testRuns];
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
      if (effectiveStatus === 'completed') {
        profile.allTimeCompletedCount++;

        const completedDate = run.completedAt ? new Date(run.completedAt) : new Date();
        const dateStr = completedDate.toISOString().split('T')[0];
        const timeFormatted = completedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const resultsArray = Object.values(run.results || {});
        let durationMs = 0;
        if (resultsArray.length > 0) {
          const timestamps = resultsArray
            .map(r => r.timestamp ? new Date(r.timestamp).getTime() : NaN)
            .filter(t => !isNaN(t));
          if (timestamps.length > 0) {
            const minTime = Math.min(...timestamps);
            const maxTime = Math.max(...timestamps, completedDate.getTime());
            durationMs = Math.max(15000, maxTime - minTime);
          }
        }
        if (!durationMs) durationMs = 300000;

        const mins = Math.floor(durationMs / 60000);
        const secs = Math.floor((durationMs % 60000) / 1000);
        const durationFormatted = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

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

        profile.dailyStats[dateStr].completedCount++;
        profile.dailyStats[dateStr].totalDurationMs += durationMs;
        profile.dailyStats[dateStr].devicesUsedOnDay.add(deviceNameStr);
        profile.dailyStats[dateStr].completedRuns.push({
          runId: run.id,
          planName: run.planName,
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

    // Plain text fallback (for markdown / terminal textboxes)
    let plainText = `📊 QA Quality Report (${new Date().toLocaleDateString()})\n`;
    plainText += `• Overall Score: ${avgHealthScore}% • ${riskStatus}\n`;
    plainText += `• Coverage: ${totalFeaturesCount} features (${totalStepsAcrossFeatures} steps)\n`;
    plainText += `• Status: 🟢 ${healthyFeaturesCount} Healthy | 🟡 ${warningFeaturesCount} Degraded | 🔴 ${criticalFeaturesCount} Critical (${totalBugsAcrossFeatures} Bugs)\n\n`;
    plainText += `Feature Breakdown:\n`;

    featureMetricsList.forEach(m => {
      const statusIcon = m.status === 'healthy' ? '🟢 Healthy' : m.status === 'warning' ? '🟡 Degraded' : '🔴 Critical';
      const bugText = m.bugCount > 0 ? `, ${m.bugCount} bugs` : '';
      const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
      plainText += `• ${m.featureName}: ${m.healthScorePct}% (${stepDetail}${bugText}) • ${statusIcon}\n`;
    });

    // Rich HTML format (for Slack, Teams, Google Docs, Word, Apple Notes, Email)
    let htmlText = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.5;">`;
    htmlText += `<p style="margin: 0 0 6px 0;">📊 <b>QA Quality Report</b> (${new Date().toLocaleDateString()})</p>`;
    htmlText += `<p style="margin: 0 0 4px 0;">• <b>Overall Score</b>: ${avgHealthScore}% • ${riskStatus}</p>`;
    htmlText += `<p style="margin: 0 0 4px 0;">• <b>Coverage</b>: ${totalFeaturesCount} features (${totalStepsAcrossFeatures} steps)</p>`;
    htmlText += `<p style="margin: 0 0 10px 0;">• <b>Status</b>: 🟢 ${healthyFeaturesCount} Healthy | 🟡 ${warningFeaturesCount} Degraded | 🔴 ${criticalFeaturesCount} Critical (${totalBugsAcrossFeatures} Bugs)</p>`;
    htmlText += `<p style="margin: 0 0 6px 0;"><b>Feature Breakdown</b>:</p>`;
    htmlText += `<ul style="margin: 0; padding-left: 18px;">`;

    featureMetricsList.forEach(m => {
      const statusIcon = m.status === 'healthy' ? '🟢 Healthy' : m.status === 'warning' ? '🟡 Degraded' : '🔴 Critical';
      const bugText = m.bugCount > 0 ? `, ${m.bugCount} bugs` : '';
      const stepDetail = m.totalStepsExecuted > 0 ? `${m.greenCount}/${m.totalStepsExecuted} passed` : '0 steps';
      htmlText += `<li style="margin-bottom: 3px;"><b>${m.featureName}</b>: ${m.healthScorePct}% (${stepDetail}${bugText}) • ${statusIcon}</li>`;
    });
    htmlText += `</ul></div>`;

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

      {/* Metrics Banner & View Switcher (Interactive Liquid Glass KPI Header Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        
        {/* Card 1: Test Plans View Switcher */}
        <div
          onClick={() => {
            setActiveKpiCard('plans');
            setActiveTab('overview');
          }}
          className={`liquid-glass-card rounded-3xl p-5 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeKpiCard === 'plans'
              ? 'bg-indigo-500/25 border-indigo-400/80 ring-2 ring-indigo-400/60 shadow-[0_0_30px_rgba(99,102,241,0.3)] scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view Test Plans"
        >
          <div>
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <span>Configured Test Plans</span>
              {activeKpiCard === 'plans' && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>}
            </div>
            <div className="text-2xl font-black text-white mt-1 font-mono tracking-tight">{totalPlans}</div>
          </div>
          <div className={`p-3 rounded-2xl border transition-all ${
            activeKpiCard === 'plans'
              ? 'bg-indigo-500 text-white border-indigo-300 shadow-lg shadow-indigo-500/50'
              : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30 backdrop-blur-md'
          }`}>
            <ListChecks className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Feature Health Metrics View Switcher */}
        <div
          onClick={() => {
            setActiveKpiCard('features');
            setActiveTab('features');
          }}
          className={`liquid-glass-card rounded-3xl p-5 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeKpiCard === 'features'
              ? 'bg-purple-500/25 border-purple-400/80 ring-2 ring-purple-400/60 shadow-[0_0_30px_rgba(168,85,247,0.3)] scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view Feature Health Metrics"
        >
          <div>
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <span>Tracked Features</span>
              {activeKpiCard === 'features' && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>}
            </div>
            <div className="text-2xl font-black text-purple-300 mt-1 font-mono tracking-tight">{featureMetricsList.length} Features</div>
          </div>
          <div className={`p-3 rounded-2xl border transition-all ${
            activeKpiCard === 'features'
              ? 'bg-purple-500 text-white border-purple-300 shadow-lg shadow-purple-500/50'
              : 'bg-purple-500/20 text-purple-300 border-purple-400/30 backdrop-blur-md'
          }`}>
            <Tag className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: QA Status View Switcher */}
        <div
          onClick={() => {
            setActiveKpiCard('runs');
            setActiveTab('qa-status');
          }}
          className={`liquid-glass-card rounded-3xl p-5 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeKpiCard === 'runs'
              ? 'bg-emerald-500/25 border-emerald-400/80 ring-2 ring-emerald-400/60 shadow-[0_0_30px_rgba(16,185,129,0.3)] scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view QA Status & Tester Daily Metrics"
        >
          <div>
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <span>QA Status</span>
              {activeKpiCard === 'runs' && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>}
            </div>
            <div className="text-2xl font-black text-emerald-300 mt-1 font-mono tracking-tight">{testerProfilesMap.length} Testers</div>
          </div>
          <div className={`p-3 rounded-2xl border transition-all ${
            activeKpiCard === 'runs'
              ? 'bg-emerald-500 text-white border-emerald-300 shadow-lg shadow-emerald-500/50'
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30 backdrop-blur-md'
          }`}>
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Total Bugs View Switcher */}
        <div
          onClick={() => {
            setActiveKpiCard('bugs');
            setActiveTab('bugs');
          }}
          className={`liquid-glass-card rounded-3xl p-5 flex items-center justify-between cursor-pointer transition-all duration-300 ${
            activeKpiCard === 'bugs'
              ? 'bg-rose-500/25 border-rose-400/80 ring-2 ring-rose-400/60 shadow-[0_0_30px_rgba(244,63,94,0.3)] scale-[1.02]'
              : 'opacity-75 hover:opacity-100 hover:scale-[1.01] hover:border-white/30'
          }`}
          title="Click to view Bugs Feed"
        >
          <div>
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <span>Total Bugs</span>
              {activeKpiCard === 'bugs' && <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>}
            </div>
            <div className="text-2xl font-black text-rose-300 mt-1 font-mono tracking-tight">{totalBugs}</div>
          </div>
          <div className={`p-3 rounded-2xl border transition-all ${
            activeKpiCard === 'bugs'
              ? 'bg-rose-500 text-white border-rose-300 shadow-lg shadow-rose-500/50'
              : 'bg-rose-500/20 text-rose-300 border-rose-400/30 backdrop-blur-md'
          }`}>
            <Bug className="w-5 h-5" />
          </div>
        </div>

      </div>

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

      {/* Tab: QA Status - Tester Profiles & Daily Time Tracking */}
      {activeTab === 'qa-status' && (
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                          <h4 className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                            <span>{profile.testerName}</span>
                            <span className="text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded-full font-semibold">QA Tester</span>
                          </h4>
                        </div>
                      </div>

                      {/* Middle: Compact Day Stats (Device Name(s), Plans Finished & Avg Time) */}
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <div className="text-right hidden md:block max-w-[140px] truncate">
                          <span className="text-[9px] uppercase text-slate-400 block">Device(s) Tested</span>
                          <span className="font-bold text-purple-300 truncate block" title={devicesStr}>{devicesStr}</span>
                        </div>
                        <div className="text-right hidden sm:block">
                          <span className="text-[9px] uppercase text-slate-400 block">Finished</span>
                          <span className="font-extrabold text-emerald-300">{dayData.completedCount} Plans</span>
                        </div>
                        <div className="text-right hidden sm:block">
                          <span className="text-[9px] uppercase text-slate-400 block">Avg Time</span>
                          <span className="font-extrabold text-indigo-300">{avgFormatted}</span>
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

                        {onDeleteTestRun && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Delete all QA test performance data for tester "${profile.testerName}"?`)) {
                                const runsToDelete = [...testRuns, ...archivedRuns].filter(r => r.testerName === profile.testerName);
                                runsToDelete.forEach(r => onDeleteTestRun(r.id));
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 rounded-xl transition-all active:scale-95"
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
                    Feature Quality & Risk Profile
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
                        <thead className="bg-slate-900/90 border-b border-slate-800 text-[11px] text-slate-400 uppercase font-semibold">
                          <tr>
                            <th className="py-3 px-4">Feature Name</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4">Health Score</th>
                            <th className="py-3 px-4">Execution Total</th>
                            <th className="py-3 px-4">Passed (Green)</th>
                            <th className="py-3 px-4">Warning (Yellow)</th>
                            <th className="py-3 px-4">Failed (Red)</th>
                            <th className="py-3 px-4">Bugs Logged</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-300">
                          {featureMetricsList.map(metric => (
                            <tr key={metric.featureName} className="hover:bg-slate-900/50 transition">
                              <td className="py-2.5 px-4 font-bold text-white">{metric.featureName}</td>
                              <td className="py-2.5 px-4">
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
                              <td className="py-2.5 px-4 font-bold text-purple-300 font-mono">{metric.healthScorePct}%</td>
                              <td className="py-2.5 px-4 font-mono font-semibold">{metric.totalStepsExecuted}</td>
                              <td className="py-2.5 px-4 text-emerald-400 font-bold font-mono">{metric.greenCount}</td>
                              <td className="py-2.5 px-4 text-amber-400 font-bold font-mono">{metric.yellowCount}</td>
                              <td className="py-2.5 px-4 text-rose-400 font-bold font-mono">{metric.redCount}</td>
                              <td className="py-2.5 px-4 text-rose-400 font-bold font-mono">{metric.bugCount}</td>
                            </tr>
                          ))}
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

                    <div className="pt-2 border-t border-white/10 text-center">
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

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            {processedBugs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No matching bugs found for selected search query and filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-mono">
                    <tr>
                      <th className="py-3 px-4">Exact Timestamp</th>
                      <th className="py-3 px-4">Feature</th>
                      <th className="py-3 px-4">Device Model</th>
                      <th className="py-3 px-4">Severity</th>
                      <th className="py-3 px-4">Step Target</th>
                      <th className="py-3 px-4">Reporter</th>
                      <th className="py-3 px-4">Bug Observation Note</th>
                      <th className="py-3 px-4">Evidence Image</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {processedBugs.map(bug => (
                      <tr key={bug.id} className="hover:bg-slate-850 transition group">
                        <td className="py-3.5 px-4 font-mono text-indigo-300 font-semibold flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-400" />
                          {bug.formattedTime}
                          <span className="text-[10px] text-slate-500 font-normal">({new Date(bug.timestamp).toLocaleDateString()})</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="bg-purple-950 text-purple-300 font-mono text-[11px] px-2 py-0.5 rounded border border-purple-800/40 flex items-center gap-1 w-fit">
                            <Tag className="w-3 h-3 text-purple-400" />
                            {bug.feature || 'General'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="bg-slate-950 text-slate-300 font-mono text-[11px] px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1 w-fit">
                            <Smartphone className="w-3 h-3 text-indigo-400" />
                            {bug.deviceName || 'Unspecified'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                            bug.severity === 'critical' || bug.severity === 'high'
                              ? 'bg-rose-950 text-rose-400 border border-rose-800'
                              : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                          }`}>
                            {bug.severity}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-white">
                          {bug.stepTitle}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {bug.testerName}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300 max-w-xs truncate">
                          {bug.note}
                        </td>
                        <td className="py-3.5 px-4">
                          {bug.imageUrl ? (
                            <button
                              onClick={() => setSelectedImagePreviewUrl(bug.imageUrl!)}
                              className="group relative flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-lg hover:border-purple-500 transition"
                              title="Click to expand image"
                            >
                              <img src={bug.imageUrl} alt="Bug screenshot" className="w-7 h-7 object-cover rounded" />
                              <span className="text-[10px] text-purple-300 font-mono pr-1 flex items-center gap-0.5">
                                <ImageIcon className="w-3 h-3 text-purple-400" /> View
                              </span>
                            </button>
                          ) : (
                            <span className="text-slate-600 font-mono text-[10px]">None</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => onDeleteBug(bug.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                            title="Delete Bug Log"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Lightbox Preview Modal */}
      {selectedImagePreviewUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative max-w-3xl w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-2 space-y-3">
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-purple-400" /> Screenshot Evidence
              </span>
              <button
                onClick={() => setSelectedImagePreviewUrl(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[80vh] overflow-auto flex justify-center bg-slate-950 rounded-xl p-2 border border-slate-850">
              <img src={selectedImagePreviewUrl} alt="Evidence" className="max-w-full max-h-[70vh] object-contain rounded-lg" />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
