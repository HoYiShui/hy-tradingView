export function createRateLimiter(options: { perMinute: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    allow(key: string): boolean {
      const t = now();
      const w = windows.get(key);
      if (!w || t - w.startedAt >= 60_000) {
        if (windows.size > 10_000) windows.clear();
        windows.set(key, { startedAt: t, count: 1 });
        return true;
      }
      w.count += 1;
      return w.count <= options.perMinute;
    },
  };
}
