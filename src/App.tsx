import React, { useState, useEffect, useRef } from 'react';
import { Dashboard } from './components/Dashboard';
import { PlanBuilder } from './components/PlanBuilder';
import { MobileTester } from './components/MobileTester';
import { Navbar } from './components/Navbar';
import { SAMPLE_PLANS, SAMPLE_RUNS, SAMPLE_BUG_LOGS } from './data/mockData';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, RefinedBugText, ReproMatches } from './types';
import { bugTextSig } from './utils/bugRefine';
import { exportAllQADataToJSON } from './utils/exportUtils';
import {
  fetchAllSupabaseData,
  fetchRx95Suggestions,
  type Rx95SuggestionsData,
  syncTestPlanToSupabase,
  deleteTestPlanFromSupabase,
  syncBugLogToSupabase,
  deleteBugLogFromSupabase,
  wipeAllBugsFromSupabase,
  syncPopulatedFeatureToSupabase,
  deletePopulatedFeatureFromSupabase,
  syncDeviceToSupabase,
  deleteDeviceFromSupabase,
  getDeletedDeviceIds,
  syncTesterToSupabase,
  deleteTesterFromSupabase,
  getDeletedTesterIds,
  syncDevicesListToCloud,
  syncTestersListToCloud,
  subscribeToSupabaseRealtime,
  subscribeToSystemCommands,
  broadcastBootSignal,
  BootSignal,
  isTestRunDeleted,
  isArchivedRunDeleted,
  markTestRunDeleted,
} from './services/supabaseService';
import { isSupabaseConfigured } from './lib/supabase';
import { getLocalDateStr } from './utils/dateUtils';
import {
  isRunFullyCompleted,
  buildStepFirstSeenIndex,
  getEffectiveRunStatus,
  filterCloudArchivedRuns,
  filterCloudTestRuns,
  filterBugsAfterRunDelete,
} from './utils/runUtils';
import { mergeRunsById } from './utils/cujReportUtils';
import {
  drainOfflineQueue,
  safeSyncTestRun,
  safeSyncArchivedRun,
  safeSyncBugLog,
  safePatchBugColumns,
  safeDeleteTestRun,
  safeDeleteArchivedRun,
  safeSyncDevices
} from './services/offlineSyncQueue';
import { APP_VERSION_CODE, CONFIG_MIN_APP_VERSION, CONFIG_DAILY_RESET_DATE } from './constants';

const safeSetStorageItem = (key: string, value: string, fallbackFn?: () => string) => {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (fallbackFn) {
      try {
        localStorage.setItem(key, fallbackFn());
      } catch (innerErr) {
        console.error(`Critical quota error saving ${key}:`, innerErr);
      }
    } else {
      console.warn(`localStorage error saving ${key}:`, err);
    }
  }
};

const normalizePlans = (raw: unknown): TestPlan[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p: any) => p && typeof p === 'object' && typeof p.id === 'string' && p.id.trim() !== '')
    .map((p: any) => ({
      ...p,
      name: typeof p.name === 'string' ? p.name : 'Untitled Plan',
      description: typeof p.description === 'string' ? p.description : '',
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
      steps: Array.isArray(p.steps)
        ? p.steps.filter((s: any) => s && typeof s === 'object' && typeof s.id === 'string')
        : []
    }));
};

const normalizeRuns = (raw: unknown): TestRun[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r: any) => r && typeof r === 'object' && typeof r.id === 'string' && r.id.trim() !== '')
    .map((r: any) => ({
      ...r,
      planId: typeof r.planId === 'string' ? r.planId : '',
      planName: typeof r.planName === 'string' ? r.planName : 'Test Plan',
      testerName: typeof r.testerName === 'string' ? r.testerName : '',
      deviceName: typeof r.deviceName === 'string' ? r.deviceName : '',
      status: r.status || 'not_started',
      currentStepIndex: typeof r.currentStepIndex === 'number' && !isNaN(r.currentStepIndex) ? r.currentStepIndex : 0,
      results: r.results && typeof r.results === 'object' && !Array.isArray(r.results) ? r.results : {},
      bugLogs: Array.isArray(r.bugLogs)
        ? r.bugLogs.filter((b: any) => b && typeof b === 'object' && typeof b.id === 'string')
        : [],
      startedAt: typeof r.startedAt === 'string' ? r.startedAt : new Date().toISOString()
    }));
};

const normalizeBugs = (raw: unknown): BugLog[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b: any) => b && typeof b === 'object' && typeof b.id === 'string' && b.id.trim() !== '');
};

const normalizeDevices = (raw: unknown): DeviceProfile[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d: any) => d && typeof d === 'object' && typeof d.id === 'string' && d.id.trim() !== '' && typeof d.name === 'string')
    .map((d: any) => ({
      ...d,
      isReady: typeof d.isReady === 'boolean' ? d.isReady : true,
      quotas: Array.isArray(d.quotas)
        ? d.quotas.filter((q: any) => q && typeof q === 'object' && typeof q.planId === 'string')
        : []
    }));
};

const normalizeTesters = (raw: unknown): TesterProfile[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t: any) => t && typeof t === 'object' && typeof t.id === 'string' && t.id.trim() !== '' && typeof t.name === 'string');
};

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
      if (saved) return normalizePlans(JSON.parse(saved));
    } catch (e) {}
    return [];
  });

  const [testRuns, setTestRuns] = useState<TestRun[]>(() => {
    try {
      const saved = localStorage.getItem('qa_test_runs');
      if (saved) {
        const parsed = normalizeRuns(JSON.parse(saved));
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
        const parsed = normalizeRuns(JSON.parse(saved));
        return parsed.filter((r: TestRun) => {
          const stepEntries = Object.entries(r.results || {}).filter(
            ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
          );
          return stepEntries.length > 0 || (r.bugLogs && r.bugLogs.length > 0);
        });
      }
    } catch (e) {}
    return [];
  });

  // RX95 worker output (read-only): same-day bundle suggestions + background heartbeat.
  const [rx95Suggestions, setRx95Suggestions] = useState<Rx95SuggestionsData>({ sets: [] });
  const refreshSuggestionsRef = useRef<() => void>(() => {});
  refreshSuggestionsRef.current = () => {
    fetchRx95Suggestions().then(d => {
      if (d) setRx95Suggestions(prev => (JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
    }).catch(() => {});
  };
  useEffect(() => {
    refreshSuggestionsRef.current();
    const t = setInterval(() => refreshSuggestionsRef.current(), 10000);
    const onStorage = (e: StorageEvent) => { if (e.key === 'qa_rx95_suggestions_local') refreshSuggestionsRef.current(); };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(t); window.removeEventListener('storage', onStorage); };
  }, []);

  const [bugLogs, setBugLogs] = useState<BugLog[]>(() => {
    try {
      const saved = localStorage.getItem('qa_bug_logs');
      if (saved) return normalizeBugs(JSON.parse(saved));
    } catch (e) {}
    return [];
  });

  // User-populated device profiles list (with readiness & plan quotas)
  const [devices, setDevices] = useState<DeviceProfile[]>(() => {
    try {
      const saved = localStorage.getItem('qa_devices_list');
      if (saved) return normalizeDevices(JSON.parse(saved));
    } catch (e) {}
    return [];
  });

  // User-populated QA tester profiles list
  const [testers, setTesters] = useState<TesterProfile[]>(() => {
    try {
      const saved = localStorage.getItem('qa_testers_list');
      if (saved) return normalizeTesters(JSON.parse(saved));
    } catch (e) {}
    return [];
  });

  // User-populated devices list
  const [populatedDevices, setPopulatedDevices] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('qa_populated_devices');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((d): d is string => typeof d === 'string' && d.trim() !== '');
        }
      }
    } catch (e) {}
    const existing = Array.from(new Set(testRuns.map((r: TestRun) => r.deviceName).filter(Boolean))) as string[];
    return existing;
  });

  // User-populated feature identifiers list
  const [populatedFeatures, setPopulatedFeatures] = useState<string[]>(() => {
    let list: string[] = [];
    try {
      const saved = localStorage.getItem('qa_populated_features');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          list = parsed.filter((f): f is string => typeof f === 'string');
        }
      } else {
        const existingFromPlans = testPlans.flatMap(p => (p.steps || []).map(s => s.feature || '')).filter(Boolean);
        const existingFromBugs = bugLogs.map(b => b.feature || '').filter(Boolean);
        list = Array.from(new Set([...existingFromPlans, ...existingFromBugs]));
      }
    } catch (e) {}
    return list.filter(f => typeof f === 'string' && f.trim() !== '' && f.toLowerCase() !== 'general');
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

  // Sequence counter & mutation grace window so stale polls never overwrite fresh local mutations
  const pollSeqRef = useRef<number>(0);
  const lastUserMutationRef = useRef<number>(0);
  const markUserMutation = () => {
    lastUserMutationRef.current = Date.now();
  };

  // Reads the most recent __DAILY_QUOTA_RESET_DATE__ marker recorded in the cloud.
  // Historically several of these rows accumulated (one per day), so take the max.
  const getCloudResetDate = (cloudFeatures?: string[]): string => {
    if (!cloudFeatures || cloudFeatures.length === 0) return '';
    let latest = '';
    const prefix = `${CONFIG_DAILY_RESET_DATE}:`;
    for (const f of cloudFeatures) {
      if (typeof f === 'string' && f.startsWith(prefix)) {
        const val = f.slice(prefix.length).trim();
        if (val && val > latest) latest = val;
      }
    }
    return latest;
  };

  const clearLocalDailySessionCache = () => {
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('qa_in_progress_run_')) localStorage.removeItem(k);
      });
      localStorage.removeItem('qa_device_name');
      localStorage.removeItem('qa_session_setup_date');
      sessionStorage.removeItem('qa_device_name');
    } catch (e) {}
  };

  // Daily Quota Reset check (auto resets devices to no plan assigned on date rollover).
  // Gated on the shared cloud date so rollover happens at most once per day across timezones.
  const checkDailyQuotaReset = (devList: DeviceProfile[], cloudFeatures?: string[]) => {
    const todayStr = getLocalDateStr();
    const cloudResetDate = getCloudResetDate(cloudFeatures);

    // Someone already rolled over today (or a client in an earlier timezone already rolled over to >= todayStr).
    if (cloudResetDate && cloudResetDate >= todayStr) {
      if (localStorage.getItem('qa_last_quota_reset_date') !== todayStr) {
        clearLocalDailySessionCache();
        safeSetStorageItem('qa_last_quota_reset_date', todayStr);
      }
      return devList;
    }

    // No cloud marker at all (fresh project, or the cloud read returned no markers).
    // Fail closed: record today locally and anchor the initial marker in the cloud rather than wiping quotas.
    if (!cloudResetDate) {
      if (localStorage.getItem('qa_last_quota_reset_date') !== todayStr) {
        clearLocalDailySessionCache();
        safeSetStorageItem('qa_last_quota_reset_date', todayStr);
      }
      if (Array.isArray(cloudFeatures)) {
        syncPopulatedFeatureToSupabase(`${CONFIG_DAILY_RESET_DATE}:${todayStr}`);
      }
      return devList;
    }

    // Cloud marker exists and strictly predates today -> genuine date rollover.
    clearLocalDailySessionCache();
    testRunsRef.current.forEach(r => {
      if (r.status === 'in_progress') {
        safeDeleteTestRun(r.id);
      }
    });
    const resetList = devList.map(d => ({
      ...d,
      quotas: [],
      isReady: true,
      activeRunId: undefined,
      activeTesterName: undefined
    }));
    safeSetStorageItem('qa_last_quota_reset_date', todayStr);
    safeSetStorageItem('qa_devices_list', JSON.stringify(resetList));
    safeSyncDevices(resetList);
    const newMarker = `${CONFIG_DAILY_RESET_DATE}:${todayStr}`;
    syncPopulatedFeatureToSupabase(newMarker);
    // Drop all superseded daily reset markers so rows never accumulate.
    (cloudFeatures || []).forEach(f => {
      if (typeof f === 'string' && f.startsWith(`${CONFIG_DAILY_RESET_DATE}:`) && f !== newMarker) {
        deletePopulatedFeatureFromSupabase(f);
      }
    });
    return resetList;
  };

  // Supabase Initial Fetch & Real-Time Sync Subscription
  const loadCloudData = async () => {
    if (!isSupabaseConfigured) return;
    const mySeq = ++pollSeqRef.current;
    const fetchStartedAt = Date.now();
    await drainOfflineQueue();
    const cloudData = await fetchAllSupabaseData();
    // Discard stale out-of-order responses or responses racing a recent local user mutation
    if (mySeq !== pollSeqRef.current) return;
    if (lastUserMutationRef.current >= fetchStartedAt || Date.now() - lastUserMutationRef.current < 2500) {
      return;
    }
    if (cloudData) {
      if (cloudData.testPlans) {
        const normalizedPlans = normalizePlans(cloudData.testPlans);
        if (JSON.stringify(normalizedPlans) !== JSON.stringify(testPlansRef.current)) {
          setTestPlans(normalizedPlans);
          if (normalizedPlans.length > 0 && (!selectedPlanId || !normalizedPlans.some(p => p.id === selectedPlanId))) {
            setSelectedPlanId(normalizedPlans[0].id);
          }
        }
      }
      const todayStr = getLocalDateStr();
      const validArchivedRuns = filterCloudArchivedRuns(
        normalizeRuns(cloudData.archivedRuns || []),
        isArchivedRunDeleted
      );
      if (cloudData.archivedRuns && JSON.stringify(validArchivedRuns) !== JSON.stringify(archivedRunsRef.current)) {
        setArchivedRuns(validArchivedRuns);
      }

      const archivedIdSet = new Set([
        ...validArchivedRuns.map(r => r.id),
        ...archivedRunsRef.current.map(r => r.id)
      ]);

      // Filter out empty ghost runs, already-archived runs, tombstoned runs, and prior-day orphaned in_progress runs
      const validTestRuns = filterCloudTestRuns(
        normalizeRuns(cloudData.testRuns || []),
        archivedIdSet,
        isTestRunDeleted,
        isArchivedRunDeleted,
        safeDeleteTestRun,
        todayStr
      );
      if (cloudData.testRuns && JSON.stringify(validTestRuns) !== JSON.stringify(testRunsRef.current)) {
        setTestRuns(validTestRuns);
      }
      if (cloudData.bugLogs) {
        let cloudWipedAt = 0;
        (cloudData.populatedFeatures || []).forEach(f => {
          if (typeof f === 'string' && f.startsWith('__GLOBAL_BUGS_WIPED_AT__:')) {
            const ts = parseInt(f.replace('__GLOBAL_BUGS_WIPED_AT__:', ''), 10);
            if (!isNaN(ts) && ts > cloudWipedAt) cloudWipedAt = ts;
          }
        });
        const localWipedAtStr = localStorage.getItem('qa_bugs_wiped_at');
        const localWipedAt = localWipedAtStr ? parseInt(localWipedAtStr, 10) : 0;
        const effectiveWipedAt = Math.max(cloudWipedAt, localWipedAt);

        // Filter out any bugs recorded before the wipe timestamp
        const validCloudBugs = normalizeBugs(cloudData.bugLogs).filter(b => {
          if (effectiveWipedAt > 0) {
            const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            if (bTs > 0 && bTs <= effectiveWipedAt) return false;
          }
          return true;
        });

        if (JSON.stringify(validCloudBugs) !== JSON.stringify(bugLogsRef.current)) {
          setBugLogs(validCloudBugs);
          bugLogsRef.current = validCloudBugs;
        }

        safeSetStorageItem(
          'qa_bug_logs',
          JSON.stringify(validCloudBugs),
          () => JSON.stringify(validCloudBugs.map((b, idx) => (idx >= 5 && b?.imageUrl?.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
        );
        if (effectiveWipedAt > 0) {
          safeSetStorageItem('qa_bugs_wiped_at', String(effectiveWipedAt));
        }
      }
      if (cloudData.populatedFeatures && cloudData.populatedFeatures.length > 0) {
        const cleanFeatures = cloudData.populatedFeatures.filter(
          (f): f is string => typeof f === 'string' && f.trim() !== '' && f.toLowerCase() !== 'general'
        );
        if (JSON.stringify(cleanFeatures) !== JSON.stringify(populatedFeaturesRef.current)) {
          setPopulatedFeatures(cleanFeatures);
        }
      }
      if (cloudData.devices && (cloudData.devices.length > 0 || devicesRef.current.length === 0)) {
        const deletedDevIds = getDeletedDeviceIds();
        const filteredCloudDevices = normalizeDevices(cloudData.devices).filter(cd => !deletedDevIds.has(cd.id));
        const isRecentUserEdit = Date.now() - lastDeviceEditTimeRef.current < 4000;
        const baseDevices = isRecentUserEdit
          ? devicesRef.current
          : filteredCloudDevices;

        const currentDevices = checkDailyQuotaReset(baseDevices, cloudData.populatedFeatures);

        const plansForQuota = cloudData.testPlans ? normalizePlans(cloudData.testPlans) : testPlansRef.current;

        const inProgressRuns = validTestRuns.filter(
          r =>
            r.status === 'in_progress' &&
            getEffectiveRunStatus(r, plansForQuota) === 'in_progress' &&
            !archivedIdSet.has(r.id) &&
            !isTestRunDeleted(r.id) &&
            getLocalDateStr(r.startedAt) === todayStr
        );
        const allCompletedRuns = mergeRunsById([
          ...validArchivedRuns,
          ...validTestRuns.filter(r => {
            if (r.status !== 'completed') return false;
            const stepEntries = Object.entries(r.results || {}).filter(
              ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
            );
            return stepEntries.length > 0;
          })
        ]);

        // Calculate today's completed runs per device and plan for quota automation
        const stepFirstSeen = buildStepFirstSeenIndex(mergeRunsById(validArchivedRuns, validTestRuns));
        const runsTodayPerDevice: Record<string, Record<string, number>> = {};
        allCompletedRuns.forEach(r => {
          if (!r.completedAt || !isRunFullyCompleted(r, plansForQuota, stepFirstSeen)) return;
          const rDate = getLocalDateStr(r.completedAt);
          if (rDate !== todayStr) return;
          const targetDev = currentDevices.find(d =>
            (r.deviceId && d.id.toLowerCase().trim() === r.deviceId.toLowerCase().trim()) ||
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

          // 1. Align active run lock using exact matching against live in-progress runs today
          const matchingRun = inProgressRuns.find(r =>
            (d.activeRunId && r.id === d.activeRunId) ||
            (r.deviceId && r.deviceId.toLowerCase().trim() === d.id.toLowerCase().trim()) ||
            (r.deviceName && r.deviceName.toLowerCase().trim() === d.name.toLowerCase().trim())
          );

          if (matchingRun) {
            if (d.activeRunId !== matchingRun.id || d.activeTesterName !== matchingRun.testerName) {
              needsSync = true;
              dev.activeRunId = matchingRun.id;
              dev.activeTesterName = matchingRun.testerName;
            }
          } else if ((d.activeRunId || d.activeTesterName) && !isRecentUserEdit) {
            // No live in-progress run exists for this device -> release orphaned device lock
            needsSync = true;
            dev.activeRunId = undefined;
            dev.activeTesterName = undefined;
          }

          return dev;
        });

        if (JSON.stringify(syncedDevices) !== JSON.stringify(devicesRef.current)) {
          setDevices(syncedDevices);
        }
        if (needsSync) {
          safeSetStorageItem('qa_devices_list', JSON.stringify(syncedDevices));
          safeSyncDevices(syncedDevices);
        }
      }
      if (cloudData.testers) {
        const deletedTesterIds = getDeletedTesterIds();
        const filteredCloudTesters = normalizeTesters(cloudData.testers).filter(ct => !deletedTesterIds.has(ct.id));
        if (JSON.stringify(filteredCloudTesters) !== JSON.stringify(testersRef.current)) {
          setTesters(filteredCloudTesters);
        }
      }
    }
  };

  useEffect(() => {
    let disposed = false;
    loadCloudData();
    let debounceTimer: any = null;
    const unsubscribe = subscribeToSupabaseRealtime(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!disposed) { loadCloudData(); refreshSuggestionsRef.current(); }
      }, 250);
    });

    // Handle Mobile Screen Unlock / App Resume via Capacitor native plugin
    let capSub: any = null;
    import('@capacitor/app')
      .then(({ App: CapApp }) => {
        if (disposed) return;
        CapApp.addListener('appStateChange', (state) => {
          if (!disposed && state.isActive) {
            loadCloudData();
          }
        }).then(sub => {
          if (disposed) {
            if (sub && typeof sub.remove === 'function') sub.remove();
          } else {
            capSub = sub;
          }
        });
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
      if (!disposed) setLastBootSignal(signal);
    });

    // Polling fallback ensures continuous background sync without thrashing UI state
    const pollTimer = setInterval(() => {
      if (!disposed) loadCloudData();
    }, 4000);

    return () => {
      disposed = true;
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
        safeSetStorageItem('qa_selected_plan_id', testPlans[0].id);
      } else {
        safeSetStorageItem('qa_selected_plan_id', selectedPlanId);
      }
    }
  }, [testPlans, selectedPlanId]);

  // Save to localStorage with QuotaExceededError fallbacks
  useEffect(() => {
    safeSetStorageItem('qa_test_plans', JSON.stringify(testPlans));
  }, [testPlans]);

  useEffect(() => {
    safeSetStorageItem(
      'qa_test_runs',
      JSON.stringify(testRuns),
      () => JSON.stringify(testRuns.map(r => ({
        ...r,
        bugLogs: (r.bugLogs || []).map(b => (b?.imageUrl && b.imageUrl.startsWith('data:')) ? { ...b, imageUrl: undefined } : b)
      })))
    );
  }, [testRuns]);

  useEffect(() => {
    safeSetStorageItem(
      'qa_archived_runs',
      JSON.stringify(archivedRuns),
      () => JSON.stringify(archivedRuns.map(r => ({
        ...r,
        bugLogs: (r.bugLogs || []).map(b => (b?.imageUrl && b.imageUrl.startsWith('data:')) ? { ...b, imageUrl: undefined } : b)
      })))
    );
  }, [archivedRuns]);

  useEffect(() => {
    safeSetStorageItem(
      'qa_bug_logs',
      JSON.stringify(bugLogs),
      () => JSON.stringify(bugLogs.map((b, idx) => (idx >= 5 && b?.imageUrl && b.imageUrl.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
    );
  }, [bugLogs]);

  useEffect(() => {
    safeSetStorageItem('qa_populated_devices', JSON.stringify(populatedDevices));
  }, [populatedDevices]);

  useEffect(() => {
    safeSetStorageItem('qa_populated_features', JSON.stringify(populatedFeatures));
  }, [populatedFeatures]);

  useEffect(() => {
    safeSetStorageItem('qa_devices_list', JSON.stringify(devices));
  }, [devices]);

  useEffect(() => {
    safeSetStorageItem('qa_testers_list', JSON.stringify(testers));
  }, [testers]);

  // Add device name to populated list if not present
  const handleAddPopulatedDevice = (deviceName: string) => {
    const trimmed = (deviceName || '').trim();
    if (!trimmed) return;
    markUserMutation();
    setPopulatedDevices(prev => {
      if (prev.some(d => d.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, trimmed];
    });
  };

  // Add feature name to populated list if not present
  const handleAddPopulatedFeature = (featureName: string) => {
    const trimmed = (featureName || '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'general' || trimmed.startsWith('__')) return;
    markUserMutation();
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
    markUserMutation();
    const existingIndex = testPlansRef.current.findIndex(p => p.id === savedPlan.id);

    if (existingIndex >= 0) {
      setTestPlans(prev => prev.map(p => p.id === savedPlan.id ? savedPlan : p));
      setTestRuns(prev => prev.map(r => {
        if (r.planId === savedPlan.id && r.planName !== savedPlan.name) {
          const updated = { ...r, planName: savedPlan.name };
          safeSyncTestRun(updated);
          return updated;
        }
        return r;
      }));
      setArchivedRuns(prev => prev.map(r => {
        if (r.planId === savedPlan.id && r.planName !== savedPlan.name) {
          const updated = { ...r, planName: savedPlan.name };
          safeSyncArchivedRun(updated);
          return updated;
        }
        return r;
      }));
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
      safeSyncTestRun(newRun);
    }

    setSelectedPlanId(savedPlan.id);
    syncTestPlanToSupabase(savedPlan);

    (savedPlan.steps || []).forEach(step => {
      if (step.feature) {
        handleAddPopulatedFeature(step.feature);
      }
    });

    setEditingPlan(null);
    setCurrentView('dashboard');
  };

  const handleClonePlan = (planId: string) => {
    markUserMutation();
    const target = testPlansRef.current.find(p => p.id === planId);
    if (!target) return;

    const nowMs = Date.now();
    const clonedId = `plan-${nowMs}-${Math.random().toString(36).slice(2, 6)}`;
    const clonedPlan: TestPlan = {
      ...target,
      id: clonedId,
      name: `${target.name} (Copy)`,
      createdAt: new Date().toISOString(),
      steps: (target.steps || []).map((s, idx) => ({
        ...s,
        id: `step-${nowMs}-${idx + 1}`
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
    safeSyncTestRun(newRun);
  };

  const handleLoadSampleData = () => {
    markUserMutation();
    setTestPlans(SAMPLE_PLANS);
    setTestRuns(SAMPLE_RUNS);
    setArchivedRuns([]);
    setBugLogs(SAMPLE_BUG_LOGS);
    if (SAMPLE_PLANS.length > 0) {
      setSelectedPlanId(SAMPLE_PLANS[0].id);
    }
  };

  const handleRunSubagentAutomatedTest = (planId?: string) => {
    markUserMutation();
    let targetPlan = (planId ? testPlansRef.current.find(p => p.id === planId) : null) || testPlansRef.current[0];
    
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
    (targetPlan.steps || []).forEach((step, idx) => {
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
    safeSyncArchivedRun(completedRun);
  };

  const handleClearAllData = () => {
    markUserMutation();
    setTestPlans([]);
    setTestRuns([]);
    setArchivedRuns([]);
    setBugLogs([]);
    setDevices([]);
    setTesters([]);
    setPopulatedFeatures([]);
    setPopulatedDevices([]);
    setSelectedPlanId('');
    try {
      localStorage.removeItem('qa_test_plans');
      localStorage.removeItem('qa_test_runs');
      localStorage.removeItem('qa_archived_runs');
      localStorage.removeItem('qa_bug_logs');
      localStorage.removeItem('qa_devices_list');
      localStorage.removeItem('qa_testers_list');
      localStorage.removeItem('qa_populated_features');
      localStorage.removeItem('qa_populated_devices');
      localStorage.removeItem('qa_selected_plan_id');
      localStorage.removeItem('qa_bug_categorizations');
      localStorage.setItem('qa_prototype_seeded', 'skip');
    } catch (e) {}
  };

  const handleImportJSONData = (data: {
    testPlans?: TestPlan[];
    testRuns?: TestRun[];
    bugLogs?: BugLog[];
    archivedRuns?: TestRun[];
    devices?: DeviceProfile[];
    testers?: TesterProfile[];
    populatedFeatures?: string[];
    populatedDevices?: string[];
  }) => {
    if (!data || typeof data !== 'object') return;
    markUserMutation();
    if (data.testPlans && Array.isArray(data.testPlans)) {
      const validPlans = normalizePlans(data.testPlans);
      setTestPlans(validPlans);
      validPlans.forEach(syncTestPlanToSupabase);
      if (validPlans.length > 0) setSelectedPlanId(validPlans[0].id);
    }
    if (data.testRuns && Array.isArray(data.testRuns)) {
      const validRuns = normalizeRuns(data.testRuns);
      setTestRuns(validRuns);
      validRuns.forEach(safeSyncTestRun);
    }
    if (data.archivedRuns && Array.isArray(data.archivedRuns)) {
      const validArchived = normalizeRuns(data.archivedRuns);
      setArchivedRuns(validArchived);
      validArchived.forEach(safeSyncArchivedRun);
    }
    if (data.bugLogs && Array.isArray(data.bugLogs)) {
      const validBugs = normalizeBugs(data.bugLogs);
      setBugLogs(validBugs);
      validBugs.forEach(syncBugLogToSupabase);
    }
    if (data.devices && Array.isArray(data.devices)) {
      const validDevices = data.devices.filter(d => d && typeof d === 'object' && d.id && d.name);
      setDevices(validDevices);
      safeSetStorageItem('qa_devices_list', JSON.stringify(validDevices));
      validDevices.forEach(syncDeviceToSupabase);
      syncDevicesListToCloud(validDevices);
    }
    if (data.testers && Array.isArray(data.testers)) {
      const validTesters = data.testers.filter(t => t && typeof t === 'object' && t.id && t.name);
      setTesters(validTesters);
      safeSetStorageItem('qa_testers_list', JSON.stringify(validTesters));
      validTesters.forEach(syncTesterToSupabase);
      syncTestersListToCloud(validTesters);
    }
    if (data.populatedFeatures && Array.isArray(data.populatedFeatures)) {
      const validFeatures = data.populatedFeatures.filter(f => typeof f === 'string' && f.trim() !== '');
      setPopulatedFeatures(validFeatures);
      safeSetStorageItem('qa_populated_features', JSON.stringify(validFeatures));
      validFeatures.forEach(syncPopulatedFeatureToSupabase);
    }
    if (data.populatedDevices && Array.isArray(data.populatedDevices)) {
      const validPopDevs = data.populatedDevices.filter(d => typeof d === 'string' && d.trim() !== '');
      setPopulatedDevices(validPopDevs);
      safeSetStorageItem('qa_populated_devices', JSON.stringify(validPopDevs));
    }
  };

  // Local prototype only: seed an offline sandbox from a read-only snapshot file.
  // Runs only when Supabase is NOT configured and VITE_PROTOTYPE_SEED_URL is set, so the live app never does this.
  useEffect(() => {
    const seedUrl = ((import.meta as any).env?.VITE_PROTOTYPE_SEED_URL || '') as string;
    if (!seedUrl || isSupabaseConfigured) return;
    const seededVal = localStorage.getItem('qa_prototype_seeded');
    if (seededVal === seedUrl || seededVal === 'skip') return;
    fetch(seedUrl)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        handleImportJSONData(data);
        localStorage.setItem('qa_prototype_seeded', seedUrl);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeletePlan = (planId: string) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();

    const runsToRemove = testRunsRef.current.filter(r => r.planId === planId);
    const removedRunIds = new Set(runsToRemove.map(r => r.id));
    runsToRemove.forEach(r => safeDeleteTestRun(r.id));

    let nextPlansSnapshot: TestPlan[] = [];
    setTestPlans(prev => {
      const filtered = prev.filter(p => p.id !== planId);
      nextPlansSnapshot = filtered;
      return filtered;
    });
    setTestRuns(prev => prev.filter(r => r.planId !== planId));
    deleteTestPlanFromSupabase(planId);

    try {
      localStorage.removeItem(`qa_in_progress_run_${planId}`);
    } catch (e) {}

    // Strip deleted planId from device quotas and release any device locked by a run of this plan
    setDevices(prev => {
      let changed = false;
      const next = prev.map(d => {
        const hadQuota = (d.quotas || []).some(q => q.planId === planId);
        const hadRunLock = Boolean(d.activeRunId && removedRunIds.has(d.activeRunId));
        if (hadQuota || hadRunLock) {
          changed = true;
          const updatedDev: DeviceProfile = {
            ...d,
            quotas: (d.quotas || []).filter(q => q.planId !== planId),
            activeRunId: hadRunLock ? undefined : d.activeRunId,
            activeTesterName: hadRunLock ? undefined : d.activeTesterName
          };
          syncDeviceToSupabase(updatedDev);
          return updatedDev;
        }
        return d;
      });
      if (changed) {
        safeSetStorageItem('qa_devices_list', JSON.stringify(next));
        syncDevicesListToCloud(next);
      }
      return next;
    });
    
    const remainingPlans = nextPlansSnapshot.length > 0 ? nextPlansSnapshot : testPlansRef.current.filter(p => p.id !== planId);
    if (currentView === 'mobile' && (selectedPlanId === planId || remainingPlans.length === 0)) {
      setCurrentView('dashboard');
    }

    if (selectedPlanId === planId) {
      setSelectedPlanId(remainingPlans[0]?.id || '');
    }
  };

  // keepBugs: used when an in_progress run is superseded (tester switched device/plan).
  // The run row is still removed so nothing stays stuck active, but its bugs are preserved.
  const handleDeleteTestRun = (runId: string, options?: { keepBugs?: boolean }) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    const deletedRun = [...testRunsRef.current, ...archivedRunsRef.current].find(r => r.id === runId);

    setTestRuns(prev => prev.filter(r => r.id !== runId));
    setArchivedRuns(prev => prev.filter(r => r.id !== runId));

    safeDeleteTestRun(runId);
    safeDeleteArchivedRun(runId);
    markTestRunDeleted(runId);
    if (deletedRun?.planId) {
      try {
        const raw = localStorage.getItem(`qa_in_progress_run_${deletedRun.planId}`);
        if (raw && JSON.parse(raw)?.id === runId) {
          localStorage.removeItem(`qa_in_progress_run_${deletedRun.planId}`);
        }
      } catch (e) {}
    }

    // Cascade delete associated bug logs from state and Supabase (explicit deletes only)
    if (!options?.keepBugs) {
      setBugLogs(prev => {
        const { remaining, toDelete } = filterBugsAfterRunDelete(prev, runId, deletedRun, options);
        toDelete.forEach(b => deleteBugLogFromSupabase(b.id));
        return remaining;
      });
    }

    // Release device if locked by this deleted run
    setDevices(prev => {
      let changed = false;
      const next = prev.map(d => {
        const matchesRunId = d.activeRunId === runId;
        const matchesTesterAndDev = Boolean(
          deletedRun &&
          deletedRun.testerName &&
          d.activeTesterName &&
          d.activeTesterName.toLowerCase().trim() === deletedRun.testerName.toLowerCase().trim() &&
          deletedRun.deviceName &&
          d.name &&
          d.name.toLowerCase().trim() === deletedRun.deviceName.toLowerCase().trim()
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
        safeSetStorageItem('qa_devices_list', JSON.stringify(next));
        syncDevicesListToCloud(next);
      }
      return next;
    });
  };

  // Minimum required app version configured by admin (takes latest marker)
  const minAppVersion = React.useMemo(() => {
    const matching = populatedFeatures.filter(
      f => typeof f === 'string' && f.startsWith(CONFIG_MIN_APP_VERSION + ':')
    );
    for (let i = matching.length - 1; i >= 0; i--) {
      const val = parseInt(matching[i].split(':')[1], 10);
      if (!isNaN(val) && val > 0) return val;
    }
    return APP_VERSION_CODE;
  }, [populatedFeatures]);

  const handleUpdateMinAppVersion = (versionCode: number) => {
    markUserMutation();
    const configKey = `${CONFIG_MIN_APP_VERSION}:${versionCode}`;
    const superseded = populatedFeaturesRef.current.filter(
      f => typeof f === 'string' && f.startsWith(CONFIG_MIN_APP_VERSION + ':') && f !== configKey
    );
    superseded.forEach(oldKey => deletePopulatedFeatureFromSupabase(oldKey));

    setPopulatedFeatures(prev => {
      const filtered = prev.filter(f => typeof f === 'string' && !f.startsWith(CONFIG_MIN_APP_VERSION + ':'));
      const next = [...filtered, configKey];
      safeSetStorageItem('qa_populated_features', JSON.stringify(next));
      return next;
    });
    syncPopulatedFeatureToSupabase(configKey);
  };

  // Daily Quota Reset: Clear all assigned test plans on devices to fresh slate
  const handleResetDailyQuotas = () => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    const todayStr = getLocalDateStr();

    // Terminate any active in-progress runs so they don't re-lock devices on the next poll
    setTestRuns(prev => prev.map(r => {
      if (r.status === 'in_progress') {
        const terminated = { ...r, status: 'terminated' as any };
        safeSyncTestRun(terminated);
        return terminated;
      }
      return r;
    }));
    clearLocalDailySessionCache();

    setDevices(prev => {
      const next = prev.map(d => ({
        ...d,
        quotas: [],
        isReady: true,
        activeRunId: undefined,
        activeTesterName: undefined
      }));
      safeSetStorageItem('qa_devices_list', JSON.stringify(next));
      safeSetStorageItem('qa_last_quota_reset_date', todayStr);
      syncDevicesListToCloud(next);
      return next;
    });

    const configKey = `${CONFIG_DAILY_RESET_DATE}:${todayStr}`;
    populatedFeaturesRef.current.forEach(f => {
      if (typeof f === 'string' && f.startsWith(`${CONFIG_DAILY_RESET_DATE}:`) && f !== configKey) {
        deletePopulatedFeatureFromSupabase(f);
      }
    });
    syncPopulatedFeatureToSupabase(configKey);
  };

  // Remote Boot Tester: kicks active user on phone, wipes ONLY active in-progress cache, frees device lock
  const handleBootTester = (runId: string, deviceId?: string, testerName?: string, deviceName?: string) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
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
    // Strip colons inside fields so split(':') in MobileTester never shifts field positions
    const safeField = (s: string) => s.replace(/:/g, ' ').toLowerCase().trim();
    const bootFeatureKey = `__BOOT__:${safeField(trimmedTester)}:${safeField(trimmedDevId)}:${(runId || '').replace(/:/g, '')}:${safeField(trimmedDevName)}:${Date.now()}`;
    syncPopulatedFeatureToSupabase(bootFeatureKey);
    setPopulatedFeatures(prev => [...prev.filter(f => typeof f === 'string' && !f.startsWith('__BOOT__')), bootFeatureKey]);
    setTimeout(async () => {
      try {
        await deletePopulatedFeatureFromSupabase(bootFeatureKey);
        setPopulatedFeatures(prev => prev.filter(f => f !== bootFeatureKey));
      } catch (e) {}
    }, 10000);

    // 3. Mark ONLY the booted run as 'terminated' in state & Supabase.
    // When a runId is given, terminate exactly that run. Without a runId, fall back to the
    // tester's live in_progress run on that device (tester AND device must both match).
    // Never sweep up the tester's other runs or other runs on the same device.
    setTestRuns(prev => {
      let matchedAny = false;
      const next = prev.map(r => {
        if (r.status === 'completed' || (r.status as any) === 'terminated') return r;
        let isTarget = false;
        if (runId) {
          isTarget = r.id === runId;
        } else if (r.status === 'in_progress') {
          const matchesTester = Boolean(trimmedTester && r.testerName && r.testerName.toLowerCase().trim() === trimmedTester.toLowerCase());
          const matchesDev = Boolean(trimmedDevName && r.deviceName && r.deviceName.toLowerCase().trim() === trimmedDevName.toLowerCase());
          const matchesId = Boolean(trimmedDevId && r.deviceId && r.deviceId.toLowerCase().trim() === trimmedDevId.toLowerCase());
          isTarget = matchesTester && (matchesId || matchesDev || (!trimmedDevId && !trimmedDevName));
        }
        if (isTarget) {
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

    // 4. Free device lock using exact matching (keep readiness intact)
    setDevices(prev => {
      let changed = false;
      const next = prev.map(d => {
        const matchesDevId = Boolean(trimmedDevId && d.id.toLowerCase().trim() === trimmedDevId.toLowerCase());
        const matchesDevName = Boolean(trimmedDevName && d.name.toLowerCase().trim() === trimmedDevName.toLowerCase());
        const matchesRunId = Boolean(runId && d.activeRunId === runId);
        // Only fall back to tester-name matching when no run/device was identified
        const matchesTester = Boolean(!runId && !trimmedDevId && !trimmedDevName && trimmedTester && d.activeTesterName && d.activeTesterName.toLowerCase().trim() === trimmedTester.toLowerCase());
        if (matchesDevId || matchesDevName || matchesRunId || matchesTester) {
          changed = true;
          const released = {
            ...d,
            activeRunId: undefined,
            activeTesterName: undefined,
          };
          syncDeviceToSupabase(released);
          return released;
        }
        return d;
      });
      if (changed) {
        safeSetStorageItem('qa_devices_list', JSON.stringify(next));
        syncDevicesListToCloud(next);
      }
      return next;
    });
  };

  const handleDeleteTester = (testerName: string) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    const normTarget = (testerName || '').toLowerCase().trim();
    const runsToDelete = [...testRunsRef.current, ...archivedRunsRef.current].filter(
      r => (r.testerName?.trim() || 'Unassigned Tester').toLowerCase() === normTarget
    );

    const idsToDelete = new Set(runsToDelete.map(r => r.id));

    setTestRuns(prev => prev.filter(r => !idsToDelete.has(r.id)));
    setArchivedRuns(prev => prev.filter(r => !idsToDelete.has(r.id)));

    runsToDelete.forEach(r => {
      safeDeleteTestRun(r.id);
      safeDeleteArchivedRun(r.id);
    });

    // Also delete matching tester profile(s) from testers list & Supabase
    setTesters(prev => {
      const matchingProfiles = prev.filter(t => t.name.toLowerCase().trim() === normTarget);
      if (matchingProfiles.length === 0) return prev;
      matchingProfiles.forEach(t => deleteTesterFromSupabase(t.id));
      const next = prev.filter(t => t.name.toLowerCase().trim() !== normTarget);
      safeSetStorageItem('qa_testers_list', JSON.stringify(next));
      syncTestersListToCloud(next);
      return next;
    });

    // Also delete bugs belonging to those deleted runs or tester
    setBugLogs(prev => {
      const toDelete = prev.filter(
        b => (b.testRunId && idsToDelete.has(b.testRunId)) || (b.testerName && b.testerName.toLowerCase().trim() === normTarget)
      );
      toDelete.forEach(b => deleteBugLogFromSupabase(b.id));
      return prev.filter(
        b => !(b.testRunId && idsToDelete.has(b.testRunId)) && !(b.testerName && b.testerName.toLowerCase().trim() === normTarget)
      );
    });

    // Release any device locks held by this tester or their runs
    setDevices(prev => {
      let changed = false;
      const next = prev.map(d => {
        const matchesRun = Boolean(d.activeRunId && idsToDelete.has(d.activeRunId));
        const matchesTester = Boolean(d.activeTesterName && d.activeTesterName.toLowerCase().trim() === normTarget);
        if (matchesRun || matchesTester) {
          changed = true;
          const released = { ...d, activeRunId: undefined, activeTesterName: undefined };
          syncDeviceToSupabase(released);
          return released;
        }
        return d;
      });
      if (changed) {
        safeSetStorageItem('qa_devices_list', JSON.stringify(next));
        syncDevicesListToCloud(next);
      }
      return next;
    });
  };

  const handleResetActiveDay = (dateStr: string) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    const resetRunIds = new Set<string>();

    // 1. Reset matching testRuns (only delete steps whose own timestamp is on dateStr, or fallback to runDate if step has no timestamp)
    setTestRuns(prevRuns =>
      prevRuns.map(run => {
        const runDate = run.completedAt
          ? getLocalDateStr(run.completedAt)
          : (run.startedAt ? getLocalDateStr(run.startedAt) : '');

        const updatedResults = { ...run.results };
        let modified = false;
        (Object.entries(updatedResults) as [string, any][]).forEach(([stepId, res]) => {
          if (stepId === '_meta') return;
          const stepDate = res && res.timestamp ? getLocalDateStr(res.timestamp) : runDate;
          if (stepDate === dateStr) {
            delete updatedResults[stepId];
            modified = true;
          }
        });

        const updatedBugs = (run.bugLogs || []).filter(b => {
          const bugDate = b.timestamp ? getLocalDateStr(b.timestamp) : runDate;
          return bugDate !== dateStr;
        });
        if ((run.bugLogs || []).length !== updatedBugs.length) {
          modified = true;
        }

        if (modified || runDate === dateStr) {
          resetRunIds.add(run.id);
          const remainingKeys = Object.keys(updatedResults).filter(k => k !== '_meta').length;
          const updated: TestRun = {
            ...run,
            results: updatedResults,
            bugLogs: updatedBugs,
            currentStepIndex: 0,
            status: (remainingKeys === 0 ? 'not_started' : 'in_progress') as TestRun['status'],
            completedAt: remainingKeys === 0 ? undefined : run.completedAt
          };
          safeSyncTestRun(updated);
          return updated;
        }
        return run;
      })
    );

    // 2. Reset or delete matching archivedRuns from state and Supabase
    setArchivedRuns(prevRuns => {
      const remainingRuns: TestRun[] = [];
      prevRuns.forEach(run => {
        const runDate = run.completedAt
          ? getLocalDateStr(run.completedAt)
          : (run.startedAt ? getLocalDateStr(run.startedAt) : '');

        const updatedResults = { ...run.results };
        let modified = false;
        (Object.entries(updatedResults) as [string, any][]).forEach(([stepId, res]) => {
          if (stepId === '_meta') return;
          const stepDate = res && res.timestamp ? getLocalDateStr(res.timestamp) : runDate;
          if (stepDate === dateStr) {
            delete updatedResults[stepId];
            modified = true;
          }
        });

        const updatedBugs = (run.bugLogs || []).filter(b => {
          const bugDate = b.timestamp ? getLocalDateStr(b.timestamp) : runDate;
          return bugDate !== dateStr;
        });
        if ((run.bugLogs || []).length !== updatedBugs.length) {
          modified = true;
        }

        const remainingKeys = Object.keys(updatedResults).filter(k => k !== '_meta').length;
        // If no steps and no bugs remain, delete the archived run completely
        if (remainingKeys === 0 && updatedBugs.length === 0) {
          resetRunIds.add(run.id);
          safeDeleteArchivedRun(run.id);
        } else if (modified) {
          const updated: TestRun = {
            ...run,
            results: updatedResults,
            bugLogs: updatedBugs,
            status: (remainingKeys === 0 ? 'not_started' : run.status) as TestRun['status']
          };
          safeSyncArchivedRun(updated);
          remainingRuns.push(updated);
        } else {
          remainingRuns.push(run);
        }
      });
      return remainingRuns;
    });

    // 3. Delete matching bugLogs for this day from state and Supabase
    setBugLogs(prevBugs => {
      const toKeep: BugLog[] = [];
      const toDelete: BugLog[] = [];
      prevBugs.forEach(b => {
        const bugDate = b.timestamp ? getLocalDateStr(b.timestamp) : '';
        if (bugDate === dateStr) {
          toDelete.push(b);
        } else {
          toKeep.push(b);
        }
      });
      toDelete.forEach(b => deleteBugLogFromSupabase(b.id));
      return toKeep;
    });

    // 4. If resetting today, clear local in-progress cache and unlock affected devices
    if (dateStr === getLocalDateStr()) {
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('qa_in_progress_run_')) localStorage.removeItem(k);
        });
      } catch (e) {}

      setDevices(prev => {
        let changed = false;
        const next = prev.map(d => {
          if (d.activeRunId || d.activeTesterName) {
            changed = true;
            const released = { ...d, activeRunId: undefined, activeTesterName: undefined };
            syncDeviceToSupabase(released);
            return released;
          }
          return d;
        });
        if (changed) {
          safeSetStorageItem('qa_devices_list', JSON.stringify(next));
          syncDevicesListToCloud(next);
        }
        return next;
      });
    }
  };

  const handleDeleteBug = (bugId: string) => {
    markUserMutation();
    const target = bugLogs.find(b => b.id === bugId);
    const bundleId = target?.bundle?.id;
    if (bundleId) {
      const survivors = bugLogs.filter(b => b.id !== bugId && b.bundle?.id === bundleId);
      if (survivors.length < 2) {
        survivors.forEach(s => handlePatchBugLog(s.id, { bundle: undefined }));
      } else {
        const latest = survivors.reduce((acc, s) => (String(s.bundle!.at) > String(acc.at) ? s.bundle! : acc), survivors[0].bundle!);
        const rawMemberIds = Array.isArray(latest?.memberIds) ? latest.memberIds : survivors.map(s => s.id);
        const filteredMemberIds = rawMemberIds.filter(id => id !== bugId && survivors.some(s => s.id === id));
        const nextBundle = {
          ...latest,
          memberIds: filteredMemberIds.length >= 2 ? filteredMemberIds : survivors.map(s => s.id),
          at: new Date().toISOString(),
        };
        handlePatchBugLogs(Object.fromEntries(survivors.map(s => [s.id, { bundle: nextBundle }])));
      }
    }
    setBugLogs(prev => {
      const next = prev.filter(b => b.id !== bugId);
      safeSetStorageItem(
        'qa_bug_logs',
        JSON.stringify(next),
        () => JSON.stringify(next.map((b, idx) => (idx >= 5 && b?.imageUrl?.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
      );
      return next;
    });
    deleteBugLogFromSupabase(bugId);

    setTestRuns(prev => prev.map(r => {
      const hasBug = (r.bugLogs || []).some(b => b.id === bugId);
      const updated = { ...r, bugLogs: (r.bugLogs || []).filter(b => b.id !== bugId) };
      if (hasBug) safeSyncTestRun(updated);
      return updated;
    }));

    setArchivedRuns(prev => prev.map(r => {
      const hasBug = (r.bugLogs || []).some(b => b.id === bugId);
      const updated = { ...r, bugLogs: (r.bugLogs || []).filter(b => b.id !== bugId) };
      if (hasBug) safeSyncArchivedRun(updated);
      return updated;
    }));
  };

  const handleUpdateBugLog = (updatedBugsInput: BugLog | BugLog[]) => {
    markUserMutation();
    const updates = Array.isArray(updatedBugsInput) ? updatedBugsInput : [updatedBugsInput];
    if (updates.length === 0) return;
    const updateMap = new Map<string, BugLog>();
    updates.forEach(b => {
      if (b && b.id) updateMap.set(b.id, b);
    });
    // Worker-owned fields (filed, filePending, bundle, reproMatches, refined) always come from the CURRENT
    // copy: a caller holding a slightly stale bug (e.g. a Bugs Feed edit seconds after RX95 confirmed a
    // filing) must never roll them back. They change only through the patch handlers below.
    const merge = (cur: BugLog): BugLog => {
      const u = updateMap.get(cur.id);
      if (!u) return cur;
      return { ...u, filed: cur.filed, filePending: cur.filePending, bundle: cur.bundle, reproMatches: cur.reproMatches, refined: cur.refined, reviewed: cur.reviewed };
    };

    setBugLogs(prev => {
      const next = prev.map(merge);
      safeSetStorageItem(
        'qa_bug_logs',
        JSON.stringify(next),
        () => JSON.stringify(next.map((b, idx) => (idx >= 5 && b?.imageUrl?.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
      );
      return next;
    });

    setTestRuns(prev => prev.map(r => {
      if (!(r.bugLogs || []).some(b => updateMap.has(b.id))) return r;
      const updated = { ...r, bugLogs: (r.bugLogs || []).map(b => (b ? merge(b) : b)) };
      safeSyncTestRun(updated);
      return updated;
    }));

    setArchivedRuns(prev => prev.map(r => {
      if (!(r.bugLogs || []).some(b => updateMap.has(b.id))) return r;
      const updated = { ...r, bugLogs: (r.bugLogs || []).map(b => (b ? merge(b) : b)) };
      safeSyncArchivedRun(updated);
      return updated;
    }));

    updates.forEach(b => {
      if (b && b.id) safeSyncBugLog(b);
    });
  };

  // Bugs already sent to Supabase with a given refinement (StrictMode runs state updaters twice).
  const refinedSyncedRef = useRef<Set<string>>(new Set());

  /**
   * Apply RX95 refinements at the source of truth: sets ONLY `refined` on bugs whose CURRENT
   * text still matches the refinement's sig, so a reply that arrives after the bug was edited
   * (e.g. in Bugs Feed while the request was in flight) can never overwrite the edit.
   */
  const handleApplyBugRefinements = (refinements: Record<string, RefinedBugText>) => {
    if (!refinements || Object.keys(refinements).length === 0) return;
    const applyTo = (b: BugLog): BugLog => {
      const r = b && refinements[b.id];
      if (!r || bugTextSig(b) !== r.sig) return b;
      if (b.refined && b.refined.sig === r.sig && b.refined.at === r.at) return b;
      return { ...b, refined: r };
    };
    markUserMutation();

    setBugLogs(prev => {
      let changed = false;
      const next = prev.map(b => { const u = applyTo(b); if (u !== b) changed = true; return u; });
      if (!changed) return prev;
      safeSetStorageItem(
        'qa_bug_logs',
        JSON.stringify(next),
        () => JSON.stringify(next.map((b, idx) => (idx >= 5 && b?.imageUrl?.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
      );
      next.forEach((b, i) => {
        if (b === prev[i] || !b.refined) return;
        const key = `${b.id}|${b.refined.sig}|${b.refined.at}`;
        if (refinedSyncedRef.current.has(key)) return;
        refinedSyncedRef.current.add(key);
        safePatchBugColumns(b, ['refined']);
      });
      return next;
    });

    setTestRuns(prev => prev.map(r => {
      const logs = r.bugLogs || [];
      const nextLogs = logs.map(applyTo);
      if (nextLogs.every((b, i) => b === logs[i])) return r;
      const updated = { ...r, bugLogs: nextLogs };
      safeSyncTestRun(updated);
      return updated;
    }));

    setArchivedRuns(prev => prev.map(r => {
      const logs = r.bugLogs || [];
      const nextLogs = logs.map(applyTo);
      if (nextLogs.every((b, i) => b === logs[i])) return r;
      const updated = { ...r, bugLogs: nextLogs };
      safeSyncArchivedRun(updated);
      return updated;
    }));
  };

  /**
   * Applies `applyTo` to every copy of each bug (bugLogs, test runs, archived runs) inside the
   * functional state updates, so it always works on the CURRENT bug, never a stale copy. Changed
   * bugs are persisted and synced like handleUpdateBugLog (bug sync deduped per call because
   * StrictMode runs state updaters twice).
   */
  const patchSyncedRef = useRef<Set<string>>(new Set());
  const applyBugTransform = (applyTo: (b: BugLog) => BugLog) => {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    markUserMutation();
    setBugLogs(prev => {
      let changed = false;
      const next = prev.map(b => { const u = b ? applyTo(b) : b; if (u !== b) changed = true; return u; });
      if (!changed) return prev;
      safeSetStorageItem(
        'qa_bug_logs',
        JSON.stringify(next),
        () => JSON.stringify(next.map((b, idx) => (idx >= 5 && b?.imageUrl?.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
      );
      next.forEach((b, i) => {
        if (b === prev[i]) return;
        const key = `${token}|${b.id}`;
        if (patchSyncedRef.current.has(key)) return;
        patchSyncedRef.current.add(key);
        const before = prev[i] || ({} as BugLog);
        const workerChanged = (['refined', 'reproMatches', 'filed', 'filePending', 'bundle', 'reviewed'] as const)
          .filter(f => JSON.stringify(before[f] ?? null) !== JSON.stringify(b[f] ?? null));
        const strip = (x: BugLog) => ({ ...x, refined: undefined, reproMatches: undefined, filed: undefined, filePending: undefined, bundle: undefined, reviewed: undefined });
        // Base fields (status, title, ...) go through the general upsert; worker-owned columns only via a targeted write.
        if (JSON.stringify(strip(before)) !== JSON.stringify(strip(b))) safeSyncBugLog(b);
        if (workerChanged.length) safePatchBugColumns(b, [...workerChanged]);
      });
      return next;
    });
    const mapRuns = <R extends { bugLogs?: BugLog[] }>(r: R, sync: (r: R) => void): R => {
      const logs = r.bugLogs || [];
      const nextLogs = logs.map(b => (b ? applyTo(b) : b));
      if (nextLogs.every((b, i) => b === logs[i])) return r;
      const updated = { ...r, bugLogs: nextLogs };
      sync(updated);
      return updated;
    };
    setTestRuns(prev => prev.map(r => mapRuns(r, safeSyncTestRun)));
    setArchivedRuns(prev => prev.map(r => mapRuns(r, safeSyncArchivedRun)));
  };

  /** Merge `patch` into the CURRENT copy of one bug (e.g. the Filed stamp, status). */
  const handlePatchBugLog = (bugId: string, patch: Partial<BugLog>) => {
    if (!bugId || !patch) return;
    applyBugTransform(b => (b.id === bugId ? { ...b, ...patch, id: b.id } : b));
  };

  /** Merge a patch into the CURRENT copy of several bugs at once (bundles, filing a mega bug). */
  const handlePatchBugLogs = (patches: Record<string, Partial<BugLog>>) => {
    if (!patches || Object.keys(patches).length === 0) return;
    applyBugTransform(b => (patches[b.id] ? { ...b, ...patches[b.id], id: b.id } : b));
  };

  /** RX95 repro matches: sets ONLY `reproMatches`, and only while the bug's text still matches `sig`. */
  const handleApplyReproMatches = (matches: Record<string, ReproMatches>) => {
    if (!matches || Object.keys(matches).length === 0) return;
    applyBugTransform(b => {
      const m = matches[b.id];
      if (!m || bugTextSig(b) !== m.sig) return b;
      if (b.reproMatches && b.reproMatches.sig === m.sig && b.reproMatches.at === m.at) return b;
      return { ...b, reproMatches: m };
    });
  };

  const handleWipeAllBugs = () => {
    markUserMutation();
    const wipedAt = Date.now();
    setBugLogs([]);
    bugLogsRef.current = [];
    safeSetStorageItem('qa_bug_logs', '[]');
    safeSetStorageItem('qa_bugs_wiped_at', String(wipedAt));

    wipeAllBugsFromSupabase();

    setTestRuns(prev => prev.map(r => {
      if (!r.bugLogs || r.bugLogs.length === 0) return r;
      const updated = { ...r, bugLogs: [] };
      safeSyncTestRun(updated);
      return updated;
    }));

    setArchivedRuns(prev => prev.map(r => {
      if (!r.bugLogs || r.bugLogs.length === 0) return r;
      const updated = { ...r, bugLogs: [] };
      safeSyncArchivedRun(updated);
      return updated;
    }));
  };

  const handleUpdateRun = (updatedRun: TestRun) => {
    markUserMutation();
    if (updatedRun.deviceName) {
      handleAddPopulatedDevice(updatedRun.deviceName);
    }

    // Filter out non-step entries like _meta or pending placeholders to get accurate completed step count
    const stepResultsEntries = Object.entries(updatedRun.results || {}).filter(
      ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
    );
    // Run is only done when explicitly marked 'completed' at the final step and has actual step data recorded
    const isDone = updatedRun.status === 'completed' && stepResultsEntries.length > 0;

    // Respect global bug wipe timestamp so stale phone bug arrays don't resurrect wiped bugs
    const localWipedAtStr = localStorage.getItem('qa_bugs_wiped_at');
    const localWipedAt = localWipedAtStr ? parseInt(localWipedAtStr, 10) : 0;
    const isBugValidAfterWipe = (b: BugLog) => {
      if (!b || !b.id) return false;
      if (localWipedAt > 0 && b.timestamp) {
        const bTs = new Date(b.timestamp).getTime();
        if (bTs > 0 && bTs <= localWipedAt) return false;
      }
      return true;
    };

    // Collect all bugs known for this run ID from bugLogs state and localStorage
    const existingRunBugs = (bugLogsRef.current || []).filter(b => b.testRunId === updatedRun.id && isBugValidAfterWipe(b));
    let storedBugs: BugLog[] = [];
    try {
      const raw = localStorage.getItem('qa_bug_logs');
      if (raw) storedBugs = normalizeBugs(JSON.parse(raw));
    } catch (e) {}
    const storedRunBugs = storedBugs.filter(b => b.testRunId === updatedRun.id && isBugValidAfterWipe(b));

    const bugMap = new Map<string, BugLog>();
    (updatedRun.bugLogs || []).filter(isBugValidAfterWipe).forEach(b => bugMap.set(b.id, b));
    existingRunBugs.forEach(b => bugMap.set(b.id, b));
    storedRunBugs.forEach(b => bugMap.set(b.id, b));
    const fullBugLogs = Array.from(bugMap.values());

    if (fullBugLogs.length > 0) {
      setBugLogs(prev => {
        const m = new Map(prev.map(b => [b.id, b]));
        fullBugLogs.forEach(b => m.set(b.id, b));
        const combined = Array.from(m.values());
        safeSetStorageItem(
          'qa_bug_logs',
          JSON.stringify(combined),
          () => JSON.stringify(combined.map((b, idx) => (idx >= 5 && b?.imageUrl?.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
        );
        return combined;
      });
      fullBugLogs.forEach(b => safeSyncBugLog(b));
    }

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
        bugLogs: fullBugLogs,
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

      // Release device lock using exact matching: if test is finished, device is no longer in use
      setDevices(prev => {
        let changed = false;
        const next = prev.map(d => {
          const matchesId = d.activeRunId === completedRun.id || Boolean(completedRun.deviceId && d.id.toLowerCase().trim() === completedRun.deviceId.toLowerCase().trim());
          const matchesName = Boolean(completedRun.deviceName && d.name.toLowerCase().trim() === completedRun.deviceName.toLowerCase().trim());
          if (matchesId || matchesName) {
            changed = true;
            const released = { ...d, activeRunId: undefined, activeTesterName: undefined };
            syncDeviceToSupabase(released);
            return released;
          }
          return d;
        });
        if (changed) {
          safeSetStorageItem('qa_devices_list', JSON.stringify(next));
          safeSyncDevices(next);
        }
        return next;
      });
    } else {
      // Guard against resurrecting a run that is already archived/completed, deleted, or terminated
      const alreadyArchived = archivedRunsRef.current.some(r => r.id === updatedRun.id);
      const alreadyTerminated = testRunsRef.current.some(r => r.id === updatedRun.id && (r.status as any) === 'terminated');
      if (alreadyArchived || isTestRunDeleted(updatedRun.id) || (alreadyTerminated && updatedRun.status === 'in_progress')) {
        if (alreadyArchived && updatedRun.status === 'completed') {
          setArchivedRuns(prev => prev.map(r => r.id === updatedRun.id ? { ...r, bugLogs: fullBugLogs } : r));
          const existingArchived = archivedRunsRef.current.find(r => r.id === updatedRun.id);
          if (existingArchived) {
            safeSyncArchivedRun({ ...existingArchived, bugLogs: fullBugLogs });
          }
        }
        return;
      }

      // Do not persist or sync an unassigned, 0-step, 0-bug fallback placeholder run
      if (
        updatedRun.status === 'not_started' &&
        stepResultsEntries.length === 0 &&
        fullBugLogs.length === 0 &&
        !updatedRun.testerName
      ) {
        return;
      }

      const runWithBugs: TestRun = {
        ...updatedRun,
        bugLogs: fullBugLogs
      };

      setTestRuns(prev => {
        let base = prev;
        if (runWithBugs.status === 'in_progress') {
          const superseded = prev.filter(r => {
            if (!r || r.id === runWithBugs.id || r.status !== 'in_progress') return false;
            const sameDevId = Boolean(
              r.deviceId &&
              runWithBugs.deviceId &&
              r.deviceId.toLowerCase().trim() === runWithBugs.deviceId.toLowerCase().trim()
            );
            const sameDevName = Boolean(
              r.deviceName &&
              runWithBugs.deviceName &&
              r.deviceName.toLowerCase().trim() === runWithBugs.deviceName.toLowerCase().trim()
            );
            const sameTester = Boolean(
              r.testerName &&
              runWithBugs.testerName &&
              r.testerName.toLowerCase().trim() === runWithBugs.testerName.toLowerCase().trim()
            );
            return sameDevId || sameDevName || sameTester;
          });
          if (superseded.length > 0) {
            const supersededIds = new Set(superseded.map(r => r.id));
            superseded.forEach(r => safeDeleteTestRun(r.id));
            base = prev.filter(r => !supersededIds.has(r.id));
          }
        }
        const exists = base.some(r => r.id === runWithBugs.id);
        if (exists) {
          return base.map(r => r.id === runWithBugs.id ? runWithBugs : r);
        }
        return [runWithBugs, ...base];
      });

      safeSyncTestRun(runWithBugs);
    }
  };

  const handleLogBug = (newBug: BugLog) => {
    markUserMutation();
    if (newBug.deviceName) {
      handleAddPopulatedDevice(newBug.deviceName);
    }
    if (newBug.feature) {
      handleAddPopulatedFeature(newBug.feature);
    }
    // Editing an existing bug (phone): keep the worker-owned fields of the CURRENT copy (see handleUpdateBugLog)
    const keepWorker = (cur: BugLog): BugLog => ({ ...newBug, filed: cur.filed, filePending: cur.filePending, bundle: cur.bundle, reproMatches: cur.reproMatches, refined: cur.refined, reviewed: cur.reviewed });
    setBugLogs(prev => {
      const exists = prev.some(b => b.id === newBug.id);
      const updated = exists ? prev.map(b => b.id === newBug.id ? keepWorker(b) : b) : [newBug, ...prev];
      safeSetStorageItem(
        'qa_bug_logs',
        JSON.stringify(updated),
        () => JSON.stringify(updated.map((b, idx) => (idx >= 5 && b?.imageUrl?.startsWith('data:')) ? { ...b, imageUrl: undefined } : b))
      );
      return updated;
    });

    // Also attach the bug to the corresponding active testRun or archivedRun so it is embedded
    if (newBug.testRunId) {
      const isArchivedOrDeleted = archivedRunsRef.current.some(r => r.id === newBug.testRunId) || isTestRunDeleted(newBug.testRunId);
      if (!isArchivedOrDeleted) {
        setTestRuns(prev => prev.map(r => {
          if (r.id === newBug.testRunId && r.status !== 'completed') {
            const exists = (r.bugLogs || []).some(b => b.id === newBug.id);
            const updatedRun = {
              ...r,
              bugLogs: exists ? (r.bugLogs || []).map(b => b.id === newBug.id ? keepWorker(b) : b) : [...(r.bugLogs || []), newBug]
            };
            safeSyncTestRun(updatedRun);
            return updatedRun;
          }
          return r;
        }));
      }

      setArchivedRuns(prev => prev.map(r => {
        if (r.id === newBug.testRunId) {
          const exists = (r.bugLogs || []).some(b => b.id === newBug.id);
          const updatedRun = {
            ...r,
            bugLogs: exists ? (r.bugLogs || []).map(b => b.id === newBug.id ? keepWorker(b) : b) : [...(r.bugLogs || []), newBug]
          };
          safeSyncArchivedRun(updatedRun);
          return updatedRun;
        }
        return r;
      }));
    }

    safeSyncBugLog(newBug);
  };

  const handleRestartRun = (runIdOrPlanId: string, ownRunId?: string) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    const plan = testPlansRef.current.find(p => p.id === runIdOrPlanId);
    const planId = plan ? plan.id : runIdOrPlanId;

    try {
      localStorage.removeItem(`qa_in_progress_run_${planId}`);
    } catch (e) {}

    // Release device lock if held by ownRunId
    if (ownRunId) {
      setDevices(prev => {
        let changed = false;
        const next = prev.map(d => {
          if (d.activeRunId === ownRunId) {
            changed = true;
            const released = { ...d, activeRunId: undefined, activeTesterName: undefined };
            syncDeviceToSupabase(released);
            return released;
          }
          return d;
        });
        if (changed) {
          safeSetStorageItem('qa_devices_list', JSON.stringify(next));
          safeSyncDevices(next);
        }
        return next;
      });
    }

    setTestRuns(prev => {
      // Only ever close the caller's OWN run, matched by exact run id.
      const oldRun = ownRunId ? prev.find(r => r.id === ownRunId) : undefined;
      if (oldRun) {
        const stepEntries = Object.entries(oldRun.results || {}).filter(
          ([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any) && (v as any).status !== 'pending'
        );
        const hasBugs = oldRun.bugLogs && oldRun.bugLogs.length > 0;
        if (stepEntries.length > 0 || hasBugs) {
          const isFull = isRunFullyCompleted({ ...oldRun, status: 'completed' }, testPlansRef.current);
          const archivedRun: TestRun = {
            ...oldRun,
            status: isFull ? 'completed' : 'terminated',
            completedAt: oldRun.completedAt || new Date().toISOString()
          };
          setArchivedRuns(aPrev => {
            if (aPrev.some(r => r.id === archivedRun.id)) return aPrev;
            return [archivedRun, ...aPrev];
          });
          safeSyncArchivedRun(archivedRun);
        }
        safeDeleteTestRun(oldRun.id);
      }

      // Drop only the caller's own previous run from local state; MobileTester synthesizes a fresh run on session setup.
      return oldRun ? prev.filter(r => r.id !== oldRun.id) : prev;
    });
  };

  const handleSaveDevice = (device: DeviceProfile) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    syncDeviceToSupabase(device);
    setDevices(prev => {
      const exists = prev.some(d => d.id === device.id);
      const next = exists ? prev.map(d => d.id === device.id ? device : d) : [...prev, device];
      safeSetStorageItem('qa_devices_list', JSON.stringify(next));
      syncDevicesListToCloud(next);
      return next;
    });
  };

  const handleDeleteDevice = (deviceId: string) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    const targetDev = devicesRef.current.find(d => d.id === deviceId);
    deleteDeviceFromSupabase(deviceId);
    setDevices(prev => {
      const next = prev.filter(d => d.id !== deviceId);
      safeSetStorageItem('qa_devices_list', JSON.stringify(next));
      syncDevicesListToCloud(next);
      return next;
    });
    if (targetDev?.name) {
      setPopulatedDevices(prev => prev.filter(n => n.toLowerCase().trim() !== targetDev.name.toLowerCase().trim()));
    }
    // Terminate any active in-progress runs on this deleted device
    setTestRuns(prev => prev.map(r => {
      if (r.status === 'in_progress') {
        const matchesId = Boolean(r.deviceId && r.deviceId.toLowerCase().trim() === deviceId.toLowerCase().trim());
        const matchesName = Boolean(targetDev?.name && r.deviceName && r.deviceName.toLowerCase().trim() === targetDev.name.toLowerCase().trim());
        if (matchesId || matchesName) {
          const terminated = { ...r, status: 'terminated' as any };
          safeSyncTestRun(terminated);
          return terminated;
        }
      }
      return r;
    }));
  };

  const handleSaveTester = (tester: TesterProfile) => {
    markUserMutation();
    const normName = (tester.name || '').toLowerCase().trim();
    setTesters(prev => {
      const existingById = prev.find(t => t.id === tester.id);
      const existingByName = !existingById ? prev.find(t => t.name.toLowerCase().trim() === normName) : undefined;
      const targetToUpdate = existingById || existingByName;
      const canonicalTester: TesterProfile = targetToUpdate
        ? { ...targetToUpdate, ...tester, id: targetToUpdate.id, name: tester.name.trim() }
        : { ...tester, name: tester.name.trim() };

      syncTesterToSupabase(canonicalTester);
      const next = targetToUpdate
        ? prev.map(t => t.id === targetToUpdate.id ? canonicalTester : t)
        : [...prev, canonicalTester];
      safeSetStorageItem('qa_testers_list', JSON.stringify(next));
      syncTestersListToCloud(next);
      return next;
    });
  };

  const handleDeleteTesterProfile = (testerId: string) => {
    markUserMutation();
    lastDeviceEditTimeRef.current = Date.now();
    const target = testersRef.current.find(t => t.id === testerId);
    deleteTesterFromSupabase(testerId);
    setTesters(prev => {
      const next = prev.filter(t => t.id !== testerId);
      safeSetStorageItem('qa_testers_list', JSON.stringify(next));
      syncTestersListToCloud(next);
      return next;
    });
    if (target?.name) {
      const normName = target.name.toLowerCase().trim();
      setDevices(prev => {
        let changed = false;
        const next = prev.map(d => {
          if (d.activeTesterName && d.activeTesterName.toLowerCase().trim() === normName) {
            changed = true;
            const released = { ...d, activeRunId: undefined, activeTesterName: undefined };
            syncDeviceToSupabase(released);
            return released;
          }
          return d;
        });
        if (changed) {
          safeSetStorageItem('qa_devices_list', JSON.stringify(next));
          syncDevicesListToCloud(next);
        }
        return next;
      });
    }
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
    const trimmed = (featureName || '').trim();
    if (!trimmed) return;
    markUserMutation();
    const normFeature = trimmed.toLowerCase();

    // Remove from Supabase & local populatedFeatures
    const matchingKeys = populatedFeaturesRef.current.filter(f => typeof f === 'string' && f.toLowerCase().trim() === normFeature);
    if (matchingKeys.length > 0) {
      matchingKeys.forEach(k => deletePopulatedFeatureFromSupabase(k));
    } else {
      deletePopulatedFeatureFromSupabase(trimmed);
    }
    setPopulatedFeatures(prev => prev.filter(f => typeof f === 'string' && f.toLowerCase().trim() !== normFeature));

    // Reset matching step features in plans to 'General' & sync to Supabase
    setTestPlans(prev => prev.map(plan => {
      const hasMatch = (plan.steps || []).some(step => step.feature?.toLowerCase().trim() === normFeature);
      if (!hasMatch) return plan;
      const updatedPlan: TestPlan = {
        ...plan,
        steps: (plan.steps || []).map(step => (step.feature?.toLowerCase().trim() === normFeature) ? { ...step, feature: 'General' } : step)
      };
      syncTestPlanToSupabase(updatedPlan);
      return updatedPlan;
    }));

    // Reset matching feature in bug logs to 'General' & sync to Supabase
    setBugLogs(prev => prev.map(bug => {
      if (bug.feature?.toLowerCase().trim() === normFeature) {
        const updatedBug = { ...bug, feature: 'General' };
        syncBugLogToSupabase(updatedBug);
        return updatedBug;
      }
      return bug;
    }));

    // Reset matching feature in test runs to 'General' & sync to Supabase
    setTestRuns(prev => prev.map(run => {
      let modified = false;
      const nextResults = Object.fromEntries(
        Object.entries(run.results || {}).map(([stepId, res]) => {
          if (res && typeof res === 'object' && (res as any).feature?.toLowerCase().trim() === normFeature) {
            modified = true;
            return [stepId, { ...res, feature: 'General' }];
          }
          return [stepId, res];
        })
      );
      const nextBugs = (run.bugLogs || []).map(bug => {
        if (bug.feature?.toLowerCase().trim() === normFeature) {
          modified = true;
          return { ...bug, feature: 'General' };
        }
        return bug;
      });
      if (!modified) return run;
      const updatedRun = { ...run, results: nextResults, bugLogs: nextBugs };
      safeSyncTestRun(updatedRun);
      return updatedRun;
    }));

    // Reset matching feature in archived runs to 'General' & sync to Supabase
    setArchivedRuns(prev => prev.map(run => {
      let modified = false;
      const nextResults = Object.fromEntries(
        Object.entries(run.results || {}).map(([stepId, res]) => {
          if (res && typeof res === 'object' && (res as any).feature?.toLowerCase().trim() === normFeature) {
            modified = true;
            return [stepId, { ...res, feature: 'General' }];
          }
          return [stepId, res];
        })
      );
      const nextBugs = (run.bugLogs || []).map(bug => {
        if (bug.feature?.toLowerCase().trim() === normFeature) {
          modified = true;
          return { ...bug, feature: 'General' };
        }
        return bug;
      });
      if (!modified) return run;
      const updatedRun = { ...run, results: nextResults, bugLogs: nextBugs };
      safeSyncArchivedRun(updatedRun);
      return updatedRun;
    }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0f19] text-slate-100 relative">
      
      {/* Liquid Ambient Glowing Background Orbs */}
      <div className="liquid-ambient-bg">
        <div className="liquid-orb liquid-orb-1"></div>
        <div className="liquid-orb liquid-orb-2"></div>
        <div className="liquid-orb liquid-orb-3"></div>
      </div>

      {/* Slim Global Header & Data Management Menu */}
      {currentView !== 'mobile' && (
        <Navbar
          currentView={currentView}
          onNavigate={setCurrentView}
          onExportBackup={() =>
            exportAllQADataToJSON(testPlans, testRuns, bugLogs, {
              archivedRuns,
              devices,
              testers,
              populatedFeatures: populatedFeatures.filter(
                f => typeof f === 'string' && f.trim() !== '' && !f.startsWith('__')
              ),
              populatedDevices,
            })
          }
          onImportBackup={handleImportJSONData}
          onClearAllData={handleClearAllData}
        />
      )}

      {/* Main View Router - keep Dashboard mounted so active tabs, filters, and modals never reset */}
      <main className="flex-1 relative z-10">
        <div key="dashboard-view" className={currentView === 'dashboard' ? 'block' : 'hidden'}>
          <Dashboard
            testPlans={testPlans}
            testRuns={testRuns}
            bugLogs={bugLogs}
            populatedFeatures={populatedFeatures.filter(f => typeof f === 'string' && f.trim() !== '' && !f.startsWith('__'))}
            devices={devices}
            testers={testers}
            onSelectPlanToBuild={handleCreatePlanClick}
            onOpenMobileView={handleOpenMobileView}
            onDeletePlan={handleDeletePlan}
            onDeleteBug={handleDeleteBug}
            onUpdateBugLog={handleUpdateBugLog}
            onApplyBugRefinements={handleApplyBugRefinements}
            onPatchBugLog={handlePatchBugLog}
            onPatchBugLogs={handlePatchBugLogs}
            rx95Suggestions={rx95Suggestions}
            onApplyReproMatches={handleApplyReproMatches}
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

        {currentView === 'plan-builder' && (
          <div key="plan-builder-view" className="animate-liquid-fade">
            <PlanBuilder
              key={editingPlan?.id || 'new-plan'}
              initialPlan={editingPlan}
              populatedFeatures={populatedFeatures.filter(f => typeof f === 'string' && f.trim() !== '' && !f.startsWith('__'))}
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
                safeSetStorageItem('qa_selected_plan_id', planId);
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
