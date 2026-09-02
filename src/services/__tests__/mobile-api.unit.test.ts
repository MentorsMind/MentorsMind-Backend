import { OfflineSyncService } from "../offline-sync.service";
import { MobileOptimizationService } from "../mobile-optimization.service";

describe("Mobile API support services", () => {
  it("creates a sync payload that includes device metadata and delta metadata", () => {
    const payload = OfflineSyncService.createSyncPayload(
      "user-123",
      "device-42",
      {
        lastSyncedAt: "2026-08-01T00:00:00.000Z",
        pendingChanges: [
          {
            id: "change-1",
            entity: "booking",
            action: "update",
            payload: { status: "confirmed" },
          },
        ],
      },
    );

    expect(payload.userId).toBe("user-123");
    expect(payload.deviceId).toBe("device-42");
    expect(payload.delta.lastSyncedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(payload.delta.pendingChanges).toHaveLength(1);
    expect(payload.delta.pendingChanges[0].entity).toBe("booking");
  });

  it("compresses payloads above the threshold and preserves metadata", () => {
    const payload = {
      message: "x".repeat(5000),
      summary: { healthy: true },
    };

    const optimized = MobileOptimizationService.optimizePayload(payload, {
      compress: true,
      mobileOnly: true,
      compressionThreshold: 200,
    });

    expect(optimized.compressed).toBe(true);
    expect(optimized.data).toBeDefined();
    expect(optimized.metadata.mobileOptimized).toBe(true);
  });

  it("resolves a stale client change against the latest server version", () => {
    const result = OfflineSyncService.resolveConflict(
      {
        id: "entity-1",
        version: 1,
        title: "Client title",
      },
      {
        id: "entity-1",
        version: 4,
        title: "Server title",
      },
    );

    expect(result.status).toBe("server-wins");
    expect(result.serverVersion).toBe(4);
    expect(result.clientVersion).toBe(1);
  });
});
