import sharp = require("sharp");
import { logger } from "./logger.utils";
import { env } from "../config/env";

export type ImageFormat = "jpeg" | "png" | "webp" | "avif";
export type ImageResizeOptions = {
  width?: number;
  height?: number;
  fit?: keyof typeof sharp.fit;
  withoutEnlargement?: boolean;
};

export interface ProcessedImage {
  buffer: Buffer;
  format: ImageFormat;
  width: number;
  height: number;
  size: number;
}

/**
 * Resize and convert an image to the specified format.
 * @param buffer - Original image buffer
 * @param options - Resize options
 * @param format - Target format (defaults to webp if browser supports it, otherwise original)
 * @param quality - Quality for lossy formats (0-100)
 * @returns Processed image buffer and metadata
 */
export async function processImage(
  buffer: Buffer,
  options: ImageResizeOptions = {},
  format?: ImageFormat,
  quality = 80,
): Promise<ProcessedImage> {
  try {
    let image = sharp(buffer);

    // Get original metadata
    const metadata = await image.metadata();
    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;

    // Apply resize options
    if (options.width || options.height) {
      image = image.resize({
        width: options.width,
        height: options.height,
        fit: options.fit ?? "inside",
        withoutEnlargement: options.withoutEnlargement ?? true,
      });
    }

    // Determine output format
    const targetFormat = format ?? "webp";

    // Format-specific options
    let formatOptions: any = { quality };

    switch (targetFormat) {
      case "jpeg":
        formatOptions = { ...formatOptions, mozjpeg: true };
        break;
      case "png":
        formatOptions = { ...formatOptions, compressionLevel: 9 };
        break;
      case "webp":
        formatOptions = { ...formatOptions, effort: 6 };
        break;
      case "avif":
        formatOptions = { ...formatOptions, effort: 6 };
        break;
    }

    // Convert to target format
    image = image.toFormat(targetFormat, formatOptions);

    // Get final metadata and buffer
    const [outputBuffer, outputMetadata] = await Promise.all([
      image.toBuffer(),
      image.metadata(),
    ]);

    return {
      buffer: outputBuffer,
      format: targetFormat as ImageFormat,
      width: outputMetadata.width ?? 0,
      height: outputMetadata.height ?? 0,
      size: outputBuffer.length,
    };
  } catch (error) {
    logger.error("Image processing failed", { error });
    throw error;
  }
}

/**
 * Create multiple resized versions of an image for responsive/srcset usage.
 * @param buffer - Original image buffer
 * @param widths - Array of widths to generate
 * @param format - Target format
 * @param quality - Quality for lossy formats
 * @returns Array of processed images with their widths
 */
export async function createResponsiveImages(
  buffer: Buffer,
  widths: number[],
  format: ImageFormat = "webp",
  quality = 80,
): Promise<Array<{ width: number; buffer: Buffer; format: ImageFormat }>> {
  const results = await Promise.all(
    widths.map(async (width) => {
      const processed = await processImage(buffer, { width }, format, quality);
      return {
        width: processed.width,
        buffer: processed.buffer,
        format: processed.format,
      };
    }),
  );
  return results;
}

/**
 * Generate a low-quality image placeholder (LQIP) for progressive loading.
 * @param buffer - Original image buffer
 * @param width - Width of the placeholder (default 20px)
 * @param quality - Quality for the placeholder (default 10)
 * @returns Base64 encoded placeholder image
 */
export async function createLQIP(
  buffer: Buffer,
  width = 20,
  quality = 10,
): Promise<string> {
  try {
    const lqipBuffer = await sharp(buffer)
      .resize({ width, withoutEnlargement: true })
      .toFormat("jpeg", { quality })
      .toBuffer();

    return `data:image/jpeg;base64,${lqipBuffer.toString("base64")}`;
  } catch (error) {
    logger.error("LQIP generation failed", { error });
    throw error;
  }
}
