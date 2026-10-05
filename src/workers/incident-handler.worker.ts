/**
 * Incident Handler Worker
 *
 * BullMQ worker that processes security incident response jobs from the
 * INCIDENT_RESPONSE queue. Each job triggers the full response playbook:
 *
 *   Job type: "run-playbook"
 *     â†’ Classifies the threat, executes containment/alert/record playbook,
 *       collects forensic evidence, pushes to SIEM.
 *
 *   Job type: "collect-forensics"
 *     â†’ Runs ForensicsService.collectForIncident for an existing incident.
 *
 *   Job type: "reconstruct-timeline"
 *     â†’ Rebuilds the incident timeline and logs a snapshot.
 *
 *   Job type: "siem-push"
 *     â†’ Sends a single incident payload to the configured SIEM.
 *
 * The worker is intentionally separate from the security-analysis worker so
 * that incident response (potentially slow: DB writes, notifications, HTTP
 * calls to SIEM) does not block rapid threat detection.
 *
 * Part of issue #840 "Automated Security Incident Response System".
 */

import { Worker, Queue, type Job } from "bullmq";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
  defaultJobOptions,
} from "../config/queue";
import { logger } from "../utils/logger.utils";
import { IncidentResponseService, type SiemPushPayload } from "../services/incident-response.service";
import { ForensicsService } from "../services/forensics.service";
import { SecurityIncidentModel } from "../models/security-incident.model";
import type { SecuritySeverity, SecurityIncidentStatus, IncidentCategory } from "../models/security-incident.model";

// â”€â”€â”€ Job data types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RunPlaybookJobData {
  type: "run-playbook";
  userId: string;
  incidentType: string;
  severity: SecuritySeverity;
  score: number | null;
  /** Optional context */
  ip?: string;
  userAgent?: string;
  resource?: string;
  sessionId?: string;
  requestId?: string;
  extraDetails?: Record<string, unknown>;
}

export interface CollectForensicsJobData {
  type: "collect-forensics";
  incidentId: string;
  userId: string;
  collectedBy?: string;
}

export interface ReconstructTimelineJobData {
  type: "reconstruct-timeline";
  incidentId: string;
}

export interface SiemPushJobData {
  type: "siem-push";
  payload: SiemPushPayload;
}

export interface UpdateIncidentStatusJobData {
  type: "update-status";
  incidentId: string;
  status: SecurityIncidentStatus;
  analystNotes?: string;
  actor?: string;
}

export type IncidentHandlerJobData =
  | RunPlaybookJobData
  | CollectForensicsJobData
  | ReconstructTimelineJobData
  | SiemPushJobData
  | UpdateIncidentStatusJobData;

// â”€â”€â”€ Queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const incidentResponseQueue = new Queue<IncidentHandlerJobData>(
  QUEUE_NAMES.INCIDENT_RESPONSE,
  {
    connection: redisConnection,
    defaultJobOptions: {
      ...defaultJobOptions,
      // Incident jobs are high priority â€” use shorter backoff
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    },
  },
);

// â”€â”€â”€ Convenience enqueuing functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Enqueue a full incident response playbook job.
 * Called by the security-analysis worker after threat detection.
 */
export async function enqueuePlaybook(
  data: Omit<RunPlaybookJobData, "type">,
): Promise<void> {
  await incidentResponseQueue.add("run-playbook", { type: "run-playbook", ...data }, {
    priority: data.severity === "critical" ? 1 : data.severity === "high" ? 5 : 10,
  });
}

/**
 * Enqueue a forensic collection job for an existing incident.
 */
export async function enqueueForensics(
  incidentId: string,
  userId: string,
  collectedBy?: string,
): Promise<void> {
  await incidentResponseQueue.add("collect-forensics", {
    type: "collect-forensics",
    incidentId,
    userId,
    collectedBy,
  });
}

/**
 * Enqueue a SIEM push job.
 */
export async function enqueueSiemPush(payload: SiemPushPayload): Promise<void> {
  await incidentResponseQueue.add("siem-push", { type: "siem-push", payload }, {
    priority: payload.severity === "critical" ? 1 : 10,
  });
}

// â”€â”€â”€ Job processor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function processIncidentJob(
  job: Job<IncidentHandlerJobData>,
): Promise<void> {
  const { type } = job.data;

  logger.info(
    { jobId: job.id, type },
    "Processing incident response job",
  );

  switch (type) {

    case "run-playbook": {
      const data = job.data as RunPlaybookJobData;

      logger.warn(
        { jobId: job.id, userId: data.userId, incidentType: data.incidentType, severity: data.severity },
        "Executing incident response playbook",
      );

      const result = await IncidentResponseService.executePlaybook(
        {
          userId: data.userId,
          ip: data.ip,
          userAgent: data.userAgent,
          resource: data.resource,
          sessionId: data.sessionId,
          requestId: data.requestId,
          extraData: data.extraDetails,
        },
        data.incidentType,
        data.severity,
        data.score,
        data.extraDetails,
      );

      logger.warn(
        {
          jobId: job.id,
          incidentId: result.incidentId,
          actionsExecuted: result.actionsExecuted,
          escalated: result.escalated,
          errorsCount: result.errors.length,
        },
        "Incident playbook complete",
      );

      // Automatically queue forensic collection for high/critical incidents
      if (data.severity === "critical" || data.severity === "high") {
        await enqueueForensics(result.incidentId, data.userId, "auto-forensics");
        logger.info(
          { incidentId: result.incidentId },
          "Queued forensic collection for high-severity incident",
        );
      }

      break;
    }

    case "collect-forensics": {
      const data = job.data as CollectForensicsJobData;

      const snapshot = await ForensicsService.collectForIncident(
        data.incidentId,
        data.userId,
        data.collectedBy ?? "incident-handler-worker",
      );

      logger.info(
        {
          jobId: job.id,
          incidentId: data.incidentId,
          artifactCount: snapshot.evidenceItems.length,
          errors: snapshot.errors,
        },
        "Forensic evidence collection complete",
      );

      break;
    }

    case "reconstruct-timeline": {
      const data = job.data as ReconstructTimelineJobData;

      const { incident, timeline, evidence } =
        await IncidentResponseService.reconstructTimeline(data.incidentId);

      if (!incident) {
        logger.warn({ jobId: job.id, incidentId: data.incidentId }, "Incident not found for timeline reconstruction");
        break;
      }

      logger.info(
        {
          jobId: job.id,
          incidentId: data.incidentId,
          timelineEvents: timeline.length,
          evidenceItems: evidence.length,
        },
        "Timeline reconstruction complete",
      );

      // Attach a reconstruction summary as evidence
      await ForensicsService.attachEvidence(
        data.incidentId,
        "log_snapshot",
        "Timeline Reconstruction Summary",
        {
          reconstructedAt: new Date().toISOString(),
          eventCount: timeline.length,
          evidenceCount: evidence.length,
          firstEvent: timeline[0]?.timestamp ?? null,
          lastEvent: timeline[timeline.length - 1]?.timestamp ?? null,
        },
        "timeline-reconstruction",
      );

      break;
    }

    case "siem-push": {
      const data = job.data as SiemPushJobData;

      await IncidentResponseService.pushToSiem(data.payload);

      logger.info(
        { jobId: job.id, incidentId: data.payload.incidentId },
        "SIEM push job complete",
      );
      break;
    }

    case "update-status": {
      const data = job.data as UpdateIncidentStatusJobData;

      const updated = await IncidentResponseService.updateIncidentStatus(
        data.incidentId,
        data.status,
        data.analystNotes,
        data.actor,
      );

      logger.info(
        { jobId: job.id, incidentId: data.incidentId, newStatus: data.status },
        "Incident status updated via worker",
      );
      break;
    }

    default: {
      logger.warn({ jobId: job.id, type }, "Unknown incident job type â€” skipping");
      break;
    }
  }
}

// â”€â”€â”€ Worker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const incidentHandlerWorker = new Worker<IncidentHandlerJobData>(
  QUEUE_NAMES.INCIDENT_RESPONSE,
  processIncidentJob,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.INCIDENT_RESPONSE,
  },
);

// â”€â”€â”€ Worker event handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

incidentHandlerWorker.on("completed", (job) => {
  logger.info(
    { jobId: job.id, type: job.data.type },
    "Incident handler job completed",
  );
});

incidentHandlerWorker.on("failed", (job, err) => {
  logger.error(
    {
      jobId: job?.id,
      type: job?.data.type,
      error: err.message,
      attempts: job?.attemptsMade,
    },
    "Incident handler job failed",
  );
});

incidentHandlerWorker.on("stalled", (jobId) => {
  logger.warn({ jobId }, "Incident handler job stalled â€” will be re-queued");
});

incidentHandlerWorker.on("error", (err) => {
  logger.error({ error: err.message }, "Incident handler worker error");
});

