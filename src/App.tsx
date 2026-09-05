import React, { useState, useEffect, useRef } from 'react';
import { Dashboard } from './components/Dashboard';
import { PlanBuilder } from './components/PlanBuilder';
import { MobileTester } from './components/MobileTester';
import { SAMPLE_PLANS, SAMPLE_RUNS, SAMPLE_BUG_LOGS } from './data/mockData';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from './types';
import {
  fetchAllSupabaseData,
  syncTestPlanToSupabase,
  deleteTestPlanFromSupabase,
  syncTestRunToSupabase,
  syncArchivedRunToSupabase,
  deleteTestRunFromSupabase,
  deleteArchivedRunFromSupabase,
  syncBugLogToSupabase,
  deleteBugLogFromSupabase,
  wipeAllBugsFromSupabase,
  syncPopulatedFeatureToSupabase,
  deletePopulatedFeatureFromSupabase,
  syncDeviceToSupabase,
  deleteDeviceFromSupabase,
  syncTesterToSupabase,
  deleteTesterFromSupabase,
  syncDevicesListToCloud,
  syncTestersListToCloud,
  subscribeToSupabaseRealtime,
  subscribeToSystemCommands,
  broadcastBootSignal,
  BootSignal,
} from './services/supabaseService';
import { isSupabaseConfigured } from './lib/supabase';
import { getLocalDateStr } from './utils/dateUtils';
import {
  drainOfflineQueue,
  safeSyncTestRun,
  safeSyncArchivedRun,
  safeSyncBugLog,
  safeDeleteTestRun,
  safeSyncDevices
} from './services/offlineSyncQueue';
import { APP_VERSION_CODE, CONFIG_MIN_APP_VERSION, CONFIG_DAILY_RESET_DATE } from './constants';

export function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'mobile' | 'plan-builder'>(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      if (
        searchParams.get('mode') === 'mobile' ||
        window.location.pathname.includes('/mobile') ||
        (window as any).Capacitor?.isNativePlatform?.() ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      ) {
        return 'mobile';
      }
    } catch (e) {}
    return 'dashboard';
  });
  const [selectedPlanId, setSelectedPlanId] = useState<string>(() => {
    try {
      return localStorage.getItem('qa_selected_plan_id') || '';
    } catch (e) {
      return '';
    }
  });

  // App State with LocalStorage persistence (starts empty by default)
  const [testPlans, setTestPlans] = useState<TestPlan[]>(() => {
    try {
      const saved = localStorage.getItem('qa_test_plans');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  const [testRuns, setTestRuns] = useState<TestRun[]>(() => {
    try {
      const saved = localStorage.getItem('qa_test_runs');
      if (saved) {
        const parsed: TestRun[] = JSON.parse(saved);
        const todayStr = getLocalDateStr();
        return parsed.filter(r => {
          if (r.status === 'in_progress') {
            const runDate = r.startedAt ? getLocalDateStr(r.startedAt) : '';
            return runDate === todayStr;
          }
          return true;
        });
      }
    } catch (e) {}
    return [];
  });

  const [archivedRuns, setArchivedRuns] = useState<TestRun[]>(() => {
    try {
      const saved = localStorage.getItem('qa_archived_runs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((r: TestRun) => {
            const stepEntries = Object.entries(r.results || {}).filter(
              ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any)
            );
            return stepEntries.length > 0 || (r.bugLogs && r.bugLogs.length > 0);
          });
        }
      }
    } catch (e) {}
    return [];
  });

  const [bugLogs, setBugLogs] = useState<BugLog[]>(() => {
    try {
      const saved = localStorage.getItem('qa_bug_logs');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  // User-populated device profiles list (with readiness & plan quotas)
  const [devices, setDevices] = useState<DeviceProfile[]>(() => {
    try {
      const saved = localStorage.getItem('qa_devices_list');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  // User-populated QA tester profiles list
  const [testers, setTesters] = useState<TesterProfile[]>(() => {
    try {
      const saved = localStorage.getItem('qa_testers_list');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  // User-populated devices list
  const [populatedDevices, setPopulatedDevices] = useState<string[]>(() => {
    const saved = localStorage.getItem('qa_populated_devices');
    if (saved) return JSON.parse(saved);
    const existing = Array.from(new Set(testRuns.map((r: TestRun) => r.deviceName).filter(Boolean))) as string[];
    return existing;
  });

  // User-populated feature identifiers list
  const [populatedFeatures, setPopulatedFeatures] = useState<string[]>(() => {
    const saved = localStorage.getItem('qa_populated_features');
    let list: string[] = [];
    if (saved) {
      list = JSON.parse(saved);
    } else {
      const existingFromPlans = testPlans.flatMap(p => p.steps.map(s => s.feature || '')).filter(Boolean);
      const existingFromBugs = bugLogs.map(b => b.feature || '').filter(Boolean);
      list = Array.from(new Set([...existingFromPlans, ...existingFromBugs]));
    }
    return list.filter(f => f && f.trim() !== '' && f.toLowerCase() !== 'general');
  });

  const testPlansRef = useRef(testPlans);
  useEffect(() => { testPlansRef.current = testPlans; }, [testPlans]);

  const testRunsRef = useRef(testRuns);
  useEffect(() => { testRunsRef.current = testRuns; }, [testRuns]);

  const archivedRunsRef = useRef(archivedRuns);
  useEffect(() => { archivedRunsRef.current = archivedRuns; }, [archivedRuns]);

  const bugLogsRef = useRef(bugLogs);
  useEffect(() => { bugLogsRef.current = bugLogs; }, [bugLogs]);

  const populatedFeaturesRef = useRef(populatedFeatures);
  useEffect(() => { populatedFeaturesRef.current = populatedFeatures; }, [populatedFeatures]);

  const [lastBootSignal, setLastBootSignal] = useState<BootSignal | null>(null);

  const devicesRef = useRef(devices);
  useEffect(() => { devicesRef.current = devices; }, [devices]);

  const lastDeviceEditTimeRef = useRef<number>(0);

  const testersRef = useRef(testers);
  useEffect(() => { testersRef.current = testers; }, [testers]);

  // Daily Quota Reset check (auto resets devices to no plan assigned on date rollover)
  const checkDailyQuotaReset = (devList: DeviceProfile[]) => {
    const todayStr = getLocalDateStr();
    const lastReset = localStorage.getItem('qa_last_quota_reset_date');
    if (lastReset && lastReset !== todayStr) {
      const resetList = devList.map(d => ({
        ...d,
        quotas: [],
        isReady: true,
        activeRunId: undefined,
        activeTesterName: undefined
      }));
      localStorage.setItem('qa_last_quota_reset_date', todayStr);
      localStorage.setItem('qa_devices_list', JSON.stringify(resetList));
      safeSyncDevices(resetList);
      syncPopulatedFeatureToSupabase(`${CONFIG_DAILY_RESET_DATE}:${todayStr}`);
      return resetList;
    }
    if (!lastReset) {
      localStorage.setItem('qa_last_quota_reset_date', todayStr);
    }
    return devList;
  };

  // Supabase Initial Fetch & Real-Time Sync Subscription
  const loadCloudData = async () => {
    if (!isSupabaseConfigured) return;
    await drainOfflineQueue();
    const cloudData = await fetchAllSupabaseData();
    if (cloudData) {
      if (cloudData.testPlans && JSON.stringify(cloudData.testPlans) !== JSON.stringify(testPlansRef.current)) {
        setTestPlans(cloudData.testPlans);
      }
      // Filter out empty ghost runs (0 recorded steps and 0 bugs)
      const validTestRuns = (cloudData.testRuns || []).filter(r => {
        const stepEntries = Object.entries(r.results || {}).filter(
          ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any)
        );
        return r.testerName || r.status !== 'not_started' || stepEntries.length > 0 || (r.bugLogs && r.bugLogs.length > 0);
      });
      if (cloudData.testRuns && JSON.stringify(validTestRuns) !== JSON.stringify(testRunsRef.current)) {
        setTestRuns(validTestRuns);
      }

      const validArchivedRuns = (cloudData.archivedRuns || []).filter(r => {
        const stepEntries = Object.entries(r.results || {}).filter(
          ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any)
        );
        const hasBugs = r.bugLogs && r.bugLogs.length > 0;
        return stepEntries.length > 0 || hasBugs;
      });
      if (cloudData.archivedRuns && JSON.stringify(validArchivedRuns) !== JSON.stringify(archivedRunsRef.current)) {
        setArchivedRuns(validArchivedRuns);
      }
      if (cloudData.bugLogs && JSON.stringify(cloudData.bugLogs) !== JSON.stringify(bugLogsRef.current)) {
        setBugLogs(cloudData.bugLogs);
      }
      if (cloudData.populatedFeatures && cloudData.populatedFeatures.length > 0) {
        if (JSON.stringify(cloudData.populatedFeatures) !== JSON.stringify(populatedFeaturesRef.current)) {
          setPopulatedFeatures(cloudData.populatedFeatures);
        }
      }
      if (cloudData.devices && (cloudData.devices.length > 0 || devicesRef.current.length === 0)) {
        // If user recently made local device edits, merge optimistic local state to avoid in-flight stale cloud responses reverting user clicks
        const isRecentUserEdit = Date.now() - lastDeviceEditTimeRef.current < 4000;
        const baseDevices = isRecentUserEdit
          ? cloudData.devices.map(cd => {
              const localDev = devicesRef.current.find(ld => ld.id === cd.id);
              if (!localDev) return cd;
              return {
                ...cd,
                isReady: localDev.isReady,
                quotas: localDev.quotas,
              };
            })
          : cloudData.devices;

        const currentDevices = checkDailyQuotaReset(baseDevices);

        const inProgressRuns = validTestRuns.filter(r => r.status === 'in_progress');
        const allCompletedRuns = [
          ...validArchivedRuns,
          ...validTestRuns.filter(r => {
            if (r.status !== 'completed') return false;
            const stepEntries = Object.entries(r.results || {}).filter(
              ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any)
            );
            return stepEntries.length > 0;
          })
        ];
        const todayStr = getLocalDateStr();

        // Calculate today's completed runs per device and plan for quota automation (strictly requiring recorded step data)
        const runsTodayPerDevice: Record<string, Record<string, number>> = {};
        allCompletedRuns.forEach(r => {
          if (!r.completedAt) return;
          const stepEntries = Object.entries(r.results || {}).filter(
            ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any)
          );
          if (stepEntries.length === 0) return;
          const rDate = getLocalDateStr(r.completedAt);
          if (rDate !== todayStr) return;
          const targetDev = currentDevices.find(d =>
            (r.deviceId && (d.id === r.deviceId || d.id.toLowerCase() === r.deviceId.toLowerCase())) ||
            (r.deviceName && d.name && d.name.toLowerCase().trim() === r.deviceName.toLowerCase().trim())
          );
          if (targetDev) {
            if (!runsTodayPerDevice[targetDev.id]) runsTodayPerDevice[targetDev.id] = {};
            runsTodayPerDevice[targetDev.id][r.planId] = (runsTodayPerDevice[targetDev.id][r.planId] || 0) + 1;
          }
        });

        let needsSync = false;
        const syncedDevices = currentDevices.map(d => {
          const dev = { ...d };

          // 1. Align active run lock
          const matchingRun = inProgressRuns.find(r =>
            (d.activeRunId && r.id === d.activeRunId) ||
            (r.deviceId === d.id) ||
            (r.deviceName && r.deviceName.toLowerCase().trim() === d.name.toLowerCase().trim())
          );

          if (matchingRun) {
            if (d.activeRunId !== matchingRun.id || d.activeTesterName !== matchingRun.testerName) {
              needsSync = true;
              dev.activeRunId = matchingRun.id;
              dev.activeTesterName = matchingRun.testerName;
            }
          } else if (d.activeRunId) {
            // Check if the run has explicitly completed or was booted/terminated
            const runCompletedOrTerminated = allCompletedRuns.some(r => r.id === d.activeRunId) ||
              (cloudData.testRuns || []).some(r => r.id === d.activeRunId && ((r as any).status === 'terminated' || r.status === 'completed'));
            if (runCompletedOrTerminated) {
              needsSync = true;
              dev.activeRunId = undefined;
              dev.activeTesterName = undefined;
            }
            // If the tester is simply swiped out/backgrounded, DO NOT WIPE!
          }

          return dev;
        });

        if (JSON.stringify(syncedDevices) !== JSON.stringify(devicesRef.current)) {
          setDevices(syncedDevices);
        }
        if (needsSync) {
          localStorage.setItem('qa_devices_list', JSON.stringify(syncedDevices));
          safeSyncDevices(syncedDevices);
        }
      }
      if (cloudData.testers && JSON.stringify(cloudData.testers) !== JSON.stringify(testersRef.current)) {
        setTesters(cloudData.testers);
      }
    }
  };

  useEffect(() => {
    loadCloudData();
    let debounceTimer: any = null;
    const unsubscribe = subscribeToSupabaseRealtime(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadCloudData();
      }, 250);
    });

    // Handle Mobile Screen Unlock / App Resume via Capacitor native plugin
    let capSub: any = null;
    import('@capacitor/app')
      .then(({ App: CapApp }) => {
        CapApp.addListener('appStateChange', (state) => {
          if (state.isActive) {
            loadCloudData();
          }
        }).then(sub => { capSub = sub; });
      })
      .catch(() => {});

    // Web visibility and window focus triggers
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadCloudData();
      }
    };
    const handleWindowFocus = () => loadCloudData();
    const handleOnline = () => loadCloudData();

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);

    const unsubCmds = subscribeToSystemCommands((signal) => {
      setLastBootSignal(signal);
    });

    // Polling fallback ensures continuous background sync without thrashing UI state
    const pollTimer = setInterval(() => {
      loadCloudData();
    }, 4000);

    return () => {
      unsubscribe();
      unsubCmds();
      clearInterval(pollTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (capSub && typeof capSub.remove === 'function') capSub.remove();
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // Ensure selectedPlanId defaults to first plan if unavailable or invalid
  useEffect(() => {
    if (testPlans.length > 0) {
      const isValid = testPlans.some(p => p.id === selectedPlanId);
      if (!selectedPlanId || !isValid) {
        setSelectedPlanId(testPlans[0].id);
        try {
          localStorage.setItem('qa_selected_plan_id', testPlans[0].id);
        } catch (e) {}
      } else {
        try {
          localStorage.setItem('qa_selected_plan_id', selectedPlanId);
        } catch (e) {}
      }
    }
  }, [testPlans, selectedPlanId]);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('qa_test_plans', JSON.stringify(testPlans));
  }, [testPlans]);

  useEffect(() => {
    localStorage.setItem('qa_test_runs', JSON.stringify(testRuns));
  }, [testRuns]);

  useEffect(() => {
    localStorage.setItem('qa_archived_runs', JSON.stringify(archivedRuns));
  }, [archivedRuns]);

  useEffect(() => {
    try {
      localStorage.setItem('qa_bug_logs', JSON.stringify(bugLogs));
    } catch (err) {
      console.warn('localStorage quota exceeded for qa_bug_logs, stripping older screenshot payloads:', err);
      try {
        // Keep images for the 5 most recent bugs, strip data URLs from older ones
        const trimmedBugs = bugLogs.map((b, idx) => {
          if (idx >= 5 && b.imageUrl && b.imageUrl.startsWith('data:')) {
            return { ...b, imageUrl: undefined };
          }
          return b;
        });
        localStorage.setItem('qa_bug_logs', JSON.stringify(trimmedBugs));
      } catch (innerErr) {
        console.error('Critical quota error saving bug logs:', innerErr);
      }
    }
  }, [bugLogs]);

  useEffect(() => {
    localStorage.setItem('qa_populated_devices', JSON.stringify(populatedDevices));
  }, [populatedDevices]);



  useEffect(() => {
    localStorage.setItem('qa_populated_features', JSON.stringify(populatedFeatures));
  }, [populatedFeatures]);

  useEffect(() => {
    localStorage.setItem('qa_devices_list', JSON.stringify(devices));
  }, [devices]);

  useEffect(() => {
    localStorage.setItem('qa_testers_list', JSON.stringify(testers));
  }, [testers]);

  // Add device name to populated list if not present
  const handleAddPopulatedDevice = (deviceName: string) => {
    const trimmed = deviceName.trim();
    if (!trimmed) return;
    setPopulatedDevices(prev => {
      if (prev.some(d => d.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, trimmed];
    });
  };

  // Add feature name to populated list if not present
  const handleAddPopulatedFeature = (featureName: string) => {
    const trimmed = featureName.trim();
    if (!trimmed) return;
    setPopulatedFeatures(prev => {
      if (prev.some(f => f.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, trimmed];
    });
    syncPopulatedFeatureToSupabase(trimmed);
  };

  const [editingPlan, setEditingPlan] = useState<TestPlan | null>(null);

  // Handlers
  const handleCreatePlanClick = () => {
    setEditingPlan(null);
    setCurrentView('plan-builder');
  };

  const handleEditPlan = (plan: TestPlan) => {
    setEditingPlan(plan);
    setCurrentView('plan-builder');
  };

  const handleSavePlan = (savedPlan: TestPlan) => {
    const existingIndex = testPlans.findIndex(p => p.id === savedPlan.id);

    if (existingIndex >= 0) {
      setTestPlans(prev => prev.map(p => p.id === savedPlan.id ? savedPlan : p));
      setTestRuns(prev => prev.map(r => r.planId === savedPlan.id ? { ...r, planName: savedPlan.name } : r));
    } else {
      setTestPlans(prev => [savedPlan, ...prev]);

      const newRun: TestRun = {
        id: 'run-' + savedPlan.id,
        planId: savedPlan.id,
        planName: savedPlan.name,
        testerName: '',
        deviceName: '',
        status: 'not_started',
        currentStepIndex: 0,
        results: {},
        bugLogs: [],
        startedAt: new Date().toISOString()
      };
      setTestRuns(prev => [newRun, ...prev]);
      syncTestRunToSupabase(newRun);
    }

    setSelectedPlanId(savedPlan.id);
    syncTestPlanToSupabase(savedPlan);

    savedPlan.steps.forEach(step => {
      if (step.feature) {
        handleAddPopulatedFeature(step.feature);
      }
    });

    setEditingPlan(null);
    setCurrentView('dashboard');
  };

  const handleClonePlan = (planId: string) => {
    const target = testPlans.find(p => p.id === planId);
    if (!target) return;

    const clonedId = 'plan-' + Date.now();
    const clonedPlan: TestPlan = {
      ...target,
      id: clonedId,
      name: `${target.name} (Copy)`,
      createdAt: new Date().toISOString(),
      steps: target.steps.map((s, idx) => ({
        ...s,
        id: `step-${Date.now()}-${idx + 1}`
      }))
    };

    setTestPlans(prev => [clonedPlan, ...prev]);
    setSelectedPlanId(clonedId);
    syncTestPlanToSupabase(clonedPlan);

    const newRun: TestRun = {
      id: 'run-' + clonedId,
      planId: clonedId,
      planName: clonedPlan.name,
      testerName: '',
      deviceName: '',
      status: 'not_started',
      currentStepIndex: 0,
      results: {},
      bugLogs: [],
      startedAt: new Date().toISOString()
    };
    setTestRuns(prev => [newRun, ...prev]);
    syncTestRunToSupabase(newRun);
  };

  const handleLoadSampleData = () => {
    setTestPlans(SAMPLE_PLANS);
    setTestRuns(SAMPLE_RUNS);
    setArchivedRuns([]);
    setBugLogs(SAMPLE_BUG_LOGS);
    if (SAMPLE_PLANS.length > 0) {
      setSelectedPlanId(SAMPLE_PLANS[0].id);
    }
  };

  const handleRunSubagentAutomatedTest = (planId?: string) => {
    let targetPlan = (planId ? testPlans.find(p => p.id === planId) : null) || testPlans[0];
    
    // If no plans exist yet, initialize sample plans first
    if (!targetPlan) {
      targetPlan = SAMPLE_PLANS[0];
      setTestPlans(SAMPLE_PLANS);
      setSelectedPlanId(targetPlan.id);
      SAMPLE_PLANS.forEach(syncTestPlanToSupabase);
    }

    const now = new Date();
    const isoTimestamp = now.toISOString();
    const runId = `run-${targetPlan.id}-subagent-${Date.now().toString(36)}`;
    const testerName = 'Automated QA Subagent';
    const deviceName = 'Simulated Automated Runner';

    handleAddPopulatedDevice(deviceName);
    handleSaveTester({
      id: 'tester-subagent-bot',
      name: testerName,
      role: 'Autonomous QA Agent'
    });

    const results: Record<string, any> = {};
    const createdBugs: BugLog[] = [];

    // Execute every step from Step 1 through to the Final Step!
    targetPlan.steps.forEach((step, idx) => {
      const status: 'green' | 'yellow' = (idx === 1 && targetPlan.steps.length > 2) ? 'yellow' : 'green';
      results[step.id] = {
        stepId: step.id,
        status,
        feature: step.feature || 'General',
        timestamp: isoTimestamp
      };

      if (step.feature) {
        handleAddPopulatedFeature(step.feature);
      }

      if (status === 'yellow') {
        const bug: BugLog = {
          id: `bug-subagent-${Date.now()}-${idx}`,
          testRunId: runId,
          planId: targetPlan.id,
          stepId: step.id,
          stepTitle: step.title,
          feature: step.feature || 'General',
          testerName,
          deviceName,
          severity: 'medium',
          note: `Subagent automated verification: detected 3.1s response latency on SSO callback.`,
          timestamp: isoTimestamp,
          formattedTime: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
        createdBugs.push(bug);
        setBugLogs(prev => [bug, ...prev]);
        syncBugLogToSupabase(bug);
      }
    });

    const completedRun: TestRun = {
      id: runId,
      planId: targetPlan.id,
      planName: targetPlan.name,
      testerName,
      deviceName,
      status: 'completed',
      currentStepIndex: targetPlan.steps.length,
      results,
      bugLogs: createdBugs,
      startedAt: new Date(now.getTime() - targetPlan.steps.length * 20000).toISOString(),
      completedAt: isoTimestamp,
      durationMs: targetPlan.steps.length * 20000
    };

    setArchivedRuns(prev => [completedRun, ...prev]);
    syncArchivedRunToSupabase(completedRun);
  };

  const handleClearAllData = () => {
    setTestPlans([]);
    setTestRuns([]);
    setArchivedRuns([]);
    setBugLogs([]);
    setSelectedPlanId('');
    localStorage.removeItem('qa_test_plans');
    localStorage.removeItem('qa_test_runs');
    localStorage.removeItem('qa_archived_runs');
    localStorage.removeItem('qa_bug_logs');
  };

  const handleImportJSONData = (data: { testPlans?: TestPlan[]; testRuns?: TestRun[]; bugLogs?: BugLog[]; archivedRuns?: TestRun[] }) => {
    if (data.testPlans && Array.isArray(data.testPlans)) {
      setTestPlans(data.testPlans);
      data.testPlans.forEach(syncTestPlanToSupabase);
      if (data.testPlans.length > 0) setSelectedPlanId(data.testPlans[0].id);
    }
    if (data.testRuns && Array.isArray(data.testRuns)) {
      setTestRuns(data.testRuns);
      data.testRuns.forEach(syncTestRunToSupabase);
    }
    if (data.archivedRuns && Array.isArray(data.archivedRuns)) {
      setArchivedRuns(data.archivedRuns);
      data.archivedRuns.forEach(syncArchivedRunToSupabase);
    }
    if (data.bugLogs && Array.isArray(data.bugLogs)) {
      setBugLogs(data.bugLogs);
      data.bugLogs.forEach(syncBugLogToSupabase);
    }
  };

  const handleDeletePlan = (planId: string) => {
    const filtered = testPlans.filter(p => p.id !== planId);
    setTestPlans(filtered);
    setTestRuns(prev => prev.filter(r => r.planId !== planId));
    deleteTestPlanFromSupabase(planId);
    
    if (currentView === 'mobile' && (selectedPlanId === planId || filtered.length === 0)) {
      setCurrentView('dashboard');
    }

    if (selectedPlanId === planId) {
      setSelectedPlanId(filtered[0]?.id || '');
    }
  };

  const handleDeleteTestRun = (runId: string) => {
    setTestRuns(prev => prev.filter(r => r.id !== runId));
    setArchivedRuns(prev => prev.filter(r => r.id !== runId));

    deleteTestRunFromSupabase(runId);
    deleteArchivedRunFromSupabase(runId);

    // Release device if locked by this deleted run
    const deletedRun = [...testRuns, ...archivedRuns].find(r => r.id === runId);
    setDevices(prev => {
      let changed = false;
      const next = prev.map(d => {
        const matchesRunId = d.activeRunId === runId;
        const matchesTesterAndDev = deletedRun && (
          (deletedRun.testerName && d.activeTesterName && d.activeTesterName.toLowerCase().trim() === deletedRun.testerName.toLowerCase().trim()) &&
          (deletedRun.deviceName && d.name && d.name.toLowerCase().trim() === deletedRun.deviceName.toLowerCase().trim())
        );
        if (matchesRunId || matchesTesterAndDev) {
          changed = true;
          const released = { ...d, activeRunId: undefined, activeTesterName: undefined };
          syncDeviceToSupabase(released);
          return released;
        }
        return d;
      });
      if (changed) {
        localStorage.setItem('qa_devices_list', JSON.stringify(next));
        syncDevicesListToCloud(next);
      }
      return next;
    });
  };

  // Minimum required app version configured by admin
  const minAppVersion = React.useMemo(() => {
    const configItem = populatedFeatures.find(f => f.startsWith(CONFIG_MIN_APP_VERSION + ':'));
    if (configItem) {
      const val = parseInt(configItem.split(':')[1], 10);
      if (!isNaN(val)) return val;
    }
    return APP_VERSION_CODE;
  }, [populatedFeatures]);

  const handleUpdateMinAppVersion = (versionCode: number) => {
    const configKey = `${CONFIG_MIN_APP_VERSION}:${versionCode}`;
    setPopulatedFeatures(prev => {
      const filtered = prev.filter(f => !f.startsWith(CONFIG_MIN_APP_VERSION + ':'));
      const next = [...filtered, configKey];
      localStorage.setItem('qa_populated_features', JSON.stringify(next));
      return next;
    });
    syncPopulatedFeatureToSupabase(configKey);
  };

  // Daily Quota Reset: Clear all assigned test plans on devices to fresh slate
  const handleResetDailyQuotas = () => {
    const todayStr = getLocalDateStr();
    setDevices(prev => {
      const next = prev.map(d => ({
        ...d,
        quotas: [],
        isReady: true,
        activeRunId: undefined,
        activeTesterName: undefined
      }));
      localStorage.setItem('qa_devices_list', JSON.stringify(next));
      localStorage.setItem('qa_last_quota_reset_date', todayStr);
      syncDevicesListToCloud(next);
      return next;
    });
    const configKey = `${CONFIG_DAILY_RESET_DATE}:${todayStr}`;
    syncPopulatedFeatureToSupabase(configKey);
  };

  // Remote Boot Tester: kicks active user on phone, wipes ONLY active in-progress cache, frees device to Maintenance
  const handleBootTester = (runId: string, deviceId?: string, testerName?: string, deviceName?: string) => {
    const trimmedTester = (testerName || '').trim();
    const trimmedDevName = (deviceName || '').trim();
    const trimmedDevId = (deviceId || '').trim();

    // 1. Broadcast instant real-time boot signal over WebSocket to all phones
    const bootSignal: BootSignal = {
      runId: runId || undefined,
      deviceId: trimmedDevId || undefined,
      deviceName: trimmedDevName || undefined,
      testerName: trimmedTester || undefined,
      timestamp: Date.now()
    };
    broadcastBootSignal(bootSignal);
    setLastBootSignal(bootSignal);

    // 2. Redundant persistent boot trigger in Supabase populated_features (auto-pruned after 10s)
    const bootFeatureKey = `__BOOT__:${trimmedTester.toLowerCase()}:${trimmedDevId.toLowerCase()}:${runId || ''}:${trimmedDevName.toLowerCase()}:${Date.now()}`;
    syncPopulatedFeatureToSupabase(bootFeatureKey);
    setPopulatedFeatures(prev => [...prev.filter(f => !f.startsWith('__BOOT__')), bootFeatureKey]);
    setTimeout(async () => {
      try {
        await deletePopulatedFeatureFromSupabase(bootFeatureKey);
        setPopulatedFeatures(prev => prev.filter(f => f !== bootFeatureKey));
      } catch (e) {}
    }, 10000);

    // 3. Mark all matching runs as 'terminated' in state & Supabase (DO NOT DELETE THEM so phone detector stays triggered)
    setTestRuns(prev => {
      let matchedAny = false;
      const next = prev.map(r => {
        const matchesRun = runId && r.id === runId;
        const matchesTester = trimmedTester && r.testerName && r.testerName.toLowerCase().trim() === trimmedTester.toLowerCase();
        const matchesDev = trimmedDevName && r.deviceName && r.deviceName.toLowerCase().trim() === trimmedDevName.toLowerCase();
        const matchesId = trimmedDevId && (r.deviceId === trimmedDevId || (r.deviceId && trimmedDevId.includes(r.deviceId)) || (r.deviceId && r.deviceId.includes(trimmedDevId)));
        if (matchesRun || matchesTester || matchesDev || matchesId) {
          matchedAny = true;
          const terminatedRun = { ...r, status: 'terminated' as any };
          safeSyncTestRun(terminatedRun);
          return terminatedRun;
        }
        return r;
      });

      // If run was not in local state, still upsert a terminated run entry to Supabase
      if (!matchedAny && (runId || trimmedTester)) {
        const syntheticTerminated: TestRun = {
          id: runId || `run-terminated-${Date.now()}`,
          planId: '',
          planName: '',
          testerName: trimmedTester,
          deviceName: trimmedDevName,
          deviceId: trimmedDevId,
          status: 'terminated' as any,
          currentStepIndex: 0,
          results: {},
          bugLogs: [],
          startedAt: new Date().toISOString()
        };
        safeSyncTestRun(syntheticTerminated);
      }

      return next;
    });

    // 4. Free device lock and release device (keep readiness intact, do NOT force maintenance)
    setDevices(prev => {
      let changed = false;
      const next = prev.map(d => {
        const matchesDevId = trimmedDevId && (d.id === trimmedDevId || trimmedDevId.includes(d.id) || d.id.includes(trimmedDevId));
        const matchesDevName = trimmedDevName && d.name.toLowerCase().trim() === trimmedDevName.toLowerCase();
        const matchesRunId = runId && d.activeRunId === runId;
        const matchesTester = trimmedTester && d.activeTesterName && d.activeTesterName.toLowerCase().trim() === trimmedTester.toLowerCase();
        if (matchesDevId || matchesDevName || matchesRunId || matchesTester) {
          changed = true;
          return {
            ...d,
            activeRunId: undefined,
            activeTesterName: undefined,
          };
        }
        return d;
      });
      if (changed) {
        localStorage.setItem('qa_devices_list', JSON.stringify(next));
        syncDevicesListToCloud(next);
      }
      return next;
    });
  };

  const handleDeleteTester = (testerName: string) => {
    const runsToDelete = [...testRuns, ...archivedRuns].filter(
      r => (r.testerName?.trim() || 'Unassigned Tester').toLowerCase() === testerName.toLowerCase().trim()
    );

    const idsToDelete = new Set(runsToDelete.map(r => r.id));

    setTestRuns(prev => prev.filter(r => !idsToDelete.has(r.id)));
    setArchivedRuns(prev => prev.filter(r => !idsToDelete.has(r.id)));

    runsToDelete.forEach(r => {
      deleteTestRunFromSupabase(r.id);
      deleteArchivedRunFromSupabase(r.id);
    });
  };

  const handleResetActiveDay = (dateStr: string) => {
    setTestRuns(prevRuns =>
      prevRuns.map(run => {
        const updatedResults = { ...run.results };
        let modified = false;
        (Object.entries(updatedResults) as [string, any][]).forEach(([stepId, res]) => {
          if (res && res.timestamp && res.timestamp.slice(0, 10) === dateStr) {
            delete updatedResults[stepId];
            modified = true;
          }
        });
        if (modified) {
          const remainingKeys = Object.keys(updatedResults).length;
          const updated = {
            ...run,
            results: updatedResults,
            currentStepIndex: 0,
            status: (remainingKeys === 0 ? 'not_started' : 'in_progress') as TestRun['status']
          };
          syncTestRunToSupabase(updated);
          return updated;
        }
        return run;
      })
    );

    setArchivedRuns(prevRuns =>
      prevRuns.map(run => {
        const updatedResults = { ...run.results };
        let modified = false;
        (Object.entries(updatedResults) as [string, any][]).forEach(([stepId, res]) => {
          if (res && res.timestamp && res.timestamp.slice(0, 10) === dateStr) {
            delete updatedResults[stepId];
            modified = true;
          }
        });
        if (modified) {
          const updated = {
            ...run,
            results: updatedResults,
            status: (Object.keys(updatedResults).length === 0 ? 'not_started' : run.status) as TestRun['status']
          };
          syncArchivedRunToSupabase(updated);
          return updated;
        }
        return run;
      })
    );
  };

  const handleDeleteBug = (bugId: string) => {
    setBugLogs(prev => prev.filter(b => b.id !== bugId));
    deleteBugLogFromSupabase(bugId);

    setTestRuns(prev => prev.map(r => {
      const hasBug = r.bugLogs.some(b => b.id === bugId);
      const updated = { ...r, bugLogs: r.bugLogs.filter(b => b.id !== bugId) };
      if (hasBug) syncTestRunToSupabase(updated);
      return updated;
    }));

    setArchivedRuns(prev => prev.map(r => {
      const hasBug = r.bugLogs.some(b => b.id === bugId);
      const updated = { ...r, bugLogs: r.bugLogs.filter(b => b.id !== bugId) };
      if (hasBug) syncArchivedRunToSupabase(updated);
      return updated;
    }));
  };

  const handleWipeAllBugs = () => {
    setBugLogs([]);
    try {
      localStorage.removeItem('qa_bug_logs');
    } catch (e) {}
    wipeAllBugsFromSupabase();

    setTestRuns(prev => prev.map(r => {
      if (!r.bugLogs || r.bugLogs.length === 0) return r;
      const updated = { ...r, bugLogs: [] };
      syncTestRunToSupabase(updated);
      return updated;
    }));

    setArchivedRuns(prev => prev.map(r => {
      if (!r.bugLogs || r.bugLogs.length === 0) return r;
      const updated = { ...r, bugLogs: [] };
      syncArchivedRunToSupabase(updated);
      return updated;
    }));
  };

  const handleUpdateRun = (updatedRun: TestRun) => {
    if (updatedRun.deviceName) {
      handleAddPopulatedDevice(updatedRun.deviceName);
    }

    setTestRuns(prev => {
      const exists = prev.some(r => r.id === updatedRun.id);
      if (exists) {
        return prev.map(r => r.id === updatedRun.id ? updatedRun : r);
      }
      return [updatedRun, ...prev];
    });

    safeSyncTestRun(updatedRun);

    const plan = testPlans.find(p => p.id === updatedRun.planId);
    const totalSteps = plan?.steps.length || 0;
    // Filter out non-step entries like _meta to get accurate completed step count
    const stepResultsEntries = Object.entries(updatedRun.results || {}).filter(
      ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in v
    );
    // Run is only done when explicitly marked 'completed' at the final step and has actual step data recorded
    const isDone = updatedRun.status === 'completed' && stepResultsEntries.length > 0;

    if (isDone) {
      const finishTimeIso = updatedRun.completedAt || new Date().toISOString();
      const startMs = updatedRun.startedAt ? new Date(updatedRun.startedAt).getTime() : 0;
      const endMs = new Date(finishTimeIso).getTime();
      const calcDurationMs = (startMs > 0 && endMs > startMs) ? (endMs - startMs) : updatedRun.durationMs;

      // Clean results to contain purely step results
      const cleanedResults: Record<string, any> = {};
      stepResultsEntries.forEach(([k, v]) => {
        cleanedResults[k] = v;
      });

      const completedRun: TestRun = {
        ...updatedRun,
        results: cleanedResults as any,
        status: 'completed',
        completedAt: finishTimeIso,
        durationMs: calcDurationMs
      };

      // Remove from active testRuns, add to archivedRuns
      setTestRuns(prev => prev.filter(r => r.id !== completedRun.id));
      setArchivedRuns(prev => {
        const exists = prev.some(r => r.id === completedRun.id);
        if (exists) {
          return prev.map(r => r.id === completedRun.id ? completedRun : r);
        }
        return [completedRun, ...prev];
      });

      safeDeleteTestRun(completedRun.id);
      safeSyncArchivedRun(completedRun);

      // Release device lock: if test is finished, device is no longer in use
      setDevices(prev => {
        let changed = false;
        const next = prev.map(d => {
          const matchesId = d.activeRunId === completedRun.id || (completedRun.deviceId && (d.id === completedRun.deviceId || completedRun.deviceId.includes(d.id)));
          const matchesName = completedRun.deviceName && d.name.toLowerCase().trim() === completedRun.deviceName.toLowerCase().trim();
          if (matchesId || matchesName) {
            changed = true;
            const released = { ...d, activeRunId: undefined, activeTesterName: undefined };
            syncDeviceToSupabase(released);
            return released;
          }
          return d;
        });
        if (changed) {
          localStorage.setItem('qa_devices_list', JSON.stringify(next));
          safeSyncDevices(next);
        }
        return next;
      });
    } else {
      setTestRuns(prev => {
        const exists = prev.some(r => r.id === updatedRun.id);
        if (exists) {
          return prev.map(r => r.id === updatedRun.id ? updatedRun : r);
        }
        return [updatedRun, ...prev];
      });

      safeSyncTestRun(updatedRun);
    }
  };

  const handleLogBug = (newBug: BugLog) => {
    if (newBug.deviceName) {
      handleAddPopulatedDevice(newBug.deviceName);
    }
    if (newBug.feature) {
      handleAddPopulatedFeature(newBug.feature);
    }
    setBugLogs(prev => {
      const exists = prev.some(b => b.id === newBug.id);
      if (exists) {
        return prev.map(b => b.id === newBug.id ? newBug : b);
      }
      return [newBug, ...prev];
    });
    safeSyncBugLog(newBug);
  };

  const handleRestartRun = (runIdOrPlanId: string) => {
    const plan = testPlans.find(p => p.id === runIdOrPlanId);
    const planId = plan ? plan.id : runIdOrPlanId;
    const planName = plan ? plan.name : 'Test Plan';

    setTestRuns(prev => {
      // Remove any existing in-progress run for this plan
      const filtered = prev.filter(r => r.planId !== planId && r.id !== runIdOrPlanId);
      const newRun: TestRun = {
        id: `run-${planId}-${Date.now().toString(36)}`,
        planId: planId,
        planName: planName,
        testerName: '',
        deviceName: '',
        status: 'not_started',
        currentStepIndex: 0,
        results: {},
        bugLogs: [],
        startedAt: new Date().toISOString()
      };
      syncTestRunToSupabase(newRun);
      return [newRun, ...filtered];
    });
  };

  const handleSaveDevice = (device: DeviceProfile) => {
    lastDeviceEditTimeRef.current = Date.now();
    const exists = devices.some(d => d.id === device.id);
    const next = exists ? devices.map(d => d.id === device.id ? device : d) : [...devices, device];
    setDevices(next);
    localStorage.setItem('qa_devices_list', JSON.stringify(next));
    syncDevicesListToCloud(next);
  };

  const handleDeleteDevice = (deviceId: string) => {
    lastDeviceEditTimeRef.current = Date.now();
    const next = devices.filter(d => d.id !== deviceId);
    setDevices(next);
    localStorage.setItem('qa_devices_list', JSON.stringify(next));
    syncDevicesListToCloud(next);
  };

  const handleSaveTester = (tester: TesterProfile) => {
    setTesters(prev => {
      const exists = prev.some(t => t.id === tester.id);
      const next = exists ? prev.map(t => t.id === tester.id ? tester : t) : [...prev, tester];
      localStorage.setItem('qa_testers_list', JSON.stringify(next));
      syncTestersListToCloud(next);
      return next;
    });
    syncTesterToSupabase(tester);
  };

  const handleDeleteTesterProfile = (testerId: string) => {
    setTesters(prev => {
      const next = prev.filter(t => t.id !== testerId);
      localStorage.setItem('qa_testers_list', JSON.stringify(next));
      syncTestersListToCloud(next);
      return next;
    });
    deleteTesterFromSupabase(testerId);
  };

  const handleOpenMobileView = (planId?: string) => {
    if (planId) {
      setSelectedPlanId(planId);
    } else if (testPlans.length > 0 && !selectedPlanId) {
      setSelectedPlanId(testPlans[0].id);
    }
    setCurrentView('mobile');
  };

  const handleDeleteFeature = (featureName: string) => {
    const trimmed = featureName.trim();
    if (!trimmed) return;

    setPopulatedFeatures(prev => prev.filter(f => f.toLowerCase() !== trimmed.toLowerCase()));

    // Reset matching step features in plans to 'General'
    setTestPlans(prev => prev.map(plan => ({
      ...plan,
      steps: plan.steps.map(step => (step.feature?.toLowerCase() === trimmed.toLowerCase()) ? { ...step, feature: 'General' } : step)
    })));

    // Reset matching feature in bug logs to 'General'
    setBugLogs(prev => prev.map(bug => (bug.feature?.toLowerCase() === trimmed.toLowerCase()) ? { ...bug, feature: 'General' } : bug));

    // Reset matching feature in test runs to 'General'
    setTestRuns(prev => prev.map(run => ({
      ...run,
      results: Object.fromEntries(
        Object.entries(run.results || {}).map(([stepId, res]) => [
          stepId,
          res.feature?.toLowerCase() === trimmed.toLowerCase() ? { ...res, feature: 'General' } : res
        ])
      ),
      bugLogs: run.bugLogs.map(bug => (bug.feature?.toLowerCase() === trimmed.toLowerCase()) ? { ...bug, feature: 'General' } : bug)
    })));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 relative">
      
      {/* Liquid Ambient Glowing Background Orbs */}
      <div className="liquid-ambient-bg">
        <div className="liquid-orb liquid-orb-1"></div>
        <div className="liquid-orb liquid-orb-2"></div>
        <div className="liquid-orb liquid-orb-3"></div>
      </div>

      {/* Main View Router */}
      <main className="flex-1 relative z-10">
        {currentView === 'dashboard' && (
          <div key="dashboard-view">
            <Dashboard
              testPlans={testPlans}
              testRuns={testRuns}
              bugLogs={bugLogs}
              populatedFeatures={populatedFeatures.filter(f => f && !f.startsWith('__'))}
              devices={devices}
              testers={testers}
              onSelectPlanToBuild={handleCreatePlanClick}
              onOpenMobileView={handleOpenMobileView}
              onDeletePlan={handleDeletePlan}
              onDeleteBug={handleDeleteBug}
              onWipeAllBugs={handleWipeAllBugs}
              onClonePlan={handleClonePlan}
              onEditPlan={handleEditPlan}
              onLoadSampleData={handleLoadSampleData}
              onClearAllData={handleClearAllData}
              onImportJSONData={handleImportJSONData}
              onAddFeature={handleAddPopulatedFeature}
              onDeleteFeature={handleDeleteFeature}
              onDeleteTestRun={handleDeleteTestRun}
              onBootTester={handleBootTester}
              onDeleteTester={handleDeleteTester}
              onResetActiveDay={handleResetActiveDay}
              onResetDailyQuotas={handleResetDailyQuotas}
              onSaveDevice={handleSaveDevice}
              onDeleteDevice={handleDeleteDevice}
              onSaveTester={handleSaveTester}
              onDeleteTesterProfile={handleDeleteTesterProfile}
              archivedRuns={archivedRuns}
              onRunSubagentTest={handleRunSubagentAutomatedTest}
              minAppVersion={minAppVersion}
              onUpdateMinAppVersion={handleUpdateMinAppVersion}
            />
          </div>
        )}

        {currentView === 'plan-builder' && (
          <div key="plan-builder-view" className="animate-liquid-fade">
            <PlanBuilder
              initialPlan={editingPlan}
              populatedFeatures={populatedFeatures.filter(f => f && !f.startsWith('__'))}
              onAddPopulatedFeature={handleAddPopulatedFeature}
              onDeleteFeature={handleDeleteFeature}
              onSavePlan={handleSavePlan}
              onCancel={() => {
                setEditingPlan(null);
                setCurrentView('dashboard');
              }}
            />
          </div>
        )}

        {currentView === 'mobile' && (
          <div key="mobile-view" className="animate-liquid-fade">
            <MobileTester
              testPlans={testPlans}
              testRuns={testRuns}
              archivedRuns={archivedRuns}
              bugLogs={bugLogs}
              devices={devices}
              testers={testers}
              minAppVersion={minAppVersion}
              populatedFeatures={populatedFeatures}
              lastBootSignal={lastBootSignal}
              onSaveDevice={handleSaveDevice}
              selectedPlanId={selectedPlanId}
              populatedDevices={populatedDevices}
              onAddPopulatedDevice={handleAddPopulatedDevice}
              onSelectPlan={(planId) => {
                setSelectedPlanId(planId);
                try {
                  localStorage.setItem('qa_selected_plan_id', planId);
                } catch (e) {}
              }}
              onUpdateRun={handleUpdateRun}
              onDeleteRun={handleDeleteTestRun}
              onLogBug={handleLogBug}
              onDeleteBug={handleDeleteBug}
              onRestartRun={handleRestartRun}
              onNavigateToDashboard={
                (window as any).Capacitor?.isNativePlatform?.() || window.location.pathname.includes('/mobile')
                  ? undefined
                  : () => setCurrentView('dashboard')
              }
            />
          </div>
        )}
      </main>

    </div>
  );
}

export default App;
