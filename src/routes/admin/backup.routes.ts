import { Router } from "express";
import { BackupController } from "../../controllers/backup.controller";

const router = Router();

/**
 * @swagger
 * /admin/backup/full:
 *   post:
 *     summary: Trigger a full database backup
 *     tags: [Admin, Backup]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: Backup job started
 */
router.post("/full", BackupController.triggerFullBackup);

/**
 * @swagger
 * /admin/backup/wal:
 *   post:
 *     summary: Trigger a WAL archive backup
 *     tags: [Admin, Backup]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: WAL backup job started
 */
router.post("/wal", BackupController.triggerWALBackup);

/**
 * @swagger
 * /admin/backup/jobs:
 *   get:
 *     summary: List all backup jobs
 *     tags: [Admin, Backup]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of backup jobs
 */
router.get("/jobs", BackupController.listJobs);

/**
 * @swagger
 * /admin/backup/jobs/{id}:
 *   get:
 *     summary: Get a specific backup job
 *     tags: [Admin, Backup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Backup job details
 *       404:
 *         description: Job not found
 */
router.get("/jobs/:id", BackupController.getJob);

/**
 * @swagger
 * /admin/backup/jobs/{id}/verify:
 *   post:
 *     summary: Verify a backup job
 *     tags: [Admin, Backup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Verification result
 */
router.post("/jobs/:id/verify", BackupController.verifyBackup);

/**
 * @swagger
 * /admin/backup/retention:
 *   post:
 *     summary: Apply retention policy and remove expired backups
 *     tags: [Admin, Backup]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Number of backups removed
 */
router.post("/retention", BackupController.applyRetention);

/**
 * @swagger
 * /admin/backup/pitr:
 *   get:
 *     summary: Get the best backup candidate for point-in-time recovery
 *     tags: [Admin, Backup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: targetTime
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: PITR candidate backup job
 *       400:
 *         description: Missing or invalid targetTime
 *       404:
 *         description: No suitable backup found
 */
router.get("/pitr", BackupController.getPITRCandidate);

export default router;
