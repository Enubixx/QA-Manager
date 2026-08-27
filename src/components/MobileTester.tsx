import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TestPlan, TestRun, BugLog } from '../types';
import { CheckCircle2, Clock, Bug, Smartphone, RefreshCw, Send, Check, Layers, ChevronDown, AlertTriangle, XCircle, ArrowRight, User, Download, Edit3, Trash2, Tag, Image, Camera, X } from 'lucide-react';
import { exportTestRunToCSV } from '../utils/exportUtils';

interface MobileTesterProps {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  archivedRuns?: TestRun[];
  selectedPlanId: string;
  populatedDevices: string[];
  onAddPopulatedDevice: (device: string) => void;
  onSelectPlan: (planId: string) => void;
  onUpdateRun: (updatedRun: TestRun) => void;
  onLogBug: (bug: BugLog) => void;
  onDeleteBug: (bugId: string) => void;
  onRestartRun: (planId: string) => void;
  onNavigateToDashboard?: () => void;
}

export const MobileTester: React.FC<MobileTesterProps> = ({
  testPlans,
  testRuns,
  archivedRuns = [],
  selectedPlanId,
  populatedDevices,
  onAddPopulatedDevice,
  onSelectPlan,
  onUpdateRun,
  onLogBug,
  onDeleteBug,
  onRestartRun,
  onNavigateToDashboard
}) => {
  // Find current plan
  const currentPlan = testPlans.find(p => p.id === selectedPlanId) || testPlans[0];

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

  // Find active run specifically for THIS device & plan
  let activeRun = testRuns.find(r => 
    r.planId === currentPlan?.id && 
    r.status !== 'completed' &&
    (r.deviceId === deviceId || r.id.includes(deviceId))
  );

  // Fallback: check if an unassigned active run matching legacy ID exists
  if (!activeRun && currentPlan) {
    activeRun = testRuns.find(r => r.id === 'run-' + currentPlan.id && r.status !== 'completed');
  }

  if (!activeRun && currentPlan) {
    const savedName = localStorage.getItem('qa_tester_name') || '';
    const savedDevice = localStorage.getItem('qa_device_name') || '';
    const uniqueSuffix = Date.now().toString(36);
    activeRun = {
      id: `run-${currentPlan.id}-${deviceId}-${uniqueSuffix}`,
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

  // Active Mobile View Tab: 'plans' (Configured Test Plans) vs 'bugs' (Logged Bugs)
  const [activeMobileTab, setActiveMobileTab] = useState<'plans' | 'bugs'>('plans');

  // Pre-test Session Setup state (Reporter Name & Device Name)
  const [showSetupModal, setShowSetupModal] = useState<boolean>(() => {
    return !activeRun?.testerName || !activeRun?.deviceName;
  });

  const [inputReporterName, setInputReporterName] = useState(() => activeRun?.testerName || localStorage.getItem('qa_tester_name') || '');
  const [inputDeviceName, setInputDeviceName] = useState(() => activeRun?.deviceName || localStorage.getItem('qa_device_name') || '');

  const steps = currentPlan?.steps || [];
  const currentStepIndex = activeRun?.currentStepIndex || 0;
  const currentStep = steps[currentStepIndex];
  const totalSteps = steps.length;
  
  // Explicit state for completion summary view
  const [completedRunSummary, setCompletedRunSummary] = useState<TestRun | null>(null);
  const isCompleted = completedRunSummary !== null || ((activeRun?.status === 'completed' || currentStepIndex >= totalSteps) && totalSteps > 0 && activeRun?.status !== 'not_started');

  // Selected Status for current step
  const [selectedStatus, setSelectedStatus] = useState<'green' | 'yellow' | 'red' | null>(null);

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

    // Persist to local device storage so the tester never has to re-type on this device
    localStorage.setItem('qa_tester_name', trimmedReporter);
    localStorage.setItem('qa_device_name', trimmedDevice);

    onAddPopulatedDevice(trimmedDevice);

    const updatedRun: TestRun = {
      ...activeRun,
      deviceId: deviceId,
      testerName: trimmedReporter,
      deviceName: trimmedDevice,
      status: activeRun.status === 'not_started' ? 'in_progress' : activeRun.status,
      startedAt: (activeRun.status === 'not_started' || !activeRun.startedAt) ? new Date().toISOString() : activeRun.startedAt
    };

    onUpdateRun(updatedRun);
    setShowSetupModal(false);
  };

  // Submit Step with Selected Status
  const handleConfirmStepStatus = () => {
    if (!currentStep || !activeRun || !selectedStatus) return;

    const now = new Date();
    const isoTimestamp = now.toISOString();

    const updatedResults = {
      ...activeRun.results,
      [currentStep.id]: {
        stepId: currentStep.id,
        status: selectedStatus,
        feature: currentStep.feature || 'General',
        timestamp: isoTimestamp
      }
    };

    const nextIndex = currentStepIndex + 1;
    const isDone = nextIndex >= totalSteps;

    const updatedRun: TestRun = {
      ...activeRun,
      results: updatedResults,
      currentStepIndex: nextIndex,
      status: isDone ? 'completed' : 'in_progress',
      completedAt: isDone ? isoTimestamp : undefined
    };

    if (isDone) {
      setCompletedRunSummary(updatedRun);
    }

    onUpdateRun(updatedRun);
    setSelectedStatus(null);
    setBugSuccessMessage(null);
  };

  // Keyboard Shortcuts listener (1 = Green, 2 = Yellow, 3 = Red, Enter = Confirm & Next, B = Log Bug)
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
      } else if (e.key === 'Enter' && selectedStatus) {
        e.preventDefault();
        handleConfirmStepStatus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSetupModal, isCompleted, showBugModal, selectedStatus, currentStep, activeRun]);

  // Real-Time Admin Boot Detection (kicks tester out in real time if session or tester is deleted on Desktop)
  const [activeRunIdBeingTested, setActiveRunIdBeingTested] = useState<string | null>(null);
  const [activeTesterNameBeingTested, setActiveTesterNameBeingTested] = useState<string | null>(null);
  const [bootMessage, setBootMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!showSetupModal && activeRun && activeRun.status === 'in_progress' && !isCompleted) {
      setActiveRunIdBeingTested(activeRun.id);
      if (activeRun.testerName) {
        setActiveTesterNameBeingTested(activeRun.testerName);
      }
    }
  }, [showSetupModal, activeRun, isCompleted]);

  useEffect(() => {
    if (showSetupModal || isCompleted) return;

    // 1. Check if the active run session ID was deleted by Admin
    if (activeRunIdBeingTested) {
      const runStillActive = testRuns.some(r => r.id === activeRunIdBeingTested);
      const runArchived = archivedRuns.some(r => r.id === activeRunIdBeingTested);

      if (!runStillActive && !runArchived) {
        setBootMessage(`⚠️ Session Terminated: An administrator has booted your QA session from the manager dashboard.`);
        setShowSetupModal(true);
        setActiveRunIdBeingTested(null);
        setActiveTesterNameBeingTested(null);
        return;
      }
    }

    // 2. Check if the entire tester profile was deleted by Admin
    if (activeTesterNameBeingTested) {
      const testerNameLower = activeTesterNameBeingTested.trim().toLowerCase();
      const hasAnyRuns = testRuns.some(r => r.testerName?.trim().toLowerCase() === testerNameLower) ||
                         archivedRuns.some(r => r.testerName?.trim().toLowerCase() === testerNameLower);

      if (!hasAnyRuns) {
        setBootMessage(`⚠️ Session Terminated: Your tester profile (${activeTesterNameBeingTested}) was deleted by an administrator.`);
        setShowSetupModal(true);
        setActiveRunIdBeingTested(null);
        setActiveTesterNameBeingTested(null);
      }
    }
  }, [testRuns, archivedRuns, activeRunIdBeingTested, activeTesterNameBeingTested, showSetupModal, isCompleted]);

  // Auto-kick user to setup screen if active run or plan gets deleted
  useEffect(() => {
    if (!currentPlan || !activeRun?.testerName || !activeRun?.deviceName) {
      setShowSetupModal(true);
    }
  }, [currentPlan, activeRun?.testerName, activeRun?.deviceName]);

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
      stepTitle: currentStep?.title || `General Mobile Defect (${currentPlan.name})`,
      feature: currentStep?.feature || 'General',
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
      onUpdateRun(updatedRun);
    } catch (err) {
      console.warn('onUpdateRun error:', err);
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
          <span className="text-emerald-400 flex items-center gap-1.5 font-sans font-bold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Live Session
          </span>
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
            {activeRun?.bugLogs && activeRun.bugLogs.length > 0 && (
              <span className="px-1.5 py-0.2 bg-white/20 text-white text-[10px] font-black rounded-full ml-0.5">
                {activeRun.bugLogs.length}
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
                <select
                  value={currentPlan?.id || ''}
                  onChange={e => {
                    setCompletedRunSummary(null);
                    setSelectedStatus(null);
                    onSelectPlan(e.target.value);
                    setShowSetupModal(true);
                  }}
                  style={{ backgroundColor: '#0b101d', color: '#e0e7ff', WebkitAppearance: 'none', appearance: 'none' }}
                  className="w-full dark-select-input rounded-xl px-3 py-1.5 text-xs font-bold shadow-inner focus:outline-none focus:border-indigo-500 cursor-pointer truncate pr-6"
                >
                  {testPlans.map(plan => (
                    <option key={plan.id} value={plan.id} style={{ backgroundColor: '#090d16', color: '#f1f5f9' }} className="bg-slate-950 text-slate-100 py-1 font-bold">
                      {plan.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
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
            {(!activeRun?.bugLogs || activeRun.bugLogs.length === 0) ? (
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
                {activeRun.bugLogs.map(bug => (
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
            
            {/* Step Progress Bar */}
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
                  <span className="px-3 py-1 bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 rounded-xl text-xs font-bold backdrop-blur-md">
                    Step #{currentStepIndex + 1}
                  </span>

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
              <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider px-1">
                Select Step Result
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                
                {/* GREEN Status Button */}
                <button
                  type="button"
                  onClick={() => setSelectedStatus('green')}
                  className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border ${
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
                  className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border ${
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
                  className={`py-3 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all border ${
                    selectedStatus === 'red'
                      ? 'bg-rose-500/30 text-white border-rose-400 shadow-xl shadow-rose-500/30 ring-2 ring-rose-400/50 scale-[1.02]'
                      : 'liquid-glass-button text-rose-300 hover:bg-rose-500/20 hover:border-rose-400/40'
                  }`}
                >
                  <XCircle className="w-5 h-5 text-rose-400" />
                  <span>Fail</span>
                </button>

              </div>

              {/* Confirm & Move to Next Step Button */}
              <button
                type="button"
                disabled={!selectedStatus}
                onClick={handleConfirmStepStatus}
                className={`w-full py-3.5 rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition-all duration-300 shadow-xl ${
                  selectedStatus
                    ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-purple-500/30 border border-white/30 hover:scale-[1.02] active:scale-[0.98]'
                    : 'liquid-glass-button text-slate-500 opacity-50 cursor-not-allowed'
                }`}
              >
                <span>{selectedStatus ? `Confirm ${selectedStatus.toUpperCase()} & Next Step` : 'Select Result Above'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          </div>
        ) : (
          /* Completion Summary View (Liquid Glass Style) */
          (() => {
            const summaryRun = completedRunSummary || activeRun;
            const summaryResults = summaryRun?.results || {};
            const summaryResultsArray = Object.values(summaryResults);
            const summaryGreen = summaryResultsArray.filter(r => r.status === 'green').length;
            const summaryYellow = summaryResultsArray.filter(r => r.status === 'yellow').length;
            const summaryRed = summaryResultsArray.filter(r => r.status === 'red').length;

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
                      {bugLogsList.map(bug => (
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
                      const savedName = localStorage.getItem('qa_tester_name') || activeRun?.testerName || '';
                      const savedDevice = localStorage.getItem('qa_device_name') || activeRun?.deviceName || '';
                      if (savedName) setInputReporterName(savedName);
                      if (savedDevice) setInputDeviceName(savedDevice);
                      if (currentPlan) {
                        onRestartRun(currentPlan.id);
                      }
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

        {/* Pre-Test Session Setup Modal */}
        {showSetupModal && (
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
                
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-400" />
                    Reporter Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Alex Rivera"
                    value={inputReporterName}
                    onChange={e => setInputReporterName(e.target.value)}
                    className="w-full liquid-glass-input rounded-2xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none font-medium"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                    Device Model
                  </label>
                  <input
                    type="text"
                    placeholder="Enter device model..."
                    value={inputDeviceName}
                    onChange={e => setInputDeviceName(e.target.value)}
                    className="w-full liquid-glass-input rounded-2xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none font-medium"
                    required
                  />
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
