import { Request, Response } from 'express';
import { EventStoreService } from '../services/event-store.service';
import { logger } from '../utils/logger';

export const getEventHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { aggregateId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const result = await EventStoreService.getEventHistory(
      aggregateId,
      parseInt(limit as string),
      parseInt(offset as string)
    );

    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Failed to get event history');
    res.status(500).json({ error: 'Failed to retrieve event history' });
  }
};

export const getAggregateState = async (req: Request, res: Response): Promise<void> => {
  try {
    const { aggregateId, aggregateType } = req.params;
    const { toVersion } = req.query;

    res.status(404).json({ 
      error: 'Aggregate state requires a custom application function',
      message: 'Please use the appropriate service for this aggregate type'
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get aggregate state');
    res.status(500).json({ error: 'Failed to retrieve aggregate state' });
  }
};

export const getEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { aggregateId } = req.params;
    const { fromVersion = 1 } = req.query;

    const events = await EventStoreService.getEvents(
      aggregateId,
      parseInt(fromVersion as string)
    );

    res.json(events);
  } catch (error) {
    logger.error({ error }, 'Failed to get events');
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
};
