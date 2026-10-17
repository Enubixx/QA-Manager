import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile, BundleSuggestion, BundleSuggestionSet } from '../types';

export const fetchAllSupabaseData = async () => {
  if (!supabase || !isSupabaseConfigured) return null;

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

    const testRuns: TestRun[] = (runsRes.data || [])
      .filter((item: any) => item && typeof item.id === 'string')
      .map((item: any) => {
        const devIdFromId = item.id.includes('-dev-') ? 'dev-' + item.id.split('-dev-')[1] : undefined;
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
          bugLogs: item.bug_logs || [],
          startedAt: getStartedAtFromItem(item) || new Date().toISOString(),
          completedAt: item.completed_at,
          durationMs: item.duration_ms || item.durationMs,
        };
      });

    const archivedRuns: TestRun[] = (archivedRes.data || [])
      .filter((item: any) => item && typeof item.id === 'string')
      .map((item: any) => {
        const devIdFromId = item.id.includes('-dev-') ? 'dev-' + item.id.split('-dev-')[1] : undefined;
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
          bugLogs: item.bug_logs || [],
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
      if (item && item.id) rowOwned.set(item.id, new Set(['filed', 'file_pending', 'bundle', 'repro_matches', 'refined'].filter(k => k in item)));
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
        filed: item.filed && typeof item.filed === 'object' ? item.filed : undefined,
        reproMatches: item.repro_matches && typeof item.repro_matches === 'object' ? item.repro_matches : undefined,
        filePending: item.file_pending && typeof item.file_pending === 'object' ? item.file_pending : undefined,
        bundle: item.bundle && typeof item.bundle === 'object' ? item.bundle : undefined,
      });
    });

    // Ingest embedded bugs from runs so bugs logged during testing are permanently resilient (respecting bugsWipedAt)
    [...testRuns, ...archivedRuns].forEach(run => {
      (run.bugLogs || []).forEach(b => {
        if (b && b.id) {
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
            };
            const keys = ['environment', 'title', 'refined', 'originalTimestamp', 'status', 'bugType', 'priority', 'filed', 'reproMatches', 'filePending', 'bundle'] as const;
            if (keys.some(k => merged[k] !== existing[k])) bugMap.set(b.id, merged);
          }
        }
      });
    });

    const bugLogs: BugLog[] = Array.from(bugMap.values());

    const rawFeaturesData = featuresRes.data || [];
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
      } else {
        populatedFeatures.push(name);
      }
    });

    const deletedDeviceIds = getDeletedDeviceIds();
    const deletedTesterIds = getDeletedTesterIds();
    devices = devices.filter(d => !deletedDeviceIds.has(d.id));
    testers = testers.filter(t => !deletedTesterIds.has(t.id));

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
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const basePayload: any = {
      id: run.id,
      plan_id: run.planId,
      plan_name: run.planName,
      tester_name: run.testerName,
      device_name: run.deviceName,
      status: run.status,
      current_step_index: run.currentStepIndex,
      results: run.results,
      bug_logs: run.bugLogs,
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
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const basePayload: any = {
      id: run.id,
      plan_id: run.planId,
      plan_name: run.planName,
      tester_name: run.testerName,
      device_name: run.deviceName,
      status: run.status,
      current_step_index: run.currentStepIndex,
      results: run.results,
      bug_logs: run.bugLogs,
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
  if (!supabase || !isSupabaseConfigured) return;
  const { error } = await supabase.from('test_runs').delete().eq('id', runId);
  if (error) {
    console.error('deleteTestRunFromSupabase error:', error);
    throw error;
  }
};

export const deleteArchivedRunFromSupabase = async (runId: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  const { error } = await supabase.from('archived_runs').delete().eq('id', runId);
  if (error) {
    console.error('deleteArchivedRunFromSupabase error:', error);
    throw error;
  }
};

/** Optional bug_logs columns; each flips to false if that column hasn't been added yet. */
const optionalBugColumns = { environment: true, title: true, refined: true, original_timestamp: true, status: true, filed: true, repro_matches: true, file_pending: true, bundle: true };

export const syncBugLogToSupabase = async (bug: BugLog) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
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
export const BUG_WORKER_FIELDS = { refined: 'refined', reproMatches: 'repro_matches', filed: 'filed', filePending: 'file_pending', bundle: 'bundle' } as const;
export type BugWorkerField = keyof typeof BUG_WORKER_FIELDS;

/**
 * Targeted write of just these worker-owned columns (null clears). Creates the row first if it doesn't exist.
 * Missing columns are dropped (the values still travel in the run's bug_logs JSON).
 */
export const patchBugWorkerColumns = async (bug: BugLog, fields: BugWorkerField[]) => {
  if (!supabase || !isSupabaseConfigured || !bug?.id || !fields.length) return;
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
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('bug_logs').delete().eq('id', bugId);
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
  try {
    const raw = localStorage.getItem('qa_deleted_device_ids');
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
};

export const markDeviceAsDeleted = (deviceId: string) => {
  try {
    const current = getDeletedDeviceIds();
    current.add(deviceId);
    localStorage.setItem('qa_deleted_device_ids', JSON.stringify(Array.from(current)));
  } catch (e) {}
};

export const unmarkDeviceAsDeleted = (deviceId: string) => {
  try {
    const current = getDeletedDeviceIds();
    current.delete(deviceId);
    localStorage.setItem('qa_deleted_device_ids', JSON.stringify(Array.from(current)));
  } catch (e) {}
};

export const getDeletedTesterIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem('qa_deleted_tester_ids');
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
};

export const markTesterAsDeleted = (testerId: string) => {
  try {
    const current = getDeletedTesterIds();
    current.add(testerId);
    localStorage.setItem('qa_deleted_tester_ids', JSON.stringify(Array.from(current)));
  } catch (e) {}
};

export const unmarkTesterAsDeleted = (testerId: string) => {
  try {
    const current = getDeletedTesterIds();
    current.delete(testerId);
    localStorage.setItem('qa_deleted_tester_ids', JSON.stringify(Array.from(current)));
  } catch (e) {}
};

export const syncDeviceToSupabase = async (device: DeviceProfile) => {
  unmarkDeviceAsDeleted(device.id);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await supabase.from('devices').upsert({
      id: device.id,
      name: device.name,
      is_ready: device.isReady,
      quotas: device.quotas,
      active_run_id: device.activeRunId || null,
      active_tester_name: device.activeTesterName || null,
    });
  } catch (err) {
    console.error('syncDeviceToSupabase error:', err);
  }
};

export const deleteDeviceFromSupabase = async (deviceId: string) => {
  markDeviceAsDeleted(deviceId);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await supabase.from('devices').delete().eq('id', deviceId);
  } catch (err) {
    console.error('deleteDeviceFromSupabase error:', err);
  }
};

export const syncTesterToSupabase = async (tester: TesterProfile) => {
  unmarkTesterAsDeleted(tester.id);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await supabase.from('testers').upsert({
      id: tester.id,
      name: tester.name,
      role: tester.role || '',
    });
  } catch (err) {
    console.error('syncTesterToSupabase error:', err);
  }
};

export const deleteTesterFromSupabase = async (testerId: string) => {
  markTesterAsDeleted(testerId);
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await supabase.from('testers').delete().eq('id', testerId);
  } catch (err) {
    console.error('deleteTesterFromSupabase error:', err);
  }
};

export const syncDevicesListToCloud = async (devices: DeviceProfile[]) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const deletedDeviceIds = getDeletedDeviceIds();
    // 1. Fetch current cloud devices to safely merge concurrent updates from other testers
    const { data } = await supabase
      .from('populated_features')
      .select('feature_name')
      .like('feature_name', '__GLOBAL_DEVICES_CONFIG__:%')
      .limit(1);

    let mergedDevices = devices.filter(d => !deletedDeviceIds.has(d.id));
    if (data && data[0]?.feature_name) {
      try {
        const cloudDevices: DeviceProfile[] = JSON.parse(
          data[0].feature_name.replace('__GLOBAL_DEVICES_CONFIG__:', '')
        );
        const localMap = new Map(mergedDevices.map(d => [d.id, d]));
        cloudDevices.forEach(cloudDev => {
          if (!deletedDeviceIds.has(cloudDev.id) && !localMap.has(cloudDev.id)) {
            mergedDevices.push(cloudDev);
          }
        });
      } catch (e) {}
    }

    const newFeatureKey = '__GLOBAL_DEVICES_CONFIG__:' + JSON.stringify(mergedDevices);
    const { data: updatedData, error: updateError } = await supabase
      .from('populated_features')
      .update({ feature_name: newFeatureKey })
      .like('feature_name', '__GLOBAL_DEVICES_CONFIG__%')
      .select();

    if (updateError) throw updateError;

    if (!updatedData || updatedData.length === 0) {
      const { error: upsertError } = await supabase.from('populated_features').upsert({
        feature_name: newFeatureKey
      });
      if (upsertError) throw upsertError;
    } else if (updatedData.length > 1) {
      for (let i = 1; i < updatedData.length; i++) {
        await supabase.from('populated_features').delete().eq('feature_name', updatedData[i].feature_name);
      }
    }
  } catch (err) {
    console.error('syncDevicesListToCloud error:', err);
    throw err;
  }
};

export const syncTestersListToCloud = async (testers: TesterProfile[]) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const deletedTesterIds = getDeletedTesterIds();
    // 1. Fetch current cloud testers to safely merge concurrent additions
    const { data } = await supabase
      .from('populated_features')
      .select('feature_name')
      .like('feature_name', '__GLOBAL_TESTERS_CONFIG__:%')
      .limit(1);

    let mergedTesters = testers.filter(t => !deletedTesterIds.has(t.id));
    if (data && data[0]?.feature_name) {
      try {
        const cloudTesters: TesterProfile[] = JSON.parse(
          data[0].feature_name.replace('__GLOBAL_TESTERS_CONFIG__:', '')
        );
        const localNames = new Set(mergedTesters.map(t => t.name.toLowerCase().trim()));
        cloudTesters.forEach(cloudT => {
          if (!deletedTesterIds.has(cloudT.id) && !localNames.has(cloudT.name.toLowerCase().trim())) {
            mergedTesters.push(cloudT);
            localNames.add(cloudT.name.toLowerCase().trim());
          }
        });
      } catch (e) {}
    }

    const newFeatureKey = '__GLOBAL_TESTERS_CONFIG__:' + JSON.stringify(mergedTesters);
    const { data: updatedData } = await supabase
      .from('populated_features')
      .update({ feature_name: newFeatureKey })
      .like('feature_name', '__GLOBAL_TESTERS_CONFIG__%')
      .select();

    if (!updatedData || updatedData.length === 0) {
      await supabase.from('populated_features').upsert({
        feature_name: newFeatureKey
      });
    } else if (updatedData.length > 1) {
      for (let i = 1; i < updatedData.length; i++) {
        await supabase.from('populated_features').delete().eq('feature_name', updatedData[i].feature_name);
      }
    }
  } catch (err) {
    console.error('syncTestersListToCloud error:', err);
  }
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
      if (at) heartbeat = { at, queues: payload.queues && typeof payload.queues === 'object' ? payload.queues : undefined };
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
