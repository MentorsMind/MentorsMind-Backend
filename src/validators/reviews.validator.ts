import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { uuidSchema } from "./schemas/common.schemas";

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

export const createReviewSchema = z.object({
  body: z.object({
    session_id: uuidSchema,
    rating: z
      .number({ error: "Rating must be a number" })
      .int("Rating must be an integer")
      .min(1, "Rating must be at least 1")
      .max(5, "Rating must be at most 5"),
    comment: z
      .string()
      .max(2000, "Comment must not exceed 2000 characters")
      .optional(),
  }),
});

export const updateReviewSchema = z
  .object({
    body: z.object({
      rating: z
        .number({ error: "Rating must be a number" })
        .int("Rating must be an integer")
        .min(1, "Rating must be at least 1")
        .max(5, "Rating must be at most 5")
        .optional(),
      comment: z
        .string()
        .max(2000, "Comment must not exceed 2000 characters")
        .optional(),
    }),
  })
  .refine(
    (data) => data.body.rating !== undefined || data.body.comment !== undefined,
    {
      message: "At least one of rating or comment must be provided",
      path: ["body"],
    },
  );

export const flagReviewSchema = z.object({
  body: z.object({
    reason: z.string().min(10, "Reason must be at least 10 characters"),
  }),
});

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

export const reviewIdParamSchema = z.object({
  params: z.object({
    id: uuidSchema,
  }),
});

export const mentorIdParamSchema = z.object({
  params: z.object({
    id: uuidSchema,
  }),
});

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

export const paginationQuerySchema = z.object({
  query: z.object({
    page: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 1))
      .refine(
        (v) => Number.isInteger(v) && v >= 1,
        "Page must be a positive integer",
      ),
    limit: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 10))
      .refine(
        (v) => Number.isInteger(v) && v >= 1,
        "Limit must be a positive integer",
      ),
  }),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateReviewInput = z.infer<typeof createReviewSchema>["body"];
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>["body"];
export type FlagReviewInput = z.infer<typeof flagReviewSchema>["body"];

// ---------------------------------------------------------------------------
// validate middleware factory — maps ZodError to HTTP 422 with field-level messages
// ---------------------------------------------------------------------------

export const validate = (schema: ZodSchema) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        }));
        res.status(422).json({
          status: "fail",
          message: "Validation failed",
          errors,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(error);
    }
  };
};
