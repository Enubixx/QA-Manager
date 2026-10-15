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

/** Builds of the phone + glasses pair a bug was logged on (captured by the QA Tester Android app). */
export interface BuildEnvironment {
  phoneManufacturer?: string;
  phoneModel?: string;
  androidVersion?: string;
  phoneBuild?: string;
  glassesCoreVersion?: string;
  glassesCompanionVersion?: string;
  /** Glasses firmware, from Glasses Companion > System > About > Version */
  glassesFirmware?: string;
  glassesSerial?: string;
  glassesProduct?: string;
  /** When the glasses fields were last captured (ISO) */
  glassesCapturedAt?: string;
  /** When this snapshot was taken (ISO) */
  capturedAt?: string;
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
  /** Short summary - becomes the Buganizer title. `note` is the description body. */
  title?: string;
  note: string;
  imageUrl?: string;
  timestamp: string; // ISO string with date & time
  formattedTime: string; // Human readable time
  bugType?: 'Bug' | 'Setup Issue' | 'Known Issue' | 'Feature Request' | 'Misc Issue';
  priority?: 'P0' | 'P1' | 'P2' | '0' | '1' | '2';
  status?: 'Filed' | 'New' | "Repro'd Issue";
  environment?: BuildEnvironment;
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
  status: 'not_started' | 'in_progress' | 'completed' | 'terminated';
  currentStepIndex: number;
  results: Record<string, StepResult>; // stepId -> StepResult
  bugLogs: BugLog[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  lastActivityTimestamp?: number;
  environment?: BuildEnvironment;
}

export interface DevicePlanQuota {
  planId: string;
  targetRunsPerDay: number;
}

export interface DeviceProfile {
  id: string;
  name: string;
  isReady: boolean;
  quotas: DevicePlanQuota[];
  activeRunId?: string;
  activeTesterName?: string;
}

export interface TesterProfile {
  id: string;
  name: string;
  role?: string;
}
