import crypto from "crypto";
import { pool } from "../config/database";
import { JwksService } from "./jwks.service";
import { server, networkPassphrase, getPlatformKeypair } from "../config/stellar";
import { signStellarTransaction } from "./hsmStellarSigner.service";
import { logger } from "../utils/logger";
import { TransactionBuilder, Memo } from "@stellar/stellar-sdk";

const PLATFORM_DID = process.env.PLATFORM_DID || "did:web:api.mentorminds.com";
const PLATFORM_HOST = process.env.PLATFORM_HOST || "api.mentorminds.com";

export type CredentialType =
  | "MentorCertification"
  | "SessionCompletion"
  | "KYCVerification";

export interface CredentialProof {
  type: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  jws: string;
}

export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: Record<string, unknown>;
  proof: CredentialProof;
}

export interface DIDDocument {
  "@context": string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyPem: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
}

export interface CredentialRecord {
  id: string;
  credentialId: string;
  issuerDid: string;
  subjectDid: string;
  credentialType: string;
  credentialData: VerifiableCredential;
  proofJws: string;
  kid: string;
  stellarTxHash: string | null;
  stellarLedger: number | null;
  revoked: boolean;
  revokedAt: Date | null;
  revokedReason: string | null;
  issuedAt: Date;
  expiresAt: Date | null;
}

export interface StatusList2021Credential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: {
    id: string;
    type: "StatusList2021";
    statusPurpose: "revocation";
    encodedList: string;
  };
  proof: CredentialProof;
}

function transformRow(row: any): CredentialRecord {
  return {
    id: row.id,
    credentialId: row.credential_id,
    issuerDid: row.issuer_did,
    subjectDid: row.subject_did,
    credentialType: row.credential_type,
    credentialData: row.credential_data,
    proofJws: row.proof_jws,
    kid: row.kid,
    stellarTxHash: row.stellar_tx_hash,
    stellarLedger: row.stellar_ledger,
    revoked: row.revoked,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
}

class DIDService {
  getPlatformDid(): string {
    return PLATFORM_DID;
  }

  async getDidDocument(): Promise<DIDDocument> {
    const currentKey = await JwksService.getCurrentKey();
    if (!currentKey) {
      throw new Error("No signing key available for DID document");
    }

    const publicKeyPem = crypto
      .createPublicKey(currentKey.publicKeyPem)
      .export({ type: "spki", format: "pem" }) as string;

    return {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/rsa-2018/v1",
      ],
      id: PLATFORM_DID,
      verificationMethod: [
        {
          id: `${PLATFORM_DID}#key-1`,
          type: "RsaVerificationKey2018",
          controller: PLATFORM_DID,
          publicKeyPem,
        },
      ],
      authentication: [`${PLATFORM_DID}#key-1`],
      assertionMethod: [`${PLATFORM_DID}#key-1`],
    };
  }

  async issueCredential(
    subjectDid: string,
    type: CredentialType,
    claims: Record<string, unknown>,
    expirationDate?: Date,
  ): Promise<VerifiableCredential> {
    const currentKey = await JwksService.getCurrentKey();
    if (!currentKey) {
      throw new Error("No signing key available");
    }

    const credentialId = `urn:uuid:${crypto.randomUUID()}`;
    const issuanceDate = new Date().toISOString();
    const expiration = expirationDate?.toISOString();

    const credential: VerifiableCredential = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://www.w3.org/2018/credentials/examples/v1",
      ],
      id: credentialId,
      type: ["VerifiableCredential", type],
      issuer: PLATFORM_DID,
      issuanceDate,
      ...(expiration && { expirationDate: expiration }),
      credentialSubject: {
        id: subjectDid,
        ...claims,
      },
      proof: {
        type: "RsaSignature2018",
        created: issuanceDate,
        verificationMethod: `${PLATFORM_DID}#key-1`,
        proofPurpose: "assertionMethod",
        jws: "",
      },
    };

    const signingInput = this.getSigningInput(credential);
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(signingInput)
      .sign(currentKey.privateKeyPem, "base64");

    const jws = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(signingInput).toString("base64url")}.${signature}`;
    credential.proof.jws = jws;

    const credentialHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(credential))
      .digest("hex");

    let stellarTxHash: string | null = null;
    let stellarLedger: number | null = null;

    try {
      const anchor = await this.anchorToStellar(credentialHash);
      stellarTxHash = anchor.txHash;
      stellarLedger = anchor.ledger;
    } catch (err) {
      logger.error("Stellar anchoring failed — credential issued without on-chain anchor", {
        credentialId,
        error: err instanceof Error ? err.message : err,
      });
    }

    await pool.query(
      `INSERT INTO verifiable_credentials
         (credential_id, issuer_did, subject_did, credential_type, credential_data, proof_jws, kid, stellar_tx_hash, stellar_ledger, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        credentialId,
        PLATFORM_DID,
        subjectDid,
        type,
        JSON.stringify(credential),
        jws,
        currentKey.kid,
        stellarTxHash,
        stellarLedger,
        new Date(),
        expirationDate ?? null,
      ],
    );

    logger.info("Credential issued", { credentialId, subjectDid, type, stellarTxHash });
    return credential;
  }

  async getCredentialStatus(
    credentialId: string,
  ): Promise<StatusList2021Credential | null> {
    const result = await pool.query(
      `SELECT * FROM verifiable_credentials WHERE credential_id = $1`,
      [credentialId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const record = transformRow(result.rows[0]);
    const statusListCredential: StatusList2021Credential = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/vc/status-list/2021/v1",
      ],
      id: `${PLATFORM_DID}#status-list-${record.credentialId}`,
      type: ["VerifiableCredential", "StatusList2021Credential"],
      issuer: PLATFORM_DID,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: `${PLATFORM_DID}#status-list-${record.credentialId}`,
        type: "StatusList2021",
        statusPurpose: "revocation",
        encodedList: this.encodeStatusList(record.revoked),
      },
      proof: {
        type: "RsaSignature2018",
        created: new Date().toISOString(),
        verificationMethod: `${PLATFORM_DID}#key-1`,
        proofPurpose: "assertionMethod",
        jws: "",
      },
    };

    const currentKey = await JwksService.getCurrentKey();
    if (!currentKey) {
      throw new Error("No signing key available for status list registry");
    }

    const signingInput = this.getSigningInput(statusListCredential);
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(signingInput)
      .sign(currentKey.privateKeyPem, "base64");
    statusListCredential.proof.jws = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(signingInput).toString("base64url")}.${signature}`;

    return statusListCredential;
  }

  async verifyCredential(
    credentialId: string,
  ): Promise<{
    valid: boolean;
    issuer: string;
    subject: string;
    issuedAt: Date;
    revokedAt: Date | null;
  }> {
    const result = await pool.query(
      `SELECT * FROM verifiable_credentials WHERE credential_id = $1`,
      [credentialId],
    );

    if (result.rows.length === 0) {
      return { valid: false, issuer: "", subject: "", issuedAt: new Date(), revokedAt: null };
    }

    const record = transformRow(result.rows[0]);

    if (record.revoked) {
      return {
        valid: false,
        issuer: record.issuerDid,
        subject: record.subjectDid,
        issuedAt: record.issuedAt,
        revokedAt: record.revokedAt,
      };
    }

    if (record.expiresAt && new Date() > record.expiresAt) {
      return {
        valid: false,
        issuer: record.issuerDid,
        subject: record.subjectDid,
        issuedAt: record.issuedAt,
        revokedAt: null,
      };
    }

    const sigValid = await this.verifySignature(record.credentialData);
    if (!sigValid) {
      return {
        valid: false,
        issuer: record.issuerDid,
        subject: record.subjectDid,
        issuedAt: record.issuedAt,
        revokedAt: null,
      };
    }

    return {
      valid: true,
      issuer: record.issuerDid,
      subject: record.subjectDid,
      issuedAt: record.issuedAt,
      revokedAt: null,
    };
  }

  async revokeCredential(
    credentialId: string,
    reason?: string,
  ): Promise<boolean> {
    const result = await pool.query(
      `UPDATE verifiable_credentials
       SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $2, updated_at = NOW()
       WHERE credential_id = $1 AND revoked = FALSE
       RETURNING id`,
      [credentialId, reason ?? null],
    );

    if (result.rowCount === 0) return false;

    logger.info("Credential revoked", { credentialId, reason });
    return true;
  }

  async revokeCredentials(
    credentialIds: string[],
    reason?: string,
  ): Promise<number> {
    if (!credentialIds.length) return 0;

    const result = await pool.query(
      `UPDATE verifiable_credentials
       SET revoked = TRUE,
           revoked_at = NOW(),
           revoked_reason = COALESCE($1, revoked_reason),
           updated_at = NOW()
       WHERE credential_id = ANY($2::text[]) AND revoked = FALSE
       RETURNING id`,
      [reason ?? null, credentialIds],
    );

    logger.info("Batch credentials revoked", {
      count: result.rowCount ?? 0,
      reason,
    });
    return result.rowCount ?? 0;
  }

  async getCredentialBySubject(
    subjectDid: string,
    type?: CredentialType,
  ): Promise<CredentialRecord[]> {
    let query = `SELECT * FROM verifiable_credentials WHERE subject_did = $1`;
    const params: any[] = [subjectDid];

    if (type) {
      query += ` AND credential_type = $2`;
      params.push(type);
    }

    query += ` ORDER BY issued_at DESC`;

    const result = await pool.query(query, params);
    return result.rows.map(transformRow);
  }

  private encodeStatusList(revoked: boolean): string {
    const byte = revoked ? 0x80 : 0x00;
    return Buffer.from([byte]).toString("base64url");
  }

  private getSigningInput(credential: VerifiableCredential | StatusList2021Credential): string {
    const { proof, ...unsigned } = credential as any;
    return JSON.stringify(unsigned);
  }

  private async verifySignature(credential: VerifiableCredential): Promise<boolean> {
    try {
      const currentKey = await JwksService.getCurrentKey();
      if (!currentKey) return false;

      const signingInput = this.getSigningInput(credential);
      const parts = credential.proof.jws.split(".");
      if (parts.length !== 3) return false;

      const signature = Buffer.from(parts[2], "base64");
      return crypto
        .createVerify("RSA-SHA256")
        .update(signingInput)
        .verify(currentKey.publicKeyPem, signature);
    } catch {
      return false;
    }
  }

  private async anchorToStellar(
    hash: string,
  ): Promise<{ txHash: string; ledger: number }> {
    const keypair = getPlatformKeypair();
    if (!keypair) {
      // HSM is enabled — defer signing to the HSM-backed signer (issue #982).
      logger.info("Platform Stellar keypair deferred to HSM-backed signer", {
        anchor: hash.substring(0, 8),
      });
      const publicKey = (await import("./hsmStellarSigner.service"))
        .getPlatformPublicKey();
      if (!publicKey) {
        throw new Error("Platform Stellar key not configured");
      }
      const account = await server.accounts().accountId(publicKey).call();
      const txBuilder = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase,
      });
      const memoHash = hash.substring(0, 28);
      txBuilder.addMemo(Memo.text(memoHash));
      txBuilder.setTimeout(60);
      const tx = txBuilder.build();
      const signed = await signStellarTransaction(tx, {
        operation: "stellar_anchor_did",
        userId: "system",
      });
      if (!signed) {
        throw new Error("HSM signing returned no signed transaction");
      }
      const result = await server.submitTransaction(signed);
      return { txHash: result.hash, ledger: result.ledger };
    }

    const account = await server.accounts().accountId(keypair.publicKey()).call();
    const txBuilder = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase,
    });

    const memoHash = hash.substring(0, 28);
    txBuilder.addMemo(Memo.text(memoHash));
    txBuilder.setTimeout(60);

    const tx = txBuilder.build();
    tx.sign(keypair);

    const result = await server.submitTransaction(tx);
    return { txHash: result.hash, ledger: result.ledger };
  }
}

export const didService = new DIDService();
