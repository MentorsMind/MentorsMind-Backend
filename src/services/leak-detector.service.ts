export interface TrackedObject {
  id: string;
  label: string;
  createdAt: number;
  ageMs: number;
}

export interface LeakReport {
  tracked: number;
  collected: number;
  longLived: TrackedObject[];
}

interface Entry {
  label: string;
  createdAt: number;
  reference: WeakRef<object>;
}

export class LeakDetectorService {
  private readonly entries = new Map<string, Entry>();
  private collected = 0;
  private sequence = 0;
  private readonly finalizer = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<string>((id) => {
      if (this.entries.delete(id)) this.collected += 1;
    })
    : undefined;

  public track<T extends object>(object: T, label = "object"): string {
    const id = `${label}:${++this.sequence}`;
    this.entries.set(id, { label, createdAt: Date.now(), reference: new WeakRef(object) });
    this.finalizer?.register(object, id);
    return id;
  }

  public untrack(id: string): boolean {
    return this.entries.delete(id);
  }

  public collect(): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.reference.deref() === undefined) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    this.collected += removed;
    return removed;
  }

  public getReport(longLivedAfterMs = 5 * 60_000): LeakReport {
    this.collect();
    const now = Date.now();
    const longLived = Array.from(this.entries.entries())
      .filter(([, entry]) => now - entry.createdAt >= longLivedAfterMs)
      .map(([id, entry]) => ({
        id,
        label: entry.label,
        createdAt: entry.createdAt,
        ageMs: now - entry.createdAt,
      }));
    return { tracked: this.entries.size, collected: this.collected, longLived };
  }

  public clear(): void {
    this.entries.clear();
    this.collected = 0;
  }
}

export const leakDetector = new LeakDetectorService();
export default leakDetector;