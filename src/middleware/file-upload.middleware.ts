import { randomUUID } from "crypto";
import { unlink } from "fs/promises";
import os from "os";
import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { Logger } from "../utils/logger";

const logger = new Logger("file-upload.middleware");

export function createFileUpload(options: multer.Options = {}) {
  return multer({
    ...options,
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (_req, _file, callback) => {
        callback(null, `mentorminds-${randomUUID()}.upload`);
      },
    }),
  });
}

export function cleanupUploadedFile(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const filePath = req.file?.path;
  if (filePath) {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
          logger.warn("Failed to remove temporary upload", {
            filePath,
            error: error.message,
          });
        }
      });
    };

    res.once("finish", cleanup);
    res.once("close", cleanup);
  }

  next();
}
