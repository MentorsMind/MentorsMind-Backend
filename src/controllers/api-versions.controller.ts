/**
 * API Versions Controller
 *
 * GET /api/versions — Returns the full version registry without auth.
 * Enables API consumers to programmatically discover version lifecycle
 * (active, deprecated, sunset dates, migration guides).
 *
 * Response is cacheable (public, max-age=3600) since version metadata
 * changes infrequently.
 */

import { Request, Response } from 'express';
import { ResponseUtil } from '../utils/response.utils';
import {
  API_VERSIONS,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  VersionConfig,
} from '../config/api-versions.config';

export const ApiVersionsController = {
  /**
   * GET /api/versions
   *
   * Returns version registry with lifecycle info for each API version.
   * No authentication required — this is discovery metadata.
   *
   * @swagger
   * /api/versions:
   *   get:
   *     summary: Get API version information
   *     description: |
   *       Returns the full version registry, including active versions,
   *       deprecation timelines, sunset dates, and migration guides.
   *       Useful for programmatic discovery of API lifecycle.
   *     tags: [Meta]
   *     responses:
   *       200:
   *         description: Version registry
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: success
   *                 data:
   *                   type: object
   *                   properties:
   *                     current:
   *                       type: string
   *                       description: Currently recommended version
   *                       example: v1
   *                     supported:
   *                       type: array
   *                       items:
   *                         type: string
   *                       description: List of active versions
   *                       example: [v1, v2]
   *                     versions:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           version:
   *                             type: string
   *                           active:
   *                             type: boolean
   *                           current:
   *                             type: boolean
   *                           deprecatedAt:
   *                             type: string
   *                             format: date-time
   *                             nullable: true
   *                           sunsetAt:
   *                             type: string
   *                             format: date-time
   *                             nullable: true
   *                           deprecationMessage:
   *                             type: string
   *                             nullable: true
   *                           links:
   *                             type: object
   *                             properties:
   *                               docs:
   *                                 type: string
   *                                 nullable: true
   */
  async getVersions(req: Request, res: Response): Promise<void> {
    // Build response with version metadata
    const versions = Object.values(API_VERSIONS).map((versionConfig: VersionConfig) => {
      const response: Record<string, any> = {
        version: versionConfig.version,
        active: versionConfig.active,
        current: versionConfig.version === CURRENT_VERSION,
      };

      // Include optional fields if present
      if (versionConfig.deprecatedAt) {
        response.deprecatedAt = versionConfig.deprecatedAt;
      }
      if (versionConfig.sunsetAt) {
        response.sunsetAt = versionConfig.sunsetAt;
      }
      if (versionConfig.deprecationMessage) {
        response.deprecationMessage = versionConfig.deprecationMessage;
      }

      // Include docs link (only if version is active)
      response.links = {
        docs: versionConfig.active ? `/api/${versionConfig.version}/docs` : null,
      };

      return response;
    });

    // Set cache headers: public, 1 hour (versions rarely change)
    res.setHeader('Cache-Control', 'public, max-age=3600');

    ResponseUtil.success(res, {
      current: CURRENT_VERSION,
      supported: SUPPORTED_VERSIONS,
      versions,
    });
  },
};
