import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, BundleSuggestion, BundleSuggestionSet } from '../types';
import { extractDeviceIdFromRunId } from '../utils/runUtils';

export { extractDeviceIdFromRunId };

export const GLOBAL_DEVICES_CONFIG_PREFIX = '__GLOBAL_DEVICES_CONFIG__:';
export const GLOBAL_TESTERS_CONFIG_PREFIX = '__GLOBAL_TESTERS_CONFIG__:';
export const GLOBAL_DELETED_DEVICES_PREFIX = '__GLOBAL_DELETED_DEVICES__:';
export const GLOBAL_DELETED_TESTERS_PREFIX = '__GLOBAL_DELETED_TESTERS__:';
export const GLOBAL_DELETED_BUGS_PREFIX = '__GLOBAL_DELETED_BUGS__:';
export const GLOBAL_DELETED_RUNS_PREFIX = '__GLOBAL_DELETED_RUNS__:';

let cloudSyncOk = false;
let cloudSyncListeners: Array<(ok: boolean) => void> = [];
let cloudTombstoneListeners: Array<() => void> = [];

export const getCloudSyncStatus = (): boolean => cloudSyncOk;

export const setCloudSyncStatus = (ok: boolean): void => {
  const next = Boolean(ok && isSupabaseConfigured);
  if (cloudSyncOk !== next) {
    cloudSyncOk = next;
    cloudSyncListeners.forEach(l => {
      try { l(cloudSyncOk); } catch (e) {}
    });
  }
};

export const onCloudSyncStatusChange = (listener: (ok: boolean) => void) => {
  cloudSyncListeners.push(listener);
  listener(cloudSyncOk);
  return () => {
    cloudSyncListeners = cloudSyncListeners.filter(l => l !== listener);
  };
};

export const onCloudTombstonesUpdated = (listener: () => void) => {
  cloudTombstoneListeners.push(listener);
  return () => {
    cloudTombstoneListeners = cloudTombstoneListeners.filter(l => l !== listener);
  };
};

const notifyCloudTombstonesUpdated = () => {
  cloudTombstoneListeners.forEach(l => {
    try { l(); } catch (e) {}
  });
};

let lastLocalStorageInstance: Storage | undefined;
const deletedTestRunIdsMemory = new Set<string>();
const deletedArchivedRunIdsMemory = new Set<string>();
const cloudDeletedRunIdsMemory = new Set<string>();
const deletedBugIdsMemory = new Set<string>();
const cloudDeletedBugIdsMemory = new Set<string>();
const deletedDeviceIdsMemory = new Set<string>();
const cloudDeletedDeviceIdsMemory = new Set<string>();
const deletedTesterIdsMemory = new Set<string>();
const cloudDeletedTesterIdsMemory = new Set<string>();

const syncMemoryWithStorageInstance = () => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== lastLocalStorageInstance) {
      lastLocalStorageInstance = localStorage;
      deletedTestRunIdsMemory.clear();
      deletedArchivedRunIdsMemory.clear();
      cloudDeletedRunIdsMemory.clear();
      deletedBugIdsMemory.clear();
      cloudDeletedBugIdsMemory.clear();
      deletedDeviceIdsMemory.clear();
      cloudDeletedDeviceIdsMemory.clear();
      deletedTesterIdsMemory.clear();
      cloudDeletedTesterIdsMemory.clear();
    }
  } catch {}
};

const readStorageSet = (key: string, memoryFallback: Set<string>): Set<string> => {
  syncMemoryWithStorageInstance();
  const result = new Set<string>();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(id => {
            if (typeof id === 'string' && id) result.add(id);
          });
        }
      } else {
        memoryFallback.clear();
      }
      memoryFallback.forEach(id => result.add(id));
      return result;
    }
  } catch (e) {}
  memoryFallback.forEach(id => result.add(id));
  return result;
};

const writeStorageSet = (key: string, values: Iterable<string>, memoryFallback: Set<string>): void => {
  syncMemoryWithStorageInstance();
  const trimmed = Array.from(new Set(Array.from(values).filter(Boolean))).slice(-500);
  memoryFallback.clear();
  trimmed.forEach(id => memoryFallback.add(id));
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(trimmed));
    }
  } catch (e) {}
};

const unionSets = (...sets: Set<string>[]): Set<string> => {
  const out = new Set<string>();
  sets.forEach(s => s.forEach(v => out.add(v)));
  return out;
};

const setsEqual = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
};

let tombstoneWriteChain: Promise<any> = Promise.resolve();

const writeSingletonPopulatedFeatureRow = async (prefix: string, fullValue: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  const { data: updatedData, error: updateError } = await supabase
    .from('populated_features')
    .update({ feature_name: fullValue })
    .like('feature_name', `${prefix}%`)
    .select();

  if (updateError) throw updateError;

  if (!updatedData || updatedData.length === 0) {
    const { error: upsertError } = await supabase.from('populated_features').upsert({
      feature_name: fullValue,
    });
    if (upsertError) throw upsertError;
  } else if (updatedData.length > 1) {
    for (let i = 1; i < updatedData.length; i++) {
      await supabase.from('populated_features').delete().eq('feature_name', updatedData[i].feature_name);
    }
  }
};

const parseIdArrayFromFeaturePrefix = (rows: Array<{ feature_name?: string }>, prefix: string): string[] => {
  const collected: string[] = [];
  for (const item of rows || []) {
    const name = item?.feature_name || '';
    if (name.startsWith(prefix)) {
      try {
        const parsed = JSON.parse(name.slice(prefix.length));
        if (Array.isArray(parsed)) {
          parsed.forEach(id => {
            if (typeof id === 'string' && id) collected.push(id);
          });
        }
      } catch {}
    }
  }
  return Array.from(new Set(collected));
};

export const updateCloudTombstoneSet = (
  prefix: string,
  addIds: string[],
  removeIds: string[] = []
): Promise<void> => {
  if (!supabase || !isSupabaseConfigured) return Promise.resolve();
  const cleanAdd = addIds.filter(Boolean);
  const cleanRemove = new Set(removeIds.filter(Boolean));
  if (cleanAdd.length === 0 && cleanRemove.size === 0) return Promise.resolve();

  const nextOp = tombstoneWriteChain.then(async () => {
    if (!supabase || !isSupabaseConfigured) return;
    try {
      const { data } = await supabase
        .from('populated_features')
        .select('feature_name')
        .like('feature_name', `${prefix}%`);
      const existing = parseIdArrayFromFeaturePrefix(data || [], prefix);
      const merged = Array.from(new Set([...existing, ...cleanAdd]))
        .filter(id => !cleanRemove.has(id))
        .slice(-500);
      await writeSingletonPopulatedFeatureRow(prefix, `${prefix}${JSON.stringify(merged)}`);
    } catch (err) {
      console.error(`updateCloudTombstoneSet (${prefix}) error:`, err);
    }
  });
  tombstoneWriteChain = nextOp.catch(() => {});
  return nextOp;
};

const ingestCloudTombstoneRows = (rows: Array<{ feature_name?: string }>): boolean => {
  let sawDevices = false;
  let sawTesters = false;
  let sawBugs = false;
  let sawRuns = false;
  const devIds = new Set<string>();
  const testerIds = new Set<string>();
  const bugIds = new Set<string>();
  const runIds = new Set<string>();

  for (const item of rows || []) {
    const name = item?.feature_name || '';
    if (name.startsWith(GLOBAL_DELETED_DEVICES_PREFIX)) {
      sawDevices = true;
      parseIdArrayFromFeaturePrefix([item], GLOBAL_DELETED_DEVICES_PREFIX).forEach(id => devIds.add(id));
    } else if (name.startsWith(GLOBAL_DELETED_TESTERS_PREFIX)) {
      sawTesters = true;
      parseIdArrayFromFeaturePrefix([item], GLOBAL_DELETED_TESTERS_PREFIX).forEach(id => testerIds.add(id));
    } else if (name.startsWith(GLOBAL_DELETED_BUGS_PREFIX)) {
      sawBugs = true;
      parseIdArrayFromFeaturePrefix([item], GLOBAL_DELETED_BUGS_PREFIX).forEach(id => bugIds.add(id));
    } else if (name.startsWith(GLOBAL_DELETED_RUNS_PREFIX)) {
      sawRuns = true;
      parseIdArrayFromFeaturePrefix([item], GLOBAL_DELETED_RUNS_PREFIX).forEach(id => runIds.add(id));
    }
  }

  let changed = false;
  if (sawDevices) {
    const prev = readStorageSet('qa_cloud_deleted_device_ids', cloudDeletedDeviceIdsMemory);
    if (!setsEqual(prev, devIds)) {
      writeStorageSet('qa_cloud_deleted_device_ids', devIds, cloudDeletedDeviceIdsMemory);
      changed = true;
    }
  }
  if (sawTesters) {
    const prev = readStorageSet('qa_cloud_deleted_tester_ids', cloudDeletedTesterIdsMemory);
    if (!setsEqual(prev, testerIds)) {
      writeStorageSet('qa_cloud_deleted_tester_ids', testerIds, cloudDeletedTesterIdsMemory);
      changed = true;
    }
  }
  if (sawBugs) {
    const prev = readStorageSet('qa_cloud_deleted_bug_ids', cloudDeletedBugIdsMemory);
    if (!setsEqual(prev, bugIds)) {
      writeStorageSet('qa_cloud_deleted_bug_ids', bugIds, cloudDeletedBugIdsMemory);
      changed = true;
    }
  }
  if (sawRuns) {
    const prev = readStorageSet('qa_cloud_deleted_run_ids', cloudDeletedRunIdsMemory);
    if (!setsEqual(prev, runIds)) {
      writeStorageSet('qa_cloud_deleted_run_ids', runIds, cloudDeletedRunIdsMemory);
      changed = true;
    }
  }
  if (changed) {
    notifyCloudTombstonesUpdated();
  }
  return changed;
};

export const refreshCloudTombstones = async (): Promise<void> => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const { data, error } = await supabase
      .from('populated_features')
      .select('feature_name')
      .like('feature_name', '__GLOBAL_DELETED_%');
    if (!error && Array.isArray(data)) {
      ingestCloudTombstoneRows(data);
    }
  } catch {}
};

export const getDeletedArchivedRunIds = (): Set<string> => {
  return unionSets(
    readStorageSet('qa_deleted_archived_run_ids', deletedArchivedRunIdsMemory),
    readStorageSet('qa_cloud_deleted_run_ids', cloudDeletedRunIdsMemory)
  );
};

export const getDeletedTestRunIds = (): Set<string> => {
  return unionSets(
    readStorageSet('qa_deleted_test_run_ids', deletedTestRunIdsMemory),
    getDeletedArchivedRunIds()
  );
};

export const isTestRunDeleted = (runId?: string | null): boolean => {
  if (!runId) return false;
  return getDeletedTestRunIds().has(runId);
};

export const isArchivedRunDeleted = (runId?: string | null): boolean => {
  if (!runId) return false;
  return getDeletedArchivedRunIds().has(runId);
};

export const markTestRunDeleted = (runId: string) => {
  if (!runId) return;
  const current = readStorageSet('qa_deleted_test_run_ids', deletedTestRunIdsMemory);
  current.add(runId);
  writeStorageSet('qa_deleted_test_run_ids', current, deletedTestRunIdsMemory);
};

export const markArchivedRunDeleted = (runId: string) => {
  if (!runId) return;
  const current = readStorageSet('qa_deleted_archived_run_ids', deletedArchivedRunIdsMemory);
  current.add(runId);
  writeStorageSet('qa_deleted_archived_run_ids', current, deletedArchivedRunIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_run_ids', cloudDeletedRunIdsMemory);
  cloudCurrent.add(runId);
  writeStorageSet('qa_cloud_deleted_run_ids', cloudCurrent, cloudDeletedRunIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_RUNS_PREFIX, [runId]);
};

export const unmarkTestRunDeleted = (runId: string) => {
  if (!runId) return;
  const current = readStorageSet('qa_deleted_test_run_ids', deletedTestRunIdsMemory);
  current.delete(runId);
  writeStorageSet('qa_deleted_test_run_ids', current, deletedTestRunIdsMemory);
};

export const unmarkArchivedRunDeleted = (runId: string) => {
  if (!runId) return;
  const current = readStorageSet('qa_deleted_archived_run_ids', deletedArchivedRunIdsMemory);
  current.delete(runId);
  writeStorageSet('qa_deleted_archived_run_ids', current, deletedArchivedRunIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_run_ids', cloudDeletedRunIdsMemory);
  cloudCurrent.delete(runId);
  writeStorageSet('qa_cloud_deleted_run_ids', cloudCurrent, cloudDeletedRunIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_RUNS_PREFIX, [], [runId]);
};

export const getDeletedBugIds = (): Set<string> => {
  return unionSets(
    readStorageSet('qa_deleted_bug_ids', deletedBugIdsMemory),
    readStorageSet('qa_cloud_deleted_bug_ids', cloudDeletedBugIdsMemory)
  );
};

export const isBugDeleted = (bugId?: string | null): boolean => {
  if (!bugId) return false;
  return getDeletedBugIds().has(bugId);
};

export const markBugDeleted = (bugId: string) => {
  if (!bugId) return;
  const current = readStorageSet('qa_deleted_bug_ids', deletedBugIdsMemory);
  current.add(bugId);
  writeStorageSet('qa_deleted_bug_ids', current, deletedBugIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_bug_ids', cloudDeletedBugIdsMemory);
  cloudCurrent.add(bugId);
  writeStorageSet('qa_cloud_deleted_bug_ids', cloudCurrent, cloudDeletedBugIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_BUGS_PREFIX, [bugId]);
};

export const unmarkBugDeleted = (bugId: string) => {
  if (!bugId) return;
  const current = readStorageSet('qa_deleted_bug_ids', deletedBugIdsMemory);
  current.delete(bugId);
  writeStorageSet('qa_deleted_bug_ids', current, deletedBugIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_bug_ids', cloudDeletedBugIdsMemory);
  cloudCurrent.delete(bugId);
  writeStorageSet('qa_cloud_deleted_bug_ids', cloudCurrent, cloudDeletedBugIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_BUGS_PREFIX, [], [bugId]);
};

export const fetchAllSupabaseData = async () => {
  if (!supabase || !isSupabaseConfigured) {
    setCloudSyncStatus(false);
    return null;
  }

  try {
    const [plansRes, runsRes, archivedRes, bugsRes, featuresRes] = await Promise.all([
      supabase.from('test_plans').select('*'),
      supabase.from('test_runs').select('*'),
      supabase.from('archived_runs').select('*'),
      supabase.from('bug_logs').select('*'),
      supabase.from('populated_features').select('*'),
    ]);

    if (plansRes.error || runsRes.error || archivedRes.error || featuresRes.error) {
      console.error('Supabase query error:', {
        plans: plansRes.error,
        runs: runsRes.error,
        archived: archivedRes.error,
        features: featuresRes.error,
      });
      setCloudSyncStatus(false);
      return null;
    }

    const testPlans: TestPlan[] = (plansRes.data || []).map((item: any) => ({
      id: item.id,
      name: item.name || '',
      description: item.description || '',
      steps: item.steps || [],
      createdAt: item.created_at || new Date().toISOString(),
    }));

    const getStartedAtFromItem = (item: any) => {
      if (!item) return undefined;
      if (item.started_at) return item.started_at;
      if (item.results && typeof item.results === 'object') {
        const timestamps = Object.values(item.results)
          .filter(Boolean)
          .map((r: any) => (r && r.timestamp ? new Date(r.timestamp).getTime() : NaN))
          .filter((t: number) => !isNaN(t));
        if (timestamps.length > 0) {
          return new Date(Math.min(...timestamps)).toISOString();
        }
      }
      return item.created_at || undefined;
    };

    const rawFeaturesData = featuresRes.data || [];
    ingestCloudTombstoneRows(rawFeaturesData);

    let populatedFeatures: string[] = [];
    let devices: DeviceProfile[] = [];
    let testers: TesterProfile[] = [];

    rawFeaturesData.forEach((item: any) => {
      const name = item.feature_name || '';
      if (name.startsWith('__GLOBAL_DEVICES_CONFIG__:') || name.startsWith('__CONFIG_DEVICES__:')) {
        try {
          const jsonStr = name.startsWith('__GLOBAL_DEVICES_CONFIG__:')
            ? name.replace('__GLOBAL_DEVICES_CONFIG__:', '')
            : name.replace('__CONFIG_DEVICES__:', '');
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) devices = parsed;
        } catch (e) {}
      } else if (name.startsWith('__GLOBAL_TESTERS_CONFIG__:') || name.startsWith('__CONFIG_TESTERS__:')) {
        try {
          const jsonStr = name.startsWith('__GLOBAL_TESTERS_CONFIG__:')
            ? name.replace('__GLOBAL_TESTERS_CONFIG__:', '')
            : name.replace('__CONFIG_TESTERS__:', '');
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) testers = parsed;
        } catch (e) {}
      } else if (
        name.startsWith(GLOBAL_DELETED_DEVICES_PREFIX) ||
        name.startsWith(GLOBAL_DELETED_TESTERS_PREFIX) ||
        name.startsWith(GLOBAL_DELETED_BUGS_PREFIX) ||
        name.startsWith(GLOBAL_DELETED_RUNS_PREFIX)
      ) {
        // Handled by ingestCloudTombstoneRows; never expose as CUJ features
      } else {
        populatedFeatures.push(name);
      }
    });

    const knownDeviceIds = new Set(devices.map(d => d.id).filter(Boolean));
    const deletedArchivedIds = getDeletedArchivedRunIds();
    const deletedBugIds = getDeletedBugIds();

    const archivedRuns: TestRun[] = (archivedRes.data || [])
      .filter((item: any) => item && typeof item.id === 'string' && !deletedArchivedIds.has(item.id))
      .map((item: any) => {
        const devIdFromId = extractDeviceIdFromRunId(item.id, knownDeviceIds);
        const rawBugs = Array.isArray(item.bug_logs) ? item.bug_logs : [];
        return {
          id: item.id,
          planId: item.plan_id,
          planName: item.plan_name || '',
          testerName: item.tester_name || '',
          deviceName: item.device_name || '',
          deviceId: item.device_id || devIdFromId,
          status: item.status || 'completed',
          currentStepIndex: item.current_step_index || 0,
          results: item.results || {},
          bugLogs: rawBugs.filter((b: any) => b && b.id && !deletedBugIds.has(b.id)),
          startedAt: getStartedAtFromItem(item) || new Date().toISOString(),
          completedAt: item.completed_at,
          durationMs: item.duration_ms || item.durationMs,
        };
      });

    const archivedIdSet = new Set(archivedRuns.map(r => r.id));
    const deletedRunIds = getDeletedTestRunIds();

    const testRuns: TestRun[] = (runsRes.data || [])
      .filter((item: any) => {
        if (!item || typeof item.id !== 'string') return false;
        if (deletedRunIds.has(item.id) || deletedArchivedIds.has(item.id)) return false;
        if (archivedIdSet.has(item.id)) {
          // Clean up zombie row in test_runs that is already archived
          supabase!.from('test_runs').delete().eq('id', item.id).then(() => {}, () => {});
          return false;
        }
        return true;
      })
      .map((item: any) => {
        const devIdFromId = extractDeviceIdFromRunId(item.id, knownDeviceIds);
        const rawBugs = Array.isArray(item.bug_logs) ? item.bug_logs : [];
        return {
          id: item.id,
          planId: item.plan_id,
          planName: item.plan_name || '',
          testerName: item.tester_name || '',
          deviceName: item.device_name || '',
          deviceId: item.device_id || devIdFromId,
          status: item.status || 'not_started',
          currentStepIndex: item.current_step_index || 0,
          results: item.results || {},
          bugLogs: rawBugs.filter((b: any) => b && b.id && !deletedBugIds.has(b.id)),
          startedAt: getStartedAtFromItem(item) || new Date().toISOString(),
          completedAt: item.completed_at,
          durationMs: item.duration_ms || item.durationMs,
        };
      });

    let bugsWipedAt = 0;
    (featuresRes.data || []).forEach((item: any) => {
      const name = item.feature_name || '';
      if (name.startsWith('__GLOBAL_BUGS_WIPED_AT__:')) {
        const ts = parseInt(name.replace('__GLOBAL_BUGS_WIPED_AT__:', ''), 10);
        if (!isNaN(ts) && ts > bugsWipedAt) bugsWipedAt = ts;
      }
    });

    const bugMap = new Map<string, BugLog>();
    // Worker-owned columns present on each bug_logs row (even when null): the row value wins over the run JSON.
    const rowOwned = new Map<string, Set<string>>();
    (bugsRes.data || []).forEach((item: any) => {
      if (!item || !item.id || deletedBugIds.has(item.id)) return;
      rowOwned.set(item.id, new Set(['filed', 'file_pending', 'bundle', 'repro_matches', 'refined', 'reviewed'].filter(k => k in item)));
      const itemTs = item.timestamp ? new Date(item.timestamp).getTime() : 0;
      if (bugsWipedAt > 0 && itemTs > 0 && itemTs <= bugsWipedAt) {
        return;
      }
      bugMap.set(item.id, {
        id: item.id,
        testRunId: item.test_run_id,
        planId: item.plan_id,
        stepId: item.step_id || '',
        stepTitle: item.step_title || '',
        feature: item.feature || '',
        testerName: item.tester_name || '',
        deviceName: item.device_name || '',
        severity: item.severity || 'medium',
        note: item.note || '',
        imageUrl: item.image_url,
        timestamp: item.timestamp || new Date().toISOString(),
        formattedTime: item.formatted_time || new Date().toLocaleTimeString(),
        environment: item.environment && typeof item.environment === 'object' ? item.environment : undefined,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : undefined,
        refined: item.refined && typeof item.refined === 'object' ? item.refined : undefined,
        originalTimestamp: typeof item.original_timestamp === 'string' && item.original_timestamp ? item.original_timestamp : undefined,
        status: typeof item.status === 'string' && item.status ? item.status : undefined,
        bugType: typeof item.bug_type === 'string' && item.bug_type ? (item.bug_type as BugLog['bugType']) : undefined,
        priority: typeof item.priority === 'string' && item.priority ? (item.priority as BugLog['priority']) : undefined,
        filed: item.filed && typeof item.filed === 'object' ? item.filed : undefined,
        reproMatches: item.repro_matches && typeof item.repro_matches === 'object' ? item.repro_matches : undefined,
        filePending: item.file_pending && typeof item.file_pending === 'object' ? item.file_pending : undefined,
        bundle: item.bundle && typeof item.bundle === 'object' ? item.bundle : undefined,
        reviewed: item.reviewed && typeof item.reviewed === 'object' ? item.reviewed : undefined,
      });
    });

    // Ingest embedded bugs from runs so bugs logged during testing are permanently resilient (respecting bugsWipedAt & deletedBugIds)
    [...testRuns, ...archivedRuns].forEach(run => {
      (run.bugLogs || []).forEach(b => {
        if (b && b.id && !deletedBugIds.has(b.id)) {
          const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          if (bugsWipedAt > 0 && bTs > 0 && bTs <= bugsWipedAt) return;
          if (!bugMap.has(b.id)) {
            bugMap.set(b.id, b);
          } else {
            // Builds and titles ride along in the run's JSON even before the bug_logs columns exist
            const existing = bugMap.get(b.id)!;
            const merged = {
              ...existing,
              environment: existing.environment || b.environment,
              title: existing.title || b.title,
              refined: rowOwned.get(b.id)?.has('refined') ? existing.refined : existing.refined || b.refined,
              originalTimestamp: existing.originalTimestamp || b.originalTimestamp,
              status: existing.status || b.status,
              // bug_logs has no bug_type / priority columns: the triage choices live in the run's JSON copy
              bugType: existing.bugType || b.bugType,
              priority: existing.priority || b.priority,
              // Worker-owned columns: when the row has the column, its value (including null = cleared) wins,
              // so e.g. a confirmed filing (file_pending set to null) isn't undone by a stale copy in the run JSON.
              filed: rowOwned.get(b.id)?.has('filed') ? existing.filed : existing.filed || b.filed,
              reproMatches: rowOwned.get(b.id)?.has('repro_matches') ? existing.reproMatches : existing.reproMatches || b.reproMatches,
              filePending: rowOwned.get(b.id)?.has('file_pending') ? existing.filePending : existing.filePending || b.filePending,
              bundle: rowOwned.get(b.id)?.has('bundle') ? existing.bundle : existing.bundle || b.bundle,
              reviewed: rowOwned.get(b.id)?.has('reviewed') ? existing.reviewed : existing.reviewed || b.reviewed,
            };
            const keys = ['environment', 'title', 'refined', 'originalTimestamp', 'status', 'bugType', 'priority', 'filed', 'reproMatches', 'filePending', 'bundle', 'reviewed'] as const;
            if (keys.some(k => merged[k] !== existing[k])) bugMap.set(b.id, merged);
          }
        }
      });
    });

    const bugLogs: BugLog[] = Array.from(bugMap.values());

    const deletedDeviceIds = getDeletedDeviceIds();
    const deletedTesterIds = getDeletedTesterIds();
    devices = devices.filter(d => !deletedDeviceIds.has(d.id));
    testers = testers.filter(t => !deletedTesterIds.has(t.id));

    setCloudSyncStatus(true);
    return {
      testPlans,
      testRuns,
      archivedRuns,
      bugLogs,
      populatedFeatures,
      devices,
      testers,
    };
  } catch (err) {
    console.error('Error fetching Supabase data:', err);
    setCloudSyncStatus(false);
    return null;
  }
};

export const syncTestPlanToSupabase = async (plan: TestPlan) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await supabase.from('test_plans').upsert({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      steps: plan.steps,
      created_at: plan.createdAt,
    });
  } catch (err) {
    console.error('syncTestPlanToSupabase error:', err);
  }
};

export const deleteTestPlanFromSupabase = async (planId: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await supabase.from('test_plans').delete().eq('id', planId);
  } catch (err) {
    console.error('deleteTestPlanFromSupabase error:', err);
  }
};

export const syncTestRunToSupabase = async (run: TestRun) => {
  if (!run?.id || isTestRunDeleted(run.id) || isArchivedRunDeleted(run.id) || run.status === 'completed') return;
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await refreshCloudTombstones();
    if (isTestRunDeleted(run.id) || isArchivedRunDeleted(run.id)) {
      await supabase.from('test_runs').delete().eq('id', run.id);
      return;
    }
    const deletedBugIds = getDeletedBugIds();
    const cleanBugLogs = Array.isArray(run.bugLogs)
      ? run.bugLogs.filter(b => b && b.id && !deletedBugIds.has(b.id))
      : [];
    const basePayload: any = {
      id: run.id,
      plan_id: run.planId,
      plan_name: run.planName,
      tester_name: run.testerName,
      device_name: run.deviceName,
      status: run.status,
      current_step_index: run.currentStepIndex,
      results: run.results,
      bug_logs: cleanBugLogs,
      started_at: run.startedAt,
      completed_at: run.completedAt,
    };
    const fullPayload: any = {
      ...basePayload,
      ...(run.deviceId !== undefined ? { device_id: run.deviceId } : {}),
      ...(run.durationMs !== undefined ? { duration_ms: run.durationMs } : {}),
    };
    let { error } = await supabase.from('test_runs').upsert(fullPayload);
    if (error && (run.deviceId !== undefined || run.durationMs !== undefined)) {
      const retry = await supabase.from('test_runs').upsert(basePayload);
      error = retry.error;
    }
    if (isTestRunDeleted(run.id) || isArchivedRunDeleted(run.id)) {
      await supabase.from('test_runs').delete().eq('id', run.id);
      return;
    }
    if (error) {
      console.error('syncTestRunToSupabase error:', error);
      throw error;
    }
  } catch (err) {
    console.error('syncTestRunToSupabase exception:', err);
    throw err;
  }
};

export const syncArchivedRunToSupabase = async (run: TestRun) => {
  if (!run?.id || isArchivedRunDeleted(run.id)) return;
  markTestRunDeleted(run.id);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await refreshCloudTombstones();
    if (isArchivedRunDeleted(run.id)) {
      await supabase.from('archived_runs').delete().eq('id', run.id);
      return;
    }
    const deletedBugIds = getDeletedBugIds();
    const cleanBugLogs = Array.isArray(run.bugLogs)
      ? run.bugLogs.filter(b => b && b.id && !deletedBugIds.has(b.id))
      : [];
    const basePayload: any = {
      id: run.id,
      plan_id: run.planId,
      plan_name: run.planName,
      tester_name: run.testerName,
      device_name: run.deviceName,
      status: run.status,
      current_step_index: run.currentStepIndex,
      results: run.results,
      bug_logs: cleanBugLogs,
      started_at: run.startedAt,
      completed_at: run.completedAt,
    };
    const fullPayload: any = {
      ...basePayload,
      ...(run.deviceId !== undefined ? { device_id: run.deviceId } : {}),
      ...(run.durationMs !== undefined ? { duration_ms: run.durationMs } : {}),
    };
    let { error } = await supabase.from('archived_runs').upsert(fullPayload);
    if (error && (run.deviceId !== undefined || run.durationMs !== undefined)) {
      const retry = await supabase.from('archived_runs').upsert(basePayload);
      error = retry.error;
    }
    if (isArchivedRunDeleted(run.id)) {
      await supabase.from('archived_runs').delete().eq('id', run.id);
      return;
    }
    if (error) {
      console.error('syncArchivedRunToSupabase error:', error);
      throw error;
    }
  } catch (err) {
    console.error('syncArchivedRunToSupabase exception:', err);
    throw err;
  }
};

export const deleteTestRunFromSupabase = async (runId: string) => {
  if (runId) markTestRunDeleted(runId);
  if (!supabase || !isSupabaseConfigured) return;
  const { error } = await supabase.from('test_runs').delete().eq('id', runId);
  if (error) {
    console.error('deleteTestRunFromSupabase error:', error);
    throw error;
  }
};

export const deleteArchivedRunFromSupabase = async (runId: string) => {
  if (runId) {
    markTestRunDeleted(runId);
    markArchivedRunDeleted(runId);
  }
  if (!supabase || !isSupabaseConfigured) return;
  const { error } = await supabase.from('archived_runs').delete().eq('id', runId);
  if (error) {
    console.error('deleteArchivedRunFromSupabase error:', error);
    throw error;
  }
};

/** Optional bug_logs columns; each flips to false if that column hasn't been added yet. */
const optionalBugColumns = { environment: true, title: true, refined: true, original_timestamp: true, status: true, bug_type: true, priority: true, filed: true, repro_matches: true, file_pending: true, bundle: true, reviewed: true };

export const syncBugLogToSupabase = async (bug: BugLog) => {
  if (!bug?.id || isBugDeleted(bug.id)) return;
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await refreshCloudTombstones();
    if (isBugDeleted(bug.id)) return;
    const wipedAtStr = typeof localStorage !== 'undefined' ? localStorage.getItem('qa_bugs_wiped_at') : null;
    if (wipedAtStr) {
      const wipedAt = parseInt(wipedAtStr, 10);
      const bugTs = bug.timestamp ? new Date(bug.timestamp).getTime() : 0;
      if (wipedAt > 0 && bugTs > 0 && bugTs <= wipedAt) {
        return;
      }
    }
    const row: Record<string, any> = {
      id: bug.id,
      test_run_id: bug.testRunId,
      plan_id: bug.planId,
      step_id: bug.stepId,
      step_title: bug.stepTitle,
      feature: bug.feature,
      tester_name: bug.testerName,
      device_name: bug.deviceName,
      severity: bug.severity,
      note: bug.note,
      image_url: bug.imageUrl,
      timestamp: bug.timestamp,
      formatted_time: bug.formattedTime,
    };
    if (bug.environment && optionalBugColumns.environment) row.environment = bug.environment;
    if (optionalBugColumns.title) row.title = (bug.title || '').trim() || null;
    if (optionalBugColumns.original_timestamp) row.original_timestamp = bug.originalTimestamp || null;
    // status is app-owned (null when unset so it can be cleared)
    if (optionalBugColumns.status) row.status = bug.status || null;
    // Bug Type / Priority (triage): columns added by tools/sql/add-bug-type-priority.sql. Until that runs they are
    // dropped by the retry below and still travel in the run's bug_logs JSON.
    if (optionalBugColumns.bug_type) row.bug_type = bug.bugType || null;
    if (optionalBugColumns.priority) row.priority = bug.priority || null;
    // Worker-owned columns (refined, repro_matches, filed, file_pending, bundle) are NEVER part of this general
    // upsert: a save from a browser with slightly stale state would overwrite e.g. the worker's fresh filing
    // confirmation. They are written only by patchBugWorkerColumns, from the actions that change them.
    let { error } = await supabase.from('bug_logs').upsert(row);
    // Optional columns (environment, title, refined, original_timestamp, status, filed, repro_matches, file_pending, bundle) may not exist yet - drop the one the error
    // names and retry. The values still travel inside the run's bug_logs JSON.
    for (let attempt = 0; error && attempt < Object.keys(optionalBugColumns).length; attempt++) {
      const msg = String((error as any).message || '');
      const missing = (Object.keys(optionalBugColumns) as Array<keyof typeof optionalBugColumns>)
        // Only a missing-column error counts (so e.g. a message mentioning "status" can't drop that column)
        .find(col => col in row && /column/i.test(msg) && new RegExp(`\\b${col}\\b`, 'i').test(msg));
      if (!missing) break;
      optionalBugColumns[missing] = false;
      delete row[missing];
      ({ error } = await supabase.from('bug_logs').upsert(row));
    }
    if (isBugDeleted(bug.id)) {
      await supabase.from('bug_logs').delete().eq('id', bug.id);
      return;
    }
    if (error) {
      console.error('syncBugLogToSupabase error:', error);
      throw error;
    }
  } catch (err) {
    console.error('syncBugLogToSupabase exception:', err);
    throw err;
  }
};

/** Bug fields owned by targeted writes (actions / the RX95 worker), and their bug_logs columns. */
// `reviewed` is written only by people (Bugs Feed), but like the others it never rides along with general saves.
export const BUG_WORKER_FIELDS = { refined: 'refined', reproMatches: 'repro_matches', filed: 'filed', filePending: 'file_pending', bundle: 'bundle', reviewed: 'reviewed' } as const;
export type BugWorkerField = keyof typeof BUG_WORKER_FIELDS;

/**
 * Targeted write of just these worker-owned columns (null clears). Creates the row first if it doesn't exist.
 * Missing columns are dropped (the values still travel in the run's bug_logs JSON).
 */
export const patchBugWorkerColumns = async (bug: BugLog, fields: BugWorkerField[]) => {
  if (!supabase || !isSupabaseConfigured || !bug?.id || isBugDeleted(bug.id) || !fields.length) return;
  const wipedAtStr = typeof localStorage !== 'undefined' ? localStorage.getItem('qa_bugs_wiped_at') : null;
  if (wipedAtStr) {
    const wipedAt = parseInt(wipedAtStr, 10);
    const bugTs = bug.timestamp ? new Date(bug.timestamp).getTime() : 0;
    if (wipedAt > 0 && bugTs > 0 && bugTs <= wipedAt) return;
  }
  const patch: Record<string, any> = {};
  for (const f of fields) {
    const col = BUG_WORKER_FIELDS[f];
    if (optionalBugColumns[col]) patch[col] = (bug as any)[f] ?? null;
  }
  let createdRow = false;
  for (let attempt = 0; attempt <= fields.length + 1 && Object.keys(patch).length; attempt++) {
    const { data, error } = await supabase.from('bug_logs').update(patch).eq('id', bug.id).select('id');
    if (!error) {
      if (data && data.length) return;
      if (createdRow) return;
      // No row yet (bug only in the run JSON): create it with the base fields, then patch again.
      await syncBugLogToSupabase(bug);
      createdRow = true;
      continue;
    }
    const msg = String((error as any).message || '');
    const missing = Object.keys(patch).find(col => /column/i.test(msg) && new RegExp(`\\b${col}\\b`, 'i').test(msg)) as keyof typeof optionalBugColumns | undefined;
    if (!missing) {
      console.error('patchBugWorkerColumns error:', error);
      throw error;
    }
    optionalBugColumns[missing] = false;
    delete patch[missing];
  }
};

export const deleteBugLogFromSupabase = async (bugId: string) => {
  if (bugId) markBugDeleted(bugId);
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('bug_logs').delete().eq('id', bugId);
  // Also strip the deleted bug from any test_runs or archived_runs rows that still embed it
  try {
    const [runsRes, archRes] = await Promise.all([
      supabase.from('test_runs').select('id,bug_logs'),
      supabase.from('archived_runs').select('id,bug_logs'),
    ]);
    for (const row of runsRes.data || []) {
      if (Array.isArray(row?.bug_logs) && row.bug_logs.some((b: any) => b?.id === bugId)) {
        const cleaned = row.bug_logs.filter((b: any) => b?.id !== bugId);
        await supabase.from('test_runs').update({ bug_logs: cleaned }).eq('id', row.id);
      }
    }
    for (const row of archRes.data || []) {
      if (Array.isArray(row?.bug_logs) && row.bug_logs.some((b: any) => b?.id === bugId)) {
        const cleaned = row.bug_logs.filter((b: any) => b?.id !== bugId);
        await supabase.from('archived_runs').update({ bug_logs: cleaned }).eq('id', row.id);
      }
    }
  } catch (e) {}
};

export const wipeAllBugsFromSupabase = async () => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const wipedAt = Date.now();
    await Promise.all([
      supabase.from('bug_logs').delete().neq('id', 'all_bugs_delete_key'),
      syncPopulatedFeatureToSupabase(`__GLOBAL_BUGS_WIPED_AT__:${wipedAt}`),
    ]);
    try {
      await supabase.from('test_runs').update({ bug_logs: [] }).neq('id', 'all_bugs_dummy');
    } catch (e) {}
    try {
      await supabase.from('archived_runs').update({ bug_logs: [] }).neq('id', 'all_bugs_dummy');
    } catch (e) {}
  } catch (err) {
    console.error('wipeAllBugsFromSupabase error:', err);
  }
};

export const deletePopulatedFeaturesByPrefixFromSupabase = async (prefix: string) => {
  if (!supabase || !isSupabaseConfigured || !prefix) return;
  try {
    await supabase.from('populated_features').delete().like('feature_name', `${prefix}%`);
  } catch (err) {
    console.error('deletePopulatedFeaturesByPrefixFromSupabase error:', err);
  }
};

export const syncPopulatedFeatureToSupabase = async (featureName: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  const singletonPrefixes = [
    '__APP_MIN_VERSION__:',
    '__DAILY_QUOTA_RESET_DATE__:',
    '__GLOBAL_BUGS_WIPED_AT__:',
  ];
  const matchedPrefix = singletonPrefixes.find(p => featureName.startsWith(p));
  if (matchedPrefix) {
    try {
      await supabase
        .from('populated_features')
        .delete()
        .like('feature_name', `${matchedPrefix}%`)
        .neq('feature_name', featureName);
    } catch (e) {}
  }
  await supabase.from('populated_features').upsert({
    feature_name: featureName,
  });
};

export const deletePopulatedFeatureFromSupabase = async (featureName: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('populated_features').delete().eq('feature_name', featureName);
};

export const getDeletedDeviceIds = (): Set<string> => {
  return unionSets(
    readStorageSet('qa_deleted_device_ids', deletedDeviceIdsMemory),
    readStorageSet('qa_cloud_deleted_device_ids', cloudDeletedDeviceIdsMemory)
  );
};

export const isDeviceDeleted = (deviceId?: string | null): boolean => {
  if (!deviceId) return false;
  return getDeletedDeviceIds().has(deviceId);
};

export const markDeviceAsDeleted = (deviceId: string) => {
  if (!deviceId) return;
  const current = readStorageSet('qa_deleted_device_ids', deletedDeviceIdsMemory);
  current.add(deviceId);
  writeStorageSet('qa_deleted_device_ids', current, deletedDeviceIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_device_ids', cloudDeletedDeviceIdsMemory);
  cloudCurrent.add(deviceId);
  writeStorageSet('qa_cloud_deleted_device_ids', cloudCurrent, cloudDeletedDeviceIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_DEVICES_PREFIX, [deviceId]);
};

export const unmarkDeviceAsDeleted = (deviceId: string) => {
  if (!deviceId) return;
  const current = readStorageSet('qa_deleted_device_ids', deletedDeviceIdsMemory);
  current.delete(deviceId);
  writeStorageSet('qa_deleted_device_ids', current, deletedDeviceIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_device_ids', cloudDeletedDeviceIdsMemory);
  cloudCurrent.delete(deviceId);
  writeStorageSet('qa_cloud_deleted_device_ids', cloudCurrent, cloudDeletedDeviceIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_DEVICES_PREFIX, [], [deviceId]);
};

export const getDeletedTesterIds = (): Set<string> => {
  return unionSets(
    readStorageSet('qa_deleted_tester_ids', deletedTesterIdsMemory),
    readStorageSet('qa_cloud_deleted_tester_ids', cloudDeletedTesterIdsMemory)
  );
};

export const isTesterDeleted = (testerId?: string | null): boolean => {
  if (!testerId) return false;
  return getDeletedTesterIds().has(testerId);
};

export const markTesterAsDeleted = (testerId: string) => {
  if (!testerId) return;
  const current = readStorageSet('qa_deleted_tester_ids', deletedTesterIdsMemory);
  current.add(testerId);
  writeStorageSet('qa_deleted_tester_ids', current, deletedTesterIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_tester_ids', cloudDeletedTesterIdsMemory);
  cloudCurrent.add(testerId);
  writeStorageSet('qa_cloud_deleted_tester_ids', cloudCurrent, cloudDeletedTesterIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_TESTERS_PREFIX, [testerId]);
};

export const unmarkTesterAsDeleted = (testerId: string) => {
  if (!testerId) return;
  const current = readStorageSet('qa_deleted_tester_ids', deletedTesterIdsMemory);
  current.delete(testerId);
  writeStorageSet('qa_deleted_tester_ids', current, deletedTesterIdsMemory);
  const cloudCurrent = readStorageSet('qa_cloud_deleted_tester_ids', cloudDeletedTesterIdsMemory);
  cloudCurrent.delete(testerId);
  writeStorageSet('qa_cloud_deleted_tester_ids', cloudCurrent, cloudDeletedTesterIdsMemory);
  updateCloudTombstoneSet(GLOBAL_DELETED_TESTERS_PREFIX, [], [testerId]);
};

export const markDeviceDeleted = markDeviceAsDeleted;
export const unmarkDeviceDeleted = unmarkDeviceAsDeleted;
export const markTesterDeleted = markTesterAsDeleted;
export const unmarkTesterDeleted = unmarkTesterAsDeleted;

export interface DevicePatch {
  id: string;
  changes: Partial<DeviceProfile>;
  updatedAt?: string;
  lockOnly?: boolean;
}

export interface TesterPatch {
  id: string;
  changes: Partial<TesterProfile>;
  updatedAt?: string;
}

/**
 * Compares two optional ISO timestamps:
 * - Returns > 0 if `a` is strictly newer than `b` (or `a` is valid and `b` is missing/invalid).
 * - Returns < 0 if `b` is strictly newer than `a` (or `b` is valid and `a` is missing/invalid).
 * - Returns 0 if both are missing/invalid or represent the same epoch ms.
 */
export const compareUpdatedAt = (a?: string, b?: string): number => {
  const msA = a ? Date.parse(a) : NaN;
  const msB = b ? Date.parse(b) : NaN;
  const validA = Number.isFinite(msA);
  const validB = Number.isFinite(msB);
  if (validA && validB) return msA - msB;
  if (validA) return 1;
  if (validB) return -1;
  return 0;
};

/**
 * Applies per-device patches onto the current cloud device list:
 * - Honors `deletedIds` tombstones (never re-inserts a tombstoned device).
 * - For `lockOnly: true` patches: only updates `activeRunId` and `activeTesterName` on an existing device;
 *   never creates a missing device and never touches `name`, `isReady`, `quotas`, or `updatedAt`.
 * - For user-edit patches: if the cloud copy has a strictly newer `updatedAt` than the patch, the cloud
 *   copy wins (stale writer loses). Otherwise only `patch.changes` are merged onto that device.
 */
export const applyDevicePatches = (
  cloudDevices: DeviceProfile[],
  patches: DevicePatch[],
  deletedIds: Set<string> = getDeletedDeviceIds()
): DeviceProfile[] => {
  const list: DeviceProfile[] = [];
  const byId = new Map<string, DeviceProfile>();

  for (const d of cloudDevices || []) {
    if (!d || !d.id || deletedIds.has(d.id) || byId.has(d.id)) continue;
    const copy: DeviceProfile = { ...d };
    list.push(copy);
    byId.set(copy.id, copy);
  }

  for (const patch of patches || []) {
    if (!patch || !patch.id || deletedIds.has(patch.id)) continue;
    const existing = byId.get(patch.id);

    if (patch.lockOnly) {
      if (existing) {
        if ('activeRunId' in patch.changes) existing.activeRunId = patch.changes.activeRunId;
        if ('activeTesterName' in patch.changes) existing.activeTesterName = patch.changes.activeTesterName;
      }
      continue;
    }

    const patchTs = patch.updatedAt ?? patch.changes.updatedAt;
    if (existing) {
      if (existing.updatedAt && patchTs && compareUpdatedAt(existing.updatedAt, patchTs) > 0) {
        // Stale writer loses against newer updatedAt in cloud
        continue;
      }
      const next: DeviceProfile = {
        ...existing,
        ...patch.changes,
        id: existing.id,
        ...(patchTs || existing.updatedAt ? { updatedAt: patchTs || existing.updatedAt } : {}),
      };
      Object.assign(existing, next);
      if (next.activeRunId === undefined) delete existing.activeRunId;
      if (next.activeTesterName === undefined) delete existing.activeTesterName;
    } else if (typeof patch.changes.name === 'string' && patch.changes.name.trim() !== '') {
      const created: DeviceProfile = {
        id: patch.id,
        name: patch.changes.name,
        isReady: typeof patch.changes.isReady === 'boolean' ? patch.changes.isReady : true,
        quotas: Array.isArray(patch.changes.quotas) ? patch.changes.quotas : [],
        activeRunId: patch.changes.activeRunId,
        activeTesterName: patch.changes.activeTesterName,
        ...(patchTs ? { updatedAt: patchTs } : {}),
      };
      list.push(created);
      byId.set(created.id, created);
    }
  }

  return list.filter(d => !deletedIds.has(d.id));
};

/**
 * Merges `cloudDevices` and `localDevices` per device ID using `updatedAt` (newest wins) and honoring `deletedIds`.
 */
export const mergeDevicesLists = (
  cloudDevices: DeviceProfile[],
  localDevices: DeviceProfile[],
  deletedIds: Set<string> = getDeletedDeviceIds(),
  preferCloudOnTie: boolean = true
): DeviceProfile[] => {
  const validCloud = (cloudDevices || []).filter(d => d && d.id && !deletedIds.has(d.id));
  const validLocal = (localDevices || []).filter(d => d && d.id && !deletedIds.has(d.id));
  const localById = new Map(validLocal.map(d => [d.id, d]));
  const seenIds = new Set<string>();
  const result: DeviceProfile[] = [];

  for (const cloudDev of validCloud) {
    seenIds.add(cloudDev.id);
    const localDev = localById.get(cloudDev.id);
    if (!localDev) {
      result.push({ ...cloudDev });
      continue;
    }
    const cmp = compareUpdatedAt(cloudDev.updatedAt, localDev.updatedAt);
    if (cmp > 0) {
      result.push({ ...cloudDev });
    } else if (cmp < 0) {
      result.push({ ...localDev });
    } else {
      result.push({ ...(preferCloudOnTie ? cloudDev : localDev) });
    }
  }

  for (const localDev of validLocal) {
    if (seenIds.has(localDev.id)) continue;
    // Include local-only device if it has an updatedAt stamp, or if cloud was empty, or if local is preferred on tie
    if (!preferCloudOnTie || Boolean(localDev.updatedAt) || validCloud.length === 0) {
      seenIds.add(localDev.id);
      result.push({ ...localDev });
    }
  }

  return result;
};

/**
 * Applies per-tester patches onto the current cloud tester list, honoring `deletedIds` and `updatedAt`.
 */
export const applyTesterPatches = (
  cloudTesters: TesterProfile[],
  patches: TesterPatch[],
  deletedIds: Set<string> = getDeletedTesterIds()
): TesterProfile[] => {
  const list: TesterProfile[] = [];
  const byId = new Map<string, TesterProfile>();

  for (const t of cloudTesters || []) {
    if (!t || !t.id || deletedIds.has(t.id) || byId.has(t.id)) continue;
    const copy: TesterProfile = { ...t };
    list.push(copy);
    byId.set(copy.id, copy);
  }

  for (const patch of patches || []) {
    if (!patch || !patch.id || deletedIds.has(patch.id)) continue;
    const existing = byId.get(patch.id);
    const patchTs = patch.updatedAt ?? patch.changes.updatedAt;

    if (existing) {
      if (existing.updatedAt && patchTs && compareUpdatedAt(existing.updatedAt, patchTs) > 0) {
        continue;
      }
      const next: TesterProfile = {
        ...existing,
        ...patch.changes,
        id: existing.id,
        ...(patchTs || existing.updatedAt ? { updatedAt: patchTs || existing.updatedAt } : {}),
      };
      Object.assign(existing, next);
    } else if (typeof patch.changes.name === 'string' && patch.changes.name.trim() !== '') {
      const normName = patch.changes.name.trim().toLowerCase();
      const byName = list.find(t => t.name.trim().toLowerCase() === normName);
      if (byName) {
        if (!byName.updatedAt || !patchTs || compareUpdatedAt(byName.updatedAt, patchTs) <= 0) {
          Object.assign(byName, {
            ...byName,
            ...patch.changes,
            id: byName.id,
            ...(patchTs || byName.updatedAt ? { updatedAt: patchTs || byName.updatedAt } : {}),
          });
        }
      } else {
        const created: TesterProfile = {
          id: patch.id,
          name: patch.changes.name.trim(),
          role: patch.changes.role,
          ...(patchTs ? { updatedAt: patchTs } : {}),
        };
        list.push(created);
        byId.set(created.id, created);
      }
    }
  }

  return list.filter(t => !deletedIds.has(t.id));
};

/**
 * Merges `cloudTesters` and `localTesters` per tester ID using `updatedAt` (newest wins) and honoring `deletedIds`.
 */
export const mergeTestersLists = (
  cloudTesters: TesterProfile[],
  localTesters: TesterProfile[],
  deletedIds: Set<string> = getDeletedTesterIds(),
  preferCloudOnTie: boolean = true
): TesterProfile[] => {
  const validCloud = (cloudTesters || []).filter(t => t && t.id && !deletedIds.has(t.id));
  const validLocal = (localTesters || []).filter(t => t && t.id && !deletedIds.has(t.id));
  const localById = new Map(validLocal.map(t => [t.id, t]));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const result: TesterProfile[] = [];

  for (const cloudTester of validCloud) {
    seenIds.add(cloudTester.id);
    const localTester = localById.get(cloudTester.id);
    let chosen: TesterProfile;
    if (!localTester) {
      chosen = { ...cloudTester };
    } else {
      const cmp = compareUpdatedAt(cloudTester.updatedAt, localTester.updatedAt);
      chosen = cmp > 0 ? { ...cloudTester } : cmp < 0 ? { ...localTester } : { ...(preferCloudOnTie ? cloudTester : localTester) };
    }
    seenNames.add((chosen.name || '').trim().toLowerCase());
    result.push(chosen);
  }

  for (const localTester of validLocal) {
    const normName = (localTester.name || '').trim().toLowerCase();
    if (seenIds.has(localTester.id) || (normName && seenNames.has(normName))) continue;
    if (!preferCloudOnTie || Boolean(localTester.updatedAt) || validCloud.length === 0) {
      seenIds.add(localTester.id);
      if (normName) seenNames.add(normName);
      result.push({ ...localTester });
    }
  }

  return result;
};

let deviceConfigWriteChain: Promise<any> = Promise.resolve();
let testerConfigWriteChain: Promise<any> = Promise.resolve();

const readCurrentCloudDevicesAndTombstones = async (): Promise<{
  cloudDevices: DeviceProfile[];
  deletedDeviceIds: Set<string>;
}> => {
  if (!supabase || !isSupabaseConfigured) {
    return { cloudDevices: [], deletedDeviceIds: getDeletedDeviceIds() };
  }
  const { data } = await supabase
    .from('populated_features')
    .select('feature_name')
    .or('feature_name.like.__GLOBAL_DEVICES_CONFIG__:%,feature_name.like.__GLOBAL_DELETED_DEVICES__:%');

  ingestCloudTombstoneRows(data || []);
  let cloudDevices: DeviceProfile[] = [];
  for (const row of data || []) {
    const name = row?.feature_name || '';
    if (name.startsWith(GLOBAL_DEVICES_CONFIG_PREFIX)) {
      try {
        const parsed = JSON.parse(name.slice(GLOBAL_DEVICES_CONFIG_PREFIX.length));
        if (Array.isArray(parsed)) cloudDevices = parsed;
      } catch {}
    }
  }
  return { cloudDevices, deletedDeviceIds: getDeletedDeviceIds() };
};

const readCurrentCloudTestersAndTombstones = async (): Promise<{
  cloudTesters: TesterProfile[];
  deletedTesterIds: Set<string>;
}> => {
  if (!supabase || !isSupabaseConfigured) {
    return { cloudTesters: [], deletedTesterIds: getDeletedTesterIds() };
  }
  const { data } = await supabase
    .from('populated_features')
    .select('feature_name')
    .or('feature_name.like.__GLOBAL_TESTERS_CONFIG__:%,feature_name.like.__GLOBAL_DELETED_TESTERS__:%');

  ingestCloudTombstoneRows(data || []);
  let cloudTesters: TesterProfile[] = [];
  for (const row of data || []) {
    const name = row?.feature_name || '';
    if (name.startsWith(GLOBAL_TESTERS_CONFIG_PREFIX)) {
      try {
        const parsed = JSON.parse(name.slice(GLOBAL_TESTERS_CONFIG_PREFIX.length));
        if (Array.isArray(parsed)) cloudTesters = parsed;
      } catch {}
    }
  }
  return { cloudTesters, deletedTesterIds: getDeletedTesterIds() };
};

export const patchDevicesToCloud = (patchesInput: DevicePatch | DevicePatch[]): Promise<DeviceProfile[]> => {
  const patches = Array.isArray(patchesInput) ? patchesInput : [patchesInput];
  for (const p of patches) {
    if (p && p.id && !p.lockOnly) {
      unmarkDeviceAsDeleted(p.id);
    }
  }
  if (!supabase || !isSupabaseConfigured || patches.length === 0) {
    return Promise.resolve([]);
  }
  const nextOp = deviceConfigWriteChain.then(async () => {
    const { cloudDevices, deletedDeviceIds } = await readCurrentCloudDevicesAndTombstones();
    const nextDevices = applyDevicePatches(cloudDevices, patches, deletedDeviceIds);
    await writeSingletonPopulatedFeatureRow(
      GLOBAL_DEVICES_CONFIG_PREFIX,
      `${GLOBAL_DEVICES_CONFIG_PREFIX}${JSON.stringify(nextDevices)}`
    );
    return nextDevices;
  });
  deviceConfigWriteChain = nextOp.catch(() => {});
  return nextOp;
};

export const patchTestersToCloud = (patchesInput: TesterPatch | TesterPatch[]): Promise<TesterProfile[]> => {
  const patches = Array.isArray(patchesInput) ? patchesInput : [patchesInput];
  for (const p of patches) {
    if (p && p.id) {
      unmarkTesterAsDeleted(p.id);
    }
  }
  if (!supabase || !isSupabaseConfigured || patches.length === 0) {
    return Promise.resolve([]);
  }
  const nextOp = testerConfigWriteChain.then(async () => {
    const { cloudTesters, deletedTesterIds } = await readCurrentCloudTestersAndTombstones();
    const nextTesters = applyTesterPatches(cloudTesters, patches, deletedTesterIds);
    await writeSingletonPopulatedFeatureRow(
      GLOBAL_TESTERS_CONFIG_PREFIX,
      `${GLOBAL_TESTERS_CONFIG_PREFIX}${JSON.stringify(nextTesters)}`
    );
    return nextTesters;
  });
  testerConfigWriteChain = nextOp.catch(() => {});
  return nextOp;
};

export const syncDeviceToSupabase = async (device: DeviceProfile) => {
  if (!device || !device.id) return;
  unmarkDeviceAsDeleted(device.id);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await patchDevicesToCloud({
      id: device.id,
      changes: device,
      updatedAt: device.updatedAt,
    });
  } catch (err) {
    console.error('syncDeviceToSupabase error:', err);
  }
};

export const deleteDeviceFromSupabase = async (deviceId: string) => {
  if (!deviceId) return;
  markDeviceAsDeleted(deviceId);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await updateCloudTombstoneSet(GLOBAL_DELETED_DEVICES_PREFIX, [deviceId]);
    const nextOp = deviceConfigWriteChain.then(async () => {
      const { cloudDevices, deletedDeviceIds } = await readCurrentCloudDevicesAndTombstones();
      deletedDeviceIds.add(deviceId);
      const filtered = cloudDevices.filter(d => d && d.id && !deletedDeviceIds.has(d.id));
      await writeSingletonPopulatedFeatureRow(
        GLOBAL_DEVICES_CONFIG_PREFIX,
        `${GLOBAL_DEVICES_CONFIG_PREFIX}${JSON.stringify(filtered)}`
      );
    });
    deviceConfigWriteChain = nextOp.catch(() => {});
    await nextOp;
  } catch (err) {
    console.error('deleteDeviceFromSupabase error:', err);
  }
};

export const syncTesterToSupabase = async (tester: TesterProfile) => {
  if (!tester || !tester.id) return;
  unmarkTesterAsDeleted(tester.id);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await patchTestersToCloud({
      id: tester.id,
      changes: tester,
      updatedAt: tester.updatedAt,
    });
  } catch (err) {
    console.error('syncTesterToSupabase error:', err);
  }
};

export const deleteTesterFromSupabase = async (testerId: string) => {
  if (!testerId) return;
  markTesterAsDeleted(testerId);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await updateCloudTombstoneSet(GLOBAL_DELETED_TESTERS_PREFIX, [testerId]);
    const nextOp = testerConfigWriteChain.then(async () => {
      const { cloudTesters, deletedTesterIds } = await readCurrentCloudTestersAndTombstones();
      deletedTesterIds.add(testerId);
      const filtered = cloudTesters.filter(t => t && t.id && !deletedTesterIds.has(t.id));
      await writeSingletonPopulatedFeatureRow(
        GLOBAL_TESTERS_CONFIG_PREFIX,
        `${GLOBAL_TESTERS_CONFIG_PREFIX}${JSON.stringify(filtered)}`
      );
    });
    testerConfigWriteChain = nextOp.catch(() => {});
    await nextOp;
  } catch (err) {
    console.error('deleteTesterFromSupabase error:', err);
  }
};

export const syncDevicesListToCloud = async (devices: DeviceProfile[]) => {
  if (!supabase || !isSupabaseConfigured) return;
  const nextOp = deviceConfigWriteChain.then(async () => {
    try {
      const { cloudDevices, deletedDeviceIds } = await readCurrentCloudDevicesAndTombstones();
      const mergedDevices = mergeDevicesLists(cloudDevices, devices || [], deletedDeviceIds, false);
      await writeSingletonPopulatedFeatureRow(
        GLOBAL_DEVICES_CONFIG_PREFIX,
        `${GLOBAL_DEVICES_CONFIG_PREFIX}${JSON.stringify(mergedDevices)}`
      );
    } catch (err) {
      console.error('syncDevicesListToCloud error:', err);
      throw err;
    }
  });
  deviceConfigWriteChain = nextOp.catch(() => {});
  return nextOp;
};

export const syncTestersListToCloud = async (testers: TesterProfile[]) => {
  if (!supabase || !isSupabaseConfigured) return;
  const nextOp = testerConfigWriteChain.then(async () => {
    try {
      const { cloudTesters, deletedTesterIds } = await readCurrentCloudTestersAndTombstones();
      const mergedTesters = mergeTestersLists(cloudTesters, testers || [], deletedTesterIds, false);
      await writeSingletonPopulatedFeatureRow(
        GLOBAL_TESTERS_CONFIG_PREFIX,
        `${GLOBAL_TESTERS_CONFIG_PREFIX}${JSON.stringify(mergedTesters)}`
      );
    } catch (err) {
      console.error('syncTestersListToCloud error:', err);
    }
  });
  testerConfigWriteChain = nextOp.catch(() => {});
  return nextOp;
};

export const subscribeToSupabaseRealtime = (onChangeCallback: () => void) => {
  if (!supabase || !isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel('qa-manager-realtime-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      onChangeCallback();
    })
    .subscribe();

  return () => {
    if (supabase) {
      supabase.removeChannel(channel);
    }
  };
};

export interface BootSignal {
  testerName?: string;
  deviceId?: string;
  deviceName?: string;
  runId?: string;
  timestamp: number;
}

let globalCommandsChannel: any = null;
const commandListeners = new Set<(signal: BootSignal) => void>();

export const getCommandsChannel = () => {
  if (!supabase || !isSupabaseConfigured) return null;
  if (!globalCommandsChannel) {
    globalCommandsChannel = supabase.channel('qa-system-commands', {
      config: { broadcast: { self: true } }
    });
    globalCommandsChannel.on('broadcast', { event: 'BOOT_TESTER' }, (msg: any) => {
      if (msg && msg.payload) {
        commandListeners.forEach(listener => {
          try {
            listener(msg.payload);
          } catch (e) {
            console.error('Error in BOOT_TESTER listener:', e);
          }
        });
      }
    });
    globalCommandsChannel.subscribe();
  }
  return globalCommandsChannel;
};

export const subscribeToSystemCommands = (onBootReceived: (signal: BootSignal) => void) => {
  if (!supabase || !isSupabaseConfigured) return () => {};

  const channel = getCommandsChannel();
  if (!channel) return () => {};

  commandListeners.add(onBootReceived);

  return () => {
    commandListeners.delete(onBootReceived);
  };
};

export const broadcastBootSignal = async (signal: BootSignal) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const channel = getCommandsChannel();
    if (!channel) return;
    await channel.send({
      type: 'broadcast',
      event: 'BOOT_TESTER',
      payload: signal
    });
  } catch (err) {
    console.error('broadcastBootSignal error:', err);
  }
};

/** RX95 worker heartbeat (row '_heartbeat' in rx95_bundle_suggestions). */
export interface Rx95Heartbeat {
  at: string;
  queues?: { refine?: number; match?: number; bundle?: number; confirm?: number };
  /** RX95 reply health: consecutive failed jobs since the last success. */
  rx95?: { okAt?: string; failAt?: string; failStreak?: number; error?: string };
}


export interface Rx95SuggestionsData {
  sets: BundleSuggestionSet[];
  heartbeat?: Rx95Heartbeat;
}

/** Local-only (no Supabase) source for sandboxes/tests: localStorage 'qa_rx95_suggestions_local' = rows like the table. */
const LOCAL_SUGGESTIONS_KEY = 'qa_rx95_suggestions_local';

function parseSuggestionRows(rows: any[]): Rx95SuggestionsData {
  const sets: BundleSuggestionSet[] = [];
  let heartbeat: Rx95Heartbeat | undefined;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    if (row.id === '_heartbeat') {
      const at = typeof payload.at === 'string' ? payload.at : (typeof row.updated_at === 'string' ? row.updated_at : '');
      if (at) heartbeat = {
        at,
        queues: payload.queues && typeof payload.queues === 'object' ? payload.queues : undefined,
        rx95: payload.rx95 && typeof payload.rx95 === 'object' ? payload.rx95 : undefined,
      };
      continue;
    }
    const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
    sets.push({
      id: String(payload.id || row.id || ''),
      planId: String(payload.planId || row.plan_id || ''),
      day: String(payload.day || row.day || ''),
      sig: String(payload.sig || row.sig || ''),
      at: String(payload.at || row.updated_at || ''),
      suggestions: suggestions
        .filter((x: any) => x && typeof x === 'object' && Array.isArray(x.memberIds))
        .map((x: any) => ({
          id: String(x.id || ''),
          memberIds: x.memberIds.map((m: any) => String(m)),
          maybeIds: Array.isArray(x.maybeIds) ? x.maybeIds.map((m: any) => String(m)) : undefined,
          title: String(x.title || ''),
          summary: String(x.summary || ''),
          confidence: Number.isFinite(Number(x.confidence)) ? Math.max(0, Math.min(100, Number(x.confidence))) : 0,
          reason: String(x.reason || ''),
        }))
        .filter((x: BundleSuggestion) => x.id && x.memberIds.length >= 2),
    });
  }
  return { sets, heartbeat };
}

/** Read-only: the app never writes rx95_bundle_suggestions. */
export const fetchRx95Suggestions = async (): Promise<Rx95SuggestionsData | null> => {
  if (!supabase || !isSupabaseConfigured) {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_SUGGESTIONS_KEY) : null;
      return raw ? parseSuggestionRows(JSON.parse(raw)) : null;
    } catch { return null; }
  }
  try {
    const { data, error } = await supabase.from('rx95_bundle_suggestions').select('*');
    if (error) return null; // table may not exist yet
    return parseSuggestionRows(data || []);
  } catch {
    return null;
  }
};
