import React, { useState, useEffect, useMemo, useRef } from 'react';
import GlassesBuildCapture from './GlassesBuildCapture';
import { TITLE_PREFIX } from '../utils/buganizerDraft';
import { atLocalTime, formatBugTime, normalizeHHMM, toLocalHHMM, withBugTime } from '../utils/bugTime';
import { buildEnvironment, getCurrentGlassesBuild, getPhoneBuildInfo, type GlassesBuild, type PhoneBuildInfo } from '../services/deviceBuilds';
import { createPortal } from 'react-dom';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from '../types';
import { CheckCircle2, Clock, Bug, Smartphone, RefreshCw, Send, Check, Layers, ChevronDown, AlertTriangle, XCircle, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, Undo2, Sparkles, User, Download, Edit3, Trash2, Tag, Image, X, Mic, WifiOff } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import {
  isRunFullyCompleted,
  buildStepFirstSeenIndex,
  getEffectiveRunStatus,
  getAutoReleaseReason,
  getRunAutoReleasedMeta,
  getAutoReleaseMessage,
} from '../utils/runUtils';
import { mergeRunsById } from '../utils/cujReportUtils';
import { getLocalDateStr } from '../utils/dateUtils';
import { APP_VERSION_CODE, APP_VERSION_NAME, APK_DOWNLOAD_URL, formatAppVersionName } from '../constants';
import { BootSignal, subscribeToSystemCommands, isTestRunDeleted } from '../services/supabaseService';

/** Buganizer titles stay readable at ~120 chars. */
const BUG_TITLE_MAX = 120;
const BUG_DESCRIPTION_TEMPLATE = 'Steps to reproduce:\n1. \n2. \n\nExpected:\n\nActual:\n';

interface MobileTesterProps {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  archivedRuns?: TestRun[];
  bugLogs?: BugLog[];
  devices?: DeviceProfile[];
  testers?: TesterProfile[];
  minAppVersion?: number;
  populatedFeatures?: string[];
  lastBootSignal?: BootSignal | null;
  onSaveDevice?: (device: DeviceProfile) => void;
  selectedPlanId: string;
  populatedDevices: string[];
  onAddPopulatedDevice: (device: string) => void;
  onSelectPlan: (planId: string) => void;
  onUpdateRun: (updatedRun: TestRun) => void;
  onDeleteRun?: (runId: string, options?: { keepBugs?: boolean }) => void;
  onLogBug: (bug: BugLog) => void;
  onDeleteBug: (bugId: string) => void;
  onRestartRun: (planId: string, ownRunId?: string) => void;
  onNavigateToDashboard?: () => void;
}

export const MobileTester: React.FC<MobileTesterProps> = ({
  testPlans,
  testRuns,
  archivedRuns = [],
  bugLogs = [],
  devices = [],
  testers = [],
  minAppVersion,
  populatedFeatures = [],
  lastBootSignal,
  onSaveDevice,
  selectedPlanId,
  populatedDevices,
  onAddPopulatedDevice,
  onSelectPlan,
  onUpdateRun,
  onDeleteRun,
  onLogBug,
  onDeleteBug,
  onRestartRun,
  onNavigateToDashboard
}) => {
  // Persistent helper to get stored tester name & device name
  const getStoredTesterName = () => {
    try {
      return localStorage.getItem('qa_tester_name') || sessionStorage.getItem('qa_tester_name') || '';
    } catch (e) {
      return '';
    }
  };

  const getStoredDeviceName = () => {
    try {
      return localStorage.getItem('qa_device_name') || sessionStorage.getItem('qa_device_name') || '';
    } catch (e) {
      return '';
    }
  };

  const [inputReporterName, setInputReporterName] = useState(() => getStoredTesterName());
  const [inputDeviceName, setInputDeviceName] = useState(() => getStoredDeviceName());

  // Persistent Device Identifier for multi-tester isolation
  const getDeviceId = () => {
    try {
      let devId = localStorage.getItem('qa_device_id');
      if (!devId) {
        devId = 'dev-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
        localStorage.setItem('qa_device_id', devId);
      }
      return devId;
    } catch {
      return 'dev-mem-' + Math.random().toString(36).substring(2, 9);
    }
  };

  const [deviceId] = useState(() => getDeviceId());
  const [deletedBugIds, setDeletedBugIds] = useState<string[]>([]);

  const saveInProgressRunLocal = (planId: string | undefined, run: TestRun) => {
    if (!planId) return;
    const key = `qa_in_progress_run_${planId}`;
    try {
      localStorage.setItem(key, JSON.stringify(run));
    } catch {
      try {
        const stripped: TestRun = {
          ...run,
          bugLogs: (run.bugLogs || []).map(b =>
            b.imageUrl && b.imageUrl.startsWith('data:') ? { ...b, imageUrl: undefined } : b
          )
        };
        localStorage.setItem(key, JSON.stringify(stripped));
      } catch {}
    }
  };

  // Match device currently in use by this phone / tester
  const currentSavedDevName = inputDeviceName || getStoredDeviceName();
  const currentDevice = useMemo(() => {
    return devices.find(d => 
      (currentSavedDevName && d.name.toLowerCase().trim() === currentSavedDevName.toLowerCase().trim()) ||
      d.id === currentSavedDevName ||
      d.id === deviceId
    );
  }, [devices, currentSavedDevName, deviceId]);

  const todayStr = useMemo(() => {
    return getLocalDateStr(new Date());
  }, [testRuns, archivedRuns, devices]);

  const mergedRuns = useMemo(() => mergeRunsById(archivedRuns, testRuns), [archivedRuns, testRuns]);
  const stepFirstSeen = useMemo(() => buildStepFirstSeenIndex(mergedRuns), [mergedRuns]);
  const archivedIdSet = useMemo(() => new Set(archivedRuns.map(r => r.id)), [archivedRuns]);

  // Compute completed runs per device and plan for today (deduplicated by run.id using mergeRunsById)
  const todayRunsMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};

    mergedRuns.forEach(run => {
      // Same rule as the dashboard: only runs that recorded every step that existed when they finished count (history-aware, see runUtils).
      if (!run.completedAt || !isRunFullyCompleted(run, testPlans, stepFirstSeen)) return;
      const runDate = getLocalDateStr(run.completedAt);
      if (runDate !== todayStr) return;

      const targetDev = devices.find(dev => 
        (run.deviceId && (dev.id === run.deviceId || dev.id.toLowerCase().trim() === run.deviceId.toLowerCase().trim())) ||
        (run.deviceName && dev.name && dev.name.toLowerCase().trim() === run.deviceName.toLowerCase().trim())
      );
      if (targetDev) {
        if (!map[targetDev.id]) map[targetDev.id] = {};
        map[targetDev.id][run.planId] = (map[targetDev.id][run.planId] || 0) + 1;
      }
    });
    return map;
  }, [mergedRuns, devices, todayStr, testPlans, stepFirstSeen]);

  // "The only test plan that should be available to that Device is the one it has a quota set for"
  // Prefer plans with remaining daily quota today before falling back to exhausted quota plans.
  const availablePlans = useMemo(() => {
    if (!currentDevice || !currentDevice.quotas || currentDevice.quotas.length === 0) {
      return testPlans;
    }
    const activeQuotaPlanIds = new Set(
      currentDevice.quotas.filter(q => q.targetRunsPerDay > 0).map(q => q.planId)
    );
    const remainingQuotaPlanIds = new Set(
      currentDevice.quotas
        .filter(q => {
          if (q.targetRunsPerDay <= 0) return false;
          const doneToday = (todayRunsMap[currentDevice.id] && todayRunsMap[currentDevice.id][q.planId]) || 0;
          return doneToday < q.targetRunsPerDay;
        })
        .map(q => q.planId)
    );
    const remainingPlans = testPlans.filter(p => remainingQuotaPlanIds.has(p.id));
    if (remainingPlans.length > 0) return remainingPlans;
    const allQuotaPlans = testPlans.filter(p => activeQuotaPlanIds.has(p.id));
    return allQuotaPlans.length > 0 ? allQuotaPlans : testPlans;
  }, [testPlans, currentDevice, todayRunsMap]);

  // Current plan strictly resolves to an available plan for this device
  const currentPlan = useMemo(() => {
    if (availablePlans.length === 0) return testPlans[0];
    const match = availablePlans.find(p => p.id === selectedPlanId);
    return match || availablePlans[0];
  }, [availablePlans, selectedPlanId, testPlans]);

  // Synchronize parent selectedPlanId if current device is locked to a specific quota plan
  useEffect(() => {
    if (currentPlan && currentPlan.id !== selectedPlanId) {
      onSelectPlan(currentPlan.id);
    }
  }, [currentPlan?.id, selectedPlanId, onSelectPlan]);

  // Check localStorage for any persistent in-progress run for this plan
  const getAckAutoReleasedIds = (): Set<string> => {
    try {
      const raw = localStorage.getItem('qa_ack_auto_released_runs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed.filter(x => typeof x === 'string'));
      }
    } catch {}
    return new Set();
  };

  const recordPendingAutoReleaseNotice = (runId: string, reason: 'previous-day' | 'idle') => {
    if (!runId) return;
    try {
      const ack = getAckAutoReleasedIds();
      if (ack.has(runId)) return;
      localStorage.setItem(
        'qa_last_auto_released_run',
        JSON.stringify({ runId, reason, at: new Date().toISOString() })
      );
    } catch {}
  };

  let localSavedRunJson: string | null = null;
  let lastSessionSetupDate: string | null = null;
  try {
    lastSessionSetupDate = localStorage.getItem('qa_session_setup_date');
    localSavedRunJson = currentPlan ? localStorage.getItem(`qa_in_progress_run_${currentPlan.id}`) : null;
  } catch {}
  let localSavedRun: TestRun | null = null;
  if (localSavedRunJson) {
    try {
      localSavedRun = JSON.parse(localSavedRunJson);
      const localAutoReason = localSavedRun ? getAutoReleaseReason(localSavedRun) : null;
      if (
        localSavedRun &&
        ((localSavedRun.status as any) !== 'in_progress' ||
          archivedIdSet.has(localSavedRun.id) ||
          isTestRunDeleted(localSavedRun.id) ||
          !localSavedRun.startedAt ||
          getLocalDateStr(localSavedRun.startedAt) !== todayStr ||
          localAutoReason !== null ||
          (lastSessionSetupDate && lastSessionSetupDate !== todayStr))
      ) {
        if (localSavedRun.id && localSavedRun.status === 'in_progress') {
          const reason =
            localAutoReason ||
            (localSavedRun.startedAt && getLocalDateStr(localSavedRun.startedAt) !== todayStr
              ? 'previous-day'
              : null);
          if (reason) recordPendingAutoReleaseNotice(localSavedRun.id, reason);
        }
        try {
          if (currentPlan?.id) localStorage.removeItem(`qa_in_progress_run_${currentPlan.id}`);
        } catch (e) {}
        localSavedRun = null;
      }
    } catch (e) {
      localSavedRun = null;
    }
  }

  // If this local run was terminated, completed, or reset in cloud, or belongs to a different selected device, purge it
  if (localSavedRun) {
    const cloudCopy = testRuns.find(r => r.id === localSavedRun?.id);
    const cloudAutoMeta = getRunAutoReleasedMeta(cloudCopy);
    if (cloudAutoMeta && localSavedRun.id) {
      recordPendingAutoReleaseNotice(localSavedRun.id, cloudAutoMeta.reason);
    }
    const localStepCount = Object.keys(localSavedRun.results || {}).filter(k => k !== '_meta').length;
    const cloudResetToEmpty = Boolean(
      cloudCopy &&
      cloudCopy.status === 'not_started' &&
      Object.keys(cloudCopy.results || {}).filter(k => k !== '_meta').length === 0 &&
      localStepCount > 0
    );
    const isInvalidInCloud = Boolean(
      (cloudCopy && ((cloudCopy.status as any) === 'terminated' || cloudCopy.status === 'completed')) ||
      archivedIdSet.has(localSavedRun.id) ||
      isTestRunDeleted(localSavedRun.id) ||
      cloudResetToEmpty
    );
    const isDifferentDevice = Boolean(
      currentDevice &&
      ((localSavedRun.deviceId &&
        localSavedRun.deviceId.startsWith('dev-') &&
        localSavedRun.deviceId !== deviceId &&
        localSavedRun.deviceId.toLowerCase().trim() !== currentDevice.id.toLowerCase().trim()) ||
        (localSavedRun.deviceName &&
          localSavedRun.deviceName.toLowerCase().trim() !== currentDevice.name.toLowerCase().trim()))
    );
    if (isInvalidInCloud || isDifferentDevice) {
      try {
        if (currentPlan?.id) localStorage.removeItem(`qa_in_progress_run_${currentPlan.id}`);
      } catch (e) {}
      localSavedRun = null;
    }
  }

  // Find active run specifically for THIS device & plan
  let activeRun = testRuns.find(r => 
    r.planId === currentPlan?.id && 
    r.status !== 'completed' &&
    (r.status as any) !== 'terminated' &&
    getAutoReleaseReason(r) === null &&
    !archivedIdSet.has(r.id) &&
    !isTestRunDeleted(r.id) &&
    (!r.startedAt || getLocalDateStr(r.startedAt) === todayStr) &&
    (
      (localSavedRun && r.id === localSavedRun.id) ||
      (currentDevice && (
        (r.deviceId && r.deviceId.toLowerCase().trim() === currentDevice.id.toLowerCase().trim()) ||
        (r.deviceName && r.deviceName.toLowerCase().trim() === currentDevice.name.toLowerCase().trim())
      )) ||
      r.deviceId === deviceId ||
      r.id.includes(deviceId)
    )
  );

  const deletedBugSet = new Set(deletedBugIds);

  // Merge with locally persisted in-progress run so step results are NEVER lost
  if (localSavedRun && localSavedRun.planId === currentPlan?.id) {
    if (!activeRun) {
      activeRun = {
        ...localSavedRun,
        bugLogs: (localSavedRun.bugLogs || []).filter(b => !deletedBugSet.has(b.id))
      };
    } else {
      const mergedBugs = [
        ...(activeRun.bugLogs || []),
        ...(localSavedRun.bugLogs || []).filter(b => !(activeRun?.bugLogs || []).some(existing => existing.id === b.id))
      ].filter(b => !deletedBugSet.has(b.id));
      activeRun = {
        ...activeRun,
        results: {
          ...(activeRun.results || {}),
          ...(localSavedRun.results || {})
        },
        bugLogs: mergedBugs,
        currentStepIndex: localSavedRun.currentStepIndex !== undefined ? localSavedRun.currentStepIndex : activeRun.currentStepIndex
      };
    }
  } else if (activeRun && deletedBugSet.size > 0) {
    activeRun = {
      ...activeRun,
      bugLogs: (activeRun.bugLogs || []).filter(b => !deletedBugSet.has(b.id))
    };
  }

  if (!activeRun && currentPlan) {
    const savedName = getStoredTesterName();
    const savedDevice = currentDevice ? currentDevice.name : getStoredDeviceName();
    const resolvedDevId = currentDevice ? currentDevice.id : deviceId;
    activeRun = {
      id: `run-${currentPlan.id}-${resolvedDevId}`,
      planId: currentPlan.id,
      planName: currentPlan.name,
      deviceId: resolvedDevId,
      testerName: savedName,
      deviceName: savedDevice,
      status: 'not_started',
      currentStepIndex: 0,
      results: {},
      bugLogs: [],
      startedAt: new Date().toISOString()
    };
  }

  // Selectable devices: Ready, not locked by another tester, and has configured daily test quota(s)
  const selectableDevices = useMemo(() => {
    const currentSavedName = getStoredDeviceName() || inputDeviceName || '';
    const myTesterLower = (getStoredTesterName() || inputReporterName || '').toLowerCase().trim();

    return devices.filter(dev => {
      if (!dev.isReady) return false;

      // Lock out if locked by another tester's active, in-progress run (via dev.activeRunId OR live testRuns match)
      const liveRunOnDevice = testRuns.find(r =>
        r &&
        r.id &&
        r.id !== activeRun?.id &&
        !archivedIdSet.has(r.id) &&
        !isTestRunDeleted(r.id) &&
        r.status === 'in_progress' &&
        getEffectiveRunStatus(r, testPlans) === 'in_progress' &&
        (!r.startedAt || getLocalDateStr(r.startedAt) === todayStr) &&
        (
          (dev.activeRunId && r.id === dev.activeRunId) ||
          (r.deviceId && r.deviceId.toLowerCase().trim() === dev.id.toLowerCase().trim()) ||
          (r.deviceName && r.deviceName.toLowerCase().trim() === dev.name.toLowerCase().trim())
        )
      );

      if (liveRunOnDevice) {
        const isSelfDevice = Boolean(
          (currentSavedName &&
            dev.name.toLowerCase().trim() === currentSavedName.toLowerCase().trim() &&
            liveRunOnDevice.deviceId === deviceId) ||
          (myTesterLower &&
            liveRunOnDevice.testerName &&
            liveRunOnDevice.testerName.toLowerCase().trim() === myTesterLower)
        );
        if (!isSelfDevice) {
          return false;
        }
      } else if (dev.activeRunId || dev.activeTesterName) {
        // Respect device lock when the other tester's run hasn't arrived in local testRuns yet,
        // while ignoring stale locks pointing to already-completed, terminated, archived, deleted, or prior-day runs.
        const knownRun = dev.activeRunId
          ? [...testRuns, ...archivedRuns].find(r => r && r.id === dev.activeRunId)
          : undefined;
        const isStaleFinishedLock = Boolean(
          dev.activeRunId && (
            archivedIdSet.has(dev.activeRunId) ||
            isTestRunDeleted(dev.activeRunId) ||
            (knownRun && (
              knownRun.status === 'completed' ||
              knownRun.status === 'terminated' ||
              getEffectiveRunStatus(knownRun, testPlans) === 'completed' ||
              (knownRun.startedAt && getLocalDateStr(knownRun.startedAt) !== todayStr)
            ))
          )
        );
        if (!isStaleFinishedLock) {
          const isSelfLock = Boolean(
            (dev.activeRunId && activeRun?.id && dev.activeRunId === activeRun.id) ||
            (myTesterLower && dev.activeTesterName && dev.activeTesterName.toLowerCase().trim() === myTesterLower) ||
            (currentSavedName &&
              dev.name.toLowerCase().trim() === currentSavedName.toLowerCase().trim() &&
              !dev.activeTesterName)
          );
          if (!isSelfLock) {
            return false;
          }
        }
      }

      // If device has no quotas at all, it cannot run tests
      if (!dev.quotas || dev.quotas.length === 0) {
        return false;
      }

      const activeQuotas = dev.quotas.filter(q => q.targetRunsPerDay > 0);
      if (activeQuotas.length === 0) return false;

      // Device must have at least one plan quota with remaining runs today
      const hasRemaining = activeQuotas.some(q => {
        const doneToday = (todayRunsMap[dev.id] && todayRunsMap[dev.id][q.planId]) || 0;
        return doneToday < q.targetRunsPerDay;
      });

      return hasRemaining;
    });
  }, [devices, todayRunsMap, activeRun?.id, testRuns, archivedIdSet, todayStr, inputDeviceName, inputReporterName, deviceId]);

  const hasValidLiveRun = Boolean(
    activeRun &&
    activeRun.status === 'in_progress' &&
    getEffectiveRunStatus(activeRun, testPlans) === 'in_progress' &&
    getAutoReleaseReason(activeRun) === null &&
    !archivedIdSet.has(activeRun.id) &&
    !isTestRunDeleted(activeRun.id) &&
    activeRun.testerName?.trim() &&
    activeRun.deviceName?.trim() &&
    (!activeRun.startedAt || getLocalDateStr(activeRun.startedAt) === todayStr)
  );

  // Keep tester identity reliably in localStorage and sessionStorage; clear stale device selection & stale in-progress runs on new day
  useEffect(() => {
    const name = getStoredTesterName();
    const dev = getStoredDeviceName();
    try {
      if (name) {
        localStorage.setItem('qa_tester_name', name);
        sessionStorage.setItem('qa_tester_name', name);
      }
      const lastSetupDate = localStorage.getItem('qa_session_setup_date');
      Object.keys(localStorage).forEach(k => {
        if (!k.startsWith('qa_in_progress_run_')) return;
        try {
          const parsed = JSON.parse(localStorage.getItem(k) || 'null');
          const parsedReason = parsed ? getAutoReleaseReason(parsed) : null;
          if (
            !parsed ||
            parsed.status !== 'in_progress' ||
            !parsed.startedAt ||
            getLocalDateStr(parsed.startedAt) !== todayStr ||
            parsedReason !== null ||
            (lastSetupDate && lastSetupDate !== todayStr) ||
            (lastSetupDate !== todayStr && !hasValidLiveRun)
          ) {
            if (parsed && parsed.id && parsed.status === 'in_progress') {
              const r =
                parsedReason ||
                (parsed.startedAt && getLocalDateStr(parsed.startedAt) !== todayStr
                  ? 'previous-day'
                  : null);
              if (r) recordPendingAutoReleaseNotice(parsed.id, r);
            }
            localStorage.removeItem(k);
          }
        } catch {
          localStorage.removeItem(k);
        }
      });
      if (lastSetupDate !== todayStr && !hasValidLiveRun) {
        localStorage.removeItem('qa_device_name');
        sessionStorage.removeItem('qa_device_name');
        setInputDeviceName('');
      } else if (dev) {
        localStorage.setItem('qa_device_name', dev);
        sessionStorage.setItem('qa_device_name', dev);
      }
    } catch {}
  }, [todayStr, hasValidLiveRun]);

  // Active Mobile View Tab: 'plans' (Configured Test Plans) vs 'bugs' (Logged Bugs)
  const [activeMobileTab, setActiveMobileTab] = useState<'plans' | 'bugs'>('plans');

  // Pre-test Session Setup state: always require Setup Modal unless resuming a valid live in-progress run from today
  // Builds of the phone + glasses pair (phone/app versions read natively; glasses firmware scanned from Companion > About)
  const buildEnvRef = useRef<{ phone: PhoneBuildInfo | null; glasses?: GlassesBuild }>({ phone: null, glasses: getCurrentGlassesBuild() });
  useEffect(() => { getPhoneBuildInfo().then(p => { buildEnvRef.current.phone = p; }); }, []);
  const currentBuildEnvironment = () => buildEnvironment(buildEnvRef.current.phone, buildEnvRef.current.glasses ?? getCurrentGlassesBuild());

  const [showSetupModal, setShowSetupModal] = useState<boolean>(() => {
    if (hasValidLiveRun) return false;
    return true;
  });

  // Professional Bottom-Sheet Custom Selectors (replaces raw OS debug menus)
  const [openTesterPickerModal, setOpenTesterPickerModal] = useState<boolean>(false);
  const [openDevicePickerModal, setOpenDevicePickerModal] = useState<boolean>(false);

  // Computed helper for currently selected tester profile
  const selectedTesterProfile = useMemo(() => {
    return testers.find(t => t.name.toLowerCase().trim() === inputReporterName.toLowerCase().trim()) || null;
  }, [testers, inputReporterName]);

  // Computed helper for currently selected device profile
  const selectedDeviceProfile = useMemo(() => {
    return devices.find(d => d.name.toLowerCase().trim() === inputDeviceName.toLowerCase().trim() || d.id === inputDeviceName) || null;
  }, [devices, inputDeviceName]);

  const isDeviceSelectable = useMemo(() => {
    if (!selectedDeviceProfile) return false;
    return selectableDevices.some(d => d.id === selectedDeviceProfile.id);
  }, [selectedDeviceProfile, selectableDevices]);

  const steps = currentPlan?.steps || [];
  const totalSteps = steps.length;

  // Active Step Index State (allows jumping back and forth to inspect and fix mistakes)
  const [activeStepIndex, setActiveStepIndex] = useState<number>(() => {
    return activeRun?.currentStepIndex || 0;
  });

  // Sync active step with activeRun when plan or run changes
  useEffect(() => {
    if (activeRun && typeof activeRun.currentStepIndex === 'number') {
      const clamped = Math.min(activeRun.currentStepIndex, Math.max(0, totalSteps - 1));
      setActiveStepIndex(clamped);
    }
  }, [activeRun?.id, currentPlan?.id]);

  const currentStepIndex = Math.min(activeStepIndex, Math.max(0, totalSteps - 1));
  const currentStep = steps[currentStepIndex];

  // Smooth horizontal scroll ref for keeping active step centered
  const stepRowRef = useRef<HTMLDivElement | null>(null);
  const activeStepRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const container = stepRowRef.current;
    const activeEl = activeStepRef.current;
    if (container && activeEl) {
      const rafId = requestAnimationFrame(() => {
        const containerWidth = container.clientWidth;
        const elLeft = activeEl.offsetLeft;
        const elWidth = activeEl.offsetWidth;
        const targetLeft = elLeft - (containerWidth / 2) + (elWidth / 2);
        container.scrollTo({
          left: Math.max(0, targetLeft),
          behavior: 'smooth'
        });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [currentStepIndex]);
  
  // Explicit state for completion summary view
  const [completedRunSummary, setCompletedRunSummary] = useState<TestRun | null>(null);

  // Enforce Setup Modal whenever not in a valid live run or viewing the completion summary,
  // and clear any pre-selected device whose daily quota is exhausted or not selectable.
  useEffect(() => {
    if (completedRunSummary) return;
    if (!hasValidLiveRun) {
      if (!showSetupModal) {
        setShowSetupModal(true);
      }
      if (devices.length > 0 && inputDeviceName && !isDeviceSelectable) {
        try {
          localStorage.removeItem('qa_device_name');
          sessionStorage.removeItem('qa_device_name');
        } catch {}
        setInputDeviceName('');
      }
    }
  }, [completedRunSummary, hasValidLiveRun, showSetupModal, devices.length, inputDeviceName, isDeviceSelectable]);

  // Active run completion state (strictly gated to this session or explicitly completed activeRun)
  const isCompleted = completedRunSummary !== null;
  const activeOrSummaryCompleted = completedRunSummary;

  // Dynamically compute active bugs for current plan/run
  const activeBugs = useMemo(() => {
    const deletedSet = new Set(deletedBugIds);
    const rawRunBugs = ((activeOrSummaryCompleted || activeRun)?.bugLogs || []).filter(b => !deletedSet.has(b.id));
    if (rawRunBugs.length > 0) {
      if (bugLogs && bugLogs.length > 0) {
        const validIds = new Set(bugLogs.map(b => b.id));
        return rawRunBugs.filter(b => validIds.has(b.id));
      }
      return rawRunBugs;
    }
    // Fallback to global bugLogs matching this plan or run
    if (bugLogs && bugLogs.length > 0) {
      return bugLogs.filter(
        b => !deletedSet.has(b.id) && (b.planId === currentPlan?.id || (activeRun && b.testRunId === activeRun.id))
      );
    }
    return [];
  }, [bugLogs, activeOrSummaryCompleted, activeRun?.bugLogs, activeRun?.id, currentPlan?.id, deletedBugIds]);

  // Selected Status for current step
  const [selectedStatus, setSelectedStatus] = useState<'green' | 'yellow' | 'red' | null>(null);

  // Whether current step already has a recorded status
  const currentStepResult = currentStep && activeRun?.results?.[currentStep.id];
  const hasExistingResult = Boolean(currentStepResult && currentStepResult.status && currentStepResult.status !== 'pending');

  // Pre-load selectedStatus with recorded result when navigating between steps
  useEffect(() => {
    if (currentStep && activeRun?.results?.[currentStep.id]?.status) {
      const recorded = activeRun.results[currentStep.id].status;
      if (recorded !== 'pending') {
        setSelectedStatus(recorded);
      }
    } else {
      setSelectedStatus(null);
    }
  }, [currentStepIndex, currentStep?.id]);

  // Quit & Release Session Confirmation Modal state
  const [showQuitConfirmModal, setShowQuitConfirmModal] = useState(false);

  const handleQuitAndReleaseSession = () => {
    // 1. Release active lock on target device and tester
    const currentDeviceName = getStoredDeviceName() || activeRun?.deviceName || inputDeviceName;
    const currentTesterName = getStoredTesterName() || activeRun?.testerName || inputReporterName;

    if (onSaveDevice) {
      devices.forEach(d => {
        const matchesName = currentDeviceName && d.name.toLowerCase().trim() === currentDeviceName.toLowerCase().trim();
        const matchesRunId = activeRun && d.activeRunId === activeRun.id;
        const matchesDeviceId = (activeRun?.deviceId && d.id === activeRun.deviceId) || (d.id === deviceId);
        const matchesTester = currentTesterName && d.activeTesterName && d.activeTesterName.toLowerCase().trim() === currentTesterName.toLowerCase().trim();

        if (matchesName || matchesRunId || matchesDeviceId || matchesTester) {
          onSaveDevice({
            ...d,
            activeRunId: undefined,
            activeTesterName: undefined
          });
        }
      });
    }

    // 2. Delete ONLY this device/tester's active uncompleted run session to restore test quota
    const runsToDelete = testRuns.filter(r => 
      r.status !== 'completed' && (
        (activeRun && r.id === activeRun.id) ||
        (deviceId && r.deviceId === deviceId) ||
        (currentTesterName && r.testerName && r.testerName.toLowerCase().trim() === currentTesterName.toLowerCase().trim()) ||
        (currentDeviceName && r.deviceName && r.deviceName.toLowerCase().trim() === currentDeviceName.toLowerCase().trim())
      )
    );

    if (onDeleteRun) {
      if (activeRun?.id) onDeleteRun(activeRun.id);
      runsToDelete.forEach(r => {
        if (r.id !== activeRun?.id) onDeleteRun(r.id);
      });
    }

    // 3. Delete any bugs logged during this in-progress session
    if (onDeleteBug) {
      if (activeRun?.bugLogs && activeRun.bugLogs.length > 0) {
        activeRun.bugLogs.forEach(b => {
          if (b.id) onDeleteBug(b.id);
        });
      }
      if (bugLogs && bugLogs.length > 0 && activeRun?.id) {
        const matchingBugs = bugLogs.filter(b => b.testRunId === activeRun.id);
        matchingBugs.forEach(b => onDeleteBug(b.id));
      }
    }

    // 4. Remove all in-progress run caches from localStorage
    try {
      if (currentPlan) {
        localStorage.removeItem(`qa_in_progress_run_${currentPlan.id}`);
      }
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('qa_in_progress_run_') || k.startsWith('qa_active_run_'))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}

    // 5. Clear session & local storage & reset setup state
    try {
      sessionStorage.removeItem('qa_tester_name');
      sessionStorage.removeItem('qa_device_name');
      localStorage.removeItem('qa_tester_name');
      localStorage.removeItem('qa_device_name');
    } catch {}
    setInputReporterName('');
    setInputDeviceName('');
    setActiveStepIndex(0);
    setSelectedStatus(null);
    setCompletedRunSummary(null);
    setShowQuitConfirmModal(false);

    // 6. Return to setup screen
    setShowSetupModal(true);
  };

  // Bug Modal state
  const [showBugModal, setShowBugModal] = useState(false);
  const [editingBug, setEditingBug] = useState<BugLog | null>(null);
  const [bugTitle, setBugTitle] = useState('');
  const [bugNote, setBugNote] = useState('');
  const [showBuganizerPreview, setShowBuganizerPreview] = useState(false);
  const [bugSeverity, setBugSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  // Time of day the bug happened ("HH:MM", same day). Defaults to now for new bugs.
  const [bugTime, setBugTime] = useState('');
  // New bugs only: true once the tester picks a time. Until then the bug is logged at the real
  // save time, so the clock ticking past a minute while typing never counts as an adjustment.
  const [bugTimeTouched, setBugTimeTouched] = useState(false);
  const [bugSuccessMessage, setBugSuccessMessage] = useState<string | null>(null);
  const [isListeningSpeech, setIsListeningSpeech] = useState(false);
  const speechRecognitionRef = useRef<any>(null);
  const speechStartingRef = useRef<boolean>(false);

  const stopSpeechRecognition = () => {
    speechStartingRef.current = false;
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) {}
      speechRecognitionRef.current = null;
    }
    setIsListeningSpeech(false);
  };

  useEffect(() => {
    return () => {
      stopSpeechRecognition();
    };
  }, []);

  const closeBugModal = () => {
    stopSpeechRecognition();
    setEditingBug(null);
    setBugTitle('');
    setShowBuganizerPreview(false);
    setBugNote('');
    setBugSeverity('medium');
    setShowBugModal(false);
  };

  useEffect(() => {
    if (!showBugModal || editingBug || bugTimeTouched) return;
    const tick = () => setBugTime(prev => {
      const nowHHMM = toLocalHHMM(new Date().toISOString());
      return prev === nowHHMM ? prev : nowHHMM;
    });
    const id = window.setInterval(tick, 10000);
    return () => window.clearInterval(id);
  }, [showBugModal, editingBug, bugTimeTouched]);

  const openNewBugModal = () => {
    stopSpeechRecognition();
    setEditingBug(null);
    setBugTitle('');
    setShowBuganizerPreview(false);
    setBugNote('');
    setBugSeverity('medium');
    setBugTime(toLocalHHMM(new Date().toISOString()));
    setBugTimeTouched(false);
    setShowBugModal(true);
  };

  const handleStartEditBug = (bug: BugLog) => {
    stopSpeechRecognition();
    setEditingBug(bug);
    setBugTitle(bug.title || '');
    setShowBuganizerPreview(false);
    // Older bugs have no separate title; their note is the description
    setBugNote(bug.title && bug.note === bug.title ? '' : bug.note);
    setBugSeverity(bug.severity || 'medium');
    setBugTime(toLocalHHMM(bug.timestamp));
    setBugTimeTouched(false);
    setShowBugModal(true);
  };

  // Toggle Speech-to-Text for Voice Bug Notes
  const toggleSpeechRecognition = () => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      alert('Speech recognition is not available in this browser environment. You can type your note directly.');
      return;
    }

    if (isListeningSpeech || speechStartingRef.current) {
      stopSpeechRecognition();
      return;
    }

    try {
      speechStartingRef.current = true;
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        speechStartingRef.current = false;
        setIsListeningSpeech(true);
        triggerHaptic('light');
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setBugNote(prev => (prev ? `${prev.trim()} ${transcript}` : transcript));
          triggerHaptic('light');
        }
      };

      recognition.onerror = (err: any) => {
        console.warn('Speech recognition error:', err);
        speechStartingRef.current = false;
        setIsListeningSpeech(false);
      };

      recognition.onend = () => {
        speechStartingRef.current = false;
        setIsListeningSpeech(false);
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('Speech recognition start error:', err);
      speechStartingRef.current = false;
      setIsListeningSpeech(false);
    }
  };


  // Save Setup Session Info
  const handleSaveSessionSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputReporterName.trim() || !inputDeviceName.trim() || !activeRun) return;
    if (!selectedDeviceProfile || !isDeviceSelectable) return;

    // Resolve target plan with remaining quota on selectedDeviceProfile
    const activeQuotas = (selectedDeviceProfile.quotas || []).filter(q => q.targetRunsPerDay > 0);
    const remainingQuotas = activeQuotas.filter(q => {
      const doneToday = (todayRunsMap[selectedDeviceProfile.id] && todayRunsMap[selectedDeviceProfile.id][q.planId]) || 0;
      return doneToday < q.targetRunsPerDay;
    });
    if (remainingQuotas.length === 0) return;

    const matchingCurrentQuota = remainingQuotas.find(q => q.planId === currentPlan?.id);
    const targetPlanId = matchingCurrentQuota ? matchingCurrentQuota.planId : remainingQuotas[0].planId;
    const targetPlan = testPlans.find(p => p.id === targetPlanId) || currentPlan;
    if (!targetPlan) return;
    if (targetPlan.id !== selectedPlanId) {
      onSelectPlan(targetPlan.id);
    }

    const trimmedReporter = inputReporterName.trim();
    const deviceIdToSave = selectedDeviceProfile.id;
    const deviceNameToSave = selectedDeviceProfile.name;
    const testerNameToSave = selectedTesterProfile ? selectedTesterProfile.name : trimmedReporter;
    const prevSavedDevice = getStoredDeviceName();

    // Unlock any device previously locked by this session if selecting a new device
    devices.forEach(d => {
      const isPrevDev = prevSavedDevice && d.name.toLowerCase().trim() === prevSavedDevice.toLowerCase().trim();
      const isLockedByThisRun = d.activeRunId === activeRun.id;
      const isNewDev = d.id === deviceIdToSave || d.name.toLowerCase().trim() === deviceNameToSave.toLowerCase().trim();

      if ((isPrevDev || isLockedByThisRun) && !isNewDev) {
        if (onSaveDevice) {
          onSaveDevice({
            ...d,
            activeRunId: undefined,
            activeTesterName: undefined
          });
        }
      }
    });

    // Store in both localStorage and sessionStorage so tester identity and today's setup date are persisted
    try {
      sessionStorage.setItem('qa_tester_name', testerNameToSave);
      sessionStorage.setItem('qa_device_name', deviceNameToSave);
      localStorage.setItem('qa_tester_name', testerNameToSave);
      localStorage.setItem('qa_device_name', deviceNameToSave);
      localStorage.setItem('qa_session_setup_date', todayStr);
    } catch {}

    onAddPopulatedDevice(deviceNameToSave);

    const isSameDevice = Boolean(
      activeRun.deviceId === deviceIdToSave &&
      activeRun.deviceName &&
      activeRun.deviceName.toLowerCase().trim() === deviceNameToSave.toLowerCase().trim()
    );
    const isSamePlan = activeRun.planId === targetPlan.id;
    const isSameTester = Boolean(
      activeRun.testerName &&
      activeRun.testerName.toLowerCase().trim() === testerNameToSave.toLowerCase().trim()
    );
    const isFromToday = Boolean(activeRun.startedAt && getLocalDateStr(activeRun.startedAt) === todayStr);

    const isBrandNew =
      !activeRun ||
      activeRun.status !== 'in_progress' ||
      Object.keys(activeRun.results || {}).length === 0 ||
      !isSameDevice ||
      !isSamePlan ||
      !isSameTester ||
      !isFromToday ||
      archivedIdSet.has(activeRun.id) ||
      isTestRunDeleted(activeRun.id);

    const baseNewId = `run-${targetPlan.id}-${deviceIdToSave}-${Date.now().toString(36)}`;
    const mintedId = isBrandNew
      ? (baseNewId === activeRun.id ? `${baseNewId}${Math.random().toString(36).slice(2, 5)}` : baseNewId)
      : activeRun.id;

    if (isBrandNew) {
      const prevTesterLower = (getStoredTesterName() || '').toLowerCase().trim();
      const newTesterLower = testerNameToSave.toLowerCase().trim();
      const prevDevLower = (prevSavedDevice || '').toLowerCase().trim();
      const newDevLower = deviceNameToSave.toLowerCase().trim();
      const newDevIdLower = deviceIdToSave.toLowerCase().trim();

      const runsToSupersede = new Map<string, TestRun>();
      if (activeRun.id && activeRun.id !== mintedId && activeRun.status === 'in_progress' && !archivedIdSet.has(activeRun.id)) {
        runsToSupersede.set(activeRun.id, activeRun);
      }
      testRuns.forEach(r => {
        if (!r || !r.id || r.id === mintedId || r.status !== 'in_progress' || archivedIdSet.has(r.id)) return;
        const rTester = (r.testerName || '').toLowerCase().trim();
        const rDevName = (r.deviceName || '').toLowerCase().trim();
        const rDevId = (r.deviceId || '').toLowerCase().trim();
        const matchesTester = Boolean(rTester && (rTester === newTesterLower || (prevTesterLower && rTester === prevTesterLower)));
        const matchesDevice = Boolean(
          (rDevId && rDevId === newDevIdLower) ||
          (rDevName && (rDevName === newDevLower || (prevDevLower && rDevName === prevDevLower)))
        );
        if (matchesTester || matchesDevice) {
          runsToSupersede.set(r.id, r);
        }
      });

      runsToSupersede.forEach(oldRun => {
        try {
          if (oldRun.planId) localStorage.removeItem(`qa_in_progress_run_${oldRun.planId}`);
        } catch {}
        if (onDeleteRun) {
          // Superseding (device/plan switch) must never delete the tester's logged bugs.
          onDeleteRun(oldRun.id, { keepBugs: true });
        }
      });

      if (activeRun.planId && activeRun.planId !== targetPlan.id) {
        try {
          localStorage.removeItem(`qa_in_progress_run_${activeRun.planId}`);
        } catch {}
      }
    }

    const updatedRun: TestRun = {
      ...activeRun,
      id: mintedId,
      planId: targetPlan.id,
      planName: targetPlan.name,
      deviceId: deviceIdToSave,
      testerName: testerNameToSave,
      deviceName: deviceNameToSave,
      status: 'in_progress',
      currentStepIndex: isBrandNew ? 0 : (activeRun.currentStepIndex || 0),
      results: isBrandNew ? {} : (activeRun.results || {}),
      bugLogs: isBrandNew ? [] : (activeRun.bugLogs || []),
      startedAt: isBrandNew ? new Date().toISOString() : (activeRun.startedAt || new Date().toISOString()),
      completedAt: undefined,
      durationMs: isBrandNew ? undefined : activeRun.durationMs,
      environment: currentBuildEnvironment() || activeRun.environment
    };

    if (isBrandNew) {
      setActiveStepIndex(0);
      setSelectedStatus(null);
    }

    // Save in-progress run to localStorage immediately
    saveInProgressRunLocal(targetPlan.id, updatedRun);

    // Sync in-progress run to state & Supabase immediately so dashboard reflects it
    onUpdateRun(updatedRun);

    // Lock newly chosen device
    if (onSaveDevice) {
      onSaveDevice({
        ...selectedDeviceProfile,
        activeRunId: updatedRun.id,
        activeTesterName: testerNameToSave
      });
    }

    setCompletedRunSummary(null);
    triggerHaptic('light');
    setShowSetupModal(false);
  };

  // Highest step index unlocked in this session (includes currentStepIndex and any step after a recorded step)
  const maxUnlockedStepIndex = useMemo(() => {
    let maxIdx = currentStepIndex;
    steps.forEach((s, idx) => {
      const st = activeRun?.results?.[s.id]?.status;
      if (st && st !== 'pending') {
        const nextUnlocked = Math.min( Math.max(0, totalSteps - 1), idx + 1 );
        if (nextUnlocked > maxIdx) maxIdx = nextUnlocked;
      }
    });
    return maxIdx;
  }, [steps, activeRun?.results, currentStepIndex, totalSteps]);

  // Navigate to previous step (to inspect or correct a mistake)
  const handlePreviousStep = () => {
    if (currentStepIndex > 0) {
      triggerHaptic('light');
      const prevIndex = currentStepIndex - 1;
      setActiveStepIndex(prevIndex);
      const prevStep = steps[prevIndex];
      const prevStatus = prevStep && activeRun?.results?.[prevStep.id]?.status;
      setSelectedStatus(prevStatus && prevStatus !== 'pending' ? prevStatus : null);
      if (activeRun) {
        const updated = { ...activeRun, currentStepIndex: prevIndex };
        saveInProgressRunLocal(currentPlan?.id, updated);
      }
    }
  };

  // Jump to any unlocked step (backward or forward up to maxUnlockedStepIndex)
  const handleGoToStep = (targetIdx: number) => {
    if (targetIdx >= 0 && targetIdx <= maxUnlockedStepIndex && targetIdx !== currentStepIndex) {
      triggerHaptic('light');
      setActiveStepIndex(targetIdx);
      const targetStep = steps[targetIdx];
      const existingStatus = targetStep && activeRun?.results?.[targetStep.id]?.status;
      setSelectedStatus(existingStatus && existingStatus !== 'pending' ? existingStatus : null);
      if (activeRun) {
        const updated = { ...activeRun, currentStepIndex: targetIdx };
        saveInProgressRunLocal(currentPlan?.id, updated);
      }
    }
  };

  // Current step defects (for reviewing or removing mistaken bugs)
  const currentStepBugs = useMemo(() => {
    if (!currentStep || !activeRun) return [];
    const deletedSet = new Set(deletedBugIds);
    return (activeRun.bugLogs || []).filter(b => b.stepId === currentStep.id && !deletedSet.has(b.id));
  }, [currentStep?.id, activeRun?.bugLogs, deletedBugIds]);

  // Remove a mistake bug from the current step, Bugs tab, or Completion Summary
  const handleDeleteStepBug = (bugId: string) => {
    setDeletedBugIds(prev => (prev.includes(bugId) ? prev : [...prev, bugId]));
    if (onDeleteBug) onDeleteBug(bugId);
    if (completedRunSummary) {
      const updatedSummary: TestRun = {
        ...completedRunSummary,
        bugLogs: (completedRunSummary.bugLogs || []).filter(b => b.id !== bugId)
      };
      setCompletedRunSummary(updatedSummary);
      onUpdateRun(updatedSummary);
    } else if (activeRun) {
      const updatedBugLogs = (activeRun.bugLogs || []).filter(b => b.id !== bugId);
      const updatedRun = { ...activeRun, bugLogs: updatedBugLogs };
      onUpdateRun(updatedRun);
      saveInProgressRunLocal(currentPlan?.id, updatedRun);
    }
    setBugSuccessMessage('Defect removed');
    setTimeout(() => setBugSuccessMessage(null), 3000);
  };

  // Submit Step with Selected Status (or Update Existing Result)
  const handleConfirmStepStatus = () => {
    if (!currentStep || !activeRun || !selectedStatus) return;
    if (showSetupModal || !activeRun.testerName?.trim() || !activeRun.deviceName?.trim()) {
      setShowSetupModal(true);
      return;
    }

    const now = new Date();
    const isoTimestamp = now.toISOString();

    const currentAccumulated = {
      ...(localSavedRun?.results || {}),
      ...(activeRun?.results || {})
    };

    const updatedResults = {
      ...currentAccumulated,
      [currentStep.id]: {
        stepId: currentStep.id,
        status: selectedStatus,
        feature: currentStep.feature || 'General',
        timestamp: isoTimestamp
      }
    };
    // Ensure _meta never pollutes step result keys
    delete (updatedResults as any)._meta;

    const firstUnrecordedIdx = steps.findIndex(s => {
      const r = updatedResults[s.id];
      return !r || !r.status || r.status === 'pending';
    });
    const isLastStep = currentStepIndex >= totalSteps - 1;
    const isDone = isLastStep && firstUnrecordedIdx === -1;
    const nextIndex = isDone
      ? totalSteps
      : isLastStep && firstUnrecordedIdx !== -1
      ? firstUnrecordedIdx
      : currentStepIndex + 1;

    let computedDurationMs: number | undefined = undefined;
    if (isDone) {
      const startMs = activeRun.startedAt ? new Date(activeRun.startedAt).getTime() : 0;
      const endMs = new Date(isoTimestamp).getTime();
      if (startMs > 0 && endMs > startMs) {
        computedDurationMs = endMs - startMs;
      } else {
        const stepTs = Object.values(updatedResults)
          .map(r => r && (r as any).timestamp ? new Date((r as any).timestamp).getTime() : NaN)
          .filter(t => !isNaN(t));
        if (stepTs.length > 0) {
          computedDurationMs = Math.max(1000, Math.max(...stepTs) - Math.min(...stepTs));
        }
      }
    }

    const resolvedDeviceId = currentDevice?.id || activeRun.deviceId;
    const updatedRun: TestRun = {
      ...activeRun,
      planId: currentPlan.id,
      planName: currentPlan.name,
      deviceId: resolvedDeviceId,
      results: updatedResults,
      currentStepIndex: nextIndex,
      status: isDone ? 'completed' : 'in_progress',
      completedAt: isDone ? isoTimestamp : undefined,
      durationMs: isDone ? computedDurationMs : activeRun.durationMs,
      bugLogs: activeRun.bugLogs || []
    };

    if (isDone) {
      triggerHaptic('success');
      setCompletedRunSummary(updatedRun);
      try {
        if (currentPlan) {
          localStorage.removeItem(`qa_in_progress_run_${currentPlan.id}`);
        }
      } catch {}
      const activeDevName = activeRun.deviceName;
      const matchedDev = devices.find(
        d =>
          (resolvedDeviceId && d.id.toLowerCase().trim() === resolvedDeviceId.toLowerCase().trim()) ||
          (activeDevName && d.name.toLowerCase().trim() === activeDevName.toLowerCase().trim()) ||
          d.activeRunId === activeRun.id
      );
      if (matchedDev) {
        if (onSaveDevice) {
          onSaveDevice({
            ...matchedDev,
            activeRunId: undefined,
            activeTesterName: undefined
          });
        }
        const hasAnyQuotaLeftAfter = (matchedDev.quotas || []).some(q => {
          if (q.targetRunsPerDay <= 0) return false;
          const doneBefore = (todayRunsMap[matchedDev.id] && todayRunsMap[matchedDev.id][q.planId]) || 0;
          const doneAfter = q.planId === currentPlan.id ? doneBefore + 1 : doneBefore;
          return doneAfter < q.targetRunsPerDay;
        });
        if (!hasAnyQuotaLeftAfter) {
          try {
            localStorage.removeItem('qa_device_name');
            sessionStorage.removeItem('qa_device_name');
          } catch {}
          setInputDeviceName('');
        }
      }
      setBugSuccessMessage(`🎉 Run complete! ${activeDevName || 'Device'} progress updated for today.`);
      setTimeout(() => setBugSuccessMessage(null), 4000);
    } else {
      triggerHaptic('light');
      saveInProgressRunLocal(currentPlan?.id, updatedRun);
      setActiveStepIndex(nextIndex);
      // Pre-select next step's recorded status if already tested previously
      const nextStepObj = steps[nextIndex];
      const nextSavedStatus = nextStepObj && updatedResults[nextStepObj.id]?.status;
      setSelectedStatus(nextSavedStatus && nextSavedStatus !== 'pending' ? nextSavedStatus : null);
    }

    // Always record step to active in-progress test run so data is NEVER lost
    onUpdateRun(updatedRun);
    setBugSuccessMessage(null);
  };

  const [bootMessage, setBootMessage] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Keyboard Shortcuts listener (1 = Green, 2 = Yellow, 3 = Red, Enter = Confirm, B = Bug, Left = Prev)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (minAppVersion && minAppVersion > APP_VERSION_CODE) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

      const targetEl = e.target as HTMLElement | null;
      const targetTag = targetEl?.tagName || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) || targetEl?.isContentEditable) {
        if (e.key === 'Escape' && showBugModal) {
          closeBugModal();
        }
        return;
      }

      if (previewImageUrl) {
        if (e.key === 'Escape') setPreviewImageUrl(null);
        return;
      }

      if (showBugModal) {
        if (e.key === 'Escape') closeBugModal();
        return;
      }

      if (showQuitConfirmModal) {
        if (e.key === 'Escape') setShowQuitConfirmModal(false);
        return;
      }

      if (openTesterPickerModal) {
        if (e.key === 'Escape') setOpenTesterPickerModal(false);
        return;
      }

      if (openDevicePickerModal) {
        if (e.key === 'Escape') setOpenDevicePickerModal(false);
        return;
      }

      if (bootMessage || showSetupModal || isCompleted || activeMobileTab !== 'plans') return;

      if (e.key === '1') {
        e.preventDefault();
        setSelectedStatus('green');
        triggerHaptic('light');
      } else if (e.key === '2') {
        e.preventDefault();
        setSelectedStatus('yellow');
        triggerHaptic('light');
      } else if (e.key === '3') {
        e.preventDefault();
        setSelectedStatus('red');
        triggerHaptic('light');
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        openNewBugModal();
      } else if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        handlePreviousStep();
      } else if (e.key === 'Enter' && selectedStatus) {
        e.preventDefault();
        handleConfirmStepStatus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    minAppVersion,
    previewImageUrl,
    showBugModal,
    showQuitConfirmModal,
    openTesterPickerModal,
    openDevicePickerModal,
    bootMessage,
    showSetupModal,
    isCompleted,
    activeMobileTab,
    selectedStatus,
    currentStepIndex,
    totalSteps,
    steps,
    activeRun
  ]);

  // Active run and plan tracking for real-time remote boot detection
  const activeRunIdRef = useRef<string | null>(null);
  const activePlanIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!showSetupModal && activeRun && activeRun.status === 'in_progress') {
      activeRunIdRef.current = activeRun.id;
      activePlanIdRef.current = currentPlan?.id || activeRun.planId;
    }
  }, [activeRun?.id, activeRun?.status, showSetupModal, currentPlan?.id]);

  // Terminate active test session immediately (wiping ONLY active in-progress run storage)
  const terminateSession = (reason?: string) => {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('qa_in_progress_run_')) {
          localStorage.removeItem(key);
        }
      });
    } catch (e) {}

    activeRunIdRef.current = null;
    setActiveStepIndex(0);
    setSelectedStatus(null);
    setBootMessage(reason || 'Session Terminated: You have been remotely kicked from this device by the administrator. Device has been released.');
    setShowSetupModal(true);
  };

  // Resilient multi-attribute matching: verifies if a boot signal targets this phone/tester/device
  const checkSignalMatchesThisPhone = (signal: { testerName?: string; deviceName?: string; deviceId?: string; runId?: string; timestamp?: number }) => {
    const sigTester = (signal.testerName || '').toLowerCase().trim();
    const sigDevName = (signal.deviceName || '').toLowerCase().trim();
    const sigDevId = (signal.deviceId || '').toLowerCase().trim();
    const sigRunId = (signal.runId || '').trim();
    const sigTimestamp = signal.timestamp || 0;

    const myTesters = [
      inputReporterName,
      getStoredTesterName(),
      selectedTesterProfile?.name,
      activeRun?.testerName
    ].filter(Boolean).map(t => (t as string).toLowerCase().trim());

    const myDevNames = [
      inputDeviceName,
      getStoredDeviceName(),
      currentDevice?.name,
      activeRun?.deviceName
    ].filter(Boolean).map(d => (d as string).toLowerCase().trim());

    const myDevIds = [
      currentDevice?.id,
      activeRun?.deviceId,
      deviceId
    ].filter(Boolean).map(id => (id as string).toLowerCase().trim());

    const myRunIds = [
      activeRun?.id,
      activeRunIdRef.current
    ].filter(Boolean) as string[];

    // 1. Direct Run ID match (always valid)
    if (sigRunId && myRunIds.some(id => id === sigRunId)) {
      return true;
    }

    // 2. If matching by tester or device without runId, ensure signal is not older than this session's startedAt
    const runStartedAtMs = activeRun?.startedAt ? new Date(activeRun.startedAt).getTime() : 0;
    if (sigTimestamp && runStartedAtMs && sigTimestamp < (runStartedAtMs - 10000)) {
      return false;
    }

    // 3. Exact case-insensitive Device Name match
    const matchesDevName = sigDevName && myDevNames.some(d => d === sigDevName);

    // 4. Exact case-insensitive Device ID match
    const matchesDevId = sigDevId && myDevIds.some(id => id === sigDevId);

    // 5. Exact case-insensitive Tester Name match
    const matchesTester = sigTester && myTesters.some(t => t === sigTester);

    return Boolean(matchesDevName || matchesDevId || matchesTester);
  };

  // Channel 1: Real-time WebSocket broadcast channel subscription (instant sub-second kick)
  useEffect(() => {
    const unsub = subscribeToSystemCommands((signal) => {
      const isRunning = !showSetupModal || (activeRun && activeRun.status === 'in_progress');
      if (!isRunning) return;

      if (checkSignalMatchesThisPhone(signal)) {
        terminateSession('Session Terminated: You have been remotely kicked from this device by the administrator. Device has been released.');
      }
    });

    return () => {
      unsub();
    };
  }, [showSetupModal, inputReporterName, inputDeviceName, currentDevice?.id, currentDevice?.name, deviceId, activeRun?.id, activeRun?.status, activeRun?.testerName, activeRun?.deviceName]);

  // Channel 2: lastBootSignal prop trigger
  useEffect(() => {
    if (!lastBootSignal) return;
    const isRunning = !showSetupModal || (activeRun && activeRun.status === 'in_progress');
    if (!isRunning) return;

    if (checkSignalMatchesThisPhone(lastBootSignal)) {
      terminateSession('Session Terminated: You have been remotely kicked from this device by the administrator. Device has been released.');
    }
  }, [lastBootSignal, showSetupModal, inputReporterName, inputDeviceName, currentDevice?.id, currentDevice?.name, deviceId, activeRun?.id, activeRun?.status, activeRun?.testerName, activeRun?.deviceName]);

  // Channel 3: Populated Features Cloud State Trigger (__BOOT__:<tester>:<devId>:<runId>:<devName>:<timestamp>)
  useEffect(() => {
    if (!populatedFeatures || populatedFeatures.length === 0) return;
    const isRunning = !showSetupModal || (activeRun && activeRun.status === 'in_progress');
    if (!isRunning) return;

    const bootEntries = populatedFeatures.filter(f => f.startsWith('__BOOT__'));
    for (const entry of bootEntries) {
      const parts = entry.split(':');
      const bootTester = parts[1] || '';
      const bootDevId = parts[2] || '';
      const bootRunId = parts[3] || '';
      const rawLast = parts[parts.length - 1] || '';
      const parsedTs = /^\d{10,}$/.test(rawLast) ? parseInt(rawLast, 10) : undefined;
      const bootDevName = parsedTs !== undefined ? parts.slice(4, parts.length - 1).join(':') : parts.slice(4).join(':');

      if (checkSignalMatchesThisPhone({
        testerName: bootTester,
        deviceId: bootDevId,
        runId: bootRunId,
        deviceName: bootDevName,
        timestamp: parsedTs
      })) {
        terminateSession('Session Terminated: You have been remotely kicked from this device by the administrator. Device has been released.');
        break;
      }
    }
  }, [populatedFeatures, showSetupModal, inputReporterName, inputDeviceName, currentDevice?.id, currentDevice?.name, deviceId, activeRun?.id, activeRun?.status, activeRun?.testerName, activeRun?.deviceName]);

  // Channel 4: Device State Changed to Maintenance (isReady === false) or Reassigned
  useEffect(() => {
    if (showSetupModal || !activeRun || activeRun.status !== 'in_progress') return;

    if (currentDevice) {
      if (currentDevice.isReady === false) {
        terminateSession('Session Terminated: This device has been placed in Maintenance mode by the administrator.');
        return;
      }
      const myTester = (inputReporterName || getStoredTesterName()).toLowerCase().trim();
      if (currentDevice.activeTesterName && myTester && currentDevice.activeTesterName.toLowerCase().trim() !== myTester) {
        terminateSession('Session Terminated: This device has been reassigned by the administrator.');
        return;
      }
    }
  }, [currentDevice?.isReady, currentDevice?.activeTesterName, showSetupModal, activeRun?.status, inputReporterName]);

  // Channel 5: Test Run Status Terminated (manual admin boot OR auto-released stuck session)
  useEffect(() => {
    const ackRun = (runId: string) => {
      if (!runId) return;
      try {
        const ack = getAckAutoReleasedIds();
        ack.add(runId);
        localStorage.setItem('qa_ack_auto_released_runs', JSON.stringify(Array.from(ack)));
        localStorage.removeItem('qa_last_auto_released_run');
      } catch {}
    };

    // 1. Check if a pending auto-release notice was recorded when clearing localStorage
    try {
      const pendingRaw = localStorage.getItem('qa_last_auto_released_run');
      if (pendingRaw) {
        const pending = JSON.parse(pendingRaw);
        const ack = getAckAutoReleasedIds();
        if (
          pending &&
          pending.runId &&
          !ack.has(pending.runId) &&
          (pending.reason === 'previous-day' || pending.reason === 'idle')
        ) {
          ackRun(pending.runId);
          terminateSession(getAutoReleaseMessage(pending.reason));
          return;
        }
      }
    } catch {}

    // 2. Check if an auto-released run in testRuns/archivedRuns belongs to this tester/phone and is unacknowledged
    if (!hasValidLiveRun) {
      const ack = getAckAutoReleasedIds();
      const storedTester = (getStoredTesterName() || inputReporterName || '').toLowerCase().trim();
      const storedDev = (getStoredDeviceName() || inputDeviceName || '').toLowerCase().trim();
      const allRuns = [...testRuns, ...archivedRuns];
      const matchingAutoReleased = allRuns.find(r => {
        if (!r || !r.id || r.status !== 'terminated' || ack.has(r.id)) return false;
        const meta = getRunAutoReleasedMeta(r);
        if (!meta) return false;
        if (activeRunIdRef.current && r.id === activeRunIdRef.current) return true;
        const rTester = (r.testerName || '').toLowerCase().trim();
        const rDevName = (r.deviceName || '').toLowerCase().trim();
        const rDevId = (r.deviceId || '').toLowerCase().trim();
        const matchesTester = Boolean(storedTester && rTester && rTester === storedTester);
        const matchesDev = Boolean(
          (storedDev && ((rDevName && rDevName === storedDev) || (rDevId && rDevId === storedDev))) ||
          (deviceId && rDevId === deviceId.toLowerCase().trim())
        );
        if (!matchesTester && !matchesDev) return false;
        if (storedTester && rTester && rTester !== storedTester) return false;
        if (storedDev && rDevName && rDevName !== storedDev && rDevId !== storedDev) return false;

        // Ensure no newer completed or live in-progress run supersedes this auto-released run
        const rStartMs = r.startedAt ? new Date(r.startedAt).getTime() : 0;
        const hasNewerRun = allRuns.some(other => {
          if (!other || other.id === r.id) return false;
          if (other.status !== 'completed' && other.status !== 'in_progress') return false;
          const oTester = (other.testerName || '').toLowerCase().trim();
          const oDev = (other.deviceName || '').toLowerCase().trim();
          if (oTester !== rTester && oDev !== rDevName) return false;
          const oStartMs = other.startedAt ? new Date(other.startedAt).getTime() : 0;
          return oStartMs > rStartMs;
        });
        return !hasNewerRun;
      });

      if (matchingAutoReleased) {
        const meta = getRunAutoReleasedMeta(matchingAutoReleased)!;
        ackRun(matchingAutoReleased.id);
        terminateSession(getAutoReleaseMessage(meta.reason));
        return;
      }
    }

    // 3. Active session terminated while running (admin kick or live auto-release)
    const wasRunning = Boolean(activeRunIdRef.current) || (!showSetupModal && activeRun && activeRun.status === 'in_progress');
    if (!wasRunning) return;

    const terminatedRun = testRuns.find(r => {
      if ((r.status as any) !== 'terminated') return false;
      if (activeRunIdRef.current && r.id === activeRunIdRef.current) return true;
      const termTimestamp = r.completedAt ? new Date(r.completedAt).getTime() : (r.startedAt ? new Date(r.startedAt).getTime() : undefined);
      return checkSignalMatchesThisPhone({
        runId: r.id,
        testerName: r.testerName,
        deviceName: r.deviceName,
        deviceId: r.deviceId,
        timestamp: termTimestamp
      });
    });

    if (terminatedRun) {
      const autoMeta = getRunAutoReleasedMeta(terminatedRun);
      if (autoMeta) {
        ackRun(terminatedRun.id);
        terminateSession(getAutoReleaseMessage(autoMeta.reason));
      } else {
        terminateSession('Session Terminated: You have been remotely kicked from this device by the administrator. Device has been released.');
      }
    }
  }, [testRuns, archivedRuns, hasValidLiveRun, showSetupModal, activeRun?.status, inputReporterName, inputDeviceName, currentDevice?.id, currentDevice?.name, deviceId]);

  // Continuous active monitor while session is in progress (checks every 1s)
  useEffect(() => {
    if (showSetupModal) return;
    const interval = setInterval(() => {
      if (currentDevice && currentDevice.isReady === false && activeRun && activeRun.status === 'in_progress') {
        terminateSession('Session Terminated: This device has been placed in Maintenance mode by the administrator.');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showSetupModal, currentDevice?.isReady, activeRun?.status]);

  // Safe notice if currentPlan is missing
  useEffect(() => {
    if (!currentPlan) {
      setBootMessage('⚠️ Selected Test Plan was removed or is unavailable.');
      setShowSetupModal(true);
    }
  }, [currentPlan]);

  // Submit or Update Bug
  const handleReportBugSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const titleText = bugTitle.replace(/\s+/g, ' ').trim().slice(0, BUG_TITLE_MAX);
    const descriptionText = bugNote.trim();
    if (!titleText) return;
    // `note` stays the free-text field every report/summary reads; fall back to the title if no description
    const noteText = descriptionText || titleText;

    if (editingBug) {
      const updatedBug: BugLog = withBugTime({
        ...editingBug,
        title: titleText,
        note: noteText,
        severity: bugSeverity,
      }, bugTime);

      try {
        onLogBug(updatedBug);
      } catch (err) {
        console.warn('onLogBug error:', err);
      }

      if (completedRunSummary) {
        const updatedSummary: TestRun = {
          ...completedRunSummary,
          bugLogs: (completedRunSummary.bugLogs || []).map(b => b.id === updatedBug.id ? updatedBug : b)
        };
        setCompletedRunSummary(updatedSummary);
        onUpdateRun(updatedSummary);
      } else if (activeRun) {
        const updatedRun: TestRun = {
          ...activeRun,
          bugLogs: (activeRun.bugLogs || []).map(b => b.id === updatedBug.id ? updatedBug : b)
        };
        saveInProgressRunLocal(currentPlan?.id, updatedRun);
        onUpdateRun(updatedRun);
      }

      setBugSuccessMessage('Defect updated successfully');
      closeBugModal();
      return;
    }

    if (!activeRun || !currentPlan) return;

    const now = new Date();
    const normBugTime = normalizeHHMM(bugTime);
    const nowHHMM = toLocalHHMM(now.toISOString());
    // If the tester moved the time back (noted the bug late), keep the real logging time as originalTimestamp.
    // Future times clamp to now and must not set a misleading originalTimestamp.
    const rawPicked = bugTimeTouched && normBugTime && normBugTime !== nowHHMM ? atLocalTime(now.toISOString(), normBugTime) : null;
    const picked = rawPicked && rawPicked.getTime() < now.getTime() && toLocalHHMM(rawPicked.toISOString()) !== nowHHMM ? rawPicked : null;
    const isoTimestamp = (picked || now).toISOString();
    const formattedTime = formatBugTime(picked || now);

    const newBug: BugLog = {
      id: 'bug-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      testRunId: (completedRunSummary || activeRun).id,
      planId: currentPlan.id,
      stepId: currentStep?.id || `step-${Date.now()}`,
      stepTitle: currentStep?.title || `Mobile Defect (${currentPlan.name})`,
      feature: currentStep?.feature || '',
      testerName: (completedRunSummary || activeRun).testerName || 'Tester',
      deviceName: (completedRunSummary || activeRun).deviceName || 'Mobile Device',
      severity: bugSeverity,
      title: titleText,
      note: noteText,
      timestamp: isoTimestamp,
      formattedTime: formattedTime,
      ...(picked ? { originalTimestamp: now.toISOString() } : {}),
      environment: currentBuildEnvironment()
    };

    try {
      onLogBug(newBug);
    } catch (err) {
      console.warn('onLogBug error:', err);
    }

    try {
      const targetRun = completedRunSummary || activeRun;
      const updatedRun: TestRun = {
        ...targetRun,
        bugLogs: [...(targetRun.bugLogs || []), newBug]
      };
      onUpdateRun(updatedRun);
      if (completedRunSummary) {
        setCompletedRunSummary(updatedRun);
      } else {
        saveInProgressRunLocal(currentPlan.id, updatedRun);
      }
    } catch (err) {
      console.warn('save bug error:', err);
    }

    // When a bug is logged on the current step, default the step status away from Pass (Green)
    if (!completedRunSummary && (selectedStatus === null || selectedStatus === 'green')) {
      setSelectedStatus(bugSeverity === 'critical' || bugSeverity === 'high' ? 'red' : 'yellow');
    }

    setBugSuccessMessage(`Bug/Note logged at ${formattedTime}`);
    closeBugModal();
  };

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;

  // Capacitor Android Hardware Back Button listener
  useEffect(() => {
    let sub: any = null;
    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', () => {
        if (previewImageUrl) {
          setPreviewImageUrl(null);
        } else if (showBugModal) {
          closeBugModal();
        } else if (showQuitConfirmModal) {
          setShowQuitConfirmModal(false);
        } else if (openTesterPickerModal) {
          setOpenTesterPickerModal(false);
        } else if (openDevicePickerModal) {
          setOpenDevicePickerModal(false);
        } else if (activeMobileTab === 'bugs') {
          setActiveMobileTab('plans');
        } else if (!showSetupModal && !isCompleted && hasValidLiveRun) {
          // If actively running a test walkthrough, prompt user to Quit & Release to suspend cleanly
          setShowQuitConfirmModal(true);
        } else if (showSetupModal) {
          if (onNavigateToDashboard) onNavigateToDashboard();
        } else if (onNavigateToDashboard) {
          onNavigateToDashboard();
        }
      }).then(s => { sub = s; });
    }).catch(err => {
      console.log('Capacitor App plugin not running in web preview context', err);
    });

    return () => {
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, [previewImageUrl, showBugModal, showQuitConfirmModal, openTesterPickerModal, openDevicePickerModal, activeMobileTab, showSetupModal, isCompleted, hasValidLiveRun, activeRun, onNavigateToDashboard]);

  // Requirement 5: App Version Enforcement Blocker
  if (minAppVersion && minAppVersion > APP_VERSION_CODE) {
    const reqVersionLabel = formatAppVersionName(minAppVersion);
    return (
      <div className="fixed inset-0 z-[999999] bg-slate-950 flex flex-col items-center justify-center p-6 text-center select-none" data-testid="update-required-screen">
        <div className="w-20 h-20 rounded-3xl bg-rose-500/20 border-2 border-rose-500/40 flex items-center justify-center mb-6 shadow-2xl shadow-rose-500/20 animate-pulse">
          <AlertTriangle className="w-10 h-10 text-rose-400" />
        </div>
        <h1 className="text-2xl font-black text-white tracking-tight mb-2">Update Required</h1>
        <p className="text-xs text-slate-300 max-w-xs mb-6 leading-relaxed font-medium">
          Your installed tester build (v{APP_VERSION_NAME}) is outdated. The QA system requires {reqVersionLabel} or higher to continue testing.
        </p>
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 w-full max-w-xs space-y-2 mb-6">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">Current Build:</span>
            <span className="font-mono font-bold text-rose-400">v{APP_VERSION_NAME} (code {APP_VERSION_CODE})</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">Required Build:</span>
            <span className="font-mono font-bold text-emerald-400">{reqVersionLabel}+ (code {minAppVersion})</span>
          </div>
        </div>
        <a
          href={APK_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="update-required-apk-link"
          className="mb-4 px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xs font-bold transition shadow-lg border border-blue-500/50 flex items-center justify-center gap-2 active:scale-95 w-full max-w-xs"
        >
          <Download className="w-4 h-4" />
          <span>Download Latest APK ({reqVersionLabel})</span>
        </a>
        <p className="text-[11px] text-slate-500 max-w-xs">
          Please download and install the latest QA Manager APK to resume testing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black p-0 sm:p-6 select-none font-sans relative">
      
      {/* Back to Dashboard Navigation Button (Desktop mode top banner) */}
      {isDesktop && onNavigateToDashboard && (
        <div className="w-full max-w-sm flex items-center justify-between mb-4 px-2">
          <span className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-zinc-400" /> Mobile Tester Simulator
          </span>
          <button
            type="button"
            onClick={() => {
              if (!showSetupModal && !isCompleted && hasValidLiveRun) {
                setShowQuitConfirmModal(true);
              } else {
                onNavigateToDashboard();
              }
            }}
            className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white rounded-xl text-xs font-bold transition shadow flex items-center gap-1.5 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
          >
            ← Back to Dashboard
          </button>
        </div>
      )}

      {/* Mobile Device Container Frame (Edge-to-edge on phones, framed card on computer) */}
      <div className={isDesktop 
        ? "mobile-device-frame glass-panel text-zinc-100 min-h-[680px] flex flex-col justify-between overflow-hidden shadow-2xl relative border-zinc-800/80 bg-zinc-950 rounded-[44px]"
        : "flex-1 flex flex-col justify-between text-zinc-100 bg-black w-full min-h-screen"
      }>
        
        {/* Top Phone Status Bar */}
        {/* Compact Mobile Header Bar */}
        <div className="bg-zinc-950/90 backdrop-blur-md px-3.5 py-2.5 flex items-center justify-between border-b border-zinc-800/80 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            {onNavigateToDashboard && (
              <button
                type="button"
                onClick={() => {
                  if (!showSetupModal && !isCompleted && hasValidLiveRun) {
                    setShowQuitConfirmModal(true);
                  } else {
                    onNavigateToDashboard();
                  }
                }}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-bold flex items-center gap-1 transition shadow-sm active:scale-95 cursor-pointer flex-shrink-0"
                title="Return to Manager Dashboard"
              >
                <span>← Dashboard</span>
              </button>
            )}
            <div className="flex items-center gap-1.5 min-w-0">
              <Layers className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
              <span className="font-bold text-white text-xs truncate max-w-[160px]" title={currentPlan?.name}>
                {currentPlan?.name || 'No Plan Assigned'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Compact Bug Logs Toggle Button */}
            <button
              type="button"
              onClick={() => setActiveMobileTab(prev => prev === 'bugs' ? 'plans' : 'bugs')}
              className={`px-2.5 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border shadow-sm active:scale-95 cursor-pointer ${
                activeMobileTab === 'bugs'
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-zinc-900 text-zinc-300 hover:text-white border-zinc-800 hover:border-zinc-700'
              }`}
              title={activeMobileTab === 'bugs' ? 'Back to test steps' : 'View logged bugs'}
            >
              <Bug className="w-3.5 h-3.5 text-rose-400" />
              <span>{activeMobileTab === 'bugs' ? 'Steps' : 'Bugs'}</span>
              {activeBugs.length > 0 && (
                <span className="px-1.5 py-0.2 bg-rose-600 text-white text-[10px] font-bold rounded-full">
                  {activeBugs.length}
                </span>
              )}
            </button>

            {/* Compact Quit & Release */}
            {!showSetupModal && !isCompleted && hasValidLiveRun && (
              <button
                type="button"
                onClick={() => setShowQuitConfirmModal(true)}
                className="px-2.5 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-zinc-800 hover:border-rose-500/40 bg-zinc-900 text-zinc-300 hover:text-rose-300 shadow-sm active:scale-95 cursor-pointer"
                title="Quit test session and release device"
              >
                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                <span>Quit</span>
              </button>
            )}
          </div>
        </div>

        {/* Compact Tester & Device Status Strip */}
        <div className="bg-zinc-950/60 backdrop-blur-md border-b border-zinc-800/80 px-3.5 py-1.5 flex items-center justify-between text-[11px] text-zinc-400">
          <div className="flex items-center gap-2 truncate">
            <span className="text-zinc-200 font-medium flex items-center gap-1 truncate">
              <User className="w-3 h-3 text-zinc-400 flex-shrink-0" />
              <span className="truncate">{(completedRunSummary || activeRun)?.testerName || inputReporterName || 'Unassigned'}</span>
            </span>
            <span className="text-zinc-700">•</span>
            <span className="text-zinc-300 font-mono flex items-center gap-1 truncate font-medium">
              <Smartphone className="w-3 h-3 text-zinc-400 flex-shrink-0" />
              <span className="truncate">{(completedRunSummary || activeRun)?.deviceName || inputDeviceName || 'No Device'}</span>
            </span>
          </div>
          {!completedRunSummary && (
            <button
              type="button"
              onClick={() => {
                setCompletedRunSummary(null);
                setShowSetupModal(true);
              }}
              className="text-[10px] text-zinc-300 hover:text-white font-medium flex items-center gap-0.5 ml-2 flex-shrink-0 bg-zinc-900 hover:bg-zinc-800 px-2 py-0.5 rounded-lg border border-zinc-800 transition active:scale-95 cursor-pointer"
            >
              <Edit3 className="w-2.5 h-2.5 text-zinc-400" /> Edit
            </button>
          )}
        </div>

        {/* Content Body */}
        {activeMobileTab === 'bugs' ? (
          <div className="p-5 flex-1 flex flex-col justify-between space-y-4 overflow-y-auto max-h-[580px]">
            
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                  <Bug className="w-4 h-4 text-rose-400" />
                  <span>Logged Defect / Bug Logs</span>
                </h3>
                <p className="text-xs text-zinc-400 font-medium mt-0.5">
                  Plan: {currentPlan?.name || 'All Plans'}
                </p>
              </div>

              <button
                type="button"
                onClick={openNewBugModal}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-md border border-rose-500/30 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Bug className="w-3.5 h-3.5" />
                <span>+ Log Bug</span>
              </button>
            </div>

            {/* Bug List */}
            {activeBugs.length === 0 ? (
              <div className="liquid-glass-card rounded-3xl p-8 text-center space-y-3 flex-1 flex flex-col items-center justify-center border border-zinc-800">
                <div className="p-4 bg-zinc-900 rounded-full border border-zinc-800 text-zinc-500 backdrop-blur-md">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">No Bugs Logged Yet</h4>
                  <p className="text-xs text-zinc-400 mt-1 max-w-xs">
                    Tap "+ Log Bug" above to record any issue found during testing.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto max-h-[480px] pr-1">
                {activeBugs.map((bug, bIdx) => (
                  <div
                    key={bug.id || bIdx}
                    className="liquid-glass-card rounded-2xl p-4 border border-zinc-800 space-y-2.5 shadow-lg bg-zinc-950/80"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {bug.title || bug.stepTitle || bug.feature || 'Bug'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditBug(bug)}
                          className="text-zinc-400 hover:text-sky-400 p-1 rounded-lg transition cursor-pointer"
                          title="Edit Bug"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStepBug(bug.id)}
                          className="text-zinc-400 hover:text-rose-400 p-1 rounded-lg transition cursor-pointer"
                          title="Delete Bug"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs text-zinc-300 font-medium leading-relaxed">
                      {bug.note}
                    </div>

                    {bug.imageUrl && (
                      <div
                        onClick={() => setPreviewImageUrl(bug.imageUrl!)}
                        className="rounded-xl overflow-hidden border border-zinc-800 max-h-40 relative group cursor-pointer"
                      >
                        <img src={bug.imageUrl} alt="Bug screenshot" className="w-full object-cover max-h-40" />
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center transition">
                          <span className="px-3 py-1 bg-zinc-900/90 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5 shadow-lg">
                            <Image className="w-3.5 h-3.5 text-zinc-400" /> Tap to Expand Photo
                          </span>
                        </div>
                      </div>
                    )}

                  </div>
                ))}
              </div>
            )}

          </div>
        ) : testPlans.length === 0 ? (
          <div className="p-6 flex-1 flex flex-col justify-center items-center text-center space-y-4">
            <div className="p-4 bg-zinc-900 rounded-full border border-zinc-800 text-zinc-500 backdrop-blur-md">
              <Layers className="w-8 h-8 text-zinc-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">No Test Plans Available</h3>
              <p className="text-xs text-zinc-400 mt-1 max-w-xs font-medium">
                Create a test plan on the Manager Dashboard to start testing on mobile.
              </p>
            </div>
          </div>
        ) : !isCompleted && currentStep ? (
          <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
            
            {/* Step Walkthrough Header & Interactive Step Chips */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-sky-400 uppercase tracking-wider text-[10px] font-bold">Step Walkthrough</span>
                <span className="font-mono text-zinc-400 text-[11px]">Step {currentStepIndex + 1} of {totalSteps}</span>
              </div>

              {/* Sequential Step Row (Auto-centers active step chip smoothly without choppiness) */}
              <div
                ref={stepRowRef}
                className="flex items-center gap-1.5 overflow-x-auto px-2 py-1 scrollbar-none overscroll-x-contain"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {steps.map((s, idx) => {
                  const sRes = activeRun?.results?.[s.id];
                  const isCurrent = idx === currentStepIndex;
                  const canNavigate = idx <= maxUnlockedStepIndex && !isCurrent;
                  const isDone = sRes && sRes.status && sRes.status !== 'pending';

                  return (
                    <button
                      key={s.id}
                      ref={isCurrent ? activeStepRef : null}
                      type="button"
                      disabled={!canNavigate}
                      onClick={() => {
                        if (canNavigate) handleGoToStep(idx);
                      }}
                      className={`flex items-center justify-center gap-1 min-w-[38px] h-8 px-2.5 rounded-xl text-xs font-bold transition-colors duration-150 flex-shrink-0 border ${
                        isCurrent
                          ? 'bg-zinc-700 text-zinc-100 border-zinc-400 shadow-md ring-1 ring-zinc-400/40'
                          : canNavigate
                          ? isDone
                            ? sRes.status === 'green'
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/40 cursor-pointer'
                              : sRes.status === 'yellow'
                              ? 'bg-amber-950/40 text-amber-300 border-amber-500/40 hover:bg-amber-900/40 cursor-pointer'
                              : 'bg-rose-950/40 text-rose-300 border-rose-500/40 hover:bg-rose-900/40 cursor-pointer'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white cursor-pointer'
                          : 'bg-zinc-900/40 text-zinc-600 border-zinc-900 opacity-40 cursor-not-allowed'
                      }`}
                      title={canNavigate ? `Go to Step ${idx + 1}: ${s.title}` : `Step ${idx + 1}`}
                    >
                      <span>{idx + 1}</span>
                      {isDone && (
                        <span className="text-[11px] leading-none">
                          {sRes.status === 'green' ? '✓' : sRes.status === 'yellow' ? '!' : '✗'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Test Plan Header Pill */}
            <div className="liquid-glass-pill rounded-2xl px-4 py-2 flex items-center justify-between border border-zinc-800">
              <div className="text-xs font-bold text-white truncate max-w-[220px]">{currentPlan?.name}</div>
              <span className="text-[10px] font-mono text-sky-300 font-bold bg-sky-500/20 px-2.5 py-0.5 rounded-lg border border-sky-500/35 shadow-sm">
                {currentStep.feature || 'General'}
              </span>
            </div>

            {/* Current Step Instruction Card (Modern Black & Gray Glass Card) */}
            <div className="liquid-glass-card rounded-3xl p-5 shadow-2xl space-y-4 flex-1 flex flex-col justify-between border border-zinc-800/80 bg-zinc-950/80">
              
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded-xl text-xs font-bold">
                      Step #{currentStepIndex + 1}
                    </span>
                    {currentStepIndex >= totalSteps - 1 && (
                      <span className="px-2.5 py-0.5 bg-amber-500/15 text-amber-300 border border-amber-400/30 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                        🏁 Final Step
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={openNewBugModal}
                    className="text-xs font-bold text-rose-300 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 px-3 py-1.5 rounded-2xl transition-all duration-200 flex items-center gap-1.5 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  >
                    <Bug className="w-3.5 h-3.5 text-rose-400" />
                    <span>Log Bug</span>
                  </button>
                </div>

                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white leading-tight">
                    {currentStep.title}
                  </h4>
                  <p className="text-xs text-zinc-300 leading-relaxed font-normal">
                    {currentStep.description}
                  </p>
                </div>

                {/* Expected Result Box */}
                <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-3.5 space-y-1">
                  <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Expected Outcome</div>
                  <div className="text-xs font-medium text-emerald-200 leading-normal">{currentStep.expectedOutcome}</div>
                </div>

                {/* Defects Logged on this Step (with 1-click removal for mistakes) */}
                {currentStepBugs.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[10px] font-bold text-rose-400 uppercase tracking-widest px-1 flex items-center justify-between">
                      <span>Logged Defects on this step ({currentStepBugs.length})</span>
                      <span className="text-[9px] text-zinc-400 lowercase font-normal">tap trash to remove if logged by mistake</span>
                    </div>
                    {currentStepBugs.map(b => (
                      <div key={b.id} className="bg-rose-950/40 border border-rose-500/30 rounded-2xl p-2.5 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <span className="text-zinc-200">{b.title ? <b className="text-rose-200">{b.title}</b> : b.note}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEditBug(b)}
                            className="text-zinc-400 hover:text-sky-400 p-1 rounded-lg transition cursor-pointer"
                            title="Edit defect note"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteStepBug(b.id)}
                            className="text-zinc-400 hover:text-rose-400 p-1 rounded-lg transition cursor-pointer"
                            title="Remove bug logged on this step"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step Result Selection Buttons */}
              <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                    {hasExistingResult ? 'Modify / Confirm Result' : 'Select Step Result'}
                  </span>
                  {hasExistingResult && currentStepResult && (
                    <span className="text-[10px] text-zinc-300 font-bold bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded-lg">
                      Current: {currentStepResult.status.toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  
                  {/* GREEN Status Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStatus('green');
                      triggerHaptic('light');
                    }}
                    className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                      selectedStatus === 'green'
                        ? 'bg-emerald-500/30 text-white border-emerald-400 shadow-xl shadow-emerald-500/20 ring-2 ring-emerald-400/50 scale-[1.02]'
                        : 'bg-zinc-900 hover:bg-zinc-850 text-emerald-400 border-zinc-800 hover:border-emerald-500/40'
                    }`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>Pass</span>
                  </button>

                  {/* YELLOW Status Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStatus('yellow');
                      triggerHaptic('light');
                    }}
                    className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                      selectedStatus === 'yellow'
                        ? 'bg-amber-500/30 text-white border-amber-400 shadow-xl shadow-amber-500/20 ring-2 ring-amber-400/50 scale-[1.02]'
                        : 'bg-zinc-900 hover:bg-zinc-850 text-amber-400 border-zinc-800 hover:border-amber-500/40'
                    }`}
                  >
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    <span>Caution</span>
                  </button>

                  {/* RED Status Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStatus('red');
                      triggerHaptic('light');
                    }}
                    className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                      selectedStatus === 'red'
                        ? 'bg-rose-500/30 text-white border-rose-400 shadow-xl shadow-rose-500/20 ring-2 ring-rose-400/50 scale-[1.02]'
                        : 'bg-zinc-900 hover:bg-zinc-850 text-rose-400 border-zinc-800 hover:border-rose-500/40'
                    }`}
                  >
                    <XCircle className="w-5 h-5 text-rose-400" />
                    <span>Fail</span>
                  </button>

                </div>

                {/* Navigation Action Buttons Row (Previous, Confirm) */}
                <div className="flex items-center gap-2 pt-1">
                  {/* Back / Previous Step Button */}
                  {currentStepIndex > 0 && (
                    <button
                      type="button"
                      onClick={handlePreviousStep}
                      className="px-3.5 py-3.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 flex-shrink-0 cursor-pointer"
                      title="Go back to previous step to review or fix a mistake"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Previous</span>
                    </button>
                  )}

                  {/* Confirm Button */}
                  <button
                    type="button"
                    disabled={!selectedStatus}
                    onClick={handleConfirmStepStatus}
                    className={`flex-1 py-3.5 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all duration-200 shadow-md ${
                      selectedStatus
                        ? 'bg-white hover:bg-zinc-200 text-black border border-white active:scale-[0.98] cursor-pointer'
                        : 'bg-zinc-900 text-zinc-600 border border-zinc-850 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <span>Confirm</span>
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

          </div>
        ) : (
          /* Completion Summary View (Liquid Glass Style) */
          (() => {
            const summaryRun = completedRunSummary || activeRun;
            const summaryResults = summaryRun?.results || {};
            const summaryResultsArray = Object.entries(summaryResults)
              .filter(([k, v]) => k !== '_meta' && v && typeof v === 'object' && 'status' in (v as any))
              .map(([_, v]) => v) as any[];
            const summaryGreen = summaryResultsArray.filter((r: any) => r && r.status === 'green').length;
            const summaryYellow = summaryResultsArray.filter((r: any) => r && r.status === 'yellow').length;
            const summaryRed = summaryResultsArray.filter((r: any) => r && r.status === 'red').length;

            // Golden Run evaluation:
            // 0 Reds, at most 1 Yellow, fully completed run with at least 1 step
            const isGoldenRun = totalSteps > 0 && summaryRed === 0 && summaryYellow <= 1 && summaryResultsArray.length >= totalSteps;

            const startMs = summaryRun?.startedAt ? new Date(summaryRun.startedAt).getTime() : 0;
            const endMs = summaryRun?.completedAt ? new Date(summaryRun.completedAt).getTime() : Date.now();
            const durationSecs = (startMs > 0 && endMs > startMs) ? Math.max(1, Math.round((endMs - startMs) / 1000)) : 0;
            const durationFormatted = durationSecs >= 60 
              ? `${Math.floor(durationSecs / 60)}m ${durationSecs % 60 < 10 ? '0' : ''}${durationSecs % 60}s`
              : `${durationSecs}s`;

            const bugLogsList = (summaryRun?.bugLogs || []).filter(b => !deletedBugIds.includes(b.id));

            return (
              <div className="p-6 flex-1 flex flex-col justify-between items-center text-center space-y-4 overflow-y-auto max-h-[580px]">
                
                <div className="space-y-2">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center border shadow-xl mx-auto backdrop-blur-md ${
                    isGoldenRun
                      ? 'bg-amber-500/25 text-amber-300 border-amber-400/80 shadow-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-emerald-500/20'
                  }`}>
                    {isGoldenRun ? <span className="text-2xl">🏆</span> : <Check className="w-6 h-6" />}
                  </div>
                  <h3 className="text-lg font-extrabold text-white tracking-tight">Test Plan Completed!</h3>
                  <p className="text-xs text-zinc-300 max-w-xs font-medium">
                    All steps in "{currentPlan?.name}" have been executed.
                  </p>
                </div>

                {/* Golden Run Indicator Banner */}
                {isGoldenRun ? (
                  <div className="w-full bg-gradient-to-r from-amber-500/20 via-yellow-500/25 to-amber-500/20 border-2 border-amber-400/80 rounded-2xl p-3.5 shadow-lg shadow-amber-500/20 flex items-center gap-3 text-left">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 flex items-center justify-center text-2xl flex-shrink-0 shadow-md">
                      🏆
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                          Golden Run Achieved!
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/30 text-amber-200 border border-amber-300/40 font-bold">
                          {summaryYellow === 0 ? '100% Green' : '1 Yellow Allowed'}
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-100/90 mt-0.5 leading-snug">
                        {summaryYellow === 0
                          ? 'Flawless execution! Every single feature passed with green.'
                          : 'Clean run! Passed with 0 reds and only 1 yellow warning.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="w-full bg-zinc-900/70 border border-zinc-800 rounded-2xl p-3 flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800/90 text-zinc-400 flex items-center justify-center text-lg flex-shrink-0 border border-zinc-700/50">
                      {summaryRed > 0 ? '🔴' : '🟡'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-300">
                          Non-Golden Run
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 font-medium">
                          {summaryRed > 0 ? `${summaryRed} Red Fail` : `${summaryYellow} Yellows`}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                        {summaryRed > 0
                          ? `Contains ${summaryRed} red failure${summaryRed > 1 ? 's' : ''} (Golden requires 0 reds).`
                          : `Contains ${summaryYellow} yellow warnings (Golden allows at most 1 yellow).`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Results breakdown */}
                <div className="w-full liquid-glass-panel rounded-2xl p-4 space-y-2 text-xs border border-zinc-800">
                  <div className="font-bold text-white flex items-center justify-between border-b border-zinc-800 pb-2">
                    <span>Total Steps Executed</span>
                    <span className="font-mono text-zinc-300 font-bold">{summaryResultsArray.length || totalSteps}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Reporter Name:</span>
                    <span className="text-white font-bold">{summaryRun?.testerName || inputReporterName || 'Field Tester'}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Device Model:</span>
                    <span className="text-zinc-300 font-mono font-bold">{summaryRun?.deviceName || inputDeviceName || 'N/A'}</span>
                  </div>
                  {durationSecs > 0 && (
                    <div className="flex justify-between text-zinc-400">
                      <span>Total Duration:</span>
                      <span className="text-zinc-300 font-mono font-bold">{durationFormatted}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-emerald-400 pt-1.5 border-t border-zinc-800 font-semibold">
                    <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Green (Pass):</span>
                    <span className="font-mono font-bold">{summaryGreen}</span>
                  </div>
                  <div className="flex justify-between text-amber-400 font-semibold">
                    <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Yellow (Caution):</span>
                    <span className="font-mono font-bold">{summaryYellow}</span>
                  </div>
                  <div className="flex justify-between text-rose-400 font-semibold">
                    <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-rose-400" /> Red (Fail):</span>
                    <span className="font-mono font-bold">{summaryRed}</span>
                  </div>
                  <div className="flex justify-between items-center text-zinc-300 pt-1.5 border-t border-zinc-800 font-medium">
                    <span>Golden Run Status:</span>
                    {isGoldenRun ? (
                      <span className="font-extrabold text-amber-300 flex items-center gap-1 font-mono text-xs bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-400/40">
                        <span>🏆</span> Golden Run
                      </span>
                    ) : (
                      <span className="font-semibold text-zinc-400 font-mono text-xs bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-700/60">
                        {summaryRed > 0 ? `Non-Golden (${summaryRed} Red)` : `Non-Golden (${summaryYellow} Yellows)`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Logged Bugs List */}
                {bugLogsList.length > 0 && (
                  <div className="w-full liquid-glass-card rounded-2xl p-3.5 text-xs space-y-2 text-left border border-zinc-800">
                    <div className="font-bold text-rose-400 flex items-center justify-between pb-1.5 border-b border-zinc-800">
                      <span>Logged Bugs ({bugLogsList.length}):</span>
                      <span className="text-[10px] text-zinc-500">Tap trash to delete</span>
                    </div>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {bugLogsList.map((bug: any) => (
                        <div key={bug.id} className="flex items-center justify-between bg-zinc-900/90 p-2 rounded-xl border border-zinc-800 text-[11px]">
                          <div className="truncate pr-2">
                            <span className="font-mono text-sky-400 mr-1.5 text-[10px] bg-sky-500/10 px-1.5 py-0.5 rounded-md border border-sky-500/25">[{bug.feature || 'General'}]</span>
                            <span className="text-zinc-200">{bug.title ? <b className="text-rose-200">{bug.title}</b> : bug.note}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => handleStartEditBug(bug)}
                              className="text-zinc-400 hover:text-sky-400 p-1 cursor-pointer"
                              title="Edit Bug Log"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteStepBug(bug.id)}
                              className="text-zinc-400 hover:text-rose-400 p-1 cursor-pointer"
                              title="Delete Bug Log"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Test Again Action */}
                {(() => {
                  const summaryDevice = devices.find(d =>
                    (summaryRun?.deviceId && d.id.toLowerCase().trim() === summaryRun.deviceId.toLowerCase().trim()) ||
                    (summaryRun?.deviceName && d.name.toLowerCase().trim() === summaryRun.deviceName.toLowerCase().trim())
                  );
                  const summaryDeviceHasQuotaLeft = Boolean(
                    summaryDevice &&
                    (summaryDevice.quotas || []).some(q => {
                      if (q.targetRunsPerDay <= 0) return false;
                      const doneToday = (todayRunsMap[summaryDevice.id] && todayRunsMap[summaryDevice.id][q.planId]) || 0;
                      return doneToday < q.targetRunsPerDay;
                    })
                  );
                  return (
                    <div className="w-full pt-2 space-y-2">
                      {!summaryDeviceHasQuotaLeft && summaryRun?.deviceName && (
                        <div className="w-full p-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold text-center">
                          ✅ Daily Quota Reached for <span className="font-mono font-bold">{summaryRun.deviceName}</span>!
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const completedId = summaryRun?.id || activeRun?.id;
                          const completedDevName = summaryRun?.deviceName || activeRun?.deviceName;
                          setCompletedRunSummary(null);
                          setSelectedStatus(null);
                          setActiveStepIndex(0);
                          if (currentPlan) {
                            try {
                              localStorage.removeItem(`qa_in_progress_run_${currentPlan.id}`);
                            } catch {}
                            // Pass THIS device's run id so restart never closes another tester's run on the same plan.
                            onRestartRun(currentPlan.id, completedId);
                          }
                          if (completedDevName && onSaveDevice) {
                            const matchedDev = devices.find(d => d.name.toLowerCase().trim() === completedDevName.toLowerCase().trim());
                            if (matchedDev) {
                              onSaveDevice({
                                ...matchedDev,
                                activeRunId: undefined,
                                activeTesterName: undefined
                              });
                            }
                          }
                          const savedName = getStoredTesterName() || summaryRun?.testerName || activeRun?.testerName || '';
                          if (savedName) setInputReporterName(savedName);
                          const savedDevice = getStoredDeviceName();
                          const savedDevStillSelectable = Boolean(
                            savedDevice &&
                            selectableDevices.some(
                              d => d.name.toLowerCase().trim() === savedDevice.toLowerCase().trim() || d.id === savedDevice
                            )
                          );
                          if (savedDevStillSelectable && summaryDeviceHasQuotaLeft) {
                            setInputDeviceName(savedDevice);
                          } else {
                            try {
                              localStorage.removeItem('qa_device_name');
                              sessionStorage.removeItem('qa_device_name');
                            } catch {}
                            setInputDeviceName('');
                          }
                          setShowSetupModal(true);
                        }}
                        className="w-full py-3.5 bg-white hover:bg-zinc-200 text-black font-bold text-xs rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md border border-white active:scale-[0.99] cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>{summaryDeviceHasQuotaLeft ? 'Test Again' : 'Switch Device / New Session'}</span>
                      </button>
                    </div>
                  );
                })()}

              </div>
            );
          })()
        )}

        {/* Admin Boot Termination Modal */}
        {bootMessage && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl p-6 flex flex-col items-center justify-center text-center z-[100] animate-in fade-in duration-200">
            <div className="p-4 bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/40 mb-4 shadow-xl shadow-rose-500/20">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-tight">Session Terminated</h3>
            <p className="text-xs text-zinc-300 max-w-xs mb-6 leading-relaxed font-medium" data-testid="boot-message-text">
              {bootMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                setBootMessage(null);
                setShowSetupModal(true);
              }}
              className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-2xl shadow-md border border-rose-500/30 active:scale-95 transition-all cursor-pointer"
            >
              Back to Test Plans
            </button>
          </div>
        )}

        {/* Quit Test Session Confirmation Modal */}
        {showQuitConfirmModal && (
          <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl p-6 flex flex-col items-center justify-center text-center z-[110] animate-in fade-in duration-200 rounded-[44px]">
            <div className="p-4 bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/40 mb-4 shadow-xl shadow-rose-500/20">
              <XCircle className="w-10 h-10 text-rose-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2 tracking-tight">Quit Session & Release Device?</h3>
            <p className="text-xs text-zinc-300 max-w-xs mb-6 leading-relaxed font-medium">
              This will abort your active test walkthrough, release <span className="text-zinc-200 font-bold font-mono">{activeRun?.deviceName || 'Target Device'}</span> lock, delete this uncompleted session, and restore today's test quota.
            </p>
            <div className="flex items-center gap-3 w-full max-w-xs">
              <button
                type="button"
                onClick={() => setShowQuitConfirmModal(false)}
                className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 font-bold text-xs rounded-2xl border border-zinc-800 active:scale-95 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleQuitAndReleaseSession}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-2xl shadow-md border border-rose-500/30 active:scale-95 transition-all cursor-pointer"
              >
                Quit & Release
              </button>
            </div>
          </div>
        )}

        {/* Pre-Test Session Setup Modal */}
        {showSetupModal && !completedRunSummary && (
          <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl p-6 flex flex-col justify-center z-50 animate-in fade-in duration-200 rounded-[44px]">
            
            <form onSubmit={handleSaveSessionSetup} className="space-y-5 max-w-sm mx-auto w-full">
              
              <div className="text-center space-y-1.5">
                <div className="p-3.5 bg-sky-500/15 text-sky-400 rounded-2xl w-fit mx-auto border border-sky-500/30 backdrop-blur-md shadow-lg">
                  <Smartphone className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">Start Field QA Session</h3>
                <p className="text-xs text-zinc-400 font-medium leading-relaxed">
                  Select your name and target mobile device to begin testing.
                </p>
              </div>

              <div className="liquid-glass-panel rounded-3xl p-5 space-y-4 border border-zinc-800 shadow-2xl bg-zinc-950/90">
                
                {/* QA Tester Custom Trigger */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-sky-400" />
                    Select QA Tester
                  </label>
                  {testers.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setOpenTesterPickerModal(true);
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all text-left group cursor-pointer active:scale-[0.99] ${
                        inputReporterName
                          ? 'bg-zinc-900 border-sky-500/50 shadow-md ring-1 ring-sky-500/25'
                          : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shadow flex-shrink-0 ${
                          inputReporterName
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                        }`}>
                          {selectedTesterProfile ? selectedTesterProfile.name.charAt(0).toUpperCase() : <User className="w-4 h-4 text-zinc-400" />}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-white truncate">
                            {selectedTesterProfile ? selectedTesterProfile.name : (inputReporterName || 'Choose QA Tester...')}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate">
                            {selectedTesterProfile?.role || 'Tap to select tester profile'}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-sky-400 group-hover:text-white flex-shrink-0 transition-transform" />
                    </button>
                  ) : (
                    <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-amber-200 text-xs font-semibold text-center leading-relaxed">
                      ⚠️ No QA tester profiles created yet. Register tester profiles on the Web Dashboard.
                    </div>
                  )}
                </div>

                {/* Target Device Custom Trigger */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                    Select Target Device
                  </label>
                  {selectableDevices.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setOpenDevicePickerModal(true);
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all text-left group cursor-pointer active:scale-[0.99] ${
                        isDeviceSelectable && selectedDeviceProfile
                          ? 'bg-zinc-900 border-sky-500/50 shadow-md ring-1 ring-sky-500/25'
                          : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shadow flex-shrink-0 ${
                          isDeviceSelectable && selectedDeviceProfile
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                        }`}>
                          <Smartphone className="w-4 h-4 text-sky-400" />
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-white truncate">
                            {isDeviceSelectable && selectedDeviceProfile ? selectedDeviceProfile.name : 'Choose Mobile Device...'}
                          </div>
                          <div className="text-[10px] text-sky-300/90 font-mono truncate">
                            {(() => {
                              if (!isDeviceSelectable || !selectedDeviceProfile) return 'Tap to select mobile device with remaining quota';
                              const activeQuotas = (selectedDeviceProfile.quotas || []).filter(q => q.targetRunsPerDay > 0);
                              if (activeQuotas.length === 0) return 'Tap to select mobile device';
                              const remainingQuotas = activeQuotas.filter(q => {
                                const done = (todayRunsMap[selectedDeviceProfile.id] && todayRunsMap[selectedDeviceProfile.id][q.planId]) || 0;
                                return done < q.targetRunsPerDay;
                              });
                              const currentQuota = remainingQuotas.find(q => q.planId === currentPlan?.id) || remainingQuotas[0] || activeQuotas[0];
                              const planObj = testPlans.find(p => p.id === currentQuota.planId);
                              const done = (todayRunsMap[selectedDeviceProfile.id] && todayRunsMap[selectedDeviceProfile.id][currentQuota.planId]) || 0;
                              const rem = Math.max(0, currentQuota.targetRunsPerDay - done);
                              return `⚡ ${planObj?.name || currentPlan?.name || 'Plan'}: ${rem} run${rem === 1 ? '' : 's'} left today`;
                            })()}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-sky-400 group-hover:text-white flex-shrink-0 transition-transform" />
                    </button>
                  ) : devices.some(d => d.isReady && d.quotas?.some(q => q.targetRunsPerDay > 0)) ? (
                    <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-200 text-xs font-semibold text-center leading-relaxed" data-testid="all-devices-quota-met">
                      All devices have hit today's quota
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-amber-200 text-xs font-semibold text-center leading-relaxed">
                      ⚠️ No ready devices with active daily quotas found. Register devices and set daily plan quotas on the Web Dashboard under Devices & Quotas.
                    </div>
                  )}
                </div>

              </div>

              <GlassesBuildCapture onChange={(glasses, phone) => { buildEnvRef.current = { phone, glasses }; }} />

              <button
                type="submit"
                disabled={!inputReporterName.trim() || !isDeviceSelectable}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:border-zinc-700 disabled:cursor-not-allowed text-white font-bold text-sm rounded-2xl shadow-lg border border-emerald-400/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
              >
                <span>Start</span>
                <ArrowRight className="w-4 h-4" />
              </button>

            </form>

          </div>
        )}

        {/* Custom Tester Picker Modal (Centered) */}
        {openTesterPickerModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl z-[80] flex items-center justify-center p-4 animate-in fade-in duration-200 rounded-[44px]">
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-5 space-y-4 w-full max-h-[85%] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <User className="w-4 h-4 text-sky-400" />
                    <span>Select QA Tester</span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">Choose who is running this QA walkthrough</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenTesterPickerModal(false)}
                  className="p-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 overflow-y-auto max-h-[350px] pr-1">
                {testers.map(t => {
                  const isSelected = t.name.toLowerCase().trim() === inputReporterName.toLowerCase().trim();
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setInputReporterName(t.name);
                        setOpenTesterPickerModal(false);
                      }}
                      className={`w-full p-3.5 rounded-2xl text-left border flex items-center justify-between gap-3 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-900 border-sky-500/60 shadow-md ring-1 ring-sky-500/40 scale-[1.01]'
                          : 'bg-zinc-950/80 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow flex-shrink-0 ${
                          isSelected
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                        }`}>
                          {t.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-white truncate">{t.name}</div>
                          <div className={`text-[10px] font-medium truncate ${isSelected ? 'text-sky-400' : 'text-zinc-400'}`}>
                            {t.role || 'QA Tester'}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center flex-shrink-0 shadow">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Custom Target Device Picker Modal (Centered) */}
        {openDevicePickerModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl z-[80] flex items-center justify-center p-4 animate-in fade-in duration-200 rounded-[44px]">
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-5 space-y-4 w-full max-h-[85%] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-sky-400" />
                    <span>Select Target Device</span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">Devices configured with active daily quotas</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenDevicePickerModal(false)}
                  className="p-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 overflow-y-auto max-h-[350px] pr-1">
                {selectableDevices.length === 0 ? (
                  <div className="p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-200 text-xs font-semibold text-center leading-relaxed">
                    {devices.some(d => d.isReady && d.quotas?.some(q => q.targetRunsPerDay > 0))
                      ? "All devices have hit today's quota"
                      : 'No ready devices with active daily quotas found.'}
                  </div>
                ) : selectableDevices.map(dev => {
                  const isSelected = dev.name.toLowerCase().trim() === inputDeviceName.toLowerCase().trim() || dev.id === inputDeviceName;
                  const activeQuotas = (dev.quotas || []).filter(q => q.targetRunsPerDay > 0);
                  
                  const quotaDetails = activeQuotas.map(q => {
                    const planObj = testPlans.find(p => p.id === q.planId);
                    const done = (todayRunsMap[dev.id] && todayRunsMap[dev.id][q.planId]) || 0;
                    const rem = Math.max(0, q.targetRunsPerDay - done);
                    return { name: planObj?.name || 'Plan', rem, planId: q.planId };
                  });

                  const quotaText = quotaDetails.map(d => `${d.name}: ${d.rem} left`).join(' • ');

                  return (
                    <button
                      key={dev.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        const chosenDevName = dev.name;
                        setInputDeviceName(chosenDevName);
                        // Check if current plan is supported by this device AND still has remaining quota today
                        const hasCurrentRemaining = dev.quotas?.some(q => {
                          if (q.planId !== currentPlan?.id || q.targetRunsPerDay <= 0) return false;
                          const done = (todayRunsMap[dev.id] && todayRunsMap[dev.id][q.planId]) || 0;
                          return done < q.targetRunsPerDay;
                        });
                        if (!hasCurrentRemaining && dev.quotas && dev.quotas.length > 0) {
                          // Switch to the first plan this device has an active remaining quota for today
                          const firstAvailableQuota = dev.quotas.find(q => {
                            const done = (todayRunsMap[dev.id] && todayRunsMap[dev.id][q.planId]) || 0;
                            return q.targetRunsPerDay > 0 && done < q.targetRunsPerDay;
                          }) || dev.quotas.find(q => q.targetRunsPerDay > 0);

                          if (firstAvailableQuota) {
                            onSelectPlan(firstAvailableQuota.planId);
                          }
                        }
                        setOpenDevicePickerModal(false);
                      }}
                      className={`w-full p-3.5 rounded-2xl text-left border flex items-center justify-between gap-3 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-900 border-sky-500/60 shadow-md ring-1 ring-sky-500/40 scale-[1.01]'
                          : 'bg-zinc-950/80 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow flex-shrink-0 ${
                          isSelected
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                        }`}>
                          <Smartphone className="w-4 h-4 text-sky-400" />
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-white truncate">{dev.name}</div>
                          <div className={`text-[10px] font-mono font-medium truncate ${isSelected ? 'text-sky-300' : 'text-zinc-400'}`}>
                            {quotaText ? `⚡ ${quotaText}` : 'Ready'}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center flex-shrink-0 shadow">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Bug Modal (Modern Clean Black & Gray Glass Modal) */}
        {showBugModal && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-2xl p-6 flex flex-col justify-between z-50 animate-in fade-in duration-200 rounded-[44px]">
            
            <form onSubmit={handleReportBugSubmit} className="h-full flex flex-col justify-between space-y-4">
              
              <div className="space-y-3.5 overflow-y-auto flex-1 min-h-0 pr-0.5 -mr-0.5">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <h4 className="text-sm font-bold text-rose-400 flex items-center gap-1.5 tracking-tight">
                    <Bug className="w-4 h-4 text-rose-400" />
                    {editingBug ? 'Edit Bug / Defect Log' : 'Bug / Note Entry'}
                  </h4>
                  {(() => {
                    const loggedAt = editingBug ? (editingBug.originalTimestamp || editingBug.timestamp) : new Date().toISOString();
                    const normTime = normalizeHHMM(bugTime);
                    const adjusted = !!normTime && (editingBug ? true : bugTimeTouched) && normTime !== toLocalHHMM(loggedAt);
                    const isLoggedToday = getLocalDateStr(loggedAt) === todayStr;
                    return (
                      <div className="flex flex-col items-end gap-0.5">
                        <label
                          title="When did this happen? Tap to adjust (same day)"
                          className={`text-[11px] font-mono px-2.5 py-1 rounded-xl border backdrop-blur-md flex items-center gap-1.5 cursor-pointer ${adjusted ? 'text-amber-200 bg-amber-950/40 border-amber-500/50' : 'text-zinc-300 bg-zinc-900 border-zinc-700 hover:border-zinc-500'}`}
                        >
                          <input
                            type="time"
                            data-testid="bug-time"
                            aria-label="Time the bug happened"
                            value={bugTime}
                            max={(!editingBug || isLoggedToday) ? toLocalHHMM(new Date().toISOString()) : undefined}
                            onChange={e => { setBugTime(e.target.value); if (!editingBug) setBugTimeTouched(true); }}
                            className="bg-transparent text-inherit font-mono w-[88px] focus:outline-none [color-scheme:dark]"
                          />
                        </label>
                        {adjusted && (
                          <button type="button" data-testid="bug-time-reset" onClick={() => { setBugTime(toLocalHHMM(editingBug ? loggedAt : new Date().toISOString())); setBugTimeTouched(false); }} className="text-[9px] text-amber-300/80 underline decoration-dotted">
                            logged {new Date(loggedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · reset
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="liquid-glass-pill rounded-2xl p-2.5 text-xs text-sky-200 flex items-center justify-between font-semibold border border-sky-500/30 bg-sky-950/20">
                  <span>Feature: <strong className="text-sky-300 font-mono">{editingBug?.feature || currentStep?.feature || 'General'}</strong></span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider">Step Target</label>
                  <div className="text-xs font-bold text-white liquid-glass-card p-3 rounded-2xl border border-zinc-800 bg-zinc-900/60">
                    {editingBug ? editingBug.stepTitle || 'Defect Entry' : `Step #${currentStepIndex + 1}: ${currentStep?.title || 'Current Step'}`}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 mb-1 uppercase tracking-wider">Reporter</label>
                    <div className="liquid-glass-input p-2.5 rounded-2xl text-zinc-200 font-medium truncate border border-zinc-800">{activeRun?.testerName || 'N/A'}</div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 mb-1 uppercase tracking-wider">Device Model</label>
                    <div className="liquid-glass-input p-2.5 rounded-2xl text-zinc-300 font-mono font-medium truncate border border-zinc-800">{activeRun?.deviceName || 'N/A'}</div>
                  </div>
                </div>

                {/* Title -> Buganizer title */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="bug-title" className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Title</label>
                    <span className={`text-[10px] font-mono ${bugTitle.length > BUG_TITLE_MAX - 15 ? 'text-amber-400' : 'text-zinc-500'}`}>{bugTitle.length}/{BUG_TITLE_MAX}</span>
                  </div>
                  <input
                    id="bug-title"
                    data-testid="bug-title"
                    type="text"
                    maxLength={BUG_TITLE_MAX}
                    placeholder="Short summary, e.g. Gemini doesn't save the Keep note"
                    value={bugTitle}
                    onChange={e => setBugTitle(e.target.value)}
                    className="w-full liquid-glass-input rounded-2xl px-3.5 py-3 text-sm text-white placeholder-zinc-500 border border-zinc-800 focus:border-rose-500/60 focus:outline-none font-semibold"
                    required
                    autoComplete="off"
                  />
                </div>

                {/* Description -> Buganizer body */}
                <div>
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <label htmlFor="bug-description" className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Description</label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="bug-template"
                        onClick={() => setBugNote(prev => (prev.trim() ? `${prev.trim()}\n\n${BUG_DESCRIPTION_TEMPLATE}` : BUG_DESCRIPTION_TEMPLATE))}
                        className="px-2.5 py-1 rounded-xl text-[10px] font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 cursor-pointer"
                        title="Insert steps / expected / actual"
                      >
                        + Steps
                      </button>
                      <button
                        type="button"
                        onClick={toggleSpeechRecognition}
                        className={`px-2.5 py-1 rounded-xl text-[10px] font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer ${
                          isListeningSpeech
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                        }`}
                        title={isListeningSpeech ? 'Stop recording voice note' : 'Click to speak note'}
                      >
                        <Mic className={`w-3 h-3 ${isListeningSpeech ? 'text-rose-400 animate-bounce' : 'text-zinc-400'}`} />
                        <span>{isListeningSpeech ? 'Listening...' : 'Dictate'}</span>
                      </button>
                    </div>
                  </div>
                  <textarea
                    id="bug-description"
                    data-testid="bug-description"
                    rows={5}
                    placeholder="What happened? Add steps, what you expected and what actually happened (or tap Dictate)."
                    value={bugNote}
                    onChange={e => setBugNote(e.target.value)}
                    className="w-full liquid-glass-input rounded-2xl p-3.5 text-xs text-white placeholder-zinc-500 border border-zinc-800 focus:border-zinc-600 focus:outline-none font-medium leading-relaxed"
                  />
                  {isListeningSpeech && (
                    <div className="mt-1.5 text-[10px] text-rose-400 flex items-center gap-1.5 font-medium animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                      Listening... speak into your microphone
                    </div>
                  )}
                </div>

                {/* Live Buganizer preview */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
                  <button
                    type="button"
                    data-testid="bug-buganizer-preview-toggle"
                    onClick={() => setShowBuganizerPreview(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold text-zinc-300 cursor-pointer"
                  >
                    <span>Buganizer preview</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${showBuganizerPreview ? 'rotate-180' : ''}`} />
                  </button>
                  {showBuganizerPreview && (
                    <div className="px-3 pb-3 space-y-1.5" data-testid="bug-buganizer-preview">
                      <div className="text-[11px] font-semibold text-white leading-snug break-words">
                        {`${TITLE_PREFIX} [${editingBug?.feature || currentStep?.feature || 'General'}] ${bugTitle.trim() || 'Your title'}`}
                      </div>
                      <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-400 font-mono bg-black/40 rounded-xl p-2 max-h-32 overflow-y-auto">
{`**What happened**
${bugNote.trim() || bugTitle.trim() || '(description)'}

**Where**
- Step: ${editingBug ? editingBug.stepTitle || 'Defect Entry' : currentStep?.title || 'Current Step'}
- CUJ: ${editingBug?.feature || currentStep?.feature || 'General'}

**Environment**
- Builds from this phone + glasses are added automatically`}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex gap-2.5 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={closeBugModal}
                  className="w-1/3 py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white font-bold text-xs rounded-2xl border border-zinc-800 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-2xl shadow-md border border-rose-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{editingBug ? 'Update Defect' : 'Save Bug Log'}</span>
                </button>
              </div>

            </form>

          </div>
        )}

        {/* Full Screen Photo Lightbox Modal via Dedicated Portal */}
        {previewImageUrl && createPortal(
          <div
            onClick={() => setPreviewImageUrl(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 9999999,
              backgroundColor: 'rgba(0, 0, 0, 0.96)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)'
            }}
          >
            {/* Top Bar - Pinned at Top of Screen Viewport */}
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '1.25rem',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100vw - 2.5rem)',
                maxWidth: '800px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'rgba(9, 9, 11, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '1rem',
                padding: '0.75rem 1rem',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
                zIndex: 10
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-zinc-700 active:scale-95 transition-all"
              >
                <span>← Back</span>
              </button>

              <span className="text-xs font-bold text-zinc-200 flex items-center gap-2">
                <Image className="w-4 h-4 text-zinc-400" /> Photo Evidence Preview
              </span>

              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-xl bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer"
                title="Close Modal"
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
                maxWidth: '800px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#09090b',
                borderRadius: '1.25rem',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '0.75rem',
                overflow: 'hidden',
                boxShadow: '0 20px 40px -10px rgba(0,0,0,0.9)'
              }}
            >
              <img
                src={previewImageUrl}
                alt="Evidence Preview"
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
                maxWidth: '800px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(9, 9, 11, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '1rem',
                padding: '0.75rem 1rem',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
                zIndex: 10
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="w-full py-3 bg-white hover:bg-zinc-200 text-black text-xs font-bold rounded-xl shadow-md border border-white active:scale-95 cursor-pointer transition-all"
              >
                ← Back to QA Walkthrough
              </button>
            </div>
          </div>,
          document.getElementById('modal-portal') || document.body
        )}

      </div>

    </div>
  );
};
