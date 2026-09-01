import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { TestPlan, TestRun, BugLog, DeviceProfile, TesterProfile } from '../types';

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

    let devicesRes: any = { data: [] };
    let testersRes: any = { data: [] };
    try {
      devicesRes = await supabase.from('devices').select('*');
    } catch (e) {}
    try {
      testersRes = await supabase.from('testers').select('*');
    } catch (e) {}

    const testPlans: TestPlan[] = (plansRes.data || []).map((item: any) => ({
      id: item.id,
      name: item.name || '',
      description: item.description || '',
      steps: item.steps || [],
      createdAt: item.created_at || new Date().toISOString(),
    }));

    const getStartedAtFromItem = (item: any) => {
      if (item.started_at) return item.started_at;
      if (item.results) {
        const timestamps = Object.values(item.results)
          .map((r: any) => r.timestamp ? new Date(r.timestamp).getTime() : NaN)
          .filter((t: number) => !isNaN(t));
        if (timestamps.length > 0) {
          return new Date(Math.min(...timestamps)).toISOString();
        }
      }
      return item.created_at || undefined;
    };

    const testRuns: TestRun[] = (runsRes.data || []).map((item: any) => {
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

    const archivedRuns: TestRun[] = (archivedRes.data || []).map((item: any) => {
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

    const bugLogs: BugLog[] = (bugsRes.data || []).map((item: any) => ({
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
    }));

    const rawFeaturesData = featuresRes.data || [];
    let populatedFeatures: string[] = [];
    let devices: DeviceProfile[] = (devicesRes.data || []).map((item: any) => ({
      id: item.id,
      name: item.name || '',
      isReady: item.is_ready ?? true,
      quotas: item.quotas || [],
      activeRunId: item.active_run_id || undefined,
      activeTesterName: item.active_tester_name || undefined,
    }));
    let testers: TesterProfile[] = (testersRes.data || []).map((item: any) => ({
      id: item.id,
      name: item.name || '',
      role: item.role || '',
    }));

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
    const payload: any = {
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
    const { error } = await supabase.from('test_runs').upsert(payload);
    if (error) console.error('syncTestRunToSupabase error:', error);
  } catch (err) {
    console.error('syncTestRunToSupabase exception:', err);
  }
};

export const syncArchivedRunToSupabase = async (run: TestRun) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    const payload: any = {
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
    const { error } = await supabase.from('archived_runs').upsert(payload);
    if (error) console.error('syncArchivedRunToSupabase error:', error);
  } catch (err) {
    console.error('syncArchivedRunToSupabase exception:', err);
  }
};

export const deleteTestRunFromSupabase = async (runId: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('test_runs').delete().eq('id', runId);
};

export const deleteArchivedRunFromSupabase = async (runId: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('archived_runs').delete().eq('id', runId);
};

export const syncBugLogToSupabase = async (bug: BugLog) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('bug_logs').upsert({
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
  });
};

export const deleteBugLogFromSupabase = async (bugId: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('bug_logs').delete().eq('id', bugId);
};

export const wipeAllBugsFromSupabase = async () => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('bug_logs').delete().neq('id', 'all_bugs_delete_key');
};

export const syncPopulatedFeatureToSupabase = async (featureName: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('populated_features').upsert({
    feature_name: featureName,
  });
};

export const deletePopulatedFeatureFromSupabase = async (featureName: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('populated_features').delete().eq('feature_name', featureName);
};

export const syncDeviceToSupabase = async (device: DeviceProfile) => {
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
  if (!supabase || !isSupabaseConfigured) return;
  try {
    await supabase.from('devices').delete().eq('id', deviceId);
  } catch (err) {
    console.error('deleteDeviceFromSupabase error:', err);
  }
};

export const syncTesterToSupabase = async (tester: TesterProfile) => {
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
    // 1. Fetch current cloud devices to safely merge concurrent updates from other testers
    const { data } = await supabase
      .from('populated_features')
      .select('feature_name')
      .like('feature_name', '__GLOBAL_DEVICES_CONFIG__:%')
      .limit(1);

    let mergedDevices = [...devices];
    if (data && data[0]?.feature_name) {
      try {
        const cloudDevices: DeviceProfile[] = JSON.parse(
          data[0].feature_name.replace('__GLOBAL_DEVICES_CONFIG__:', '')
        );
        const localMap = new Map(devices.map(d => [d.id, d]));
        cloudDevices.forEach(cloudDev => {
          if (!localMap.has(cloudDev.id)) {
            mergedDevices.push(cloudDev);
          } else {
            const localDev = localMap.get(cloudDev.id)!;
            // Preserve concurrent cloud locks on other devices if local didn't modify that device
            if (cloudDev.activeTesterName && !localDev.activeTesterName && !localDev.activeRunId) {
              const idx = mergedDevices.findIndex(d => d.id === cloudDev.id);
              if (idx !== -1) {
                mergedDevices[idx] = {
                  ...mergedDevices[idx],
                  activeRunId: cloudDev.activeRunId,
                  activeTesterName: cloudDev.activeTesterName
                };
              }
            }
          }
        });
      } catch (e) {}
    }

    await supabase.from('populated_features').delete().like('feature_name', '__GLOBAL_DEVICES_CONFIG__%');
    await supabase.from('populated_features').delete().like('feature_name', '__CONFIG_DEVICES__%');
    await supabase.from('populated_features').upsert({
      feature_name: '__GLOBAL_DEVICES_CONFIG__:' + JSON.stringify(mergedDevices)
    });
  } catch (err) {
    console.error('syncDevicesListToCloud error:', err);
  }
};

export const syncTestersListToCloud = async (testers: TesterProfile[]) => {
  if (!supabase || !isSupabaseConfigured) return;
  try {
    // 1. Fetch current cloud testers to safely merge concurrent additions
    const { data } = await supabase
      .from('populated_features')
      .select('feature_name')
      .like('feature_name', '__GLOBAL_TESTERS_CONFIG__:%')
      .limit(1);

    let mergedTesters = [...testers];
    if (data && data[0]?.feature_name) {
      try {
        const cloudTesters: TesterProfile[] = JSON.parse(
          data[0].feature_name.replace('__GLOBAL_TESTERS_CONFIG__:', '')
        );
        const localNames = new Set(testers.map(t => t.name.toLowerCase().trim()));
        cloudTesters.forEach(cloudT => {
          if (!localNames.has(cloudT.name.toLowerCase().trim())) {
            mergedTesters.push(cloudT);
            localNames.add(cloudT.name.toLowerCase().trim());
          }
        });
      } catch (e) {}
    }

    await supabase.from('populated_features').delete().like('feature_name', '__GLOBAL_TESTERS_CONFIG__%');
    await supabase.from('populated_features').delete().like('feature_name', '__CONFIG_TESTERS__%');
    await supabase.from('populated_features').upsert({
      feature_name: '__GLOBAL_TESTERS_CONFIG__:' + JSON.stringify(mergedTesters)
    });
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
