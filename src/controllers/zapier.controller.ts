import { Request, Response } from "express";
import { ResponseUtil } from "../utils/response.utils";
import { ZapierService, ZapierContext } from "../services/zapier.service";

interface ZapierRequest extends Request {
  zapier?: ZapierContext;
}

export const ZapierController = {
  async listTriggers(_req: ZapierRequest, res: Response): Promise<void> {
    ResponseUtil.success(
      res,
      {
        triggers: ZapierService.listTriggers(),
        actions: ZapierService.listActions(),
      },
      "Zapier capabilities retrieved successfully",
    );
  },

  async subscribe(req: ZapierRequest, res: Response): Promise<void> {
    const trigger = req.body.trigger;
    const targetUrl = req.body.targetUrl;
    const secret = req.body.secret;

    const subscription = await ZapierService.subscribe(
      req.zapier!,
      trigger,
      targetUrl,
      secret,
      req.body.metadata ?? {},
    );

    ResponseUtil.created(res, subscription, "Zapier webhook subscribed");
  },

  async unsubscribe(req: ZapierRequest, res: Response): Promise<void> {
    const removed = await ZapierService.unsubscribe(req.zapier!, {
      subscriptionId: req.body.subscriptionId,
      targetUrl: req.body.targetUrl,
    });

    if (!removed) {
      ResponseUtil.notFound(res, "Zapier subscription not found");
      return;
    }

    ResponseUtil.success(res, { removed: true }, "Zapier webhook unsubscribed");
  },

  async sample(req: ZapierRequest, res: Response): Promise<void> {
    const trigger = req.params.trigger as any;
    ResponseUtil.success(
      res,
      ZapierService.getSamplePayload(trigger),
      "Sample payload retrieved successfully",
    );
  },

  async sampleAction(req: ZapierRequest, res: Response): Promise<void> {
    const action = req.params.action as any;
    ResponseUtil.success(
      res,
      ZapierService.getSampleActionPayload(action),
      "Sample action payload retrieved successfully",
    );
  },

  async executeAction(req: ZapierRequest, res: Response): Promise<void> {
    const action = req.params.action as any;
    const result = await ZapierService.executeAction(action, req.body ?? {});
    ResponseUtil.success(res, result, "Zapier action executed successfully");
  },
};
