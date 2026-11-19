import multer from 'multer';

/**
 * Creates a Multer middleware instance tailored for image uploads.
 * 
 * @param maxSize - The maximum allowed file size in bytes
 * @param allowedMimeTypes - An array of accepted MIME types
 */
export function createImageUploadMiddleware(maxSize: number, allowedMimeTypes: string[]) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSize },
    fileFilter: (_req, file, cb) => {
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        // Pass error so multer rejects the upload early
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      }
    },
  });
}
