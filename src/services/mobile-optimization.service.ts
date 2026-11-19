export interface MobileOptimizationOptions {
  compress?: boolean;
  mobileOnly?: boolean;
  compressionThreshold?: number;
}

export interface OptimizedPayloadResult<T> {
  compressed: boolean;
  data: T | string;
  metadata: {
    mobileOptimized: boolean;
    originalSizeBytes: number;
    finalSizeBytes: number;
    encoding?: string;
    generatedAt: string;
  };
}

export class MobileOptimizationService {
  static optimizePayload<T>(
    payload: T,
    options: MobileOptimizationOptions = {},
  ): OptimizedPayloadResult<T> {
    const compress = !!options.compress;
    const mobileOnly = !!options.mobileOnly;
    const threshold = options.compressionThreshold ?? 1024;
    const original =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    const originalSizeBytes = Buffer.byteLength(original ?? "", "utf8");

    if (!compress || originalSizeBytes < threshold) {
      return {
        compressed: false,
        data: payload,
        metadata: {
          mobileOptimized: mobileOnly,
          originalSizeBytes,
          finalSizeBytes: originalSizeBytes,
          generatedAt: new Date().toISOString(),
        },
      };
    }

    const encoded = Buffer.from(original ?? "", "utf8").toString("base64");

    return {
      compressed: true,
      data: encoded as T & string,
      metadata: {
        mobileOptimized: mobileOnly,
        originalSizeBytes,
        finalSizeBytes: Buffer.byteLength(encoded, "utf8"),
        encoding: "base64",
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

export default MobileOptimizationService;
