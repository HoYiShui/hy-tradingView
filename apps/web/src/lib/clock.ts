export const DAY_MS = 86_400_000;

export const SPEEDS = [
  { label: "0.1x", factor: 0.1 },
  { label: "0.5x", factor: 0.5 },
  { label: "1x", factor: 1 },
  { label: "1.2x", factor: 1.2 },
  { label: "2x", factor: 2 },
  { label: "5x", factor: 5 },
  { label: "20x", factor: 20 },
] as const;

export type Speed = (typeof SPEEDS)[number]["factor"];

export interface Clock {
  readonly t: number;
  readonly from: number;
  readonly to: number;
  readonly playing: boolean;
  readonly speed: Speed;
}

export const SPEED_LABEL = (speed: Speed): string => SPEEDS.find((s) => s.factor === speed)?.label ?? `${speed}x`;

export function makeClock(from: number, to: number): Clock {
  return { t: from, from, to, playing: false, speed: 1 };
}

export function tick(clock: Clock, realMs: number): Clock {
  if (!clock.playing) return clock;
  const t = Math.min(clock.to, clock.t + realMs * clock.speed * (DAY_MS / 1000));
  return t >= clock.to ? { ...clock, t, playing: false } : { ...clock, t };
}

export function seekTo(clock: Clock, t: number): Clock {
  return { ...clock, t: Math.min(clock.to, Math.max(clock.from, t)) };
}

export function togglePlay(clock: Clock): Clock {
  if (clock.playing) return { ...clock, playing: false };
  return { ...clock, playing: true, t: clock.t >= clock.to ? clock.from : clock.t };
}

export function withSpeed(clock: Clock, speed: Speed): Clock {
  return { ...clock, speed };
}

export function stepSpeed(clock: Clock, dir: 1 | -1): Clock {
  const i = SPEEDS.findIndex((s) => s.factor === clock.speed);
  const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
  return next === undefined ? clock : { ...clock, speed: next.factor };
}


export function realSecondsToFinish(clock: Clock): number {
  return (clock.to - clock.t) / DAY_MS / clock.speed;
}
