import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ResponseUtil } from "../utils/response.utils";
import { ComplianceService, DSARType, DataRetentionPolicy } from "../services/compliance.service";

export const ComplianceController = {
  async createDSAR(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(res, "Authenticated user required");
      return;
    }

    const { type, metadata } = req.body;
    if (!type || typeof type !== "string") {
      ResponseUtil.error(res, "DSAR type is required", 400);
      return;
    }

    try {
      const ipAddress = ComplianceService.getRequestIp(req);
      const userAgent = req.headers["user-agent"] || "unknown";
      const request = await ComplianceService.createDSAR(
        userId,
        type as DSARType,
        ipAddress,
        userAgent,
        metadata || {},
      );
      ResponseUtil.created(res, request, "Data subject request created successfully");
    } catch (error) {
      ResponseUtil.error(res, (error as Error).message || "Failed to create DSAR", 400);
    }
  },

  async getDSARs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(res, "Authenticated user required");
      return;
    }

    try {
      const requests = await ComplianceService.getDSARs(userId);
      ResponseUtil.success(res, requests, "DSAR history retrieved successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to retrieve DSAR history", 500, (error as Error).message);
    }
  },

  async getDSARById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(res, "Authenticated user required");
      return;
    }

    try {
      const request = await ComplianceService.getDSARById(req.params.id);
      if (!request) {
        ResponseUtil.notFound(res, "DSAR not found");
        return;
      }

      const isAdmin = req.user?.role === "admin";
      if (!isAdmin && request.user_id !== userId) {
        ResponseUtil.forbidden(res, "Access denied");
        return;
      }
      ResponseUtil.success(res, request, "DSAR retrieved successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to retrieve DSAR", 500, (error as Error).message);
    }
  },

  async completeDSAR(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { data } = req.body;
    try {
      const request = await ComplianceService.completeDSAR(
        req.params.id,
        data || {},
        req.user?.id || null,
        ComplianceService.getRequestIp(req),
        req.headers["user-agent"] || null,
      );
      ResponseUtil.success(res, request, "DSAR completed successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to complete DSAR", 500, (error as Error).message);
    }
  },

  async createRetentionPolicy(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { dataType, retentionPeriod, deletionMethod, legalBasis } = req.body;

    if (!dataType || typeof retentionPeriod !== "number" || !deletionMethod || !legalBasis) {
      ResponseUtil.validationError(res, [
        { field: "dataType", message: "Data type is required" },
        { field: "retentionPeriod", message: "Retention period in days is required" },
        { field: "deletionMethod", message: "Deletion method is required" },
        { field: "legalBasis", message: "Legal basis is required" },
      ]);
      return;
    }

    try {
      const policy = await ComplianceService.addRetentionPolicy({
        dataType,
        retentionPeriod,
        deletionMethod,
        legalBasis,
      });
      ResponseUtil.created(res, policy, "Retention policy saved successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to save retention policy", 500, (error as Error).message);
    }
  },

  async getRetentionPolicies(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const policies = await ComplianceService.getRetentionPolicies();
      ResponseUtil.success(res, policies, "Retention policies retrieved successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to retrieve retention policies", 500, (error as Error).message);
    }
  },

  async enforceRetentionPolicies(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await ComplianceService.enforceRetentionPolicies();
      ResponseUtil.success(res, result, "Retention enforcement completed successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to enforce retention policies", 500, (error as Error).message);
    }
  },

  async recordLineageEvent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    const { dataType, sourceSystem, destinationSystem, description, metadata } = req.body;

    if (!userId) {
      ResponseUtil.unauthorized(res, "Authenticated user required");
      return;
    }
    if (!dataType || !sourceSystem || !destinationSystem || !description) {
      ResponseUtil.validationError(res, [
        { field: "dataType", message: "Data type is required" },
        { field: "sourceSystem", message: "Source system is required" },
        { field: "destinationSystem", message: "Destination system is required" },
        { field: "description", message: "Description is required" },
      ]);
      return;
    }

    try {
      const event = await ComplianceService.recordLineageEvent(
        userId,
        dataType,
        sourceSystem,
        destinationSystem,
        description,
        metadata || {},
      );
      ResponseUtil.created(res, event, "Data lineage event recorded successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to record lineage event", 500, (error as Error).message);
    }
  },

  async getLineageEvents(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;
      const response = await ComplianceService.getLineageEvents(undefined, page, limit);
      ResponseUtil.success(res, response, "Lineage events retrieved successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to retrieve lineage events", 500, (error as Error).message);
    }
  },

  async generateComplianceReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const filters = {
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        userId: req.query.userId as string | undefined,
      };
      const report = await ComplianceService.generateComplianceReport(filters);
      ResponseUtil.success(res, report, "Compliance report generated successfully");
    } catch (error) {
      ResponseUtil.error(res, "Failed to generate compliance report", 500, (error as Error).message);
    }
  },
};
