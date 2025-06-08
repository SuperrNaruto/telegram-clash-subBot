interface Entry<T> { ts: number; data: T }
export class Cache<T> {
  constructor(private ttl = 600_000) {}   // 默认10分钟
  private store = new Map<string, Entry<T>>();
  get(key: string) {
    const e = this.store.get(key);
    if (e && Date.now() - e.ts < this.ttl) return e.data;
    this.store.delete(key); return undefined;
  }
  set(key: string, data: T) {
    this.store.set(key, { ts: Date.now(), data });
  }
}