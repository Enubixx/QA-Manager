import React from 'react';
import { RefreshCw, Layers, X, Trash2 } from 'lucide-react';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, DevicePlanQuota } from '../../types';
import { APP_VERSION_OPTIONS } from '../../constants';
import { getRunAutoReleasedMeta } from '../../utils/runUtils';
import { getLocalDateStr as getLocalDateStrUtil } from '../../utils/dateUtils';

export interface ActiveTesterMetrics {
  deviceName: string;
  deviceId?: string;
  planName?: string;
  runId?: string;
  startedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepTitle?: string;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  progressPct: number;
  isAway: boolean;
}

export interface CompletedRunSummaryItem {
  runId: string;
  planName: string;
  deviceName: string;
  completedAtFormatted: string;
  durationMs: number;
  durationFormatted: string;
  greenCount: number;
  yellowCount: number;
  redCount: number;
}

export interface TesterPerformanceProfile {
  testerName: string;
  devicesUsed: Set<string>;
  allTimeCompletedCount: number;
  dailyStats: Record<
    string,
    {
      dateStr: string;
      completedCount: number;
      totalDurationMs: number;
      devicesUsedOnDay: Set<string>;
      completedRuns: CompletedRunSummaryItem[];
    }
  >;
}

export interface UnifiedTesterItem {
  id?: string;
  name: string;
  role: string;
  performanceProfile?: TesterPerformanceProfile;
}

export interface EnrichedDevice extends DeviceProfile {
  assignedQuota: DevicePlanQuota | null;
  hasAssignedPlan: boolean;
  assignedPlan: TestPlan | null;
  targetRuns: number;
  doneToday: number;
  remaining: number;
  pct: number;
  activeRunForDevice: TestRun | undefined;
  isInUse: boolean;
  inUseTesterName: string;
  activeTesterInfo: ActiveTesterMetrics | undefined;
}

export interface EnrichedTester extends UnifiedTesterItem {
  testerKey: string;
  dayData: {
    completedCount: number;
    totalDurationMs: number;
    completedRuns: CompletedRunSummaryItem[];
    devicesUsedOnDay: Set<string>;
  };
  completedRunsList: CompletedRunSummaryItem[];
  avgMs: number;
  avgFormatted: string;
  floorTimeFormatted: string;
  isActive: boolean;
  activeInfo: ActiveTesterMetrics | undefined;
  devicePills: {
    key: string;
    deviceId?: string;
    deviceName: string;
    label: string;
    isDone: boolean;
    tooltip: string;
  }[];
  dayDevices: string[];
  bugCount: number;
  lastRun: CompletedRunSummaryItem | null;
  allTimeRuns: number;
}

interface PoolRosterDrawerProps {
  devices: DeviceProfile[];
  unassignedDevices: DeviceProfile[];
  enrichedDevices: EnrichedDevice[];
  unifiedTesters: UnifiedTesterItem[];
  sortedTesters: EnrichedTester[];
  testRuns: TestRun[];
  archivedRuns: TestRun[];
  newDeviceName: string;
  setNewDeviceName: React.Dispatch<React.SetStateAction<string>>;
  newPersonName: string;
  setNewPersonName: React.Dispatch<React.SetStateAction<string>>;
  newPersonRole: string;
  setNewPersonRole: React.Dispatch<React.SetStateAction<string>>;
  setShowOffShiftTesters: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickActivateDeviceId: React.Dispatch<React.SetStateAction<string>>;
  setInspectorTarget: React.Dispatch<React.SetStateAction<{ type: 'device' | 'tester'; id: string } | null>>;
  onSaveDevice?: (device: DeviceProfile) => void;
  onDeleteDevice?: (deviceId: string) => void;
  onSaveTester?: (tester: TesterProfile) => void;
  onDeleteTesterProfile?: (testerId: string) => void;
  onDeleteTester?: (testerName: string) => void;
  onDeleteTestRun?: (runId: string) => void;
}

export const PoolRosterDrawer: React.FC<PoolRosterDrawerProps> = ({
  devices,
  unassignedDevices,
  enrichedDevices,
  unifiedTesters,
  sortedTesters,
  testRuns,
  archivedRuns,
  newDeviceName,
  setNewDeviceName,
  newPersonName,
  setNewPersonName,
  newPersonRole,
  setNewPersonRole,
  setShowOffShiftTesters,
  setQuickActivateDeviceId,
  setInspectorTarget,
  onSaveDevice,
  onDeleteDevice,
  onSaveTester,
  onDeleteTesterProfile,
  onDeleteTester,
  onDeleteTestRun
}) => {
  return (
    <div className="px-5 py-3.5 bg-[#0b1120] border-b border-[#162036] grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left: Device Pool */}
      <div className="space-y-2 lg:border-r lg:border-slate-800/80 lg:pr-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Device Pool · {devices.length} total ({unassignedDevices.length} unassigned)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="New device ID (e.g. WP06)..."
            value={newDeviceName}
            onChange={e => setNewDeviceName(e.target.value)}
            className="flex-1 bg-[#090d16] border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => {
              const trimmed = newDeviceName.trim();
              if (!trimmed) return;
              if (devices.some(d => d.name.trim().toLowerCase() === trimmed.toLowerCase())) {
                alert(`Device "${trimmed}" already exists.`);
                return;
              }
              const newDev: DeviceProfile = {
                id: `dev-${Date.now()}`,
                name: trimmed,
                isReady: true,
                quotas: []
              };
              if (onSaveDevice) onSaveDevice(newDev);
              setQuickActivateDeviceId(newDev.id);
              setNewDeviceName('');
            }}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shrink-0"
          >
            ＋ Add
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-0.5 max-h-32 overflow-y-auto">
          {enrichedDevices.map(dev => (
            <div
              key={dev.id}
              onClick={() => {
                setQuickActivateDeviceId(dev.id);
                setInspectorTarget({ type: 'device', id: dev.id });
              }}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                dev.hasAssignedPlan
                  ? 'bg-[#13203a] border-blue-500/40 text-blue-200'
                  : 'bg-[#090d16] border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  dev.isInUse
                    ? 'bg-rose-400'
                    : dev.hasAssignedPlan
                      ? 'bg-emerald-400'
                      : 'bg-slate-600'
                }`}
              />
              <span className="font-bold">{dev.name}</span>
              {dev.hasAssignedPlan && (
                <span className="text-[10px] text-emerald-300">
                  {dev.doneToday}/{dev.targetRuns}
                </span>
              )}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (onDeleteDevice) onDeleteDevice(dev.id);
                }}
                className="text-slate-500 hover:text-rose-400 ml-0.5 cursor-pointer"
                title={`Delete ${dev.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Saved Testers Roster */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Roster · {unifiedTesters.length} testers
          </span>
          <button
            type="button"
            onClick={() => setShowOffShiftTesters(false)}
            className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
          >
            Close ✕
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Tester name..."
            value={newPersonName}
            onChange={e => setNewPersonName(e.target.value)}
            className="flex-1 bg-[#090d16] border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Role..."
            value={newPersonRole}
            onChange={e => setNewPersonRole(e.target.value)}
            className="w-28 bg-[#090d16] border border-slate-800 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => {
              const trimmedName = newPersonName.trim();
              if (!trimmedName) return;
              if (unifiedTesters.some(t => t.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
                alert(`Tester "${trimmedName}" already exists.`);
                return;
              }
              const newTester: TesterProfile = {
                id: `tester-${Date.now()}`,
                name: trimmedName,
                role: newPersonRole.trim() || 'Mobile Tester'
              };
              if (onSaveTester) onSaveTester(newTester);
              setInspectorTarget({ type: 'tester', id: newTester.name });
              setNewPersonName('');
            }}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shrink-0"
          >
            ＋ Add
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-0.5 max-h-32 overflow-y-auto">
          {sortedTesters.map(t => {
            const hasActivity = t.isActive || t.dayData.completedCount > 0 || t.bugCount > 0;
            return (
              <div
                key={t.id || t.name}
                onClick={() => setInspectorTarget({ type: 'tester', id: t.name })}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] transition cursor-pointer ${
                  hasActivity
                    ? 'bg-[#13203a] border-blue-500/40 text-slate-100'
                    : 'bg-[#090d16] border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    t.isActive
                      ? 'bg-emerald-400'
                      : hasActivity
                        ? 'bg-blue-400'
                        : 'bg-slate-600'
                  }`}
                />
                <span className="font-medium text-slate-200">{t.name}</span>
                {t.dayData.completedCount > 0 && (
                  <span className="font-mono text-[10px] text-blue-300">
                    {t.dayData.completedCount}d
                  </span>
                )}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (onDeleteTester) {
                      onDeleteTester(t.name);
                    } else if (t.id && onDeleteTesterProfile) {
                      onDeleteTesterProfile(t.id);
                    } else if (onDeleteTestRun) {
                      const runsToDelete = [...testRuns, ...archivedRuns].filter(
                        r => r.testerName === t.name
                      );
                      runsToDelete.forEach(r => onDeleteTestRun(r.id));
                    }
                  }}
                  className="text-slate-500 hover:text-rose-400 ml-0.5 cursor-pointer"
                  title={`Delete ${t.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface FloorTileProps {
  dev: EnrichedDevice;
  isSelected: boolean;
  onSelect: () => void;
  formatOngoingDuration: (startedAt?: string) => string;
}

export const FloorTile: React.FC<FloorTileProps> = ({
  dev,
  isSelected,
  onSelect,
  formatOngoingDuration
}) => {
  const shortTesterName = dev.inUseTesterName
    ? (() => {
        const parts = dev.inUseTesterName.trim().split(/\s+/);
        return parts.length > 1
          ? `${parts[0]} ${parts[1].charAt(0)}`
          : parts[0];
      })()
    : '';

  const stepTotal =
    dev.activeTesterInfo?.totalSteps ||
    dev.assignedPlan?.steps?.length ||
    0;
  const stepCurr = dev.activeTesterInfo?.currentStepIndex || 1;

  return (
    <div
      onClick={onSelect}
      className={`bg-[#0b1120] border rounded-xl p-3 flex flex-col gap-1.5 min-h-[116px] transition cursor-pointer ${
        isSelected
          ? 'border-blue-500 ring-1 ring-blue-500/30'
          : 'border-[#1b2740] hover:border-slate-700'
      }`}
    >
      {/* Row 1: mono device name + status pill */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <span className="font-mono font-bold text-[13px] text-slate-100 truncate">
          {dev.name}
        </span>

        {dev.isInUse ? (
          dev.activeTesterInfo?.isAway ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-500/15 text-amber-300 truncate max-w-[130px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              <span className="truncate">
                Away · {shortTesterName.split(' ')[0]}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-rose-500/15 text-rose-300 truncate max-w-[130px]">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
              <span className="truncate">
                {shortTesterName}
                {dev.activeRunForDevice?.startedAt
                  ? ` · ${formatOngoingDuration(dev.activeRunForDevice.startedAt)}`
                  : ''}
              </span>
            </span>
          )
        ) : !dev.isReady ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-rose-500/15 text-rose-300">
            Maintenance
          </span>
        ) : dev.hasAssignedPlan && dev.doneToday >= dev.targetRuns ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-500/15 text-emerald-300">
            ✓ Quota met
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-slate-800/80 text-slate-400">
            Ready
          </span>
        )}
      </div>

      {/* Row 2: plan name truncated */}
      <div className="text-[11.5px] text-slate-400 truncate">
        {dev.assignedPlan?.name ||
          dev.activeTesterInfo?.planName ||
          'Unassigned'}
      </div>

      {/* Row 3: progress bar + done/target */}
      <div className="flex items-center gap-2 mt-0.5">
        <div className="flex-1 h-1 bg-[#1e293b] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              dev.doneToday >= dev.targetRuns && dev.targetRuns > 0
                ? 'bg-emerald-500'
                : 'bg-blue-500'
            }`}
            style={{ width: `${dev.pct}%` }}
          />
        </div>
        <span
          className={`font-mono text-[11px] font-semibold shrink-0 ${
            dev.doneToday >= dev.targetRuns && dev.targetRuns > 0
              ? 'text-emerald-400'
              : 'text-slate-300'
          }`}
        >
          {dev.doneToday}/{dev.targetRuns}
        </span>
      </div>

      {/* Row 4: Step x/y when in use (else blank spacer so tiles are equal height) */}
      {dev.isInUse ? (
        <div className="font-mono text-[10.5px] text-slate-500 truncate">
          Step {stepCurr}/{stepTotal || 1}
          {dev.activeTesterInfo?.currentStepTitle
            ? ` · ${dev.activeTesterInfo.currentStepTitle}`
            : ''}
        </div>
      ) : (
        <div className="font-mono text-[10.5px] text-transparent select-none">
          &nbsp;
        </div>
      )}
    </div>
  );
};

interface InspectorSlideOverProps {
  resolvedInspector:
    | { type: 'device'; device: EnrichedDevice }
    | { type: 'tester'; tester: EnrichedTester };
  enrichedTesters: EnrichedTester[];
  testPlans: TestPlan[];
  testRuns: TestRun[];
  archivedRuns: TestRun[];
  selectedQaDate: string;
  todayStr: string;
  dateScopeLabel: string;
  setInspectorTarget: React.Dispatch<React.SetStateAction<{ type: 'device' | 'tester'; id: string } | null>>;
  setSelectedInspectorTester: React.Dispatch<React.SetStateAction<string>>;
  formatOngoingDuration: (startedAt?: string) => string;
  onSaveDevice?: (device: DeviceProfile) => void;
  onDeleteDevice?: (deviceId: string) => void;
  onDeleteTesterProfile?: (testerId: string) => void;
  onDeleteTester?: (testerName: string) => void;
  onDeleteTestRun?: (runId: string) => void;
  onBootTester?: (runId: string, deviceId?: string, testerName?: string, deviceName?: string) => void;
}

export const InspectorSlideOver: React.FC<InspectorSlideOverProps> = ({
  resolvedInspector,
  enrichedTesters,
  testPlans,
  testRuns,
  archivedRuns,
  selectedQaDate,
  todayStr,
  dateScopeLabel,
  setInspectorTarget,
  setSelectedInspectorTester,
  formatOngoingDuration,
  onSaveDevice,
  onDeleteDevice,
  onDeleteTesterProfile,
  onDeleteTester,
  onDeleteTestRun,
  onBootTester
}) => {
  const planTitleMap = new Map(testPlans.map(p => [p.id, p.name]));
  const autoReleasedRunsForScope = (() => {
    const byId = new Map<string, TestRun>();
    [...(archivedRuns || []), ...(testRuns || [])].forEach(r => {
      if (!r || !r.id || r.status !== 'terminated') return;
      const meta = getRunAutoReleasedMeta(r);
      if (!meta) return;
      if (selectedQaDate !== 'all') {
        const startDay = r.startedAt ? getLocalDateStrUtil(r.startedAt) : '';
        const completedDay = r.completedAt ? getLocalDateStrUtil(r.completedAt) : '';
        const releasedDay = meta.at ? getLocalDateStrUtil(meta.at) : '';
        if (
          startDay !== selectedQaDate &&
          completedDay !== selectedQaDate &&
          releasedDay !== selectedQaDate
        ) {
          return;
        }
      }
      byId.set(r.id, r);
    });
    return Array.from(byId.values()).map(r => {
      const meta = getRunAutoReleasedMeta(r)!;
      const stepEntries = Object.entries(r.results || {}).filter(
        ([k, v]) =>
          k !== '_meta' &&
          v &&
          typeof v === 'object' &&
          'status' in (v as any) &&
          (v as any).status !== 'pending'
      );
      const resultsArray = stepEntries.map(([_, v]) => v as any);
      const greenCount = resultsArray.filter(x => x.status === 'green').length;
      const yellowCount = resultsArray.filter(x => x.status === 'yellow').length;
      const redCount = resultsArray.filter(x => x.status === 'red').length;
      const ts = meta.at || r.completedAt || r.startedAt;
      const d = ts ? new Date(ts) : null;
      const timeFormatted =
        d && !isNaN(d.getTime())
          ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
      return {
        runId: r.id,
        testerName: r.testerName || 'Unassigned Tester',
        deviceName: r.deviceName || 'Mobile Device',
        deviceId: r.deviceId,
        planName: planTitleMap.get(r.planId) || r.planName || 'Test Plan',
        reason: meta.reason,
        timeFormatted,
        greenCount,
        yellowCount,
        redCount,
      };
    });
  })();

  return (
    <>
      {/* Light backdrop */}
      <div
        onClick={() => {
          setInspectorTarget(null);
          setSelectedInspectorTester('');
        }}
        className="fixed inset-0 bg-black/30 z-30"
      />

      {/* Slide-over drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-[380px] bg-[#0f182b] border-l border-[#263859] shadow-2xl z-40 p-5 flex flex-col gap-3.5 overflow-y-auto">
        {resolvedInspector.type === 'device' ? (
          (() => {
            const dev = resolvedInspector.device;
            const deviceCompletedRuns = enrichedTesters.flatMap(t =>
              t.completedRunsList
                .filter(
                  r =>
                    r.deviceName.toLowerCase().trim() ===
                    dev.name.toLowerCase().trim()
                )
                .map(r => ({ ...r, testerName: t.name }))
            );
            const deviceAutoReleasedRuns = autoReleasedRunsForScope.filter(
              r =>
                (r.deviceId &&
                  r.deviceId.toLowerCase().trim() === dev.id.toLowerCase().trim()) ||
                r.deviceName.toLowerCase().trim() === dev.name.toLowerCase().trim()
            );

            const statusLabel = dev.isInUse
              ? dev.activeTesterInfo?.isAway
                ? `Away · ${dev.inUseTesterName}`
                : `In use by ${dev.inUseTesterName}`
              : !dev.isReady
                ? 'Maintenance'
                : dev.hasAssignedPlan && dev.doneToday >= dev.targetRuns
                  ? 'Quota met'
                  : 'Ready';

            return (
              <>
                {/* Top header with trash + ✕ button */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                      DEVICE
                    </div>
                    <div className="font-mono text-[17px] font-bold text-slate-100 truncate">
                      {dev.name}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {dev.hasAssignedPlan
                        ? `${dev.doneToday}/${dev.targetRuns} quota`
                        : 'No plan assigned'}{' '}
                      · {statusLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (onDeleteDevice) onDeleteDevice(dev.id);
                        setInspectorTarget(null);
                      }}
                      className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition cursor-pointer"
                      title={`Delete ${dev.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectorTarget(null);
                        setSelectedInspectorTester('');
                      }}
                      className="text-slate-400 hover:text-white text-sm px-1.5 py-0.5 cursor-pointer"
                      title="Close (Esc)"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Actions row: Unlock (in use only), Ready/Maintenance toggle, Unassign */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {dev.isInUse && (
                    <button
                      type="button"
                      onClick={() => {
                        onBootTester?.(
                          dev.activeRunForDevice?.id || dev.activeRunId || '',
                          dev.id,
                          dev.inUseTesterName,
                          dev.name
                        );
                        onSaveDevice?.({
                          ...dev,
                          activeRunId: undefined,
                          activeTesterName: undefined
                        });
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/35 hover:bg-amber-500/25 transition cursor-pointer"
                    >
                      Unlock
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const nextReady = !dev.isReady;
                      if (!nextReady && dev.isInUse && onBootTester) {
                        onBootTester(
                          dev.activeRunForDevice?.id || dev.activeRunId || '',
                          dev.id,
                          dev.inUseTesterName,
                          dev.name
                        );
                      }
                      const updated: DeviceProfile = {
                        ...dev,
                        isReady: nextReady,
                        ...(nextReady
                          ? {}
                          : { activeRunId: undefined, activeTesterName: undefined })
                      };
                      if (onSaveDevice) onSaveDevice(updated);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                      dev.isReady
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/35 hover:bg-rose-500/25'
                    }`}
                  >
                    {dev.isReady ? 'Ready' : 'Maintenance'}
                  </button>

                  {dev.hasAssignedPlan && (
                    <button
                      type="button"
                      onClick={() => {
                        if (onSaveDevice) onSaveDevice({ ...dev, quotas: [] });
                        if (!dev.isInUse) setInspectorTarget(null);
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-transparent text-slate-400 border border-slate-800 hover:text-slate-200 transition cursor-pointer"
                    >
                      Unassign
                    </button>
                  )}
                </div>

                {/* Editable plan select + quota input live HERE */}
                <div className="flex items-center gap-2">
                  <select
                    value={dev.assignedQuota?.planId || ''}
                    onChange={e => {
                      const newPlanId = e.target.value;
                      if (!newPlanId) {
                        if (onSaveDevice) onSaveDevice({ ...dev, quotas: [] });
                        if (!dev.isInUse) setInspectorTarget(null);
                      } else {
                        const currentTarget = Math.min(50, Math.max(1, dev.assignedQuota?.targetRunsPerDay || 2));
                        if (onSaveDevice) {
                          onSaveDevice({
                            ...dev,
                            quotas: [
                              { planId: newPlanId, targetRunsPerDay: currentTarget }
                            ]
                          });
                        }
                      }
                    }}
                    style={{ backgroundColor: '#090d16', color: '#e2e8f0' }}
                    className="flex-1 min-w-0 bg-[#090d16] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="">-- Unassign plan --</option>
                    {testPlans.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.steps.length} steps)
                      </option>
                    ))}
                  </select>

                  {dev.assignedQuota && (
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={dev.targetRuns}
                      onChange={e => {
                        const val = Math.min(
                          50,
                          Math.max(1, parseInt(e.target.value, 10) || 1)
                        );
                        if (onSaveDevice && dev.assignedQuota) {
                          onSaveDevice({
                            ...dev,
                            quotas: [
                              {
                                planId: dev.assignedQuota.planId,
                                targetRunsPerDay: val
                              }
                            ]
                          });
                        }
                      }}
                      className="w-14 bg-[#090d16] border border-slate-800 text-xs text-slate-100 font-mono font-bold rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-blue-500"
                      title="Daily quota"
                    />
                  )}
                </div>

                {/* Live run card (click tester -> switch to tester view) */}
                {dev.isInUse && (
                  <div
                    onClick={() =>
                      setInspectorTarget({ type: 'tester', id: dev.inUseTesterName })
                    }
                    className="bg-[#0b1222] border border-[#1e3258] rounded-xl p-3 text-xs space-y-1.5 cursor-pointer hover:border-blue-500/60 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-blue-300 truncate">
                        ● {dev.activeTesterInfo?.isAway ? 'AWAY' : 'LIVE'} ·{' '}
                        {dev.inUseTesterName}
                      </span>
                      <span className="font-mono text-slate-200 text-[11px] shrink-0">
                        Step {dev.activeTesterInfo?.currentStepIndex || 1}/
                        {dev.activeTesterInfo?.totalSteps ||
                          dev.assignedPlan?.steps?.length ||
                          1}
                        {dev.activeRunForDevice?.startedAt
                          ? ` · ${formatOngoingDuration(
                              dev.activeRunForDevice.startedAt
                            )}`
                          : ''}
                      </span>
                    </div>
                    {dev.activeTesterInfo?.currentStepTitle && (
                      <div className="text-[11px] text-slate-400 truncate">
                        ↳ {dev.activeTesterInfo.currentStepTitle}
                      </div>
                    )}
                    <div className="font-mono text-[11px] flex items-center gap-2">
                      <span className="text-emerald-400">
                        ✓{dev.activeTesterInfo?.greenCount || 0}
                      </span>
                      <span className="text-amber-400">
                        !{dev.activeTesterInfo?.yellowCount || 0}
                      </span>
                      <span className="text-rose-400">
                        ✗{dev.activeTesterInfo?.redCount || 0}
                      </span>
                    </div>
                  </div>
                )}

                {/* Completed runs on this device for the selected date */}
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 pt-1">
                  COMPLETED{' '}
                  {selectedQaDate === todayStr ? 'TODAY' : `(${dateScopeLabel})`} (
                  {deviceCompletedRuns.length})
                </div>

                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {deviceCompletedRuns.map((runItem, idx) => (
                    <div
                      key={runItem.runId + idx}
                      className="bg-[#0b1120] border border-[#1a2540] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          <span
                            onClick={() =>
                              setInspectorTarget({
                                type: 'tester',
                                id: runItem.testerName
                              })
                            }
                            className="font-semibold text-slate-200 hover:text-blue-300 cursor-pointer"
                          >
                            {runItem.testerName}
                          </span>
                          <span className="text-slate-500 text-[11px]">
                            {' '}
                            · {runItem.planName}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {runItem.completedAtFormatted} ·{' '}
                          <span className="text-slate-300">
                            {runItem.durationFormatted}
                          </span>
                        </div>
                      </div>

                      <div className="font-mono text-[11px] flex items-center gap-1.5 shrink-0">
                        <span className="text-emerald-400">✓{runItem.greenCount}</span>
                        {runItem.yellowCount > 0 && (
                          <span className="text-amber-400">!{runItem.yellowCount}</span>
                        )}
                        {runItem.redCount > 0 && (
                          <span className="text-rose-400">✗{runItem.redCount}</span>
                        )}
                        {onDeleteTestRun && (
                          <button
                            type="button"
                            onClick={() => onDeleteTestRun(runItem.runId)}
                            className="p-0.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer ml-1"
                            title="Delete run"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {deviceAutoReleasedRuns.map((runItem, idx) => (
                    <div
                      key={runItem.runId + '-auto-' + idx}
                      className="bg-[#0b1120] border border-[#1a2540] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            onClick={() =>
                              setInspectorTarget({
                                type: 'tester',
                                id: runItem.testerName
                              })
                            }
                            className="font-semibold text-slate-200 hover:text-blue-300 cursor-pointer truncate"
                          >
                            {runItem.testerName}
                          </span>
                          <span
                            data-testid="auto-released-chip"
                            className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-medium shrink-0"
                          >
                            auto-released
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 truncate">
                          {runItem.planName}
                          {runItem.timeFormatted ? ` · ${runItem.timeFormatted}` : ''} ·{' '}
                          <span className="text-slate-400">
                            {runItem.reason === 'previous-day' ? 'previous day' : 'idle 2h+'}
                          </span>
                        </div>
                      </div>

                      <div className="font-mono text-[11px] flex items-center gap-1.5 shrink-0">
                        <span className="text-emerald-400">✓{runItem.greenCount}</span>
                        {runItem.yellowCount > 0 && (
                          <span className="text-amber-400">!{runItem.yellowCount}</span>
                        )}
                        {runItem.redCount > 0 && (
                          <span className="text-rose-400">✗{runItem.redCount}</span>
                        )}
                        {onDeleteTestRun && (
                          <button
                            type="button"
                            onClick={() => onDeleteTestRun(runItem.runId)}
                            className="p-0.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer ml-1"
                            title="Delete run"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()
        ) : (
          (() => {
            const inspectedTester = resolvedInspector.tester;
            const testerAutoReleasedRuns = autoReleasedRunsForScope.filter(
              r => r.testerName.toLowerCase().trim() === inspectedTester.testerKey
            );
            return (
              <>
                {/* Tester view header with trash + ✕ */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      TESTER
                    </div>
                    <div className="text-[17px] font-bold text-slate-100 truncate">
                      {inspectedTester.name}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {inspectedTester.dayData.completedCount} completed ·{' '}
                      {inspectedTester.isActive
                        ? `Active on ${
                            inspectedTester.activeInfo?.deviceName || 'Device'
                          }`
                        : 'Idle'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (onDeleteTester) {
                          onDeleteTester(inspectedTester.name);
                        } else if (inspectedTester.id && onDeleteTesterProfile) {
                          onDeleteTesterProfile(inspectedTester.id);
                        } else if (onDeleteTestRun) {
                          const runsToDelete = [...testRuns, ...archivedRuns].filter(
                            r => r.testerName === inspectedTester.name
                          );
                          runsToDelete.forEach(r => onDeleteTestRun(r.id));
                        }
                        setInspectorTarget(null);
                        setSelectedInspectorTester('');
                      }}
                      className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition cursor-pointer"
                      title={`Delete ${inspectedTester.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectorTarget(null);
                        setSelectedInspectorTester('');
                      }}
                      className="text-slate-400 hover:text-white text-sm px-1.5 py-0.5 cursor-pointer"
                      title="Close (Esc)"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Actions row: Boot {device} when active */}
                {inspectedTester.isActive && onBootTester && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            `Remote Boot: Kick "${inspectedTester.name}" off "${
                              inspectedTester.activeInfo?.deviceName || 'device'
                            }" and release device?`
                          )
                        ) {
                          onBootTester(
                            inspectedTester.activeInfo?.runId || '',
                            inspectedTester.activeInfo?.deviceId,
                            inspectedTester.name,
                            inspectedTester.activeInfo?.deviceName
                          );
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 transition cursor-pointer"
                    >
                      Boot {inspectedTester.activeInfo?.deviceName || ''}
                    </button>
                  </div>
                )}

                {/* Live run card (click device -> device view) */}
                {inspectedTester.isActive && inspectedTester.activeInfo && (
                  <div
                    onClick={() =>
                      setInspectorTarget({
                        type: 'device',
                        id:
                          inspectedTester.activeInfo?.deviceId ||
                          inspectedTester.activeInfo?.deviceName ||
                          ''
                      })
                    }
                    className="bg-[#0b1222] border border-[#1e3258] rounded-xl p-3 text-xs space-y-1.5 cursor-pointer hover:border-blue-500/60 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-blue-300 truncate">
                        ● {inspectedTester.activeInfo.isAway ? 'AWAY' : 'LIVE'} ·{' '}
                        {inspectedTester.activeInfo.deviceName || 'Device'}
                      </span>
                      <span className="font-mono text-slate-200 text-[11px] shrink-0">
                        Step {inspectedTester.activeInfo.currentStepIndex}/
                        {inspectedTester.activeInfo.totalSteps}
                        {inspectedTester.activeInfo.startedAt
                          ? ` · ${formatOngoingDuration(
                              inspectedTester.activeInfo.startedAt
                            )}`
                          : ''}
                      </span>
                    </div>
                    {inspectedTester.activeInfo.currentStepTitle && (
                      <div className="text-[11px] text-slate-400 truncate">
                        ↳ {inspectedTester.activeInfo.currentStepTitle}
                      </div>
                    )}
                    <div className="font-mono text-[11px] flex items-center gap-2">
                      <span className="text-emerald-400">
                        ✓{inspectedTester.activeInfo.greenCount || 0}
                      </span>
                      <span className="text-amber-400">
                        !{inspectedTester.activeInfo.yellowCount || 0}
                      </span>
                      <span className="text-rose-400">
                        ✗{inspectedTester.activeInfo.redCount || 0}
                      </span>
                    </div>
                  </div>
                )}

                {/* Completed runs for selected date */}
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 pt-1">
                  COMPLETED{' '}
                  {selectedQaDate === todayStr ? 'TODAY' : `(${dateScopeLabel})`} (
                  {inspectedTester.completedRunsList.length})
                </div>

                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {inspectedTester.completedRunsList.map((runItem, idx) => (
                    <div
                      key={runItem.runId + idx}
                      className="bg-[#0b1120] border border-[#1a2540] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-200 truncate">
                          {runItem.planName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 truncate">
                          <span
                            onClick={() =>
                              setInspectorTarget({
                                type: 'device',
                                id: runItem.deviceName
                              })
                            }
                            className="text-slate-300 hover:text-blue-300 cursor-pointer"
                          >
                            {runItem.deviceName}
                          </span>{' '}
                          · {runItem.completedAtFormatted} ·{' '}
                          <span className="text-slate-300">
                            {runItem.durationFormatted}
                          </span>
                        </div>
                      </div>

                      <div className="font-mono text-[11px] flex items-center gap-1.5 shrink-0">
                        <span className="text-emerald-400">✓{runItem.greenCount}</span>
                        {runItem.yellowCount > 0 && (
                          <span className="text-amber-400">!{runItem.yellowCount}</span>
                        )}
                        {runItem.redCount > 0 && (
                          <span className="text-rose-400">✗{runItem.redCount}</span>
                        )}
                        {onDeleteTestRun && (
                          <button
                            type="button"
                            onClick={() => onDeleteTestRun(runItem.runId)}
                            className="p-0.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer ml-1"
                            title="Delete run"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {testerAutoReleasedRuns.map((runItem, idx) => (
                    <div
                      key={runItem.runId + '-auto-' + idx}
                      className="bg-[#0b1120] border border-[#1a2540] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-semibold text-slate-200 truncate">
                            {runItem.planName}
                          </span>
                          <span
                            data-testid="auto-released-chip"
                            className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-medium shrink-0"
                          >
                            auto-released
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 truncate">
                          <span
                            onClick={() =>
                              setInspectorTarget({
                                type: 'device',
                                id: runItem.deviceId || runItem.deviceName
                              })
                            }
                            className="text-slate-300 hover:text-blue-300 cursor-pointer"
                          >
                            {runItem.deviceName}
                          </span>
                          {runItem.timeFormatted ? ` · ${runItem.timeFormatted}` : ''} ·{' '}
                          <span className="text-slate-400">
                            {runItem.reason === 'previous-day' ? 'previous day' : 'idle 2h+'}
                          </span>
                        </div>
                      </div>

                      <div className="font-mono text-[11px] flex items-center gap-1.5 shrink-0">
                        <span className="text-emerald-400">✓{runItem.greenCount}</span>
                        {runItem.yellowCount > 0 && (
                          <span className="text-amber-400">!{runItem.yellowCount}</span>
                        )}
                        {runItem.redCount > 0 && (
                          <span className="text-rose-400">✗{runItem.redCount}</span>
                        )}
                        {onDeleteTestRun && (
                          <button
                            type="button"
                            onClick={() => onDeleteTestRun(runItem.runId)}
                            className="p-0.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer ml-1"
                            title="Delete run"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()
        )}
      </div>
    </>
  );
};

export interface DevicesTestersTabProps {
  testPlans: TestPlan[];
  testRuns: TestRun[];
  archivedRuns: TestRun[];
  bugLogs: BugLog[];
  devices: DeviceProfile[];
  unassignedDevices: DeviceProfile[];
  unifiedTesters: UnifiedTesterItem[];
  activeTesterMap: Map<string, ActiveTesterMetrics>;
  todayRunsMap: Record<string, Record<string, number>>;
  fleetProgress: { totalCompleted: number; totalTarget: number; pct: number };
  liveInProgressRuns: TestRun[];
  selectedQaDate: string;
  setSelectedQaDate: React.Dispatch<React.SetStateAction<string>>;
  todayStr: string;
  allQaDatesList: string[];
  testerViewMode: 'tested' | 'active' | 'idle' | 'all';
  setTesterViewMode: React.Dispatch<React.SetStateAction<'tested' | 'active' | 'idle' | 'all'>>;
  showOffShiftTesters: boolean;
  setShowOffShiftTesters: React.Dispatch<React.SetStateAction<boolean>>;
  newDeviceName: string;
  setNewDeviceName: React.Dispatch<React.SetStateAction<string>>;
  newPersonName: string;
  setNewPersonName: React.Dispatch<React.SetStateAction<string>>;
  newPersonRole: string;
  setNewPersonRole: React.Dispatch<React.SetStateAction<string>>;
  quickActivateDeviceId: string;
  setQuickActivateDeviceId: React.Dispatch<React.SetStateAction<string>>;
  quickActivatePlanId: string;
  setQuickActivatePlanId: React.Dispatch<React.SetStateAction<string>>;
  quickActivateQuota: number;
  setQuickActivateQuota: React.Dispatch<React.SetStateAction<number>>;
  inspectorTarget: { type: 'device' | 'tester'; id: string } | null;
  setInspectorTarget: React.Dispatch<React.SetStateAction<{ type: 'device' | 'tester'; id: string } | null>>;
  selectedInspectorTester: string;
  setSelectedInspectorTester: React.Dispatch<React.SetStateAction<string>>;
  isFloorMenuOpen: boolean;
  setIsFloorMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  floorMenuRef: React.RefObject<HTMLDivElement>;
  isActivateTileOpen: boolean;
  setIsActivateTileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveTab: (tab: 'overview' | 'devices' | 'testers' | 'features' | 'bugs') => void;
  formatOngoingDuration: (startedAt?: string) => string;
  getLocalDateStr: (dateInput?: string | Date) => string;
  minAppVersion?: number;
  onUpdateMinAppVersion?: (versionCode: number) => void;
  onResetActiveDay?: (dateStr: string) => void;
  onResetDailyQuotas?: () => void;
  onSaveDevice?: (device: DeviceProfile) => void;
  onDeleteDevice?: (deviceId: string) => void;
  onSaveTester?: (tester: TesterProfile) => void;
  onDeleteTesterProfile?: (testerId: string) => void;
  onDeleteTester?: (testerName: string) => void;
  onDeleteTestRun?: (runId: string) => void;
  onBootTester?: (runId: string, deviceId?: string, testerName?: string, deviceName?: string) => void;
}

export const DevicesTestersTab: React.FC<DevicesTestersTabProps> = ({
  testPlans,
  testRuns,
  archivedRuns,
  bugLogs,
  devices,
  unassignedDevices,
  unifiedTesters,
  activeTesterMap,
  todayRunsMap,
  fleetProgress,
  liveInProgressRuns,
  selectedQaDate,
  setSelectedQaDate,
  todayStr,
  allQaDatesList,
  testerViewMode,
  setTesterViewMode,
  showOffShiftTesters,
  setShowOffShiftTesters,
  newDeviceName,
  setNewDeviceName,
  newPersonName,
  setNewPersonName,
  newPersonRole,
  setNewPersonRole,
  quickActivateDeviceId,
  setQuickActivateDeviceId,
  quickActivatePlanId,
  setQuickActivatePlanId,
  quickActivateQuota,
  setQuickActivateQuota,
  inspectorTarget,
  setInspectorTarget,
  selectedInspectorTester,
  setSelectedInspectorTester,
  isFloorMenuOpen,
  setIsFloorMenuOpen,
  floorMenuRef,
  isActivateTileOpen,
  setIsActivateTileOpen,
  setActiveTab,
  formatOngoingDuration,
  getLocalDateStr,
  minAppVersion,
  onUpdateMinAppVersion,
  onResetActiveDay,
  onResetDailyQuotas,
  onSaveDevice,
  onDeleteDevice,
  onSaveTester,
  onDeleteTesterProfile,
  onDeleteTester,
  onDeleteTestRun,
  onBootTester
}) => {
  const formatFloorDuration = (ms: number) => {
    if (!ms || ms <= 0) return '0m';
    const totalMins = Math.max(1, Math.round(ms / 60000));
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return hrs > 0 ? `${hrs}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
  };

  // 1. Enrich testers with selectedQaDate stats, live session state, device quota attribution, and bugs
  const enrichedTesters: EnrichedTester[] = unifiedTesters.map(tester => {
    const testerKey = tester.name.toLowerCase().trim();
    const profile = tester.performanceProfile;
    const dayData = !profile
      ? {
          completedCount: 0,
          totalDurationMs: 0,
          completedRuns: [] as CompletedRunSummaryItem[],
          devicesUsedOnDay: new Set<string>()
        }
      : selectedQaDate === 'all'
        ? {
            completedCount: profile.allTimeCompletedCount,
            totalDurationMs: Object.values(profile.dailyStats).reduce((acc, d) => acc + d.totalDurationMs, 0),
            completedRuns: Object.values(profile.dailyStats).flatMap(d => d.completedRuns),
            devicesUsedOnDay: profile.devicesUsed
          }
        : profile.dailyStats[selectedQaDate] || {
            completedCount: 0,
            totalDurationMs: 0,
            completedRuns: [],
            devicesUsedOnDay: new Set<string>()
          };

    const completedRunsList = dayData.completedRuns;
    const avgMs = dayData.completedCount > 0 ? Math.round(dayData.totalDurationMs / dayData.completedCount) : 0;
    const avgMins = Math.floor(avgMs / 60000);
    const avgSecs = Math.floor((avgMs % 60000) / 1000);
    const avgFormatted = avgMs > 0 ? `${avgMins}m ${avgSecs < 10 ? '0' : ''}${avgSecs}s` : '—';
    const floorTimeFormatted = formatFloorDuration(dayData.totalDurationMs);

    const isActive = activeTesterMap.has(testerKey);
    const activeInfo = activeTesterMap.get(testerKey);

    // Per-device run counts for this tester on selectedQaDate
    const devCounts = new Map<string, { displayName: string; count: number }>();
    completedRunsList.forEach(r => {
      const devName = (r.deviceName || '').trim();
      if (!devName) return;
      const dKey = devName.toLowerCase();
      const prev = devCounts.get(dKey);
      if (prev) {
        prev.count += 1;
      } else {
        devCounts.set(dKey, { displayName: devName, count: 1 });
      }
    });
    if (isActive && activeInfo?.deviceName) {
      const activeDevName = activeInfo.deviceName.trim();
      const dKey = activeDevName.toLowerCase();
      if (activeDevName && !devCounts.has(dKey)) {
        devCounts.set(dKey, { displayName: activeDevName, count: 0 });
      }
    }

    const devicePills = Array.from(devCounts.values()).map(({ displayName, count }) => {
      const matchedDev = devices.find(d => d.name.toLowerCase().trim() === displayName.toLowerCase().trim());
      const assignedQuota = matchedDev?.quotas?.find(q => q.targetRunsPerDay > 0) || matchedDev?.quotas?.[0];
      if (selectedQaDate === todayStr && matchedDev && assignedQuota && assignedQuota.targetRunsPerDay > 0) {
        const target = assignedQuota.targetRunsPerDay;
        const doneOnDevToday = (todayRunsMap[matchedDev.id] && todayRunsMap[matchedDev.id][assignedQuota.planId]) || count;
        const displayDone = count;
        const isMet = count >= target;
        return {
          key: displayName,
          deviceId: matchedDev.id,
          deviceName: matchedDev.name,
          label: `${matchedDev.name} ${displayDone}/${target}${isMet ? '✓' : ''}`,
          isDone: isMet,
          tooltip: `Inspect ${matchedDev.name} (${count} by ${tester.name}, ${doneOnDevToday}/${target} device total today)`
        };
      }
      return {
        key: displayName,
        deviceId: matchedDev?.id,
        deviceName: displayName,
        label: count > 0 ? `${displayName} ×${count}` : displayName,
        isDone: count > 0,
        tooltip: `Inspect ${displayName}`
      };
    });

    const dayDevices = Array.from(devCounts.values()).map(d => d.displayName);

    const bugCount = bugLogs.filter(b => {
      const bTester = ((b.testerName || (b as any).reporter || '') as string).toLowerCase().trim();
      if (bTester !== testerKey) return false;
      if (selectedQaDate === 'all') return true;
      return getLocalDateStr(b.timestamp) === selectedQaDate;
    }).length;

    const lastRun = completedRunsList.length > 0 ? completedRunsList[completedRunsList.length - 1] : null;
    const allTimeRuns = profile?.allTimeCompletedCount || 0;

    return {
      ...tester,
      testerKey,
      dayData,
      completedRunsList,
      avgMs,
      avgFormatted,
      floorTimeFormatted,
      isActive,
      activeInfo,
      devicePills,
      dayDevices,
      bugCount,
      lastRun,
      allTimeRuns
    };
  });

  const sortedTesters = [...enrichedTesters].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (b.dayData.completedCount !== a.dayData.completedCount) {
      return b.dayData.completedCount - a.dayData.completedCount;
    }
    if (b.bugCount !== a.bugCount) {
      return b.bugCount - a.bugCount;
    }
    return a.name.localeCompare(b.name);
  });

  const activeOrTestedTesters = sortedTesters.filter(
    t => t.isActive || t.dayData.completedCount > 0 || t.bugCount > 0
  );

  let liveNowCount = 0;
  let awayNowCount = 0;
  activeTesterMap.forEach(info => {
    if (info.isAway) awayNowCount += 1;
    else liveNowCount += 1;
  });

  const shiftTotalRuns = sortedTesters.reduce((acc, t) => acc + t.dayData.completedCount, 0);
  const shiftTotalFloorMs = sortedTesters.reduce((acc, t) => acc + t.dayData.totalDurationMs, 0);
  const shiftAvgPaceMs = shiftTotalRuns > 0 ? Math.round(shiftTotalFloorMs / shiftTotalRuns) : 0;
  const shiftAvgPaceMins = Math.floor(shiftAvgPaceMs / 60000);
  const shiftAvgPaceSecs = Math.floor((shiftAvgPaceMs % 60000) / 1000);
  const shiftAvgPaceFormatted = shiftAvgPaceMs > 0
    ? `${shiftAvgPaceMins}m ${shiftAvgPaceSecs < 10 ? '0' : ''}${shiftAvgPaceSecs}s`
    : '—';
  const shiftTotalBugs = sortedTesters.reduce((acc, t) => acc + t.bugCount, 0);

  // Filter testers by mode
  let displayedTesters = activeOrTestedTesters;
  if (testerViewMode === 'active') {
    displayedTesters = sortedTesters.filter(t => t.isActive);
  }

  // 2. Enrich devices with quota, today's completions, and live in-use tester
  const enrichedDevices: EnrichedDevice[] = devices.map(device => {
    const validQuota =
      (device.quotas &&
        device.quotas.find(
          q => q.planId && (q.targetRunsPerDay || 0) > 0 && testPlans.some(p => p.id === q.planId)
        )) ||
      null;
    const assignedPlan = validQuota ? testPlans.find(p => p.id === validQuota.planId) || null : null;
    const assignedQuota = validQuota;
    const hasAssignedPlan = Boolean(validQuota && assignedPlan);
    const targetRuns = assignedQuota ? Math.min(50, Math.max(1, assignedQuota.targetRunsPerDay || 1)) : 2;
    const doneToday = (assignedQuota && todayRunsMap[device.id] && todayRunsMap[device.id][assignedQuota.planId]) || 0;
    const remaining = assignedQuota ? Math.max(0, targetRuns - doneToday) : 0;
    const pct = assignedQuota && targetRuns > 0 ? Math.min(100, Math.round((doneToday / targetRuns) * 100)) : 0;

    const activeRunForDevice = liveInProgressRuns.find(r =>
      (device.activeRunId && r.id === device.activeRunId) ||
      (r.deviceId && r.deviceId.toLowerCase().trim() === device.id.toLowerCase().trim()) ||
      (r.deviceName && r.deviceName.toLowerCase().trim() === device.name.toLowerCase().trim())
    );
    const isInUse = Boolean(activeRunForDevice);
    const inUseTesterName = activeRunForDevice?.testerName || device.activeTesterName || 'Tester';
    const activeTesterInfo = isInUse ? activeTesterMap.get(inUseTesterName.toLowerCase().trim()) : undefined;

    return {
      ...device,
      assignedQuota,
      hasAssignedPlan,
      assignedPlan,
      targetRuns,
      doneToday,
      remaining,
      pct,
      activeRunForDevice,
      isInUse,
      inUseTesterName,
      activeTesterInfo
    };
  });

  const inUseDevicesCount = enrichedDevices.filter(d => d.isInUse).length;
  const displayedDevices = enrichedDevices.filter(d => d.hasAssignedPlan || d.isInUse);

  // Quick-Activate defaults (unassigned devices for "+ Activate device" tile / start-of-day)
  const effectiveQuickDeviceId =
    (quickActivateDeviceId && unassignedDevices.some(d => d.id === quickActivateDeviceId))
      ? quickActivateDeviceId
      : (unassignedDevices[0]?.id || devices[0]?.id || '');
  const effectiveQuickPlanId =
    (quickActivatePlanId && testPlans.some(p => p.id === quickActivatePlanId))
      ? quickActivatePlanId
      : (testPlans[0]?.id || '');

  // 3. Resolve Slide-Over Detail Panel Target (Device OR Tester — null when nothing selected)
  let resolvedInspector:
    | { type: 'device'; device: EnrichedDevice }
    | { type: 'tester'; tester: EnrichedTester }
    | null = null;

  if (inspectorTarget?.type === 'device') {
    const foundDev = enrichedDevices.find(
      d => d.id === inspectorTarget.id || d.name.toLowerCase().trim() === inspectorTarget.id.toLowerCase().trim()
    );
    if (foundDev) resolvedInspector = { type: 'device', device: foundDev };
  } else if (inspectorTarget?.type === 'tester') {
    const foundTester = sortedTesters.find(
      t => t.testerKey === inspectorTarget.id.toLowerCase().trim() || t.id === inspectorTarget.id
    );
    if (foundTester) resolvedInspector = { type: 'tester', tester: foundTester };
  } else if (selectedInspectorTester) {
    const foundTester = sortedTesters.find(
      t => t.testerKey === selectedInspectorTester.toLowerCase().trim()
    );
    if (foundTester) resolvedInspector = { type: 'tester', tester: foundTester };
  }

  const dateScopeLabel = selectedQaDate === 'all' ? 'all time' : selectedQaDate;
  const isTodayScope = selectedQaDate === todayStr;
  const isStartOfDay = displayedDevices.length === 0 && activeOrTestedTesters.length === 0;
  const hasMeaningfulActivity = isTodayScope
    ? (!isStartOfDay ||
        fleetProgress.totalTarget > 0 ||
        fleetProgress.totalCompleted > 0 ||
        inUseDevicesCount > 0 ||
        liveNowCount > 0 ||
        awayNowCount > 0 ||
        shiftTotalBugs > 0)
    : (shiftTotalRuns > 0 || activeOrTestedTesters.length > 0 || shiftTotalBugs > 0);

  const formatShortDate = (dateStr: string) => {
    if (dateStr === 'all') return 'All-time';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }
    return dateStr;
  };

  const handleQuickActivateDevice = () => {
    const targetDev =
      unassignedDevices.find(d => d.id === effectiveQuickDeviceId) ||
      devices.find(d => d.id === effectiveQuickDeviceId);
    if (!targetDev || !effectiveQuickPlanId) return;
    const quota = Math.min(50, Math.max(1, Number(quickActivateQuota) || 2));
    if (onSaveDevice) {
      onSaveDevice({
        ...targetDev,
        isReady: true,
        quotas: [{ planId: effectiveQuickPlanId, targetRunsPerDay: quota }]
      });
    }
    const nextUnassigned = unassignedDevices.find(d => d.id !== targetDev.id);
    setQuickActivateDeviceId(nextUnassigned?.id || '');
    setIsActivateTileOpen(false);
  };

  return (
    <div className="relative">
      {/* Single unified floor frame (Option A · Tile Board) */}
      <div className="bg-[#0e1526] border border-slate-800 rounded-2xl overflow-visible shadow-xl">
        {/* 1. Header row (single line, never wraps on >=1024px) */}
        <div className="px-5 py-3.5 border-b border-[#162036] flex items-center justify-between gap-4 flex-wrap lg:flex-nowrap">
          {/* Left + Middle: Title, compact date select, inline text KPIs */}
          <div className="flex items-center gap-5 min-w-0 flex-wrap lg:flex-nowrap">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[14px] font-bold text-slate-100 tracking-tight whitespace-nowrap">
                {selectedQaDate === todayStr
                  ? "Today's floor"
                  : selectedQaDate === 'all'
                    ? 'Floor · All-time'
                    : `Floor · ${formatShortDate(selectedQaDate)}`}
              </span>
              <div className="relative inline-flex items-center">
                <select
                  value={selectedQaDate}
                  onChange={e => setSelectedQaDate(e.target.value)}
                  style={{ backgroundColor: 'transparent', WebkitAppearance: 'none' }}
                  className="w-auto appearance-none bg-transparent text-slate-400 hover:text-slate-200 text-xs font-medium pr-3 py-0.5 rounded focus:outline-none cursor-pointer"
                  title="Switch floor date scope"
                >
                  <option value={todayStr} className="bg-[#0b1120] text-slate-100">
                    {formatShortDate(todayStr)}
                  </option>
                  {allQaDatesList
                    .filter(d => d !== todayStr)
                    .map(dateStr => (
                      <option key={dateStr} value={dateStr} className="bg-[#0b1120] text-slate-100">
                        {formatShortDate(dateStr)}
                      </option>
                    ))}
                  <option value="all" className="bg-[#0b1120] text-slate-100">
                    All-time
                  </option>
                </select>
                <span className="pointer-events-none absolute right-0 text-[10px] text-slate-500">
                  ▾
                </span>
              </div>
            </div>

            {/* Inline KPIs as text, no cards */}
            <div className="flex items-center gap-4 text-xs text-slate-400 whitespace-nowrap overflow-x-auto">
              {!hasMeaningfulActivity ? (
                <>
                  <span>
                    <strong className="font-mono text-slate-200 font-bold">
                      {isTodayScope ? '0/0' : '0'}
                    </strong>{' '}
                    runs
                  </span>
                  <span>
                    <strong className="font-mono text-slate-200 font-bold">0</strong> testers
                  </span>
                </>
              ) : (
                <>
                  {isTodayScope ? (
                    <span>
                      <strong className="font-mono text-slate-100 font-bold">
                        {fleetProgress.totalCompleted}/{fleetProgress.totalTarget}
                      </strong>{' '}
                      runs · {fleetProgress.pct}%
                    </span>
                  ) : (
                    <span>
                      <strong className="font-mono text-slate-100 font-bold">
                        {shiftTotalRuns}
                      </strong>{' '}
                      run{shiftTotalRuns === 1 ? '' : 's'} ·{' '}
                      <strong className="font-mono text-slate-100 font-bold">
                        {activeOrTestedTesters.length}
                      </strong>{' '}
                      tester{activeOrTestedTesters.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {isTodayScope && inUseDevicesCount > 0 && (
                    <span>
                      <strong className="font-mono text-slate-100 font-bold">
                        {inUseDevicesCount}
                      </strong>{' '}
                      in use
                    </span>
                  )}
                  {isTodayScope && (liveNowCount > 0 || awayNowCount > 0) && (
                    <span>
                      <strong className="font-mono text-slate-100 font-bold">
                        {liveNowCount}
                      </strong>{' '}
                      live
                      {awayNowCount > 0 ? ` · ${awayNowCount} away` : ''}
                    </span>
                  )}
                  {shiftAvgPaceFormatted !== '—' && (
                    <span>
                      <strong className="font-mono text-slate-100 font-bold">
                        {shiftAvgPaceFormatted}
                      </strong>{' '}
                      avg
                    </span>
                  )}
                  {shiftTotalBugs > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('bugs')}
                      className="hover:underline cursor-pointer"
                      title="View bug reports"
                    >
                      <strong className="font-mono text-rose-300 font-bold">
                        {shiftTotalBugs}
                      </strong>{' '}
                      <span className="text-rose-300/80">
                        bug{shiftTotalBugs === 1 ? '' : 's'}
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right: Ghost button Pool & Roster + ⋯ menu button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowOffShiftTesters(prev => !prev)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer ${
                showOffShiftTesters
                  ? 'bg-[#13203a] border-blue-500/50 text-blue-200'
                  : 'bg-transparent border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              Pool &amp; Roster
            </button>

            <div className="relative" ref={floorMenuRef}>
              <button
                type="button"
                onClick={() => setIsFloorMenuOpen(prev => !prev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer ${
                  isFloorMenuOpen
                    ? 'bg-[#13203a] border-blue-500/50 text-blue-200'
                    : 'bg-transparent border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
                title="Floor actions"
              >
                ⋯
              </button>

              {isFloorMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-52 bg-[#0b1120] border border-slate-800 rounded-xl shadow-2xl py-1.5 z-30 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setIsFloorMenuOpen(false);
                      if (
                        confirm(
                          "Reset today's completed run counters and today's test execution data across all devices?"
                        )
                      ) {
                        if (onResetActiveDay) onResetActiveDay(getLocalDateStr(new Date()));
                      }
                    }}
                    className="w-full px-3 py-1.5 text-left text-slate-300 hover:bg-[#13203a] hover:text-white flex items-center justify-between transition cursor-pointer"
                  >
                    <span>Reset counters</span>
                    <RefreshCw className="w-3 h-3 text-slate-500" />
                  </button>

                  {onResetDailyQuotas && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsFloorMenuOpen(false);
                        if (
                          confirm(
                            'Reset all device quotas to "No Plan Assigned" for today? (This clears plan assignments so you can assign new ones for the day)'
                          )
                        ) {
                          onResetDailyQuotas();
                          setInspectorTarget(null);
                        }
                      }}
                      className="w-full px-3 py-1.5 text-left text-slate-300 hover:bg-[#13203a] hover:text-white flex items-center justify-between transition cursor-pointer"
                    >
                      <span>Clear plans</span>
                      <Layers className="w-3 h-3 text-slate-500" />
                    </button>
                  )}

                  {onUpdateMinAppVersion && (
                    <div className="border-t border-slate-800/80 mt-1 pt-1.5 px-3 py-1 flex items-center justify-between gap-2">
                      <span className="text-slate-400 whitespace-nowrap">Required APK ▸</span>
                      <select
                        value={minAppVersion || 1}
                        onChange={e => {
                          onUpdateMinAppVersion(parseInt(e.target.value, 10));
                          setIsFloorMenuOpen(false);
                        }}
                        style={{ backgroundColor: '#090d16', color: '#93c5fd' }}
                        className="bg-[#090d16] text-blue-300 font-mono font-bold border border-slate-700 rounded px-1.5 py-0.5 text-[11px] focus:outline-none cursor-pointer"
                      >
                        {APP_VERSION_OPTIONS.map(opt => (
                          <option key={opt.code} value={opt.code}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Optional Collapsible Pool & Roster Drawer (inside frame under header) */}
        {showOffShiftTesters && (
          <PoolRosterDrawer
            devices={devices}
            unassignedDevices={unassignedDevices}
            enrichedDevices={enrichedDevices}
            unifiedTesters={unifiedTesters}
            sortedTesters={sortedTesters}
            testRuns={testRuns}
            archivedRuns={archivedRuns}
            newDeviceName={newDeviceName}
            setNewDeviceName={setNewDeviceName}
            newPersonName={newPersonName}
            setNewPersonName={setNewPersonName}
            newPersonRole={newPersonRole}
            setNewPersonRole={setNewPersonRole}
            setShowOffShiftTesters={setShowOffShiftTesters}
            setQuickActivateDeviceId={setQuickActivateDeviceId}
            setInspectorTarget={setInspectorTarget}
            onSaveDevice={onSaveDevice}
            onDeleteDevice={onDeleteDevice}
            onSaveTester={onSaveTester}
            onDeleteTesterProfile={onDeleteTesterProfile}
            onDeleteTester={onDeleteTester}
            onDeleteTestRun={onDeleteTestRun}
          />
        )}

        {/* 4. Start of day (no assigned devices AND no active/tested testers) */}
        {isStartOfDay ? (
          <div className="px-5 py-9 flex flex-wrap items-center justify-center gap-2.5">
            <span className="text-xs text-slate-400 mr-1">Start the day:</span>
            <select
              value={effectiveQuickDeviceId}
              onChange={e => setQuickActivateDeviceId(e.target.value)}
              style={{ backgroundColor: '#090d16', color: '#e2e8f0' }}
              className="bg-[#090d16] border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {unassignedDevices.length === 0 && devices.length === 0 && (
                <option value="">No devices in pool</option>
              )}
              {(unassignedDevices.length > 0 ? unassignedDevices : devices).map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              value={effectiveQuickPlanId}
              onChange={e => setQuickActivatePlanId(e.target.value)}
              style={{ backgroundColor: '#090d16', color: '#e2e8f0' }}
              className="bg-[#090d16] border border-slate-800 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-blue-500 cursor-pointer max-w-[260px]"
            >
              {testPlans.length === 0 ? (
                <option value="">No test plans</option>
              ) : (
                testPlans.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.steps.length} steps)
                  </option>
                ))
              )}
            </select>

            <div className="inline-flex items-center bg-[#090d16] border border-slate-800 rounded-lg px-2 py-1 text-xs">
              <input
                type="number"
                min={1}
                max={50}
                value={quickActivateQuota}
                onChange={e =>
                  setQuickActivateQuota(
                    Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1))
                  )
                }
                className="w-8 bg-transparent text-slate-200 font-mono font-bold text-xs text-center focus:outline-none"
              />
              <span className="text-slate-500 text-[11px] font-mono">/ day</span>
            </div>

            <button
              type="button"
              disabled={!effectiveQuickDeviceId || !effectiveQuickPlanId}
              onClick={handleQuickActivateDevice}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              ＋ Activate
            </button>
          </div>
        ) : (
          <>
            {/* 2. Devices section (tile grid) */}
            <div className="px-5 pt-3.5 pb-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  DEVICES · {displayedDevices.length} ACTIVE
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 auto-rows-fr gap-2.5">
                {displayedDevices.map(dev => {
                  const isSelected =
                    resolvedInspector?.type === 'device' &&
                    resolvedInspector.device.id === dev.id;

                  return (
                    <FloorTile
                      key={dev.id}
                      dev={dev}
                      isSelected={isSelected}
                      onSelect={() => setInspectorTarget({ type: 'device', id: dev.id })}
                      formatOngoingDuration={formatOngoingDuration}
                    />
                  );
                })}

                {/* Last tile: dashed "+ Activate device" or inline mini-form */}
                {isActivateTileOpen ? (
                  <div className="bg-[#0b1120] border border-blue-500/60 rounded-xl p-2.5 flex flex-col justify-between gap-1.5 min-h-[116px]">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={effectiveQuickDeviceId}
                        onChange={e => setQuickActivateDeviceId(e.target.value)}
                        style={{ backgroundColor: '#090d16', color: '#f8fafc' }}
                        className="flex-1 min-w-0 bg-[#090d16] border border-slate-700 text-slate-100 rounded px-1.5 py-1 text-[11px] font-mono font-bold focus:outline-none focus:border-blue-500"
                      >
                        {unassignedDevices.length === 0 ? (
                          <option value="">No unassigned</option>
                        ) : (
                          unassignedDevices.map(d => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))
                        )}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={quickActivateQuota}
                        onChange={e =>
                          setQuickActivateQuota(
                            Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1))
                          )
                        }
                        className="w-11 bg-[#090d16] border border-slate-700 text-blue-300 font-mono font-bold text-[11px] rounded px-1 py-1 text-center focus:outline-none focus:border-blue-500"
                        title="Daily target runs"
                      />
                      <button
                        type="button"
                        onClick={() => setIsActivateTileOpen(false)}
                        className="text-slate-500 hover:text-slate-200 px-1 text-xs cursor-pointer"
                        title="Cancel"
                      >
                        ✕
                      </button>
                    </div>

                    <select
                      value={effectiveQuickPlanId}
                      onChange={e => setQuickActivatePlanId(e.target.value)}
                      style={{ backgroundColor: '#090d16', color: '#f8fafc' }}
                      className="w-full bg-[#090d16] border border-slate-700 text-slate-200 rounded px-1.5 py-1 text-[11px] truncate focus:outline-none focus:border-blue-500"
                    >
                      {testPlans.length === 0 ? (
                        <option value="">No plans</option>
                      ) : (
                        testPlans.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))
                      )}
                    </select>

                    <button
                      type="button"
                      disabled={unassignedDevices.length === 0 || !effectiveQuickPlanId}
                      onClick={handleQuickActivateDevice}
                      className="w-full py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-[11px] font-semibold transition cursor-pointer"
                    >
                      Activate
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsActivateTileOpen(true)}
                    className="bg-transparent border border-dashed border-[#1e2d4a] hover:border-slate-600 rounded-xl p-3 flex flex-col items-center justify-center gap-0.5 text-slate-500 hover:text-slate-300 transition cursor-pointer min-h-[116px]"
                  >
                    <span className="text-xs font-semibold">＋ Activate device</span>
                    <span className="text-[11px] text-slate-600 font-mono">
                      {unassignedDevices.length} in pool
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* 3. Testers section (hidden entirely if no active/tested testers exist) */}
            {activeOrTestedTesters.length > 0 && (
              <div className="px-5 pt-3 pb-2 border-t border-[#162036]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      TESTERS · {activeOrTestedTesters.length}{' '}
                      {selectedQaDate === todayStr
                        ? 'TODAY'
                        : selectedQaDate === 'all'
                          ? 'ALL-TIME'
                          : selectedQaDate}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setTesterViewMode(prev => (prev === 'active' ? 'tested' : 'active'))
                      }
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border transition cursor-pointer ${
                        testerViewMode === 'active'
                          ? 'bg-blue-600/20 border-blue-500/60 text-blue-200'
                          : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>Live Now ({activeTesterMap.size})</span>
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-[#141d31]">
                  {displayedTesters.map(tester => {
                    const isSelected =
                      resolvedInspector?.type === 'tester' &&
                      resolvedInspector.tester.testerKey === tester.testerKey;

                    return (
                      <div
                        key={tester.id || tester.name}
                        onClick={() =>
                          setInspectorTarget({ type: 'tester', id: tester.name })
                        }
                        className={`grid grid-cols-1 md:grid-cols-[220px_1fr_80px_80px_100px] items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg text-xs transition cursor-pointer ${
                          isSelected ? 'bg-[#13203a]' : 'hover:bg-[#111b30]/70'
                        }`}
                      >
                        {/* Col 1: Avatar + Name + Live line */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-6 h-6 rounded-full text-[11px] font-bold inline-flex items-center justify-center border shrink-0 ${
                              tester.isActive
                                ? tester.activeInfo?.isAway
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/45'
                                  : 'bg-blue-600 text-white border-blue-400'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {tester.name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-100 truncate">
                              {tester.name}
                            </div>
                            {tester.isActive && tester.activeInfo ? (
                              tester.activeInfo.isAway ? (
                                <div className="text-[11px] text-amber-300 truncate">
                                  ● Away · {tester.activeInfo.deviceName || 'Device'} ·{' '}
                                  {tester.activeInfo.currentStepIndex}/
                                  {tester.activeInfo.totalSteps}
                                </div>
                              ) : (
                                <div className="text-[11px] text-emerald-400 truncate">
                                  ● {tester.activeInfo.deviceName || 'Device'} ·{' '}
                                  {tester.activeInfo.currentStepIndex}/
                                  {tester.activeInfo.totalSteps}
                                </div>
                              )
                            ) : (
                              <div className="text-[11px] text-slate-500 truncate">
                                Idle · last run {tester.lastRun?.completedAtFormatted || 'today'}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Col 2: Device quota chips (click -> device slide-over) */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {tester.devicePills.length > 0 ? (
                            tester.devicePills.map(pill => (
                              <span
                                key={pill.key}
                                onClick={e => {
                                  const targetDevId = pill.deviceId || pill.deviceName;
                                  if (targetDevId) {
                                    e.stopPropagation();
                                    setInspectorTarget({
                                      type: 'device',
                                      id: targetDevId
                                    });
                                  }
                                }}
                                className={`font-mono text-[11px] px-2 py-0.5 rounded-md cursor-pointer transition ${
                                  pill.isDone
                                    ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                    : 'bg-[#131d31] text-slate-300 hover:bg-[#1a2742]'
                                }`}
                                title={pill.tooltip || `Inspect ${pill.deviceName}`}
                              >
                                {pill.label}
                              </span>
                            ))
                          ) : (
                            <span className="font-mono text-[11px] text-slate-600">—</span>
                          )}
                        </div>

                        {/* Col 3: Runs */}
                        <div className="font-mono text-slate-200">
                          {tester.dayData.completedCount} run
                          {tester.dayData.completedCount === 1 ? '' : 's'}
                        </div>

                        {/* Col 4: Bug pill or — */}
                        <div>
                          {tester.bugCount > 0 ? (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setActiveTab('bugs');
                              }}
                              className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 transition cursor-pointer"
                              title={`View bugs logged by ${tester.name}`}
                            >
                              🐛 {tester.bugCount}
                            </button>
                          ) : (
                            <span className="font-mono text-slate-600">—</span>
                          )}
                        </div>

                        {/* Col 5: Avg time right-aligned mono */}
                        <div className="text-right font-mono text-slate-400">
                          {tester.avgFormatted !== '—' ? `${tester.avgFormatted} avg` : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 5. Slide-over detail panel (only rendered when resolvedInspector !== null) */}
      {resolvedInspector && (
        <InspectorSlideOver
          resolvedInspector={resolvedInspector}
          enrichedTesters={enrichedTesters}
          testPlans={testPlans}
          testRuns={testRuns}
          archivedRuns={archivedRuns}
          selectedQaDate={selectedQaDate}
          todayStr={todayStr}
          dateScopeLabel={dateScopeLabel}
          setInspectorTarget={setInspectorTarget}
          setSelectedInspectorTester={setSelectedInspectorTester}
          formatOngoingDuration={formatOngoingDuration}
          onSaveDevice={onSaveDevice}
          onDeleteDevice={onDeleteDevice}
          onDeleteTesterProfile={onDeleteTesterProfile}
          onDeleteTester={onDeleteTester}
          onDeleteTestRun={onDeleteTestRun}
          onBootTester={onBootTester}
        />
      )}
    </div>
  );
};
