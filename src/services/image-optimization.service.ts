import sharp from 'sharp';

export interface OptimizationOptions {
  width?: number;
  height?: number;
  format?: 'webp' | 'jpeg' | 'png';
  quality?: number;
}

export const ImageOptimizationService = {
  /**
   * Resizes and compresses an image buffer, outputting in the specified format.
   * WebP is highly recommended for avatar/profile images.
   *
   * @param buffer - The raw image buffer (e.g. from multer)
   * @param options - Optimization settings
   * @returns A promise that resolves to the processed image buffer
   */
  async optimizeImage(buffer: Buffer, options: OptimizationOptions): Promise<Buffer> {
    let instance = sharp(buffer);

    // Apply resizing if requested
    if (options.width || options.height) {
      instance = instance.resize(options.width, options.height, {
        fit: 'cover',
        position: 'center',
      });
    }

    const format = options.format || 'webp';
    const quality = options.quality || 80;

    // Apply format-specific optimizations
    if (format === 'webp') {
      instance = instance.webp({ quality, effort: 4 });
    } else if (format === 'jpeg') {
      instance = instance.jpeg({ quality, progressive: true });
    } else if (format === 'png') {
      instance = instance.png({ quality, compressionLevel: 8 });
    }

    return instance.toBuffer();
  },
};
