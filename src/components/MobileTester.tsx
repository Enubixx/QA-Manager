import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from '../types';
import { CheckCircle2, Clock, Bug, Smartphone, RefreshCw, Send, Check, Layers, ChevronDown, AlertTriangle, XCircle, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, Undo2, Sparkles, User, Download, Edit3, Trash2, Tag, Image, Camera, X } from 'lucide-react';
import { exportTestRunToCSV } from '../utils/exportUtils';
import { triggerHaptic } from '../utils/haptics';

interface MobileTesterProps {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  archivedRuns?: TestRun[];
  bugLogs?: BugLog[];
  devices?: DeviceProfile[];
  testers?: TesterProfile[];
  onSaveDevice?: (device: DeviceProfile) => void;
  selectedPlanId: string;
  populatedDevices: string[];
  onAddPopulatedDevice: (device: string) => void;
  onSelectPlan: (planId: string) => void;
  onUpdateRun: (updatedRun: TestRun) => void;
  onDeleteRun?: (runId: string) => void;
  onLogBug: (bug: BugLog) => void;
  onDeleteBug: (bugId: string) => void;
  onRestartRun: (planId: string) => void;
  onNavigateToDashboard?: () => void;
}

export const MobileTester: React.FC<MobileTesterProps> = ({
  testPlans,
  testRuns,
  archivedRuns = [],
  bugLogs = [],
  devices = [],
  testers = [],
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
    let devId = localStorage.getItem('qa_device_id');
    if (!devId) {
      devId = 'dev-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
      localStorage.setItem('qa_device_id', devId);
    }
    return devId;
  };

  const deviceId = getDeviceId();

  // Match device currently in use by this phone / tester
  const currentSavedDevName = inputDeviceName || getStoredDeviceName();
  const currentDevice = useMemo(() => {
    return devices.find(d => 
      (currentSavedDevName && d.name.toLowerCase().trim() === currentSavedDevName.toLowerCase().trim()) ||
      d.id === currentSavedDevName ||
      d.id === deviceId
    );
  }, [devices, currentSavedDevName, deviceId]);

  // "The only test plan that should be available to that Device is the one it has a quota set for"
  const availablePlans = useMemo(() => {
    if (!currentDevice || !currentDevice.quotas || currentDevice.quotas.length === 0) {
      return testPlans;
    }
    const filtered = testPlans.filter(p => 
      currentDevice.quotas.some(q => q.planId === p.id && q.targetRunsPerDay > 0)
    );
    return filtered.length > 0 ? filtered : testPlans;
  }, [testPlans, currentDevice]);

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

  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  // Compute completed runs per device and plan for today
  const todayRunsMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    const allRuns = [...archivedRuns, ...testRuns];
    allRuns.forEach(run => {
      if (run.status !== 'completed' || !run.completedAt) return;
      const d = new Date(run.completedAt);
      const runDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (runDate !== todayStr) return;

      devices.forEach(dev => {
        const matchesId = run.deviceId && (dev.id === run.deviceId || run.deviceId.includes(dev.id));
        const matchesName = run.deviceName && dev.name.toLowerCase().trim() === run.deviceName.toLowerCase().trim();
        if (matchesId || matchesName) {
          if (!map[dev.id]) map[dev.id] = {};
          map[dev.id][run.planId] = (map[dev.id][run.planId] || 0) + 1;
        }
      });
    });
    return map;
  }, [archivedRuns, testRuns, devices, todayStr]);

  // Check localStorage for any persistent in-progress run for this plan
  const localSavedRunJson = currentPlan ? localStorage.getItem(`qa_in_progress_run_${currentPlan.id}`) : null;
  let localSavedRun: TestRun | null = null;
  if (localSavedRunJson) {
    try {
      localSavedRun = JSON.parse(localSavedRunJson);
      if (localSavedRun && localSavedRun.status === 'completed') {
        localSavedRun = null;
      }
    } catch (e) {}
  }

  // Find active run specifically for THIS device & plan
  let activeRun = testRuns.find(r => 
    r.planId === currentPlan?.id && 
    r.status !== 'completed' &&
    (r.deviceId === deviceId || r.id.includes(deviceId) || (localSavedRun && r.id === localSavedRun.id))
  );

  // Fallback: check if an unassigned active run matching legacy ID exists
  if (!activeRun && currentPlan) {
    activeRun = testRuns.find(r => r.id === 'run-' + currentPlan.id && r.status !== 'completed');
  }

  // Merge with locally persisted in-progress run so step results are NEVER lost
  if (localSavedRun && localSavedRun.planId === currentPlan?.id) {
    if (!activeRun) {
      activeRun = localSavedRun;
    } else {
      activeRun = {
        ...activeRun,
        results: {
          ...(activeRun.results || {}),
          ...(localSavedRun.results || {})
        },
        bugLogs: [
          ...(activeRun.bugLogs || []),
          ...(localSavedRun.bugLogs || []).filter(b => !(activeRun?.bugLogs || []).some(existing => existing.id === b.id))
        ],
        currentStepIndex: localSavedRun.currentStepIndex !== undefined ? localSavedRun.currentStepIndex : activeRun.currentStepIndex
      };
    }
  }

  if (!activeRun && currentPlan) {
    const savedName = getStoredTesterName();
    const savedDevice = getStoredDeviceName();
    activeRun = {
      id: `run-${currentPlan.id}-${deviceId}`,
      planId: currentPlan.id,
      planName: currentPlan.name,
      deviceId: deviceId,
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

    return devices.filter(dev => {
      if (!dev.isReady) return false;

      // Lock out ONLY if locked by another tester's active, in-progress run
      if (dev.activeRunId && dev.activeRunId !== activeRun?.id) {
        const matchingRun = testRuns.find(r => r.id === dev.activeRunId);
        const isSelfDevice = currentSavedName && dev.name.toLowerCase().trim() === currentSavedName.toLowerCase().trim();
        if (matchingRun && matchingRun.status === 'in_progress' && !isSelfDevice) {
          return false;
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
  }, [devices, todayRunsMap, activeRun, testRuns, inputDeviceName]);

  // Keep tester identity reliably in localStorage and sessionStorage (NEVER wipe on mount)
  useEffect(() => {
    const name = getStoredTesterName();
    const dev = getStoredDeviceName();
    if (name) {
      localStorage.setItem('qa_tester_name', name);
      sessionStorage.setItem('qa_tester_name', name);
    }
    if (dev) {
      localStorage.setItem('qa_device_name', dev);
      sessionStorage.setItem('qa_device_name', dev);
    }
  }, []);

  // Active Mobile View Tab: 'plans' (Configured Test Plans) vs 'bugs' (Logged Bugs)
  const [activeMobileTab, setActiveMobileTab] = useState<'plans' | 'bugs'>('plans');

  // Pre-test Session Setup state: only display if tester name or device is completely unconfigured
  const [showSetupModal, setShowSetupModal] = useState<boolean>(() => {
    const savedName = getStoredTesterName();
    const savedDevice = getStoredDeviceName();
    const hasTester = Boolean(savedName || activeRun?.testerName);
    const hasDevice = Boolean(savedDevice || activeRun?.deviceName);
    return !hasTester || !hasDevice;
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

  // Active run completion state (strictly gated to this session or explicitly completed activeRun)
  const isCompleted = completedRunSummary !== null;
  const activeOrSummaryCompleted = completedRunSummary;

  // Dynamically compute active bugs for current plan/run
  const activeBugs = useMemo(() => {
    const rawRunBugs = (activeOrSummaryCompleted || activeRun)?.bugLogs || [];
    if (rawRunBugs.length > 0) {
      if (bugLogs && bugLogs.length > 0) {
        const validIds = new Set(bugLogs.map(b => b.id));
        // Keep bugs that are either in global bugLogs OR were newly created in this local session
        return rawRunBugs.filter(b => validIds.has(b.id) || b.id.startsWith('bug-'));
      }
      return rawRunBugs;
    }
    // Fallback to global bugLogs matching this plan or run
    if (bugLogs && bugLogs.length > 0) {
      return bugLogs.filter(b => b.planId === currentPlan?.id || (activeRun && b.testRunId === activeRun.id));
    }
    return [];
  }, [bugLogs, activeOrSummaryCompleted, activeRun?.bugLogs, currentPlan?.id]);

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
    // 1. Release active lock on target device
    const currentDeviceName = sessionStorage.getItem('qa_device_name') || activeRun?.deviceName || inputDeviceName;
    if (currentDeviceName && onSaveDevice) {
      const matchedDev = devices.find(d => 
        d.name.toLowerCase().trim() === currentDeviceName.toLowerCase().trim() ||
        (activeRun && d.activeRunId === activeRun.id)
      );
      if (matchedDev) {
        onSaveDevice({
          ...matchedDev,
          activeRunId: undefined,
          activeTesterName: undefined
        });
      }
    }

    // 2. Delete active uncompleted run session to restore test quota
    const runsToDelete = testRuns.filter(r => 
      r.status !== 'completed' && (
        (activeRun && r.id === activeRun.id) ||
        (currentPlan && r.planId === currentPlan.id && (
          !r.deviceId || r.deviceId === deviceId || (currentDeviceName && r.deviceName === currentDeviceName)
        ))
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

    // 5. Clear session storage & reset setup state
    sessionStorage.removeItem('qa_tester_name');
    sessionStorage.removeItem('qa_device_name');
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
  const [bugNote, setBugNote] = useState('');
  const [bugImageUrl, setBugImageUrl] = useState('');
  const [bugSeverity, setBugSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [bugSuccessMessage, setBugSuccessMessage] = useState<string | null>(null);

  // Native Mobile Photo Upload Handler (with canvas compression to avoid quota issues)
  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        const rawDataUrl = event.target.result;
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height = Math.round((height * MAX_WIDTH) / width);
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = Math.round((width * MAX_HEIGHT) / height);
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', 0.7);
            setBugImageUrl(compressed);
          } else {
            setBugImageUrl(rawDataUrl);
          }
        };
        img.onerror = () => {
          setBugImageUrl(rawDataUrl);
        };
        img.src = rawDataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  // Save Setup Session Info
  const handleSaveSessionSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputReporterName.trim() || !inputDeviceName.trim() || !activeRun) return;

    const trimmedReporter = inputReporterName.trim();
    const trimmedDevice = inputDeviceName.trim();
    const prevSavedDevice = getStoredDeviceName();

    // Unlock any device previously locked by this session if selecting a new device
    devices.forEach(d => {
      const isPrevDev = prevSavedDevice && d.name.toLowerCase().trim() === prevSavedDevice.toLowerCase().trim();
      const isLockedByThisRun = d.activeRunId === activeRun.id;
      const isNewDev = d.name.toLowerCase().trim() === trimmedDevice.toLowerCase().trim() || d.id === trimmedDevice;

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

    // Store in both localStorage and sessionStorage so tester identity is never lost
    sessionStorage.setItem('qa_tester_name', trimmedReporter);
    sessionStorage.setItem('qa_device_name', trimmedDevice);
    localStorage.setItem('qa_tester_name', trimmedReporter);
    localStorage.setItem('qa_device_name', trimmedDevice);

    onAddPopulatedDevice(trimmedDevice);

    const isBrandNew = !activeRun || activeRun.status === 'not_started' || Object.keys(activeRun.results || {}).length === 0;

    const updatedRun: TestRun = {
      ...activeRun,
      id: isBrandNew ? `run-${currentPlan.id}-${deviceId}-${Date.now().toString(36)}` : activeRun.id,
      planId: currentPlan.id,
      planName: currentPlan.name,
      deviceId: deviceId,
      testerName: trimmedReporter,
      deviceName: trimmedDevice,
      status: 'in_progress',
      currentStepIndex: isBrandNew ? 0 : (activeRun.currentStepIndex || 0),
      results: isBrandNew ? {} : (activeRun.results || {}),
      bugLogs: isBrandNew ? [] : (activeRun.bugLogs || []),
      startedAt: isBrandNew ? new Date().toISOString() : (activeRun.startedAt || new Date().toISOString())
    };

    if (isBrandNew) {
      setActiveStepIndex(0);
      setSelectedStatus(null);
    }

    // Save in-progress run to localStorage immediately
    if (currentPlan) {
      localStorage.setItem(`qa_in_progress_run_${currentPlan.id}`, JSON.stringify(updatedRun));
    }

    // Lock newly chosen device
    const matchedDev = devices.find(d => d.name.toLowerCase().trim() === trimmedDevice.toLowerCase().trim() || d.id === trimmedDevice);
    if (matchedDev && onSaveDevice) {
      onSaveDevice({
        ...matchedDev,
        activeRunId: updatedRun.id,
        activeTesterName: trimmedReporter
      });
    }

    triggerHaptic('light');
    setShowSetupModal(false);
  };

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
        if (currentPlan) {
          localStorage.setItem(`qa_in_progress_run_${currentPlan.id}`, JSON.stringify(updated));
        }
      }
    }
  };

  // Go back to a specific previous step (only allowed to go backward)
  const handleGoToStep = (targetIdx: number) => {
    if (targetIdx >= 0 && targetIdx < currentStepIndex) {
      triggerHaptic('light');
      setActiveStepIndex(targetIdx);
      const targetStep = steps[targetIdx];
      const existingStatus = targetStep && activeRun?.results?.[targetStep.id]?.status;
      setSelectedStatus(existingStatus && existingStatus !== 'pending' ? existingStatus : null);
      if (activeRun) {
        const updated = { ...activeRun, currentStepIndex: targetIdx };
        if (currentPlan) {
          localStorage.setItem(`qa_in_progress_run_${currentPlan.id}`, JSON.stringify(updated));
        }
      }
    }
  };

  // Current step defects (for reviewing or removing mistaken bugs)
  const currentStepBugs = useMemo(() => {
    if (!currentStep || !activeRun) return [];
    return (activeRun.bugLogs || []).filter(b => b.stepId === currentStep.id);
  }, [currentStep?.id, activeRun?.bugLogs]);

  // Remove a mistake bug from the current step
  const handleDeleteStepBug = (bugId: string) => {
    if (onDeleteBug) onDeleteBug(bugId);
    if (activeRun) {
      const updatedBugLogs = (activeRun.bugLogs || []).filter(b => b.id !== bugId);
      const updatedRun = { ...activeRun, bugLogs: updatedBugLogs };
      onUpdateRun(updatedRun);
      if (currentPlan) {
        localStorage.setItem(`qa_in_progress_run_${currentPlan.id}`, JSON.stringify(updatedRun));
      }
      setBugSuccessMessage('Defect removed from this step');
      setTimeout(() => setBugSuccessMessage(null), 3000);
    }
  };

  // Submit Step with Selected Status (or Update Existing Result)
  const handleConfirmStepStatus = () => {
    if (!currentStep || !activeRun || !selectedStatus) return;

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

    const isLastStep = currentStepIndex >= totalSteps - 1;
    const isDone = isLastStep;
    const nextIndex = isLastStep ? totalSteps : currentStepIndex + 1;

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

    const updatedRun: TestRun = {
      ...activeRun,
      planId: currentPlan.id,
      planName: currentPlan.name,
      results: updatedResults,
      currentStepIndex: nextIndex,
      status: isDone ? 'completed' : 'in_progress',
      completedAt: isDone ? isoTimestamp : undefined,
      durationMs: isDone ? computedDurationMs : activeRun.durationMs
    };

    if (isDone) {
      triggerHaptic('success');
      setCompletedRunSummary(updatedRun);
      if (currentPlan) {
        localStorage.removeItem(`qa_in_progress_run_${currentPlan.id}`);
      }
      const activeDevName = activeRun.deviceName;
      const matchedDev = devices.find(d => (activeDevName && d.name.toLowerCase().trim() === activeDevName.toLowerCase().trim()) || d.activeRunId === activeRun.id);
      if (matchedDev && onSaveDevice) {
        onSaveDevice({
          ...matchedDev,
          activeRunId: undefined,
          activeTesterName: undefined
        });
      }
      setBugSuccessMessage(`🎉 Run complete! ${activeDevName || 'Device'} progress updated for today.`);
      setTimeout(() => setBugSuccessMessage(null), 4000);
    } else {
      triggerHaptic('light');
      if (currentPlan) {
        localStorage.setItem(`qa_in_progress_run_${currentPlan.id}`, JSON.stringify(updatedRun));
      }
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

  // Keyboard Shortcuts listener (1 = Green, 2 = Yellow, 3 = Red, Enter = Confirm, B = Bug, Left = Prev, Right = Next)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag)) {
        if (e.key === 'Escape' && showBugModal) {
          setShowBugModal(false);
        }
        return;
      }

      if (showSetupModal || isCompleted) return;

      if (showBugModal) {
        if (e.key === 'Escape') setShowBugModal(false);
        return;
      }

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
        setShowBugModal(true);
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
  }, [showSetupModal, isCompleted, showBugModal, selectedStatus, currentStepIndex, totalSteps, steps, activeRun]);

  const [bootMessage, setBootMessage] = useState<string | null>(null);

  // Safe notice if currentPlan is missing
  useEffect(() => {
    if (!currentPlan) {
      setBootMessage('⚠️ Selected Test Plan was removed or is unavailable.');
      setShowSetupModal(true);
    }
  }, [currentPlan]);

  // Submit Bug ONLY
  const handleReportBugSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bugNote.trim() || !activeRun || !currentPlan) return;

    const now = new Date();
    const isoTimestamp = now.toISOString();
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const newBug: BugLog = {
      id: 'bug-' + Date.now(),
      testRunId: activeRun.id,
      planId: currentPlan.id,
      stepId: currentStep?.id || `step-${Date.now()}`,
      stepTitle: currentStep?.title || `Mobile Defect (${currentPlan.name})`,
      feature: currentStep?.feature || '',
      testerName: activeRun.testerName || 'Tester',
      deviceName: activeRun.deviceName || 'Mobile Device',
      severity: bugSeverity,
      note: bugNote.trim(),
      imageUrl: bugImageUrl.trim() || undefined,
      timestamp: isoTimestamp,
      formattedTime: formattedTime
    };

    try {
      onLogBug(newBug);
    } catch (err) {
      console.warn('onLogBug error:', err);
    }

    try {
      const updatedRun: TestRun = {
        ...activeRun,
        bugLogs: [...(activeRun.bugLogs || []), newBug]
      };
      if (currentPlan) {
        localStorage.setItem(`qa_in_progress_run_${currentPlan.id}`, JSON.stringify(updatedRun));
      }
    } catch (err) {
      console.warn('save bug error:', err);
    }

    setBugSuccessMessage(`Bug/Note logged at ${formattedTime}`);
    setBugNote('');
    setBugImageUrl('');
    setShowBugModal(false);
  };

  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;

  // Capacitor Android Hardware Back Button listener
  useEffect(() => {
    let sub: any = null;
    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', () => {
        if (previewImageUrl) {
          setPreviewImageUrl(null);
        } else if (showBugModal) {
          setShowBugModal(false);
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
  }, [previewImageUrl, showBugModal, showSetupModal, onNavigateToDashboard]);

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
            onClick={onNavigateToDashboard}
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
                onClick={onNavigateToDashboard}
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
            {!showSetupModal && activeRun && activeRun.status !== 'completed' && (
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
              <span className="truncate">{activeRun?.testerName || inputReporterName || 'Unassigned'}</span>
            </span>
            <span className="text-zinc-700">•</span>
            <span className="text-zinc-300 font-mono flex items-center gap-1 truncate font-medium">
              <Smartphone className="w-3 h-3 text-zinc-400 flex-shrink-0" />
              <span className="truncate">{activeRun?.deviceName || inputDeviceName || 'No Device'}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowSetupModal(true)}
            className="text-[10px] text-zinc-300 hover:text-white font-medium flex items-center gap-0.5 ml-2 flex-shrink-0 bg-zinc-900 hover:bg-zinc-800 px-2 py-0.5 rounded-lg border border-zinc-800 transition active:scale-95 cursor-pointer"
          >
            <Edit3 className="w-2.5 h-2.5 text-zinc-400" /> Edit
          </button>
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
                onClick={() => setShowBugModal(true)}
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
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                          bug.severity === 'critical'
                            ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                            : bug.severity === 'high'
                            ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                            : 'bg-blue-500/30 text-blue-300 border border-blue-500/40'
                        }`}>
                          {bug.severity}
                        </span>
                        <span className="text-xs font-bold text-white">
                          {bug.stepTitle || bug.feature || 'Bug'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteBug(bug.id)}
                        className="text-zinc-400 hover:text-rose-400 p-1 rounded-lg transition cursor-pointer"
                        title="Delete Bug"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
                  const canGoBack = idx < currentStepIndex;
                  const isDone = sRes && sRes.status && sRes.status !== 'pending';

                  return (
                    <button
                      key={s.id}
                      ref={isCurrent ? activeStepRef : null}
                      type="button"
                      disabled={!canGoBack}
                      onClick={() => {
                        if (canGoBack) handleGoToStep(idx);
                      }}
                      className={`flex items-center justify-center gap-1 min-w-[38px] h-8 px-2.5 rounded-xl text-xs font-bold transition-colors duration-150 flex-shrink-0 border ${
                        isCurrent
                          ? 'bg-zinc-700 text-zinc-100 border-zinc-400 shadow-md ring-1 ring-zinc-400/40'
                          : canGoBack
                          ? isDone
                            ? sRes.status === 'green'
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/40 cursor-pointer'
                              : sRes.status === 'yellow'
                              ? 'bg-amber-950/40 text-amber-300 border-amber-500/40 hover:bg-amber-900/40 cursor-pointer'
                              : 'bg-rose-950/40 text-rose-300 border-rose-500/40 hover:bg-rose-900/40 cursor-pointer'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white cursor-pointer'
                          : 'bg-zinc-900/40 text-zinc-600 border-zinc-900 opacity-40 cursor-not-allowed'
                      }`}
                      title={canGoBack ? `Go back to Step ${idx + 1}: ${s.title}` : `Step ${idx + 1}`}
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
                    onClick={() => setShowBugModal(true)}
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
                          <span className="font-bold text-rose-300">[{b.severity.toUpperCase()}]</span>{' '}
                          <span className="text-zinc-200">{b.note}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteStepBug(b.id)}
                          className="text-zinc-400 hover:text-rose-400 p-1 rounded-lg transition cursor-pointer"
                          title="Remove bug logged on this step"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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

            const startMs = summaryRun?.startedAt ? new Date(summaryRun.startedAt).getTime() : 0;
            const endMs = summaryRun?.completedAt ? new Date(summaryRun.completedAt).getTime() : Date.now();
            const durationSecs = (startMs > 0 && endMs > startMs) ? Math.max(1, Math.round((endMs - startMs) / 1000)) : 0;
            const durationFormatted = durationSecs >= 60 
              ? `${Math.floor(durationSecs / 60)}m ${durationSecs % 60 < 10 ? '0' : ''}${durationSecs % 60}s`
              : `${durationSecs}s`;

            const bugLogsList = summaryRun?.bugLogs || [];

            return (
              <div className="p-6 flex-1 flex flex-col justify-between items-center text-center space-y-4 overflow-y-auto max-h-[580px]">
                
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 shadow-xl mx-auto backdrop-blur-md">
                    <Check className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-extrabold text-white tracking-tight">Test Plan Completed!</h3>
                  <p className="text-xs text-zinc-300 max-w-xs font-medium">
                    All steps in "{currentPlan?.name}" have been executed.
                  </p>
                </div>

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
                            <span className="text-zinc-200">{bug.note}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onDeleteBug(bug.id)}
                            className="text-zinc-400 hover:text-rose-400 p-1 flex-shrink-0 cursor-pointer"
                            title="Delete Bug Log"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Test Again Action */}
                <div className="w-full pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCompletedRunSummary(null);
                      setSelectedStatus(null);
                      setActiveStepIndex(0);
                      if (currentPlan) {
                        localStorage.removeItem(`qa_in_progress_run_${currentPlan.id}`);
                        onRestartRun(currentPlan.id);
                      }
                      if (activeRun?.deviceName && onSaveDevice) {
                        const matchedDev = devices.find(d => d.name.toLowerCase().trim() === activeRun.deviceName?.toLowerCase().trim());
                        if (matchedDev) {
                          onSaveDevice({
                            ...matchedDev,
                            activeRunId: undefined,
                            activeTesterName: undefined
                          });
                        }
                      }
                      const savedName = sessionStorage.getItem('qa_tester_name') || activeRun?.testerName || '';
                      const savedDevice = sessionStorage.getItem('qa_device_name') || activeRun?.deviceName || '';
                      if (savedName) setInputReporterName(savedName);
                      if (savedDevice) setInputDeviceName(savedDevice);
                      setShowSetupModal(true);
                    }}
                    className="w-full py-3.5 bg-white hover:bg-zinc-200 text-black font-bold text-xs rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md border border-white active:scale-[0.99] cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Test Again</span>
                  </button>
                </div>

              </div>
            );
          })()
        )}

        {/* Admin Boot Termination Modal */}
        {bootMessage && (
          <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl p-6 flex flex-col items-center justify-center text-center z-[100] animate-in fade-in duration-200 rounded-[44px]">
            <div className="p-4 bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/40 mb-4 shadow-xl shadow-rose-500/20">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2 tracking-tight">Session Terminated</h3>
            <p className="text-xs text-zinc-300 max-w-xs mb-6 leading-relaxed font-medium">
              An administrator has ended your QA session from the desktop manager dashboard.
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
                        inputDeviceName
                          ? 'bg-zinc-900 border-sky-500/50 shadow-md ring-1 ring-sky-500/25'
                          : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shadow flex-shrink-0 ${
                          inputDeviceName
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                        }`}>
                          <Smartphone className="w-4 h-4 text-sky-400" />
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-white truncate">
                            {selectedDeviceProfile ? selectedDeviceProfile.name : (inputDeviceName || 'Choose Mobile Device...')}
                          </div>
                          <div className="text-[10px] text-sky-300/90 font-mono truncate">
                            {(() => {
                              if (!selectedDeviceProfile) return 'Tap to select mobile device';
                              const activeQuotas = (selectedDeviceProfile.quotas || []).filter(q => q.targetRunsPerDay > 0);
                              if (activeQuotas.length === 0) return 'Ready';
                              const currentQuota = activeQuotas.find(q => q.planId === currentPlan?.id);
                              if (currentQuota) {
                                const done = (todayRunsMap[selectedDeviceProfile.id] && todayRunsMap[selectedDeviceProfile.id][currentQuota.planId]) || 0;
                                const rem = Math.max(0, currentQuota.targetRunsPerDay - done);
                                return `⚡ ${currentPlan?.name}: ${rem} run${rem === 1 ? '' : 's'} left today`;
                              }
                              const firstQ = activeQuotas[0];
                              const planObj = testPlans.find(p => p.id === firstQ.planId);
                              const done = (todayRunsMap[selectedDeviceProfile.id] && todayRunsMap[selectedDeviceProfile.id][firstQ.planId]) || 0;
                              const rem = Math.max(0, firstQ.targetRunsPerDay - done);
                              return `⚡ ${planObj?.name || 'Plan'}: ${rem} left today`;
                            })()}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-sky-400 group-hover:text-white flex-shrink-0 transition-transform" />
                    </button>
                  ) : (
                    <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-amber-200 text-xs font-semibold text-center leading-relaxed">
                      ⚠️ No ready devices with active daily quotas found. Register devices and set daily plan quotas on the Web Dashboard under Devices & Quotas.
                    </div>
                  )}
                </div>

              </div>

              <button
                type="submit"
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-2xl shadow-lg border border-emerald-400/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
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
                {selectableDevices.map(dev => {
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
                        // Check if current plan is supported by this device
                        const hasCurrent = dev.quotas?.some(q => q.planId === currentPlan?.id && q.targetRunsPerDay > 0);
                        if (!hasCurrent && dev.quotas && dev.quotas.length > 0) {
                          // Switch to the first plan this device has an active quota for
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
              
              <div className="space-y-3.5">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <h4 className="text-sm font-bold text-rose-400 flex items-center gap-1.5 tracking-tight">
                    <Bug className="w-4 h-4 text-rose-400" />
                    Bug / Note Entry
                  </h4>
                  <div className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2.5 py-1 rounded-xl border border-zinc-800 backdrop-blur-md flex items-center gap-1">
                    <Clock className="w-3 h-3 text-zinc-400" />
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <div className="liquid-glass-pill rounded-2xl p-2.5 text-xs text-sky-200 flex items-center justify-between font-semibold border border-sky-500/30 bg-sky-950/20">
                  <span>Feature: <strong className="text-sky-300 font-mono">{currentStep?.feature || 'General'}</strong></span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider">Step Target</label>
                  <div className="text-xs font-bold text-white liquid-glass-card p-3 rounded-2xl border border-zinc-800 bg-zinc-900/60">
                    Step #{currentStepIndex + 1}: {currentStep?.title}
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

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider">Bug Description / Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Describe what went wrong or observation notes..."
                    value={bugNote}
                    onChange={e => setBugNote(e.target.value)}
                    className="w-full liquid-glass-input rounded-2xl p-3.5 text-xs text-white placeholder-zinc-500 border border-zinc-800 focus:border-zinc-600 focus:outline-none font-medium leading-relaxed"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider">
                    Attach Screenshot / Photo
                  </label>

                  <input
                    type="file"
                    accept="image/*"
                    id="mobile-bug-photo-upload"
                    onChange={handlePhotoFileChange}
                    className="hidden"
                  />

                  {bugImageUrl ? (
                    <div className="space-y-2">
                      <div className="relative w-full h-32 rounded-2xl overflow-hidden border border-zinc-800 shadow-md bg-black">
                        <img src={bugImageUrl} alt="Evidence Preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setBugImageUrl('')}
                          className="absolute top-2 right-2 bg-rose-600/90 text-white p-1 rounded-full text-xs hover:bg-rose-500 shadow transition-transform active:scale-95 cursor-pointer"
                          title="Remove photo"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Photo Attached from Photos App
                      </div>
                    </div>
                  ) : (
                    <label
                      htmlFor="mobile-bug-photo-upload"
                      className="liquid-glass-button w-full py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2.5 cursor-pointer text-xs font-bold text-zinc-300 hover:text-white transition-all duration-200 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 shadow-md active:scale-[0.98]"
                    >
                      <Camera className="w-4 h-4 text-zinc-400" />
                      <span>Attach Photo from Photos App / Camera</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex gap-2.5 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowBugModal(false)}
                  className="w-1/3 py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white font-bold text-xs rounded-2xl border border-zinc-800 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-2xl shadow-md border border-rose-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Save Bug Log</span>
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
