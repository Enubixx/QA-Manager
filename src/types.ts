export interface TestStep {
  id: string;
  title: string;
  description: string;
  expectedOutcome: string;
  feature?: string;
  imageUrl?: string;
  slideUrl?: string;
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

export interface BugFiled {
  /** Buganizer issue number, digits only (optional for manual stamps). */
  issueId?: string;
  at: string;
  by?: string;
  via: 'manual' | 'follow-up' | 'new' | 'legacy' | 'bundle';
  /** True once the RX95 worker found proof in Buganizer (comment / new issue carrying the QA Manager ID). */
  confirmed?: boolean;
}

/**
 * Opened in Buganizer but not yet proven filed. The RX95 worker polls Buganizer (read-only) for
 * the QA Manager ID and, when found, replaces this with `filed { confirmed: true }`.
 */
/** A person reviewed a report on the Bugs Feed (or moved it back to New). */
export interface BugReviewed {
  at: string;
  state?: 'reviewed' | 'new';
}

export interface BugFilePending {
  kind: 'follow-up' | 'new' | 'bundle';
  /** Known for follow-ups (the existing bug); filled in by the worker for new bugs. */
  issueId?: string;
  /** Hotlist the new bug is expected in (from the plan allowlist). */
  hotlistId?: string;
  openedAt: string;
  /** Set by the worker after 24h without proof. */
  expired?: boolean;
  /** Bundle id when the mega bug was opened. */
  bundleId?: string;
}

/** A confirmed same-day bundle; stored on every member bug. */
export interface BugBundle {
  id: string;
  memberIds: string[];
  /** RX95's shared title (no "[Gemini on Glasses] [CUJ]" prefix). */
  title: string;
  /** RX95's shared "What happened" text. */
  summary?: string;
  at: string;
  by: 'rx95' | 'manual';
}

/** RX95's suggested bundles for one plan + day (table rx95_bundle_suggestions). */
export interface BundleSuggestionSet {
  /** `${planId}|${day}` */
  id: string;
  planId: string;
  /** YYYY-MM-DD (America/Los_Angeles) */
  day: string;
  /** fingerprint of the member texts it was computed from */
  sig: string;
  at: string;
  suggestions: BundleSuggestion[];
}

export interface BundleSuggestion {
  /** stable id (hash of sorted member ids) */
  id: string;
  memberIds: string[];
  /** members RX95 was unsure about (shown unticked) */
  maybeIds?: string[];
  title: string;
  summary: string;
  /** 0-100 */
  confidence: number;
  reason: string;
}

export interface ReproCandidate {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  /** 0-100 */
  confidence: number;
  verdict: 'very_likely' | 'possible' | 'unlikely';
  reason: string;
}

export interface ReproMatches {
  /** bugTextSig() of the bug when checked */
  sig: string;
  hotlistId: string;
  /** How many hotlist bugs were considered */
  searched: number;
  at: string;
  candidates: ReproCandidate[];
}

export interface RefinedBugText {
  sig: string;
  title: string;
  description: string;
  at: string;
  by: 'rx95';
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
  /**
   * RX95's cleaned-up wording of this bug for Buganizer. `sig` is the title+note it was written
   * from, so it is ignored (and re-requested) once the reporter's text changes.
   */
  refined?: RefinedBugText;
  /** When the tester adjusted the bug's time of day, the time it was first logged. */
  originalTimestamp?: string;
  imageUrl?: string;
  timestamp: string; // ISO string with date & time
  formattedTime: string; // Human readable time
  bugType?: 'Bug' | 'Setup Issue' | 'Known Issue' | 'Feature Request' | 'Misc Issue';
  priority?: 'P0' | 'P1' | 'P2' | '0' | '1' | '2';
  /** Triage status. 'Filed' is legacy (now shown as the `filed` stamp); new values are 'New' | "Repro'd Issue". */
  status?: 'Filed' | 'New' | "Repro'd Issue";
  /** Set when the bug is filed in Buganizer (Bugs Feed "Filed" switch, a follow-up, or "Filed as b/"). Filed bugs are hidden on the Buganizer tab. */
  filed?: BugFiled;
  /** RX95's possible existing Buganizer bugs for a "Repro'd Issue" (valid while `sig` matches the bug text). */
  reproMatches?: ReproMatches;
  /** Opened in Buganizer, waiting for the RX95 worker to confirm it was really filed. */
  filePending?: BugFilePending;
  /** Confirmed same-day bundle this report belongs to. */
  bundle?: BugBundle;
  /** Bugs Feed review state (set by a person; never by the RX95 worker). `state: 'new'` = moved back to New. */
  reviewed?: BugReviewed;
  environment?: BuildEnvironment;
}

export interface StepResult {
  stepId: string;
  status: 'green' | 'yellow' | 'red' | 'pending';
  feature?: string;
  timestamp?: string;
  notes?: string;
}

export interface AutoReleaseMeta {
  at: string;
  reason: 'previous-day' | 'idle';
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
  _meta?: {
    autoReleased?: AutoReleaseMeta;
  };
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
  updatedAt?: string;
}

export interface TesterProfile {
  id: string;
  name: string;
  role?: string;
  updatedAt?: string;
}
