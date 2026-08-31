import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from '../types';
import { CheckCircle2, Clock, Bug, Smartphone, RefreshCw, Send, Check, Layers, ChevronDown, AlertTriangle, XCircle, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, Undo2, Sparkles, User, Download, Edit3, Trash2, Tag, Image, Camera, X } from 'lucide-react';
import { exportTestRunToCSV } from '../utils/exportUtils';

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
    if (activeRun && onDeleteRun) {
      onDeleteRun(activeRun.id);
    }

    // 3. Clear session storage & reset setup state
    sessionStorage.removeItem('qa_tester_name');
    sessionStorage.removeItem('qa_device_name');
    setInputReporterName('');
    setInputDeviceName('');
    setCompletedRunSummary(null);
    setSelectedStatus(null);
    setShowQuitConfirmModal(false);

    // 4. Return to setup screen
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

    const updatedRun: TestRun = {
      ...activeRun,
      planId: currentPlan.id,
      planName: currentPlan.name,
      deviceId: deviceId,
      testerName: trimmedReporter,
      deviceName: trimmedDevice,
      status: activeRun.status === 'not_started' ? 'in_progress' : activeRun.status,
      startedAt: (activeRun.status === 'not_started' || !activeRun.startedAt) ? new Date().toISOString() : activeRun.startedAt
    };

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

    setShowSetupModal(false);
  };

  // Navigate to previous step (to inspect or correct a mistake)
  const handlePreviousStep = () => {
    if (currentStepIndex > 0) {
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
      } else if (e.key === '2') {
        e.preventDefault();
        setSelectedStatus('yellow');
      } else if (e.key === '3') {
        e.preventDefault();
        setSelectedStatus('red');
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 p-0 sm:p-6 select-none font-sans relative">
      
      {/* Back to Dashboard Navigation Button (Desktop mode top banner) */}
      {isDesktop && onNavigateToDashboard && (
        <div className="w-full max-w-sm flex items-center justify-between mb-4 px-2">
          <span className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-indigo-400" /> Mobile Tester Simulator
          </span>
          <button
            type="button"
            onClick={onNavigateToDashboard}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow flex items-center gap-1.5 hover:scale-[1.02] active:scale-[0.98]"
          >
            ← Back to Dashboard
          </button>
        </div>
      )}

      {/* Mobile Device Container Frame (Edge-to-edge on phones, framed card on computer) */}
      <div className={isDesktop 
        ? "mobile-device-frame glass-panel text-slate-100 min-h-[680px] flex flex-col justify-between overflow-hidden shadow-2xl relative border-white/10 rounded-[44px]"
        : "flex-1 flex flex-col justify-between text-slate-100 bg-slate-950 w-full min-h-screen"
      }>
        
        {/* Top Phone Status Bar */}
        <div className="bg-slate-950/90 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-white/10 text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            {onNavigateToDashboard && (
              <button
                type="button"
                onClick={onNavigateToDashboard}
                className="px-2.5 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-400/40 rounded-xl text-xs font-extrabold flex items-center gap-1 transition shadow-sm active:scale-95 cursor-pointer mr-1"
                title="Exit Field QA session and return to Manager Dashboard"
              >
                <span>← Dashboard</span>
              </button>
            )}
            <span className="flex items-center gap-1.5 font-sans font-extrabold text-white text-xs">
              <Smartphone className="w-4 h-4 text-indigo-400" />
              Field QA Tester
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!showSetupModal && activeRun && activeRun.status !== 'completed' && (
              <button
                type="button"
                onClick={() => setShowQuitConfirmModal(true)}
                className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-extrabold flex items-center gap-1 transition shadow-sm active:scale-95 cursor-pointer"
                title="Quit test session, release device lock, and restore test quota"
              >
                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                <span>Quit & Release</span>
              </button>
            )}
            <span className="text-emerald-400 flex items-center gap-1.5 font-sans font-bold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live Session
            </span>
          </div>
        </div>

        {/* Mobile Navigation Tabs (Configured Test Plans vs Logged Bugs) */}
        <div className="flex border-b border-white/10 bg-slate-950/90 backdrop-blur-md p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveMobileTab('plans')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              activeMobileTab === 'plans'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg border border-indigo-400/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Configured Test Plans</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMobileTab('bugs')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              activeMobileTab === 'bugs'
                ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-lg border border-rose-400/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Bug className="w-3.5 h-3.5" />
            <span>Bug Logs</span>
            {activeBugs.length > 0 && (
              <span className="px-1.5 py-0.2 bg-white/20 text-white text-[10px] font-black rounded-full ml-0.5">
                {activeBugs.length}
              </span>
            )}
          </button>
        </div>

        {/* Test Plan & Tester Bar */}
        {testPlans.length > 0 && (
          <div className="bg-slate-950/60 backdrop-blur-xl border-b border-white/10 px-4 py-2.5 space-y-2">
            
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                <span>Plan:</span>
              </div>
              <div className="relative flex-1 max-w-[210px]">
                <div className="w-full flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/15 text-xs font-bold text-white shadow-inner truncate">
                  <span className="truncate">{currentPlan?.name || 'No Plan Assigned'}</span>
                </div>
              </div>
            </div>

            {/* Reporter & Device Info Badge */}
            <div className="flex items-center justify-between text-[11px] text-slate-300 glass-panel-subtle px-3 py-1.5 rounded-xl">
              <div className="flex items-center gap-2 truncate">
                <span className="text-white font-semibold flex items-center gap-1">
                  <User className="w-3 h-3 text-indigo-400" />
                  {activeRun?.testerName || 'Unassigned'}
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-purple-300 font-mono flex items-center gap-1 truncate font-semibold">
                  <Smartphone className="w-3 h-3 text-purple-400" />
                  {activeRun?.deviceName || 'Device Setup Needed'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSetupModal(true)}
                className="text-[10px] text-purple-300 hover:text-white font-bold flex items-center gap-0.5 ml-1 flex-shrink-0 bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30 transition"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            </div>

          </div>
        )}

        {/* Content Body */}
        {activeMobileTab === 'bugs' ? (
          <div className="p-5 flex-1 flex flex-col justify-between space-y-4 overflow-y-auto max-h-[580px]">
            
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                  <Bug className="w-4 h-4 text-rose-400" />
                  <span>Logged Defect / Bug Logs</span>
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Plan: {currentPlan?.name || 'All Plans'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowBugModal(true)}
                className="px-3 py-1.5 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 text-white font-extrabold text-xs rounded-2xl shadow-lg border border-white/20 flex items-center gap-1.5 transition-all"
              >
                <Bug className="w-3.5 h-3.5" />
                <span>+ Log Bug</span>
              </button>
            </div>

            {/* Bug List */}
            {activeBugs.length === 0 ? (
              <div className="liquid-glass-card rounded-3xl p-8 text-center space-y-3 flex-1 flex flex-col items-center justify-center border-white/10">
                <div className="p-4 bg-slate-950/80 rounded-full border border-white/10 text-slate-500 backdrop-blur-md">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">No Bugs Logged Yet</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs">
                    Tap "+ Log Bug" above to record any issue found during testing.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[420px] pr-1">
                {activeBugs.map(bug => (
                  <div key={bug.id} className="liquid-glass-panel rounded-2xl p-4 space-y-2 border-white/15 relative text-left">
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase border ${
                          bug.severity === 'critical' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                          bug.severity === 'high' ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' :
                          bug.severity === 'medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                          'bg-blue-500/20 text-blue-300 border-blue-500/40'
                        }`}>
                          {bug.severity}
                        </span>
                        <span className="text-[10px] font-mono text-purple-300 font-bold bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30">
                          {bug.feature || 'General'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-mono">{bug.formattedTime || 'Logged'}</span>
                        <button
                          type="button"
                          onClick={() => onDeleteBug(bug.id)}
                          className="text-slate-400 hover:text-rose-400 p-1 flex-shrink-0"
                          title="Delete Bug Log"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs font-bold text-white">
                      {bug.stepTitle}
                    </div>

                    <div className="text-xs text-slate-200 bg-slate-950/60 p-3 rounded-xl border border-white/10 font-medium">
                      {bug.note}
                    </div>

                    {bug.imageUrl && (
                      <div
                        onClick={() => setPreviewImageUrl(bug.imageUrl!)}
                        className="rounded-xl overflow-hidden border border-white/15 max-h-40 relative group cursor-pointer"
                      >
                        <img src={bug.imageUrl} alt="Bug screenshot" className="w-full object-cover max-h-40" />
                        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center transition">
                          <span className="px-3 py-1 bg-slate-950/90 text-purple-200 border border-purple-400/40 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5 shadow-lg">
                            <Image className="w-3.5 h-3.5 text-purple-400" /> Tap to Expand Photo
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
            <div className="p-4 bg-slate-950/80 rounded-full border border-white/10 text-slate-500 backdrop-blur-md">
              <Layers className="w-8 h-8 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">No Test Plans Available</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xs font-medium">
                Create a test plan on the Manager Dashboard to start testing on mobile.
              </p>
            </div>
          </div>
        ) : !isCompleted && currentStep ? (
          <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
            
            {/* Step Progress Bar & Interactive Step Chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-indigo-300 uppercase tracking-wider text-[10px]">Step Walkthrough</span>
                <span className="font-mono text-slate-400 text-[11px]">Step {currentStepIndex + 1} of {totalSteps}</span>
              </div>

              <div className="w-full bg-slate-950/80 h-2 rounded-full overflow-hidden border border-white/10 shadow-inner">
                <div
                  className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-full transition-all duration-300 shadow-md shadow-purple-500/20"
                  style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
                ></div>
              </div>

              {/* Sequential Step Breadcrumbs (Tap any previous step to go back and review) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none pt-0.5">
                {steps.map((s, idx) => {
                  const sRes = activeRun?.results?.[s.id];
                  const isCurrent = idx === currentStepIndex;
                  const canGoBack = idx < currentStepIndex;
                  const isDone = sRes && sRes.status && sRes.status !== 'pending';

                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!canGoBack}
                      onClick={() => {
                        if (canGoBack) handleGoToStep(idx);
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-bold transition-all flex-shrink-0 border ${
                        isCurrent
                          ? 'bg-indigo-600 text-white border-indigo-300 shadow-md ring-2 ring-indigo-400/50 scale-105'
                          : canGoBack
                          ? isDone
                            ? sRes.status === 'green'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30 cursor-pointer'
                              : sRes.status === 'yellow'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 cursor-pointer'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30 cursor-pointer'
                            : 'bg-slate-900/60 text-slate-400 border-white/10 hover:text-white cursor-pointer'
                          : 'bg-slate-900/30 text-slate-600 border-white/5 opacity-40 cursor-not-allowed'
                      }`}
                      title={canGoBack ? `Go back to Step ${idx + 1}: ${s.title}` : `Step ${idx + 1}`}
                    >
                      <span>{idx + 1}</span>
                      {isDone && (
                        <span>
                          {sRes.status === 'green' ? '✓' : sRes.status === 'yellow' ? '!' : '✗'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Test Plan Header Pill */}
            <div className="liquid-glass-pill rounded-2xl px-4 py-2 flex items-center justify-between">
              <div className="text-xs font-bold text-white truncate max-w-[220px]">{currentPlan?.name}</div>
              <span className="text-[10px] font-mono text-purple-300 font-bold bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30">
                {currentStep.feature || 'General'}
              </span>
            </div>

            {/* Current Step Instruction Card (Apple Liquid Glass Card) */}
            <div className="liquid-glass-card rounded-3xl p-5 shadow-2xl space-y-4 flex-1 flex flex-col justify-between border-white/15 bg-slate-950/40">
              
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 rounded-xl text-xs font-bold backdrop-blur-md">
                      Step #{currentStepIndex + 1}
                    </span>
                    {currentStepIndex >= totalSteps - 1 && (
                      <span className="px-2.5 py-0.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-400/40 rounded-xl text-[10px] font-extrabold uppercase tracking-wider backdrop-blur-md animate-pulse flex items-center gap-1">
                        🏁 Final Step
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => setShowBugModal(true)}
                    className="text-xs font-bold text-rose-300 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 px-3 py-1.5 rounded-2xl transition-all duration-300 flex items-center gap-1.5 backdrop-blur-md hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Bug className="w-3.5 h-3.5 text-rose-400" />
                    <span>Log Bug / Note</span>
                  </button>
                </div>

                <h3 className="text-base font-extrabold text-white leading-snug tracking-tight">
                  {currentStep.title}
                </h3>

                <p className="text-xs text-slate-200 leading-relaxed bg-slate-950/60 backdrop-blur-md p-3.5 rounded-2xl border border-white/10 font-medium">
                  {currentStep.description}
                </p>
              </div>

              {/* Expected Result Box */}
              <div className="bg-emerald-500/10 border border-emerald-400/30 backdrop-blur-md rounded-2xl p-3.5 space-y-1">
                <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Expected Outcome</div>
                <div className="text-xs font-medium text-emerald-100 leading-normal">{currentStep.expectedOutcome}</div>
              </div>

              {/* Reviewing Recorded Step Banner */}
              {hasExistingResult && (
                <div className="bg-indigo-500/15 border border-indigo-400/30 backdrop-blur-md rounded-2xl p-2.5 text-[11px] font-semibold text-indigo-200 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <Undo2 className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                    <span className="truncate">Reviewing recorded step. Modify status below if needed.</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase shrink-0 ${
                    currentStepResult?.status === 'green'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : currentStepResult?.status === 'yellow'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}>
                    Saved: {currentStepResult?.status || 'recorded'}
                  </span>
                </div>
              )}

              {/* Defects Logged on this Step (with 1-click removal for mistakes) */}
              {currentStepBugs.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] font-bold text-rose-400 uppercase tracking-widest px-1 flex items-center justify-between">
                    <span>Logged Defects on this step ({currentStepBugs.length})</span>
                    <span className="text-[9px] text-slate-400 lowercase font-normal">tap trash to remove if logged by mistake</span>
                  </div>
                  {currentStepBugs.map(b => (
                    <div key={b.id} className="bg-rose-950/40 border border-rose-500/30 rounded-2xl p-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <span className="font-bold text-rose-300">[{b.severity.toUpperCase()}]</span>{' '}
                        <span className="text-slate-200">{b.note}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteStepBug(b.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 rounded-xl transition-colors shrink-0"
                        title="Remove this mistake defect"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Inline feedback if bug was logged */}
              {bugSuccessMessage && (
                <div className="bg-rose-500/20 border border-rose-400/40 backdrop-blur-md rounded-2xl p-2.5 text-[11px] font-semibold text-rose-200 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                  <span>{bugSuccessMessage}</span>
                </div>
              )}

            </div>

            {/* 3 Status Selection Buttons: Green, Yellow, Red */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  {hasExistingResult ? 'Modify / Confirm Result' : 'Select Step Result'}
                </span>
                {hasExistingResult && currentStepResult && (
                  <span className="text-[10px] text-purple-300 font-bold bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 rounded-lg">
                    Current: {currentStepResult.status.toUpperCase()}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                
                {/* GREEN Status Button */}
                <button
                  type="button"
                  onClick={() => setSelectedStatus('green')}
                  className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                    selectedStatus === 'green'
                      ? 'bg-emerald-500/30 text-white border-emerald-400 shadow-xl shadow-emerald-500/30 ring-2 ring-emerald-400/50 scale-[1.02]'
                      : 'liquid-glass-button text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-400/40'
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>Pass</span>
                </button>

                {/* YELLOW Status Button */}
                <button
                  type="button"
                  onClick={() => setSelectedStatus('yellow')}
                  className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                    selectedStatus === 'yellow'
                      ? 'bg-amber-500/30 text-white border-amber-400 shadow-xl shadow-amber-500/30 ring-2 ring-amber-400/50 scale-[1.02]'
                      : 'liquid-glass-button text-amber-300 hover:bg-amber-500/20 hover:border-amber-400/40'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <span>Caution</span>
                </button>

                {/* RED Status Button */}
                <button
                  type="button"
                  onClick={() => setSelectedStatus('red')}
                  className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                    selectedStatus === 'red'
                      ? 'bg-rose-500/30 text-white border-rose-400 shadow-xl shadow-rose-500/30 ring-2 ring-rose-400/50 scale-[1.02]'
                      : 'liquid-glass-button text-rose-300 hover:bg-rose-500/20 hover:border-rose-400/40'
                  }`}
                >
                  <XCircle className="w-5 h-5 text-rose-400" />
                  <span>Fail</span>
                </button>

              </div>

              {/* Navigation Action Buttons Row (Previous, Confirm/Update, Next) */}
              <div className="flex items-center gap-2 pt-1">
                {/* Back / Previous Step Button */}
                {currentStepIndex > 0 && (
                  <button
                    type="button"
                    onClick={handlePreviousStep}
                    className="px-3.5 py-3.5 liquid-glass-button text-slate-300 hover:text-white rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 flex-shrink-0 cursor-pointer"
                    title="Go back to previous step to review or fix a mistake"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>
                )}

                {/* Confirm & Move to Next Step Button */}
                <button
                  type="button"
                  disabled={!selectedStatus}
                  onClick={handleConfirmStepStatus}
                  className={`flex-1 py-3.5 rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition-all duration-300 shadow-xl cursor-pointer ${
                    selectedStatus
                      ? currentStepIndex >= totalSteps - 1
                        ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 text-white shadow-emerald-500/30 border border-white/30 hover:scale-[1.02] active:scale-[0.98]'
                        : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-purple-500/30 border border-white/30 hover:scale-[1.02] active:scale-[0.98]'
                      : 'liquid-glass-button text-slate-500 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <span>
                    {selectedStatus
                      ? currentStepIndex >= totalSteps - 1
                        ? hasExistingResult
                          ? `Update ${selectedStatus.toUpperCase()} & Finish Run`
                          : `Confirm ${selectedStatus.toUpperCase()} & Finish Run`
                        : hasExistingResult
                          ? `Update ${selectedStatus.toUpperCase()} & Next`
                          : `Confirm ${selectedStatus.toUpperCase()} & Next Step`
                      : 'Select Result Above'}
                  </span>
                  {currentStepIndex >= totalSteps - 1 ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                </button>

                {/* Confirm & Move to Next Step Button */}
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
                  <p className="text-xs text-slate-300 max-w-xs font-medium">
                    All steps in "{currentPlan?.name}" have been executed.
                  </p>
                </div>

                {/* Results breakdown */}
                <div className="w-full liquid-glass-panel rounded-2xl p-4 space-y-2 text-xs border-white/10">
                  <div className="font-bold text-white flex items-center justify-between border-b border-white/10 pb-2">
                    <span>Total Steps Executed</span>
                    <span className="font-mono text-indigo-300">{summaryResultsArray.length || totalSteps}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Reporter Name:</span>
                    <span className="text-white font-bold">{summaryRun?.testerName || inputReporterName || 'Field Tester'}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Device Model:</span>
                    <span className="text-purple-300 font-mono font-bold">{summaryRun?.deviceName || inputDeviceName || 'N/A'}</span>
                  </div>
                  {durationSecs > 0 && (
                    <div className="flex justify-between text-slate-300">
                      <span>Total Duration:</span>
                      <span className="text-indigo-300 font-mono font-bold">{durationFormatted}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-emerald-300 pt-1.5 border-t border-white/10 font-semibold">
                    <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Green (Pass):</span>
                    <span className="font-mono font-bold">{summaryGreen}</span>
                  </div>
                  <div className="flex justify-between text-amber-300 font-semibold">
                    <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Yellow (Caution):</span>
                    <span className="font-mono font-bold">{summaryYellow}</span>
                  </div>
                  <div className="flex justify-between text-rose-300 font-semibold">
                    <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-rose-400" /> Red (Fail):</span>
                    <span className="font-mono font-bold">{summaryRed}</span>
                  </div>
                </div>

                {/* Logged Bugs List */}
                {bugLogsList.length > 0 && (
                  <div className="w-full liquid-glass-card rounded-2xl p-3.5 text-xs space-y-2 text-left border-white/15">
                    <div className="font-bold text-rose-300 flex items-center justify-between pb-1.5 border-b border-white/10">
                      <span>Logged Bugs ({bugLogsList.length}):</span>
                      <span className="text-[10px] text-slate-400">Tap trash to delete</span>
                    </div>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {bugLogsList.map((bug: any) => (
                        <div key={bug.id} className="flex items-center justify-between bg-slate-950/60 p-2 rounded-xl border border-white/10 text-[11px]">
                          <div className="truncate pr-2">
                            <span className="font-mono text-purple-300 mr-1 text-[10px]">[{bug.feature || 'General'}]</span>
                            <span className="text-slate-200">{bug.note}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onDeleteBug(bug.id)}
                            className="text-slate-400 hover:text-rose-400 p-1 flex-shrink-0"
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
                    className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold text-xs rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl shadow-indigo-500/25 border border-white/20 hover:scale-[1.01] active:scale-[0.99]"
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
          <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-2xl p-6 flex flex-col items-center justify-center text-center z-[100] animate-in fade-in duration-200 rounded-[44px]">
            <div className="p-4 bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/40 mb-4 shadow-xl shadow-rose-500/20">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h3 className="text-lg font-extrabold text-white mb-2 tracking-tight">Session Terminated</h3>
            <p className="text-xs text-slate-300 max-w-xs mb-6 leading-relaxed font-medium">
              An administrator has ended your QA session from the desktop manager dashboard.
            </p>
            <button
              type="button"
              onClick={() => {
                setBootMessage(null);
                setShowSetupModal(true);
              }}
              className="px-6 py-3 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-extrabold text-xs rounded-2xl shadow-xl shadow-rose-500/30 border border-white/20 active:scale-95 transition-all cursor-pointer"
            >
              Back to Test Plans
            </button>
          </div>
        )}

        {/* Quit Test Session Confirmation Modal */}
        {showQuitConfirmModal && (
          <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-2xl p-6 flex flex-col items-center justify-center text-center z-[110] animate-in fade-in duration-200 rounded-[44px]">
            <div className="p-4 bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/40 mb-4 shadow-xl shadow-rose-500/20">
              <XCircle className="w-10 h-10 text-rose-400" />
            </div>
            <h3 className="text-xl font-extrabold text-white mb-2 tracking-tight">Quit Session & Release Device?</h3>
            <p className="text-xs text-slate-300 max-w-xs mb-6 leading-relaxed font-medium">
              This will abort your active test walkthrough, release <span className="text-purple-300 font-bold font-mono">{activeRun?.deviceName || 'Target Device'}</span> lock, delete this uncompleted session, and restore today's test quota.
            </p>
            <div className="flex items-center gap-3 w-full max-w-xs">
              <button
                type="button"
                onClick={() => setShowQuitConfirmModal(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-2xl border border-slate-700 active:scale-95 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleQuitAndReleaseSession}
                className="flex-1 py-3 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-extrabold text-xs rounded-2xl shadow-xl shadow-rose-500/30 border border-white/20 active:scale-95 transition-all cursor-pointer"
              >
                Quit & Release
              </button>
            </div>
          </div>
        )}

        {/* Pre-Test Session Setup Modal */}
        {showSetupModal && !completedRunSummary && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-2xl p-6 flex flex-col justify-center z-50 animate-in fade-in duration-200 rounded-[44px]">
            
            <form onSubmit={handleSaveSessionSetup} className="space-y-5 max-w-sm mx-auto w-full">
              
              <div className="text-center space-y-1.5">
                <div className="p-3.5 bg-indigo-500/20 text-indigo-300 rounded-2xl w-fit mx-auto border border-indigo-400/30 backdrop-blur-md shadow-lg shadow-indigo-500/10">
                  <Smartphone className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-extrabold text-white tracking-tight">Start Field QA Session</h3>
                <p className="text-xs text-slate-300 font-medium leading-relaxed">
                  Enter your name and mobile device model to begin testing.
                </p>
              </div>

              <div className="liquid-glass-panel rounded-3xl p-5 space-y-4 border-white/15 shadow-2xl">
                
                {/* QA Tester Custom Trigger */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-400" />
                    Select QA Tester
                  </label>
                  {testers.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOpenTesterPickerModal(true)}
                      className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all text-left group cursor-pointer active:scale-[0.99] ${
                        inputReporterName
                          ? 'bg-slate-900/90 border-indigo-500/40 shadow-md ring-1 ring-indigo-500/20'
                          : 'bg-slate-900/70 border-white/15 hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow flex-shrink-0">
                          {selectedTesterProfile ? selectedTesterProfile.name.charAt(0).toUpperCase() : <User className="w-4 h-4 text-indigo-200" />}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-extrabold text-white truncate">
                            {selectedTesterProfile ? selectedTesterProfile.name : (inputReporterName || 'Choose QA Tester...')}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {selectedTesterProfile?.role || 'Tap to select tester profile'}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-white flex-shrink-0 transition-transform" />
                    </button>
                  ) : (
                    <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-amber-200 text-xs font-semibold text-center leading-relaxed">
                      ⚠️ No QA tester profiles created yet. Register tester profiles on the Web Dashboard.
                    </div>
                  )}
                </div>

                {/* Target Device Custom Trigger */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                    Select Target Device
                  </label>
                  {selectableDevices.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOpenDevicePickerModal(true)}
                      className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all text-left group cursor-pointer active:scale-[0.99] ${
                        inputDeviceName
                          ? 'bg-slate-900/90 border-purple-500/40 shadow-md ring-1 ring-purple-500/20'
                          : 'bg-slate-900/70 border-white/15 hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-600 text-white flex items-center justify-center font-bold text-xs shadow flex-shrink-0">
                          <Smartphone className="w-4 h-4 text-purple-200" />
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-extrabold text-white truncate">
                            {selectedDeviceProfile ? selectedDeviceProfile.name : (inputDeviceName || 'Choose Mobile Device...')}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
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
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-white flex-shrink-0 transition-transform" />
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
                className="w-full py-3.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:to-pink-400 text-white font-extrabold text-xs rounded-2xl shadow-xl shadow-purple-500/25 border border-white/30 flex items-center justify-center gap-2 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span>Start QA Walkthrough</span>
                <ArrowRight className="w-4 h-4" />
              </button>

            </form>

          </div>
        )}

        {/* Custom Tester Picker Modal (Centered) */}
        {openTesterPickerModal && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl z-[80] flex items-center justify-center p-4 animate-in fade-in duration-200 rounded-[44px]">
            <div className="bg-slate-900/95 border border-white/20 rounded-3xl p-5 space-y-4 w-full max-h-[85%] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <User className="w-4 h-4 text-indigo-400" />
                    <span>Select QA Tester</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Choose who is running this QA walkthrough</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenTesterPickerModal(false)}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition cursor-pointer"
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
                        setInputReporterName(t.name);
                        setOpenTesterPickerModal(false);
                      }}
                      className={`w-full p-3.5 rounded-2xl text-left border flex items-center justify-between gap-3 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border-indigo-400/50 shadow-lg ring-1 ring-indigo-500/40 scale-[1.01]'
                          : 'bg-slate-950/60 border-white/10 hover:bg-slate-950/90 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm shadow flex-shrink-0">
                          {t.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-black text-white truncate">{t.name}</div>
                          <div className="text-[10px] text-indigo-300 font-medium truncate">{t.role || 'QA Tester'}</div>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 shadow">
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
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl z-[80] flex items-center justify-center p-4 animate-in fade-in duration-200 rounded-[44px]">
            <div className="bg-slate-900/95 border border-white/20 rounded-3xl p-5 space-y-4 w-full max-h-[85%] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-purple-400" />
                    <span>Select Target Device</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Devices configured with active daily quotas</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenDevicePickerModal(false)}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition cursor-pointer"
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
                          ? 'bg-gradient-to-r from-purple-900/40 to-pink-900/40 border-purple-400/50 shadow-lg ring-1 ring-purple-500/40 scale-[1.01]'
                          : 'bg-slate-950/60 border-white/10 hover:bg-slate-950/90 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-600 text-white flex items-center justify-center font-bold text-sm shadow flex-shrink-0">
                          <Smartphone className="w-4 h-4 text-purple-200" />
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-black text-white truncate">{dev.name}</div>
                          <div className="text-[10px] text-purple-300 font-mono font-semibold truncate">
                            {quotaText ? `⚡ ${quotaText}` : 'Ready'}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center flex-shrink-0 shadow">
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

        {/* Bug Modal (Apple Liquid Glass Modal) */}
        {showBugModal && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-2xl p-6 flex flex-col justify-between z-50 animate-in fade-in duration-200 rounded-[44px]">
            
            <form onSubmit={handleReportBugSubmit} className="h-full flex flex-col justify-between space-y-4">
              
              <div className="space-y-3.5">
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <h4 className="text-sm font-black text-rose-300 flex items-center gap-1.5 tracking-tight">
                    <Bug className="w-4 h-4 text-rose-400" />
                    Bug / Note Entry
                  </h4>
                  <div className="text-[10px] font-mono text-slate-300 bg-white/10 px-2.5 py-1 rounded-xl border border-white/15 backdrop-blur-md flex items-center gap-1">
                    <Clock className="w-3 h-3 text-indigo-400" />
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <div className="liquid-glass-pill rounded-2xl p-2.5 text-xs text-indigo-200 flex items-center justify-between font-semibold">
                  <span>Feature: <strong className="text-purple-300 font-mono">{currentStep?.feature || 'General'}</strong></span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Step Target</label>
                  <div className="text-xs font-bold text-white liquid-glass-card p-3 rounded-2xl border-white/15">
                    Step #{currentStepIndex + 1}: {currentStep?.title}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Reporter</label>
                    <div className="liquid-glass-input p-2.5 rounded-2xl text-slate-200 font-semibold truncate">{activeRun?.testerName || 'N/A'}</div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Device Model</label>
                    <div className="liquid-glass-input p-2.5 rounded-2xl text-purple-300 font-mono font-bold truncate">{activeRun?.deviceName || 'N/A'}</div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Bug Description / Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Describe what went wrong or observation notes..."
                    value={bugNote}
                    onChange={e => setBugNote(e.target.value)}
                    className="w-full liquid-glass-input rounded-2xl p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none font-medium leading-relaxed"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
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
                      <div className="relative w-full h-32 rounded-2xl overflow-hidden border border-white/20 shadow-md bg-slate-950">
                        <img src={bugImageUrl} alt="Evidence Preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setBugImageUrl('')}
                          className="absolute top-2 right-2 bg-rose-600/90 text-white p-1 rounded-full text-xs hover:bg-rose-500 shadow transition-transform active:scale-95"
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
                      className="liquid-glass-button w-full py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2.5 cursor-pointer text-xs font-bold text-slate-200 hover:text-white transition-all duration-300 border-white/20 hover:bg-white/15 shadow-lg active:scale-[0.98]"
                    >
                      <Camera className="w-4 h-4 text-purple-400" />
                      <span>Attach Photo from Photos App / Camera</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex gap-2.5 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowBugModal(false)}
                  className="w-1/3 py-3 liquid-glass-button text-slate-300 hover:text-white font-bold text-xs rounded-2xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-3 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 text-white font-extrabold text-xs rounded-2xl shadow-xl shadow-rose-500/25 border border-white/20 flex items-center justify-center gap-1.5 transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                  Save Bug Log
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
              backgroundColor: 'rgba(2, 6, 23, 0.96)',
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
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '1rem',
                padding: '0.75rem 1rem',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
                zIndex: 10
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-lg active:scale-95 transition-all"
              >
                <span>← Back</span>
              </button>

              <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Image className="w-4 h-4 text-purple-400" /> Photo Evidence Preview
              </span>

              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
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
                backgroundColor: '#030712',
                borderRadius: '1.25rem',
                border: '1px solid rgba(255, 255, 255, 0.15)',
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
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '1rem',
                padding: '0.75rem 1rem',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
                zIndex: 10
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white text-xs font-extrabold rounded-xl shadow-xl border border-white/20 active:scale-95 cursor-pointer transition-all"
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
