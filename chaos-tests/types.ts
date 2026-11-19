export type FailureKind = "database" | "network" | "service";

export interface Fault {
  kind: FailureKind;
  target: string;
  message: string;
}

export interface RecoveryMetrics {
  experiment: string;
  failureKind: FailureKind;
  target: string;
  startedAt: string;
  durationMs: number;
  probes: number;
  failedProbes: number;
  fallbackProbes: number;
  recovered: boolean;
  availabilityPercent: number;
  meanTimeToRecoveryMs: number | null;
}

export interface ExperimentResult {
  name: string;
  metrics: RecoveryMetrics;
  observations: string[];
}

export interface ChaosExperiment {
  name: string;
  failureKind: FailureKind;
  target: string;
  run(): Promise<ExperimentResult>;
}