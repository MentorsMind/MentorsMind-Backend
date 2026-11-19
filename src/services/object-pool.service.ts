export interface ObjectPoolOptions<T> {
  create: () => T;
  reset?: (object: T) => void;
  maxSize?: number;
}

export interface ObjectPoolStats {
  created: number;
  available: number;
  inUse: number;
  acquireCount: number;
  releaseCount: number;
}

export class ObjectPool<T extends object> {
  private readonly available: T[] = [];
  private readonly inUse = new Set<T>();
  private readonly options: Required<Pick<ObjectPoolOptions<T>, "maxSize">> & ObjectPoolOptions<T>;
  private created = 0;
  private acquireCount = 0;
  private releaseCount = 0;

  constructor(options: ObjectPoolOptions<T>) {
    this.options = { ...options, maxSize: options.maxSize ?? 100 };
    if (this.options.maxSize < 1) throw new Error("Object pool maxSize must be positive");
  }

  public acquire(): T {
    const object = this.available.pop();
    if (object === undefined) {
      const createdObject = this.options.create();
      this.created += 1;
      this.inUse.add(createdObject);
      this.acquireCount += 1;
      return createdObject;
    }
    this.inUse.add(object);
    this.acquireCount += 1;
    return object;
  }

  public release(object: T): boolean {
    if (!this.inUse.delete(object)) return false;
    this.options.reset?.(object);
    if (this.available.length < this.options.maxSize) this.available.push(object);
    this.releaseCount += 1;
    return true;
  }

  public drain(): void {
    this.available.length = 0;
  }

  public getStats(): ObjectPoolStats {
    return {
      created: this.created,
      available: this.available.length,
      inUse: this.inUse.size,
      acquireCount: this.acquireCount,
      releaseCount: this.releaseCount,
    };
  }
}

export default ObjectPool;