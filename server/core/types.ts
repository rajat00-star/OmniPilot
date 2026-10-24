// Shared domain model for missions, steps, evidence and verification.
// The web client imports these types too (type-only), so keep this file free of runtime deps.

export type MissionStatus =
  | "draft"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "verifying"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "waiting_approval"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export type VerificationStatus = "not_run" | "passed" | "failed" | "warning";

export type ReasoningMode = "claude" | "deterministic";

export interface Target {
  id: string;
  name: string;
  urls: string[];
  /** Where this target came from. "catalog" = curated seed list, never presented as research. */
  origin: "user" | "catalog" | "model";
  enabled: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  tool: string;
  input: Record<string, unknown>;
  dependsOn: string[];
  /** Failure of a non-critical step degrades the mission instead of failing it. */
  critical: boolean;
}

export interface Plan {
  objective: string;
  productName: string;
  productPitch: string;
  deliverables: string[];
  targets: Target[];
  steps: PlanStep[];
  planner: ReasoningMode;
  plannerNotes: string[];
}

export interface StepRun extends PlanStep {
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  attempts: number;
  resultSummary?: string;
  output?: unknown;
  evidenceIds: string[];
  artifactIds: string[];
  verification: VerificationStatus;
  error?: { message: string; code?: string; recovery?: string };
}

export interface SourceCapture {
  id: string;
  targetId: string;
  targetName: string;
  requestedUrl: string;
  finalUrl?: string;
  redirectChain: string[];
  httpStatus?: number;
  title?: string;
  capturedAt: string;
  ok: boolean;
  error?: string;
  /** Mission-relative path of the stored capture text (metadata header + visible text). */
  textFile?: string;
  textSha256?: string;
  textLength?: number;
  screenshotFile?: string;
  stepId: string;
}

export type ObservationKind = "observation" | "inference" | "unknown";
export type ObservationCheck = "grounded" | "ungrounded" | "needs_review" | "unverified";

export interface Observation {
  id: string;
  targetId: string;
  targetName: string;
  field: string;
  value: string;
  kind: ObservationKind;
  /** How it was produced, e.g. "dom:meta[name=description]", "regex:price", "claude:synthesis". */
  method: string;
  sourceId?: string;
  sourceUrl?: string;
  pageTitle?: string;
  capturedAt?: string;
  excerpt?: string;
  /** Observation ids an inference is based on. */
  basis?: string[];
  check: ObservationCheck;
  checkNote?: string;
}

export interface ArtifactRecord {
  id: string;
  kind: "csv" | "markdown" | "html" | "json" | "png";
  role: string;
  filename: string;
  bytes: number;
  sha256: string;
  createdAt: string;
  stepId: string;
  verification: VerificationStatus;
}

export interface CheckResult {
  id: string;
  artifactId?: string;
  scope: "integrity" | "grounding" | "coverage" | "render";
  name: string;
  status: "passed" | "failed" | "warning";
  detail: string;
}

export interface VerificationSummary {
  generatedAt: string;
  sourcesAttempted: number;
  sourcesCaptured: number;
  sourcesFailed: number;
  targetsTotal: number;
  targetsWithAnyCapture: number;
  descriptionsFound: number;
  pricesFound: number;
  pricesUnavailable: number;
  observationsTotal: number;
  observationsGrounded: number;
  observationsUngrounded: number;
  inferences: number;
  claimsNeedingReview: number;
  artifactsChecked: number;
  checksPassed: number;
  checksFailed: number;
  checksWarned: number;
  integrityNote: string;
}

export interface ApprovalRequest {
  id: string;
  stepId: string;
  title: string;
  reason: string;
  createdAt: string;
  resolution?: "approved" | "denied";
  resolvedAt?: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  level: "info" | "success" | "warning" | "error";
  stepId?: string;
  tool?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface BrowserFrame {
  at: string;
  url: string;
  /** The URL that was requested, when a redirect led to a different final URL. */
  requestedUrl?: string;
  title?: string;
  screenshotFile?: string;
  stepId?: string;
  state: "loading" | "loaded" | "failed" | "blocked";
  detail?: string;
}

export interface Mission {
  id: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: MissionStatus;
  mode: ReasoningMode;
  plan?: Plan;
  steps: StepRun[];
  sources: SourceCapture[];
  observations: Observation[];
  artifacts: ArtifactRecord[];
  checks: CheckResult[];
  summary?: VerificationSummary;
  approvals: ApprovalRequest[];
  activity: ActivityEntry[];
  frames: BrowserFrame[];
  analysis?: unknown;
  finalSummary?: string;
  error?: string;
  warnings: string[];
}

export interface MissionListItem {
  id: string;
  prompt: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  artifactCount: number;
  mode: ReasoningMode;
}
