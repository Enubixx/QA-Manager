import React, { useState, useEffect } from 'react';
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
  syncPopulatedFeatureToSupabase,
  deletePopulatedFeatureFromSupabase,
  syncDeviceToSupabase,
  deleteDeviceFromSupabase,
  syncTesterToSupabase,
  deleteTesterFromSupabase,
  subscribeToSupabaseRealtime,
} from './services/supabaseService';
import { isSupabaseConfigured } from './lib/supabase';

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
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');

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
      if (saved) return JSON.parse(saved);
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
    return [
      { id: 'dev-1', name: 'Google Pixel 8', isReady: true, quotas: [] },
      { id: 'dev-2', name: 'Samsung Galaxy S24', isReady: true, quotas: [] },
      { id: 'dev-3', name: 'iPhone 15 Pro', isReady: true, quotas: [] },
    ];
  });

  // User-populated QA tester profiles list
  const [testers, setTesters] = useState<TesterProfile[]>(() => {
    try {
      const saved = localStorage.getItem('qa_testers_list');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      { id: 'tester-1', name: 'Kevin Huang', role: 'QA Lead' },
      { id: 'tester-2', name: 'Sarah Miller', role: 'Mobile Tester' },
    ];
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

  // Supabase Initial Fetch & Real-Time Sync Subscription
  const loadCloudData = async () => {
    if (!isSupabaseConfigured) return;
    const cloudData = await fetchAllSupabaseData();
    if (cloudData) {
      if (cloudData.testPlans) setTestPlans(cloudData.testPlans);
      if (cloudData.testRuns) setTestRuns(cloudData.testRuns);
      if (cloudData.archivedRuns) setArchivedRuns(cloudData.archivedRuns);
      if (cloudData.bugLogs) setBugLogs(cloudData.bugLogs);
      if (cloudData.populatedFeatures && cloudData.populatedFeatures.length > 0) {
        setPopulatedFeatures(cloudData.populatedFeatures);
      }
      if (cloudData.devices && cloudData.devices.length > 0) {
        setDevices(cloudData.devices);
      }
      if (cloudData.testers && cloudData.testers.length > 0) {
        setTesters(cloudData.testers);
      }
    }
  };

  useEffect(() => {
    loadCloudData();
    const unsubscribe = subscribeToSupabaseRealtime(() => {
      loadCloudData();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Ensure selectedPlanId defaults to first plan if available
  useEffect(() => {
    if (!selectedPlanId && testPlans.length > 0) {
      setSelectedPlanId(testPlans[0].id);
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
    localStorage.setItem('qa_bug_logs', JSON.stringify(bugLogs));
  }, [bugLogs]);

  useEffect(() => {
    localStorage.setItem('qa_populated_devices', JSON.stringify(populatedDevices));
  }, [populatedDevices]);

  useEffect(() => {
    localStorage.setItem('qa_populated_features', JSON.stringify(populatedFeatures));
  }, [populatedFeatures]);

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

  const handleImportJSONData = (data: { testPlans?: TestPlan[]; testRuns?: TestRun[]; bugLogs?: BugLog[] }) => {
    if (data.testPlans && Array.isArray(data.testPlans)) {
      setTestPlans(data.testPlans);
      data.testPlans.forEach(syncTestPlanToSupabase);
      if (data.testPlans.length > 0) setSelectedPlanId(data.testPlans[0].id);
    }
    if (data.testRuns && Array.isArray(data.testRuns)) {
      setTestRuns(data.testRuns);
      data.testRuns.forEach(syncTestRunToSupabase);
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
    const runToDelete = testRuns.find(r => r.id === runId) || archivedRuns.find(r => r.id === runId);

    setTestRuns(prev => prev.filter(r => r.id !== runId));
    setArchivedRuns(prev => prev.filter(r => r.id !== runId));

    deleteTestRunFromSupabase(runId);
    deleteArchivedRunFromSupabase(runId);

    if (currentView === 'mobile' && runToDelete && runToDelete.planId === selectedPlanId) {
      setCurrentView('dashboard');
    }
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

    syncTestRunToSupabase(updatedRun);

    const plan = testPlans.find(p => p.id === updatedRun.planId);
    const totalSteps = plan?.steps.length || 0;
    const completedSteps = Object.keys(updatedRun.results || {}).length;
    const isDone = updatedRun.status === 'completed' || (totalSteps > 0 && completedSteps >= totalSteps);

    if (isDone) {
      const finishTimeIso = updatedRun.completedAt || new Date().toISOString();
      const startMs = updatedRun.startedAt ? new Date(updatedRun.startedAt).getTime() : 0;
      const endMs = new Date(finishTimeIso).getTime();
      const calcDurationMs = (startMs > 0 && endMs > startMs) ? (endMs - startMs) : updatedRun.durationMs;

      const finalResults = {
        ...(updatedRun.results || {}),
        _meta: {
          startedAt: updatedRun.startedAt || new Date().toISOString(),
          durationMs: calcDurationMs
        }
      };

      const completedRun: TestRun = {
        ...updatedRun,
        results: finalResults as any,
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

      deleteTestRunFromSupabase(completedRun.id);
      syncArchivedRunToSupabase(completedRun);
    } else {
      setTestRuns(prev => {
        const exists = prev.some(r => r.id === updatedRun.id);
        if (exists) {
          return prev.map(r => r.id === updatedRun.id ? updatedRun : r);
        }
        return [updatedRun, ...prev];
      });

      syncTestRunToSupabase(updatedRun);
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
    syncBugLogToSupabase(newBug);
  };

  const handleRestartRun = (runIdOrPlanId: string) => {
    setTestRuns(prev => {
      const targetRun = prev.find(r => r.id === runIdOrPlanId || (r.planId === runIdOrPlanId && r.status !== 'completed'));
      if (!targetRun) return prev;

      if (targetRun.status === 'completed') {
        const newRun: TestRun = {
          ...targetRun,
          id: `run-${targetRun.planId}-${targetRun.deviceId || 'dev'}-${Date.now().toString(36)}`,
          status: 'in_progress',
          currentStepIndex: 0,
          results: {},
          completedAt: undefined,
          startedAt: new Date().toISOString()
        };
        syncTestRunToSupabase(newRun);
        return [newRun, ...prev];
      }

      const updated = prev.map(r => {
        if (r.id === targetRun.id) {
          const resetRun = {
            ...r,
            currentStepIndex: 0,
            status: 'in_progress' as const,
            results: {},
            startedAt: new Date().toISOString()
          };
          syncTestRunToSupabase(resetRun);
          return resetRun;
        }
        return r;
      });
      return updated;
    });
  };

  const handleSaveDevice = (device: DeviceProfile) => {
    setDevices(prev => {
      const exists = prev.some(d => d.id === device.id);
      const next = exists ? prev.map(d => d.id === device.id ? device : d) : [...prev, device];
      localStorage.setItem('qa_devices_list', JSON.stringify(next));
      return next;
    });
    syncDeviceToSupabase(device);
  };

  const handleDeleteDevice = (deviceId: string) => {
    setDevices(prev => {
      const next = prev.filter(d => d.id !== deviceId);
      localStorage.setItem('qa_devices_list', JSON.stringify(next));
      return next;
    });
    deleteDeviceFromSupabase(deviceId);
  };

  const handleSaveTester = (tester: TesterProfile) => {
    setTesters(prev => {
      const exists = prev.some(t => t.id === tester.id);
      const next = exists ? prev.map(t => t.id === tester.id ? tester : t) : [...prev, tester];
      localStorage.setItem('qa_testers_list', JSON.stringify(next));
      return next;
    });
    syncTesterToSupabase(tester);
  };

  const handleDeleteTesterProfile = (testerId: string) => {
    setTesters(prev => {
      const next = prev.filter(t => t.id !== testerId);
      localStorage.setItem('qa_testers_list', JSON.stringify(next));
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
              onSelectPlan={setSelectedPlanId}
              onUpdateRun={handleUpdateRun}
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
