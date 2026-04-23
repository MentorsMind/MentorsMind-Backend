import { EscrowModel, EscrowStatus } from "../../models/escrow.model";
import { testPool } from "../../tests/setup";
import { createUser } from "../../tests/factories/user.factory";

async function createEscrow(learnerId: string, mentorId: string) {
  return EscrowModel.create({
    learnerId,
    mentorId,
    amount: "100.0000000",
    currency: "XLM",
  });
}

beforeAll(async () => {
  // Create escrows table (not in standard migrations)
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS escrows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      learner_id UUID NOT NULL REFERENCES users(id),
      mentor_id UUID NOT NULL REFERENCES users(id),
      amount DECIMAL(20, 7) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      stellar_tx_hash VARCHAR(64),
      dispute_id UUID,
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      released_at TIMESTAMP WITH TIME ZONE,
      refunded_at TIMESTAMP WITH TIME ZONE,
      CONSTRAINT check_amount_positive CHECK (amount > 0),
      CONSTRAINT check_different_users CHECK (learner_id != mentor_id)
    )
  `);
});

afterEach(async () => {
  await testPool.query("TRUNCATE TABLE escrows CASCADE");
});

describe("EscrowModel.updateStatus", () => {
  it("updates status only (no additionalFields)", async () => {
    const learner = await createUser();
    const mentor = await createUser({ role: "mentor" });
    const escrow = await createEscrow(learner.id, mentor.id);

    const result = await EscrowModel.updateStatus(escrow.id, "funded");

    expect(result).not.toBeNull();
    expect(result!.status).toBe("funded");
    expect(result!.stellar_tx_hash).toBeNull();
    expect(result!.released_at).toBeNull();
    expect(result!.refunded_at).toBeNull();
  });

  it("updates status with stellar_tx_hash", async () => {
    const learner = await createUser();
    const mentor = await createUser({ role: "mentor" });
    const escrow = await createEscrow(learner.id, mentor.id);
    const txHash =
      "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

    const result = await EscrowModel.updateStatus(escrow.id, "funded", {
      stellar_tx_hash: txHash,
    });

    expect(result!.status).toBe("funded");
    expect(result!.stellar_tx_hash).toBe(txHash);
  });

  it("updates status with released_at", async () => {
    const learner = await createUser();
    const mentor = await createUser({ role: "mentor" });
    const escrow = await createEscrow(learner.id, mentor.id);
    const releasedAt = new Date();

    const result = await EscrowModel.updateStatus(escrow.id, "released", {
      released_at: releasedAt,
    });

    expect(result!.status).toBe("released");
    expect(result!.released_at).not.toBeNull();
  });

  it("updates status with refunded_at", async () => {
    const learner = await createUser();
    const mentor = await createUser({ role: "mentor" });
    const escrow = await createEscrow(learner.id, mentor.id);
    const refundedAt = new Date();

    const result = await EscrowModel.updateStatus(escrow.id, "refunded", {
      refunded_at: refundedAt,
    });

    expect(result!.status).toBe("refunded");
    expect(result!.refunded_at).not.toBeNull();
  });

  it("updates status with all additionalFields at once", async () => {
    const learner = await createUser();
    const mentor = await createUser({ role: "mentor" });
    const escrow = await createEscrow(learner.id, mentor.id);
    const txHash =
      "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
    const now = new Date();

    const result = await EscrowModel.updateStatus(escrow.id, "released", {
      stellar_tx_hash: txHash,
      released_at: now,
    });

    expect(result!.status).toBe("released");
    expect(result!.stellar_tx_hash).toBe(txHash);
    expect(result!.released_at).not.toBeNull();
  });

  it("returns null for non-existent escrow id", async () => {
    const result = await EscrowModel.updateStatus(
      "00000000-0000-0000-0000-000000000000",
      "cancelled",
    );

    expect(result).toBeNull();
  });
});
