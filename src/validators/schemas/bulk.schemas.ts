import { z } from "zod";

export const bulkPaymentsSchema = z.object({
  body: z.object({
    payments: z
      .array(
        z.object({
          userId: z.string().uuid(),
          bookingId: z.string().uuid(),
          amount: z.string().regex(/^\d+(\.\d+)?$/),
          currency: z.string().min(1).max(12).optional(),
          description: z.string().max(500).optional(),
        }),
      )
      .min(1)
      .max(500),
  }),
});
