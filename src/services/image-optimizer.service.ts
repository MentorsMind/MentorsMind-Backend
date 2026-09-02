/**
 * Image optimization and delivery (issue #863).
 *
 * Wraps the sharp helpers in `utils/image.utils` with the delivery concerns:
 * format negotiation against the caller's Accept header, a responsive variant
 * set with a matching srcset, a blurred placeholder, and a content-addressed
 * key so a variant is cached forever at the edge and never invalidated.
 *
 * Sharp is required lazily: it is a native module, and a unit test for the
 * naming and negotiation logic should not have to load it.
 */

import crypto from "crypto";
import { Logger } from "../utils/logger";
import {
  cdnConfig,
  negotiateImageFormat,
  type CDNConfiguration,
  type ImageDeliveryFormat,
  type ImageNegotiationConfig,
} from "../config/cdn.config";
import type { ProcessedImage } from "../utils/image.utils";

const logger = new Logger("ImageOptimizer");

export interface OptimizedVariant {
  width: number;
  format: ImageDeliveryFormat;
  /** Content-addressed path, safe to cache immutably. */
  key: string;
  bytes: number;
}

export interface OptimizationResult {
  variants: OptimizedVariant[];
  /** `srcset` value covering every variant. */
  srcset: string;
  format: ImageDeliveryFormat;
  /** Inline data URI placeholder, when enabled. */
  placeholder?: string;
  /** Bytes saved against the source, summed over the smallest variant. */
  savedBytes: number;
}

export class ImageTooLargeError extends Error {
  constructor(bytes: number, limit: number) {
    super(`image is ${bytes} bytes, limit is ${limit}`);
    this.name = "ImageTooLargeError";
  }
}

/** Formats sharp can encode. `negotiateImageFormat` may return any of these. */
const ENCODABLE: ReadonlySet<ImageDeliveryFormat> = new Set([
  "avif",
  "webp",
  "jpeg",
  "png",
]);

/**
 * Content-addressed variant key.
 *
 * The hash covers the source bytes plus the variant parameters, so two requests
 * for the same rendition share a key and a changed source never collides with
 * the old one. That is what makes an immutable, never-purged edge cache safe.
 */
export function variantKey(
  sourceDigest: string,
  width: number,
  format: ImageDeliveryFormat,
  quality: number,
): string {
  const suffix = crypto
    .createHash("sha256")
    .update(`${sourceDigest}:${width}:${format}:${quality}`)
    .digest("hex")
    .slice(0, 16);
  return `img/${sourceDigest.slice(0, 8)}/${width}w-${suffix}.${format}`;
}

export function digestOf(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Widths to generate for a source image.
 *
 * Breakpoints wider than the source are dropped — upscaling produces a larger
 * file that looks worse. The source width is always included so there is a
 * variant at full fidelity.
 */
export function widthsFor(
  sourceWidth: number,
  breakpoints: number[],
): number[] {
  const usable = breakpoints.filter((width) => width < sourceWidth);
  return [...new Set([...usable, sourceWidth])].sort((a, b) => a - b);
}

export function buildSrcset(
  variants: OptimizedVariant[],
  baseUrl: string,
): string {
  return variants
    .map((variant) => `${joinUrl(baseUrl, variant.key)} ${variant.width}w`)
    .join(", ");
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export interface ImageProcessor {
  process(
    buffer: Buffer,
    options: { width?: number },
    format: ImageDeliveryFormat,
    quality: number,
  ): Promise<ProcessedImage>;
  lqip(buffer: Buffer): Promise<string>;
  metadata(buffer: Buffer): Promise<{ width: number; height: number }>;
}

/** Default processor, backed by sharp via the existing image utilities. */
const sharpProcessor: ImageProcessor = {
  async process(buffer, options, format, quality) {
    const { processImage } = require("../utils/image.utils");
    return processImage(buffer, options, format, quality);
  },
  async lqip(buffer) {
    const { createLQIP } = require("../utils/image.utils");
    return createLQIP(buffer);
  },
  async metadata(buffer) {
    const sharp = require("sharp");
    const meta = await sharp(buffer).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  },
};

export class ImageOptimizerService {
  constructor(
    private readonly config: CDNConfiguration = cdnConfig,
    private readonly processor: ImageProcessor = sharpProcessor,
  ) {}

  /** Best format for a caller's `Accept` header. */
  formatFor(acceptHeader: string | undefined): ImageDeliveryFormat {
    const format = negotiateImageFormat(acceptHeader, this.config.images);
    return ENCODABLE.has(format) ? format : "jpeg";
  }

  /**
   * Produce every responsive variant of an image, plus a srcset and placeholder.
   *
   * @param source     Original image bytes.
   * @param baseUrl    Public CDN base the srcset URLs are built from.
   * @param accept     Caller's `Accept` header, used to pick the format.
   */
  async optimize(
    source: Buffer,
    baseUrl: string,
    accept?: string,
    overrides: Partial<ImageNegotiationConfig> = {},
  ): Promise<OptimizationResult> {
    const settings = { ...this.config.images, ...overrides };

    if (source.byteLength > settings.maxSourceBytes) {
      throw new ImageTooLargeError(source.byteLength, settings.maxSourceBytes);
    }

    const format = this.formatFor(accept);
    const digest = digestOf(source);
    const { width: sourceWidth } = await this.processor.metadata(source);
    const widths = widthsFor(sourceWidth, settings.breakpoints);

    const variants: OptimizedVariant[] = [];
    for (const width of widths) {
      try {
        const processed = await this.processor.process(
          source,
          { width },
          format,
          settings.quality,
        );
        variants.push({
          width,
          format,
          key: variantKey(digest, width, format, settings.quality),
          bytes: processed.size,
        });
      } catch (err) {
        // One failed rendition should not cost the caller the whole set.
        logger.warn(
          `Variant ${width}w/${format} failed: ${(err as Error).message}`,
        );
      }
    }

    let placeholder: string | undefined;
    if (settings.generatePlaceholder) {
      try {
        placeholder = await this.processor.lqip(source);
      } catch (err) {
        logger.warn(`Placeholder generation failed: ${(err as Error).message}`);
      }
    }

    const smallest = variants.length
      ? Math.min(...variants.map((variant) => variant.bytes))
      : source.byteLength;

    return {
      variants,
      srcset: buildSrcset(variants, baseUrl),
      format,
      placeholder,
      savedBytes: Math.max(0, source.byteLength - smallest),
    };
  }
}

export const imageOptimizer = new ImageOptimizerService();
