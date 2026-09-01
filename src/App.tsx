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
      if (saved) return JSON.parse(saved);
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

  const devicesRef = useRef(devices);
  useEffect(() => { devicesRef.current = devices; }, [devices]);

  const testersRef = useRef(testers);
  useEffect(() => { testersRef.current = testers; }, [testers]);

  // Supabase Initial Fetch & Real-Time Sync Subscription
  const loadCloudData = async () => {
    if (!isSupabaseConfigured) return;
    await drainOfflineQueue();
    const cloudData = await fetchAllSupabaseData();
    if (cloudData) {
      if (cloudData.testPlans) setTestPlans(cloudData.testPlans);
      if (cloudData.testRuns) {
        setTestRuns(cloudData.testRuns);
      }
      if (cloudData.archivedRuns) setArchivedRuns(cloudData.archivedRuns);
      if (cloudData.bugLogs) setBugLogs(cloudData.bugLogs);
      if (cloudData.populatedFeatures && cloudData.populatedFeatures.length > 0) {
        setPopulatedFeatures(cloudData.populatedFeatures);
      }
      if (cloudData.devices && JSON.stringify(cloudData.devices) !== JSON.stringify(devicesRef.current)) {
        setDevices(cloudData.devices);
      }
      if (cloudData.testers && JSON.stringify(cloudData.testers) !== JSON.stringify(testersRef.current)) {
        setTesters(cloudData.testers);
      }
    }
  };

  useEffect(() => {
    loadCloudData();
    const unsubscribe = subscribeToSupabaseRealtime(() => {
      loadCloudData();
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

    return () => {
      unsubscribe();
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

    setBugLogs(prevBugs => {
      const bugsToRemove = prevBugs.filter(b => b.timestamp && b.timestamp.slice(0, 10) === dateStr);
      bugsToRemove.forEach(b => deleteBugLogFromSupabase(b.id));
      return prevBugs.filter(b => !b.timestamp || b.timestamp.slice(0, 10) !== dateStr);
    });
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
    // Run is only done when explicitly marked 'completed' at the final step
    const isDone = updatedRun.status === 'completed';

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
    setBugLogs(prev => [newBug, ...prev]);
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
    setDevices(prev => {
      const exists = prev.some(d => d.id === device.id);
      const next = exists ? prev.map(d => d.id === device.id ? device : d) : [...prev, device];
      localStorage.setItem('qa_devices_list', JSON.stringify(next));
      syncDevicesListToCloud(next);
      return next;
    });
    syncDeviceToSupabase(device);
  };

  const handleDeleteDevice = (deviceId: string) => {
    setDevices(prev => {
      const next = prev.filter(d => d.id !== deviceId);
      localStorage.setItem('qa_devices_list', JSON.stringify(next));
      syncDevicesListToCloud(next);
      return next;
    });
    deleteDeviceFromSupabase(deviceId);
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
          <div key="dashboard-view" className="animate-liquid-fade">
            <Dashboard
              testPlans={testPlans}
              testRuns={testRuns}
              bugLogs={bugLogs}
              populatedFeatures={populatedFeatures}
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
              onDeleteTester={handleDeleteTester}
              onResetActiveDay={handleResetActiveDay}
              onSaveDevice={handleSaveDevice}
              onDeleteDevice={handleDeleteDevice}
              onSaveTester={handleSaveTester}
              onDeleteTesterProfile={handleDeleteTesterProfile}
              archivedRuns={archivedRuns}
              onRunSubagentTest={handleRunSubagentAutomatedTest}
            />
          </div>
        )}

        {currentView === 'plan-builder' && (
          <div key="plan-builder-view" className="animate-liquid-fade">
            <PlanBuilder
              initialPlan={editingPlan}
              populatedFeatures={populatedFeatures}
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
