/**
 * Verification Service — Issue #103
 * Handles mentor identity and credential verification workflow.
 */

import pool from '../config/database';
import { enqueueEmail } from '../queues/email.queue';
import { logger } from '../utils/logger.utils';
import * as StellarSdk from '@stellar/stellar-sdk';

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const VERIFICATION_CONTRACT_ADDRESS = process.env.VERIFICATION_CONTRACT_ADDRESS;

interface VerificationContractInvocation {
  contractAddress: string;
  method: string;
  args: unknown[];
}

interface OnChainVerificationResult {
  txHash: string | null;
  successful: boolean;
}

export type VerificationStatus =
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'more_info_requested'
    | 'expired';

export interface VerificationRecord {
    id: string;
    mentor_id: string;
    document_type: string;
    document_url: string;
    credential_url: string | null;
    linkedin_url: string | null;
    additional_notes: string | null;
    status: VerificationStatus;
    reviewed_by: string | null;
    reviewed_at: Date | null;
    rejection_reason: string | null;
    additional_info_request: string | null;
    on_chain_tx_hash: string | null;
    expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
    mentor_email?: string;
    mentor_first_name?: string;
    mentor_last_name?: string;
}

export interface SubmitVerificationInput {
    documentType: string;
    documentUrl: string;
    credentialUrl?: string;
    linkedinUrl?: string;
    additionalNotes?: string;
}

export interface ListVerificationsQuery {
    status?: VerificationStatus;
    page?: number;
    limit?: number;
}

const VERIFICATION_COLUMNS = `
  v.*,
  u.email        AS mentor_email,
  u.first_name   AS mentor_first_name,
  u.last_name    AS mentor_last_name
`;

export const VerificationService = {
    // initialize() removed - schema management moved to migrations


    /** POST /mentors/verification/submit */
    async submit(mentorId: string, input: SubmitVerificationInput): Promise<VerificationRecord> {
        await pool.query(
            `UPDATE mentor_verifications
       SET status = 'rejected', rejection_reason = 'Superseded by new submission', updated_at = NOW()
       WHERE mentor_id = $1 AND status = 'pending'`,
            [mentorId],
        );

        const { rows } = await pool.query<VerificationRecord>(
            `INSERT INTO mentor_verifications
         (mentor_id, document_type, document_url, credential_url, linkedin_url, additional_notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
            [
                mentorId,
                input.documentType,
                input.documentUrl,
                input.credentialUrl ?? null,
                input.linkedinUrl ?? null,
                input.additionalNotes ?? null,
            ],
        );

        const verification = rows[0];
        await this.sendStatusEmail(mentorId, 'pending', verification.id);

        logger.info('[VerificationService] Verification submitted', {
            verificationId: verification.id,
            mentorId,
        });

        return verification;
    },

    /** GET /admin/verifications */
    async list(query: ListVerificationsQuery): Promise<{
        verifications: VerificationRecord[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    }> {
        const page = query.page ?? 1;
        const limit = query.limit ?? 20;
        const offset = (page - 1) * limit;

        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (query.status) {
            conditions.push(`v.status = $${idx}`);
            values.push(query.status);
            idx++;
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const limitParam = idx;
        const offsetParam = idx + 1;

        const [dataResult, countResult] = await Promise.all([
            pool.query<VerificationRecord>(
                `SELECT ${VERIFICATION_COLUMNS}
         FROM mentor_verifications v
         JOIN users u ON u.id = v.mentor_id
         ${where}
         ORDER BY v.created_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
                [...values, limit, offset],
            ),
            pool.query<{ count: string }>(
                `SELECT COUNT(*) FROM mentor_verifications v ${where}`,
                values,
            ),
        ]);

        const total = parseInt(countResult.rows[0].count, 10);
        return {
            verifications: dataResult.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    },

    /** GET /mentors/:id/verification-status */
    async getStatusByMentorId(mentorId: string): Promise<VerificationRecord | null> {
        const { rows } = await pool.query<VerificationRecord>(
            `SELECT ${VERIFICATION_COLUMNS}
       FROM mentor_verifications v
       JOIN users u ON u.id = v.mentor_id
       WHERE v.mentor_id = $1
       ORDER BY v.created_at DESC
       LIMIT 1`,
            [mentorId],
        );
        return rows[0] ?? null;
    },

    /** GET verification by ID (admin use) */
    async getById(id: string): Promise<VerificationRecord | null> {
        const { rows } = await pool.query<VerificationRecord>(
            `SELECT ${VERIFICATION_COLUMNS}
       FROM mentor_verifications v
       JOIN users u ON u.id = v.mentor_id
       WHERE v.id = $1`,
            [id],
        );
        return rows[0] ?? null;
    },

    /** PUT /admin/verifications/:id/approve */
    async approve(verificationId: string, adminId: string): Promise<VerificationRecord> {
        const verification = await this.getById(verificationId);
        if (!verification) throw new Error('Verification not found');
        if (verification.status !== 'pending' && verification.status !== 'more_info_requested') {
            throw new Error('Verification is not in a reviewable state');
        }

        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);

        const onChainTxHash = await this.triggerOnChainVerification(verification.mentor_id);
        const onChainPending = onChainTxHash === null;

        const { rows } = await pool.query<VerificationRecord>(
            `UPDATE mentor_verifications
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
           expires_at = $2, on_chain_tx_hash = $3, on_chain_pending = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
            [adminId, expiresAt, onChainTxHash, onChainPending, verificationId],
        );

        await pool.query(
            `UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1`,
            [verification.mentor_id],
        );

        await this.sendStatusEmail(verification.mentor_id, 'approved', verificationId);

        logger.info('[VerificationService] Verification approved', {
            verificationId,
            mentorId: verification.mentor_id,
            adminId,
            onChainTxHash,
        });

        return rows[0];
    },

    /** PUT /admin/verifications/:id/reject */
    async reject(verificationId: string, adminId: string, reason: string): Promise<VerificationRecord> {
        const verification = await this.getById(verificationId);
        if (!verification) throw new Error('Verification not found');
        if (verification.status !== 'pending' && verification.status !== 'more_info_requested') {
            throw new Error('Verification is not in a reviewable state');
        }

        const { rows } = await pool.query<VerificationRecord>(
            `UPDATE mentor_verifications
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
           rejection_reason = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
            [adminId, reason, verificationId],
        );

        await this.sendStatusEmail(verification.mentor_id, 'rejected', verificationId, { reason });

        logger.info('[VerificationService] Verification rejected', {
            verificationId,
            mentorId: verification.mentor_id,
            adminId,
        });

        return rows[0];
    },

    /** PUT /admin/verifications/:id/request-more */
    async requestMoreInfo(
        verificationId: string,
        adminId: string,
        message: string,
    ): Promise<VerificationRecord> {
        const verification = await this.getById(verificationId);
        if (!verification) throw new Error('Verification not found');
        if (!['pending', 'more_info_requested'].includes(verification.status)) {
            throw new Error('Verification is not in a reviewable state');
        }

        const { rows } = await pool.query<VerificationRecord>(
            `UPDATE mentor_verifications
       SET status = 'more_info_requested', reviewed_by = $1, reviewed_at = NOW(),
           additional_info_request = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
            [adminId, message, verificationId],
        );

        await this.sendStatusEmail(verification.mentor_id, 'more_info_requested', verificationId, {
            message,
        });

        logger.info('[VerificationService] More info requested', {
            verificationId,
            mentorId: verification.mentor_id,
            adminId,
        });

        return rows[0];
    },

    /** Cron: flag verifications past their expiry date */
    async flagExpiredVerifications(): Promise<number> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rowCount } = await client.query(
                `WITH expired_verifications AS (
                   UPDATE mentor_verifications
                   SET status = 'expired', updated_at = NOW()
                   WHERE status = 'approved' AND expires_at < NOW()
                   RETURNING mentor_id
                 )
                 UPDATE users
                 SET is_verified = FALSE, updated_at = NOW()
                 FROM expired_verifications
                 WHERE users.id = expired_verifications.mentor_id`
            );

            await client.query('COMMIT');

            const count = rowCount ?? 0;
            if (count > 0) {
                logger.info('[VerificationService] Expired verifications flagged', { count });
            }

            return count;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    },

    /** Background Job: Retry pending on-chain verifications */
    async retryPendingOnChainVerifications(): Promise<number> {
        const { rows } = await pool.query<VerificationRecord>(
            `SELECT * FROM mentor_verifications WHERE on_chain_pending = TRUE`
        );

        let successCount = 0;
        for (const verification of rows) {
            try {
                const txHash = await this.triggerOnChainVerification(verification.mentor_id);
                if (txHash) {
                    await pool.query(
                        `UPDATE mentor_verifications SET on_chain_tx_hash = $1, on_chain_pending = FALSE, updated_at = NOW() WHERE id = $2`,
                        [txHash, verification.id]
                    );
                    successCount++;
                }
            } catch (err) {
                logger.warn('[VerificationService] Retry on-chain verification failed', {
                    verificationId: verification.id,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }
        
        if (successCount > 0) {
            logger.info('[VerificationService] Retried pending on-chain verifications', { successCount });
        }
        
        return successCount;
    },

    async sendStatusEmail(
        mentorId: string,
        status: VerificationStatus,
        verificationId: string,
        extra?: { reason?: string; message?: string },
    ): Promise<void> {
        try {
            const { rows } = await pool.query<{ email: string; first_name: string }>(
                `SELECT email, first_name FROM users WHERE id = $1`,
                [mentorId],
            );
            if (!rows[0]) return;

            const { email, first_name } = rows[0];

            const subjects: Record<VerificationStatus, string> = {
                pending: 'Verification Submission Received',
                approved: 'Your Verification Has Been Approved',
                rejected: 'Verification Update — Action Required',
                more_info_requested: 'Additional Information Needed for Verification',
                expired: 'Your Verification Has Expired',
            };

            const bodies: Record<VerificationStatus, string> = {
                pending: `Hi ${first_name}, we've received your verification submission (ID: ${verificationId}). Our team will review it shortly.`,
                approved: `Hi ${first_name}, congratulations! Your mentor verification has been approved. Your profile is now verified for one year.`,
                rejected: `Hi ${first_name}, unfortunately your verification was not approved. Reason: ${extra?.reason ?? 'Not specified'}. You may resubmit with updated documents.`,
                more_info_requested: `Hi ${first_name}, our team needs additional information to complete your verification: ${extra?.message ?? ''}. Please resubmit with the requested documents.`,
                expired: `Hi ${first_name}, your mentor verification has expired. Please resubmit your documents to renew your verified status.`,
            };

            await enqueueEmail({
                to: [email],
                subject: subjects[status],
                textContent: bodies[status],
                htmlContent: `<p>${bodies[status]}</p>`,
                priority: status === 'approved' ? 'high' : 'normal',
            });
        } catch (err) {
            logger.error('[VerificationService] Failed to send status email', {
                mentorId,
                status,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    },

    async triggerOnChainVerification(mentorId: string): Promise<string | null> {
        if (!VERIFICATION_CONTRACT_ADDRESS) {
            logger.warn('[VerificationService] VERIFICATION_CONTRACT_ADDRESS not configured, skipping on-chain verification', { mentorId });
            return null;
        }

        const sdkAny = StellarSdk as any;
        const SorobanRpc = sdkAny.SorobanRpc || sdkAny.rpc;

        if (!SorobanRpc?.Server) {
            logger.error('[VerificationService] Soroban RPC not available in stellar-sdk', { mentorId });
            throw new Error('Soroban RPC is not available. Cannot proceed with on-chain verification.');
        }

        const rpcServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

        const platformKeypair = process.env.PLATFORM_SECRET_KEY
            ? sdkAny.Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY)
            : null;

        const sourcePublicKey = platformKeypair?.publicKey?.() || process.env.PLATFORM_PUBLIC_KEY;

        if (!sourcePublicKey) {
            logger.error('[VerificationService] Platform signing key not configured', { mentorId });
            throw new Error('Platform signing key is not configured. Cannot proceed with on-chain verification.');
        }

        const networkPassphrase = process.env.STELLAR_NETWORK === 'mainnet'
            ? sdkAny.Networks.PUBLIC
            : sdkAny.Networks.TESTNET;

        try {
            const account = await rpcServer.getAccount(sourcePublicKey);

            const contract = new sdkAny.Contract(VERIFICATION_CONTRACT_ADDRESS);

            const verificationData = {
                mentor_id: mentorId,
                verified_at: Math.floor(Date.now() / 1000),
            };

            const scValData = sdkAny.nativeToScVal
                ? sdkAny.nativeToScVal(verificationData, { type: 'map' })
                : verificationData;

            const operation = contract.call('verify_credential', scValData);

            const tx = new sdkAny.TransactionBuilder(account, {
                fee: '200',
                networkPassphrase,
            })
                .addOperation(operation)
                .setTimeout(30)
                .build();

            const simulation = await rpcServer.simulateTransaction(tx);

            if (simulation?.error) {
                logger.error('[VerificationService] On-chain verification simulation failed', {
                    mentorId,
                    error: String(simulation.error),
                });
                throw new Error(`Verification simulation failed: ${simulation.error}`);
            }

            let preparedTx = tx;
            if (SorobanRpc.assembleTransaction) {
                const assembled = SorobanRpc.assembleTransaction(tx, simulation);
                preparedTx = assembled?.build ? assembled.build() : assembled;
            }

            if (platformKeypair && typeof preparedTx?.sign === 'function') {
                preparedTx.sign(platformKeypair);
            }

            const sendResult = await rpcServer.sendTransaction(preparedTx);

            if (sendResult?.status === 'PENDING' || sendResult?.status === 'OK') {
                const txHash = sendResult.hash || sendResult.id;

                logger.info('[VerificationService] On-chain verification transaction submitted', {
                    mentorId,
                    txHash,
                });

                return txHash;
            }

            logger.error('[VerificationService] On-chain verification transaction rejected', {
                mentorId,
                status: sendResult?.status,
            });
            throw new Error(`Verification transaction rejected with status: ${sendResult?.status}`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('[VerificationService] On-chain verification failed', {
                mentorId,
                error: errorMessage,
            });
            throw new Error(`On-chain verification failed: ${errorMessage}`);
        }
    },
};
