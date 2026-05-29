/**
 * Email worker — canonical implementation lives in src/jobs/email.worker.ts.
 * This file re-exports for backward compatibility with workers/index.ts.
 */
export { emailWorker } from "../jobs/email.worker";
