export interface ResolutionTemplate {
  id: string;
  type: string;
  title: string;
  content: string;
  suggested_action: "full_refund" | "partial_refund" | "release";
}

export const RESOLUTION_TEMPLATES: ResolutionTemplate[] = [
  {
    id: "payment_refund_full",
    type: "payment",
    title: "Full Refund Granted",
    content:
      "After reviewing the dispute, we have decided to issue a full refund as the service provided did not meet the agreed-upon standards.",
    suggested_action: "full_refund",
  },
  {
    id: "quality_partial_refund",
    type: "quality",
    title: "Partial Refund for Quality Issue",
    content:
      "We recognize that the session quality was subpar. A partial refund has been issued to compensate for the inconvenience.",
    suggested_action: "partial_refund",
  },
  {
    id: "conduct_release",
    type: "conduct",
    title: "Funds Released to Mentor",
    content:
      "Based on our investigation and the evidence provided, no policy violation occurred. The funds have been released to the mentor.",
    suggested_action: "release",
  },
  {
    id: "cancellation_refund",
    type: "cancellation",
    title: "Refund for Late Cancellation",
    content:
      "The session was cancelled outside of the allowed window. A full refund has been processed in accordance with our cancellation policy.",
    suggested_action: "full_refund",
  },
];
