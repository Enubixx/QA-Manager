import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { TestPlan, TestRun, BugLog } from '../types';

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

    const testPlans: TestPlan[] = (plansRes.data || []).map(item => ({
      id: item.id,
      name: item.name || '',
      description: item.description || '',
      steps: item.steps || [],
      createdAt: item.created_at || new Date().toISOString(),
    }));

    const testRuns: TestRun[] = (runsRes.data || []).map(item => ({
      id: item.id,
      planId: item.plan_id,
      planName: item.plan_name || '',
      testerName: item.tester_name || '',
      deviceName: item.device_name || '',
      status: item.status || 'not_started',
      currentStepIndex: item.current_step_index || 0,
      results: item.results || {},
      bugLogs: item.bug_logs || [],
      startedAt: item.started_at || new Date().toISOString(),
      completedAt: item.completed_at,
    }));

    const archivedRuns: TestRun[] = (archivedRes.data || []).map(item => ({
      id: item.id,
      planId: item.plan_id,
      planName: item.plan_name || '',
      testerName: item.tester_name || '',
      deviceName: item.device_name || '',
      status: item.status || 'completed',
      currentStepIndex: item.current_step_index || 0,
      results: item.results || {},
      bugLogs: item.bug_logs || [],
      startedAt: item.started_at || new Date().toISOString(),
      completedAt: item.completed_at,
    }));

    const bugLogs: BugLog[] = (bugsRes.data || []).map(item => ({
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

    const populatedFeatures: string[] = (featuresRes.data || []).map(item => item.feature_name);

    return {
      testPlans,
      testRuns,
      archivedRuns,
      bugLogs,
      populatedFeatures,
    };
  } catch (err) {
    console.error('Error fetching Supabase data:', err);
    return null;
  }
};

export const syncTestPlanToSupabase = async (plan: TestPlan) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('test_plans').upsert({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    steps: plan.steps,
    created_at: plan.createdAt,
  });
};

export const deleteTestPlanFromSupabase = async (planId: string) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('test_plans').delete().eq('id', planId);
};

export const syncTestRunToSupabase = async (run: TestRun) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('test_runs').upsert({
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
  });
};

export const syncArchivedRunToSupabase = async (run: TestRun) => {
  if (!supabase || !isSupabaseConfigured) return;
  await supabase.from('archived_runs').upsert({
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
  });
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
