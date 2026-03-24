import { Request, Response } from 'express';
import { getAllTimezones, getTimezoneOffset, isValidIANATimezone, getLocalNow } from '../utils/timezone.utils';
import { successResponse } from '../utils/response.utils';

/**
 * GET /api/v1/timezones
 * List all valid IANA timezones with offsets
 */
export const listTimezones = async (req: Request, res: Response): Promise<void> => {
  const timezones = getAllTimezones();
  
  const timezonesWithOffsets = timezones.map((tz) => ({
    identifier: tz,
    offset: getTimezoneOffset(tz),
    currentTime: getLocalNow(tz).toISO(),
  }));

  res.json(
    successResponse(timezonesWithOffsets, 'Timezones retrieved successfully')
  );
};

/**
 * GET /api/v1/timezones/:identifier
 * Get details for specific timezone
 */
export const getTimezoneDetails = async (req: Request, res: Response): Promise<void> => {
  const { identifier } = req.params;
  
  // Decode URL-encoded timezone (e.g., America%2FNew_York)
  const timezone = decodeURIComponent(identifier);

  if (!isValidIANATimezone(timezone)) {
    res.status(400).json({
      success: false,
      message: `Invalid IANA timezone identifier: ${timezone}`,
    });
    return;
  }

  const now = getLocalNow(timezone);
  
  res.json(
    successResponse(
      {
        identifier: timezone,
        offset: getTimezoneOffset(timezone),
        currentTime: now.toISO(),
        currentTimeFormatted: now.toFormat('EEEE, MMMM d, yyyy \'at\' h:mm:ss a zzz'),
        isDST: now.isInDST,
      },
      'Timezone details retrieved successfully'
    )
  );
};
