import { DisputeStateMachine } from "../dispute-state-machine.service";
import { DisputeStatus } from "../../models/dispute.model";

// DisputeStateMachine is a pure static class — no DB access, so no mocks needed.
const ALL_STATUSES: DisputeStatus[] = [
  "open",
  "investigating",
  "mediation",
  "escalated",
  "resolved",
  "dismissed",
];

// Expected transition matrix (mirrors DisputeStateMachine.validTransitions)
const VALID: Record<DisputeStatus, DisputeStatus[]> = {
  open: ["investigating", "resolved", "dismissed"],
  investigating: ["mediation", "escalated", "resolved", "dismissed"],
  mediation: ["escalated", "resolved", "dismissed"],
  escalated: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

const validPairs = ALL_STATUSES.flatMap((from) =>
  VALID[from].map((to) => [from, to] as const),
);

const invalidPairs = ALL_STATUSES.flatMap((from) =>
  ALL_STATUSES.filter((to) => to !== from && !VALID[from].includes(to)).map(
    (to) => [from, to] as const,
  ),
);

describe("DisputeStateMachine", () => {
  describe("valid transitions", () => {
    it.each(validPairs)("%s → %s is allowed", (from, to) => {
      expect(DisputeStateMachine.canTransition(from, to)).toBe(true);
      expect(() => DisputeStateMachine.assertTransition(from, to)).not.toThrow();
    });
  });

  describe("invalid transitions", () => {
    it.each(invalidPairs)("%s → %s is rejected", (from, to) => {
      expect(DisputeStateMachine.canTransition(from, to)).toBe(false);
      expect(() => DisputeStateMachine.assertTransition(from, to)).toThrow(
        `Invalid state transition from '${from}' to '${to}'`,
      );
    });

    it("covers every non-self pair exactly once", () => {
      expect(validPairs.length + invalidPairs.length).toBe(
        ALL_STATUSES.length * (ALL_STATUSES.length - 1),
      );
    });
  });

  describe("terminal states", () => {
    it.each(["resolved", "dismissed"] as DisputeStatus[])(
      "%s cannot move to any other state",
      (terminal) => {
        ALL_STATUSES.filter((s) => s !== terminal).forEach((to) => {
          expect(() =>
            DisputeStateMachine.assertTransition(terminal, to),
          ).toThrow();
        });
      },
    );

    it("cannot reopen a resolved dispute", () => {
      expect(() =>
        DisputeStateMachine.assertTransition("resolved", "open"),
      ).toThrow("Invalid state transition from 'resolved' to 'open'");
    });
  });

  describe("same-state transitions", () => {
    it.each(ALL_STATUSES)("%s → %s is treated as a no-op", (status) => {
      expect(DisputeStateMachine.canTransition(status, status)).toBe(true);
      expect(() =>
        DisputeStateMachine.assertTransition(status, status),
      ).not.toThrow();
    });
  });

  describe("business rules", () => {
    it("mediation is only reachable after investigation", () => {
      const sources = ALL_STATUSES.filter((from) =>
        DisputeStateMachine.canTransition(from, "mediation") && from !== "mediation",
      );
      expect(sources).toEqual(["investigating"]);
    });

    it("an open dispute cannot skip straight to mediation or escalation", () => {
      expect(DisputeStateMachine.canTransition("open", "mediation")).toBe(false);
      expect(DisputeStateMachine.canTransition("open", "escalated")).toBe(false);
    });

    it("no state can transition back to open", () => {
      ALL_STATUSES.filter((s) => s !== "open").forEach((from) => {
        expect(DisputeStateMachine.canTransition(from, "open")).toBe(false);
      });
    });
  });
});
