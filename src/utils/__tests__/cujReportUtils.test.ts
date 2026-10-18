import { describe, it, expect } from 'vitest';
import {
  computeCujReport,
  buildTimelinePoints,
  buildCujReportText,
  ALL_PLANS,
} from '../cujReportUtils';
import type { TestPlan, TestRun, BugLog } from '../../types';

const plan: TestPlan = {
  id: 'plan-1',
  name: 'Core Plan',
  description: '',
  createdAt: '2026-04-01T00:00:00.000Z',
  steps: [
    { id: 's1', title: 'Step 1', feature: 'Notifications', description: '', expectedOutcome: '' },
    { id: 's2', title: 'Step 2', feature: 'Notifications', description: '', expectedOutcome: '' },
    { id: 's3', title: 'Step 3', feature: 'Notifications', description: '', expectedOutcome: '' },
    { id: 's4', title: 'Step 4', feature: 'Notifications', description: '', expectedOutcome: '' },
    { id: 's5', title: 'Step 5', feature: 'Notifications', description: '', expectedOutcome: '' },
  ],
};

describe('cujReportUtils', () => {
  it('enforces the Golden Run rule (0 red, <=1 yellow) and downgrades green step with P0 bug to red (A1)', () => {
    const runGolden: TestRun = {
      id: 'run-golden',
      planId: 'plan-1',
      planName: 'Core Plan',
      testerName: 'Alice',
      deviceName: 'WP01',
      status: 'completed',
      currentStepIndex: 5,
      startedAt: '2026-04-15T10:00:00.000Z',
      completedAt: '2026-04-15T10:10:00.000Z',
      results: {
        s1: { stepId: 's1', status: 'yellow', timestamp: '2026-04-15T10:01:00.000Z' },
        s2: { stepId: 's2', status: 'green', timestamp: '2026-04-15T10:02:00.000Z' },
        s3: { stepId: 's3', status: 'green', timestamp: '2026-04-15T10:03:00.000Z' },
        s4: { stepId: 's4', status: 'green', timestamp: '2026-04-15T10:04:00.000Z' },
        s5: { stepId: 's5', status: 'green', timestamp: '2026-04-15T10:05:00.000Z' },
      },
      bugLogs: [],
    };
    const reportGolden = computeCujReport({
      plans: [plan],
      runs: [runGolden],
      bugs: [],
      scope: { date: '2026-04-15', planId: ALL_PLANS },
    });
    expect(reportGolden.golden.runs[0].isGolden).toBe(true);

    // Same run with a P0 bug on green step s2 -> downgraded to red -> not Golden
    const p0Bug: BugLog = {
      id: 'bug-a1',
      testRunId: 'run-golden',
      planId: 'plan-1',
      stepId: 's2',
      stepTitle: 'Step 2',
      feature: 'Notifications',
      testerName: 'Alice',
      deviceName: 'WP01',
      note: 'Crash on notification tap',
      severity: 'critical',
      priority: 'P0',
      timestamp: '2026-04-15T10:02:30.000Z',
      formattedTime: '10:02 AM',
    };
    const reportNotGolden = computeCujReport({
      plans: [plan],
      runs: [runGolden],
      bugs: [p0Bug],
      scope: { date: '2026-04-15', planId: ALL_PLANS },
    });
    expect(reportNotGolden.golden.runs[0].isGolden).toBe(false);
    expect(reportNotGolden.golden.runs[0].redCount).toBe(1);
    expect(reportNotGolden.golden.runs[0].greenCount).toBe(3);
  });

  it('marks CUJ at 80% health with a P0/critical bug as critical (A2)', () => {
    const run: TestRun = {
      id: 'run-a2',
      planId: 'plan-1',
      planName: 'Core Plan',
      testerName: 'Alice',
      deviceName: 'WP01',
      status: 'completed',
      currentStepIndex: 5,
      startedAt: '2026-04-15T10:00:00.000Z',
      completedAt: '2026-04-15T10:10:00.000Z',
      results: {
        s1: { stepId: 's1', status: 'yellow', timestamp: '2026-04-15T10:01:00.000Z' },
        s2: { stepId: 's2', status: 'green', timestamp: '2026-04-15T10:02:00.000Z' },
        s3: { stepId: 's3', status: 'green', timestamp: '2026-04-15T10:03:00.000Z' },
        s4: { stepId: 's4', status: 'green', timestamp: '2026-04-15T10:04:00.000Z' },
        s5: { stepId: 's5', status: 'green', timestamp: '2026-04-15T10:05:00.000Z' },
      },
      bugLogs: [],
    };
    const p0Bug: BugLog = {
      id: 'bug-a2',
      testRunId: 'run-a2',
      planId: 'plan-1',
      stepId: '',
      stepTitle: '',
      feature: 'Notifications',
      testerName: 'Alice',
      deviceName: 'WP01',
      note: 'Kernel panic',
      severity: 'critical',
      priority: 'P0',
      timestamp: '2026-04-15T10:01:30.000Z',
      formattedTime: '10:01 AM',
    };
    const report = computeCujReport({
      plans: [plan],
      runs: [run],
      bugs: [p0Bug],
      scope: { date: '2026-04-15', planId: ALL_PLANS },
    });
    expect(report.testedMetrics[0].healthScorePct).toBe(80);
    expect(report.testedMetrics[0].status).toBe('critical');
  });

  it('downgrades green steps on Quality Timeline when standalone bugs exist on that day (A3)', () => {
    const run: TestRun = {
      id: 'run-a3',
      planId: 'plan-1',
      planName: 'Core Plan',
      testerName: 'Alice',
      deviceName: 'WP01',
      status: 'completed',
      currentStepIndex: 5,
      startedAt: '2026-04-15T10:00:00.000Z',
      completedAt: '2026-04-15T10:10:00.000Z',
      results: {
        s1: { stepId: 's1', status: 'green', timestamp: '2026-04-15T10:01:00.000Z' },
        s2: { stepId: 's2', status: 'green', timestamp: '2026-04-15T10:02:00.000Z' },
        s3: { stepId: 's3', status: 'green', timestamp: '2026-04-15T10:03:00.000Z' },
        s4: { stepId: 's4', status: 'green', timestamp: '2026-04-15T10:04:00.000Z' },
        s5: { stepId: 's5', status: 'green', timestamp: '2026-04-15T10:05:00.000Z' },
      },
      bugLogs: [],
    };
    const bugs: BugLog[] = [1, 2].map(i => ({
      id: `bug-a3-${i}`,
      testRunId: 'run-a3',
      planId: 'plan-1',
      stepId: '',
      stepTitle: '',
      feature: 'Notifications',
      testerName: 'Alice',
      deviceName: 'WP01',
      note: `Crit bug ${i}`,
      severity: 'critical',
      priority: 'P0',
      timestamp: '2026-04-15T11:00:00.000Z',
      formattedTime: '11:00 AM',
    }));
    const pts = buildTimelinePoints({ plans: [plan], runs: [run], bugs, planId: ALL_PLANS });
    expect(pts).toHaveLength(1);
    expect(pts[0].scorePct).toBe(60);
    expect(pts[0].red).toBe(2);
    expect(pts[0].green).toBe(3);
  });

  it('excludes in-progress partial runs from Golden Runs table while counting live steps in CUJ metrics (A4)', () => {
    const inProgressRun: TestRun = {
      id: 'run-a4',
      planId: 'plan-1',
      planName: 'Core Plan',
      testerName: 'Alice',
      deviceName: 'WP01',
      status: 'in_progress',
      currentStepIndex: 2,
      startedAt: '2026-04-15T10:00:00.000Z',
      results: {
        s1: { stepId: 's1', status: 'green', timestamp: '2026-04-15T10:01:00.000Z' },
        s2: { stepId: 's2', status: 'green', timestamp: '2026-04-15T10:02:00.000Z' },
      },
      bugLogs: [],
    };
    const report = computeCujReport({
      plans: [plan],
      runs: [inProgressRun],
      bugs: [],
      scope: { date: '2026-04-15', planId: ALL_PLANS },
    });
    expect(report.golden.runs).toHaveLength(0);
    expect(report.testedMetrics[0].totalStepsExecuted).toBe(2);
  });

  it('counts only steps matching scope.date for cross-midnight runs in Golden Runs (A5)', () => {
    const crossRun: TestRun = {
      id: 'run-a5',
      planId: 'plan-1',
      planName: 'Core Plan',
      testerName: 'Alice',
      deviceName: 'WP01',
      status: 'completed',
      currentStepIndex: 5,
      startedAt: '2026-04-15T23:55:00',
      completedAt: '2026-04-16T00:05:00',
      results: {
        s1: { stepId: 's1', status: 'green', timestamp: '2026-04-15T23:56:00' },
        s2: { stepId: 's2', status: 'green', timestamp: '2026-04-15T23:58:00' },
        s3: { stepId: 's3', status: 'green', timestamp: '2026-04-16T00:01:00' },
        s4: { stepId: 's4', status: 'green', timestamp: '2026-04-16T00:02:00' },
        s5: { stepId: 's5', status: 'green', timestamp: '2026-04-16T00:03:00' },
      },
      bugLogs: [],
    };
    const rDay1 = computeCujReport({
      plans: [plan],
      runs: [crossRun],
      bugs: [],
      scope: { date: '2026-04-15', planId: ALL_PLANS },
    });
    const rDay2 = computeCujReport({
      plans: [plan],
      runs: [crossRun],
      bugs: [],
      scope: { date: '2026-04-16', planId: ALL_PLANS },
    });
    expect(rDay1.golden.runs[0].totalSteps).toBe(2);
    expect(rDay2.golden.runs[0].totalSteps).toBe(3);
  });

  it('places bug-only CUJs in bugOnlyMetrics with status no_steps and includes (KI, updated) in plainText (A6, A7)', () => {
    const standaloneBug: BugLog = {
      id: 'bug-a6',
      testRunId: '',
      planId: 'plan-1',
      stepId: '',
      stepTitle: '',
      feature: 'Camera Capture',
      testerName: 'Alice',
      deviceName: 'WP01',
      note: 'Preview black screen',
      severity: 'high',
      priority: 'P1',
      timestamp: '2026-04-15T12:00:00.000Z',
      formattedTime: '12:00 PM',
    };
    const report = computeCujReport({
      plans: [plan],
      runs: [],
      bugs: [standaloneBug],
      scope: { date: '2026-04-15', planId: ALL_PLANS },
    });
    expect(report.testedMetrics).toHaveLength(0);
    expect(report.bugOnlyMetrics).toHaveLength(1);
    expect(report.bugOnlyMetrics[0].status).toBe('no_steps');
    expect(report.bugOnlyMetrics[0].totalStepsExecuted).toBe(0);

    const { plainText } = buildCujReportText(report, {
      dateLabel: 'Today',
      getSummary: () => '',
      otherFiledBugs: [{ id: '499999999', title: 'Audio stutter', priority: 'P1', kind: 'follow-up' }],
    });
    expect(plainText).toContain('b/499999999 (KI, updated) [P1] Audio stutter');
  });
});
