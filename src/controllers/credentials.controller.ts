import { Request, Response } from "express";
import { didService, CredentialType } from "../services/did.service";
import { ResponseUtil } from "../utils/response.utils";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { AuditLogService, extractIpAddress } from "../services/auditLog.service";

export const CredentialsController = {
  async getDidDocument(_req: Request, res: Response): Promise<void> {
    try {
      const doc = await didService.getDidDocument();
      res.setHeader("Content-Type", "application/ld+json");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).json(doc);
    } catch (err) {
      ResponseUtil.error(res, "Failed to generate DID document", 500);
    }
  },

  async issueCredential(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { subjectDid, type, claims, expirationDate } = req.body;

    if (!subjectDid || !type || !claims) {
      ResponseUtil.error(res, "subjectDid, type, and claims are required", 400);
      return;
    }

    const validTypes: CredentialType[] = [
      "MentorCertification",
      "SessionCompletion",
      "KYCVerification",
    ];
    if (!validTypes.includes(type)) {
      ResponseUtil.error(
        res,
        `Invalid credential type. Must be one of: ${validTypes.join(", ")}`,
        400,
      );
      return;
    }

    try {
      const credential = await didService.issueCredential(
        subjectDid,
        type,
        claims,
        expirationDate ? new Date(expirationDate) : undefined,
      );

      await AuditLogService.log({
        userId: req.user?.userId ?? null,
        action: "CREDENTIAL_ISSUED",
        resourceType: "credential",
        ipAddress: extractIpAddress(req),
        userAgent: req.headers["user-agent"] || null,
        metadata: { credentialId: credential.id, type, subjectDid },
      });

      ResponseUtil.created(res, credential, "Credential issued successfully");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to issue credential";
      ResponseUtil.error(res, msg, 500);
    }
  },

  async verifyCredential(req: Request, res: Response): Promise<void> {
    const credentialId = req.params.credentialId as string;
    if (!credentialId) {
      ResponseUtil.error(res, "credentialId is required", 400);
      return;
    }

    try {
      const result = await didService.verifyCredential(credentialId);
      ResponseUtil.success(res, result, "Verification complete");
    } catch (err) {
      ResponseUtil.error(res, "Verification failed", 500);
    }
  },

  async getCredentialStatus(req: Request, res: Response): Promise<void> {
    const credentialId = req.params.credentialId as string;
    if (!credentialId) {
      ResponseUtil.error(res, "credentialId is required", 400);
      return;
    }

    try {
      const status = await didService.getCredentialStatus(credentialId);
      if (!status) {
        ResponseUtil.notFound(res, "Credential not found");
        return;
      }

      res.setHeader("Content-Type", "application/ld+json");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).json(status);
    } catch (err) {
      ResponseUtil.error(res, "Failed to generate credential status list", 500);
    }
  },

  async revokeCredential(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const credentialId = req.params.credentialId as string;
    const { reason } = req.body;

    if (!credentialId) {
      ResponseUtil.error(res, "credentialId is required", 400);
      return;
    }

    try {
      const revoked = await didService.revokeCredential(credentialId, reason);
      if (!revoked) {
        ResponseUtil.notFound(res, "Credential not found or already revoked");
        return;
      }

      await AuditLogService.log({
        userId: req.user?.userId ?? null,
        action: "CREDENTIAL_REVOKED",
        resourceType: "credential",
        ipAddress: extractIpAddress(req),
        userAgent: req.headers["user-agent"] || null,
        metadata: { credentialId, reason },
      });

      ResponseUtil.success(res, { credentialId, revoked: true }, "Credential revoked");
    } catch (err) {
      ResponseUtil.error(res, "Failed to revoke credential", 500);
    }
  },

  async revokeCredentials(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { credentialIds, reason } = req.body ?? {};
    if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
      ResponseUtil.error(res, "credentialIds must be a non-empty array", 400);
      return;
    }

    try {
      const count = await didService.revokeCredentials(credentialIds, reason);
      await AuditLogService.log({
        userId: req.user?.userId ?? null,
        action: "CREDENTIALS_BATCH_REVOKED",
        resourceType: "credential",
        ipAddress: extractIpAddress(req),
        userAgent: req.headers["user-agent"] || null,
        metadata: { credentialIds, reason, count },
      });

      ResponseUtil.success(
        res,
        { revokedCount: count, credentialIds },
        "Credentials revoked successfully",
      );
    } catch (err) {
      ResponseUtil.error(res, "Failed to revoke credentials", 500);
    }
  },

  async getCredentialsBySubject(req: Request, res: Response): Promise<void> {
    const subjectDid = req.params.subjectDid as string;
    const { type } = req.query;

    if (!subjectDid) {
      ResponseUtil.error(res, "subjectDid is required", 400);
      return;
    }

    try {
      const credentials = await didService.getCredentialBySubject(
        subjectDid,
        type as CredentialType | undefined,
      );
      ResponseUtil.success(res, credentials);
    } catch (err) {
      ResponseUtil.error(res, "Failed to fetch credentials", 500);
    }
  },
};
