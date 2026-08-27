export interface TestStep {
  id: string;
  title: string;
  description: string;
  expectedOutcome: string;
  feature?: string;
}

export interface TestPlan {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  createdAt: string;
}

export interface BugLog {
  id: string;
  testRunId: string;
  planId: string;
  stepId: string;
  stepTitle: string;
  feature?: string;
  testerName: string;
  deviceName?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  note: string;
  imageUrl?: string;
  timestamp: string; // ISO string with date & time
  formattedTime: string; // Human readable time
}

export interface StepResult {
  stepId: string;
  status: 'green' | 'yellow' | 'red' | 'pending';
  feature?: string;
  timestamp?: string;
  notes?: string;
}

export interface TestRun {
  id: string;
  planId: string;
  planName: string;
  testerName: string;
  deviceName?: string;
  deviceId?: string;
  status: 'not_started' | 'in_progress' | 'completed';
  currentStepIndex: number;
  results: Record<string, StepResult>; // stepId -> StepResult
  bugLogs: BugLog[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}
