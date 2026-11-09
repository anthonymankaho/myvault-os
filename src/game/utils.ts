export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a: number, b: number, t: number): number {
  const diff = normalizeAngle(b - a);
  return normalizeAngle(a + diff * clamp(t, 0, 1));
}

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--.---';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  const minStr = String(mins).padStart(2, '0');
  const secStr = String(secs).padStart(2, '0');
  const msStr = String(ms).padStart(3, '0');
  return `${minStr}:${secStr}.${msStr}`;
}

export function formatOrdinal(position: number): string {
  if (position === 1) return '1ST';
  if (position === 2) return '2ND';
  if (position === 3) return '3RD';
  return `${position}TH`;
}

export function distanceToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq <= 1e-8) {
    return Math.hypot(apx, apz);
  }
  const t = clamp((apx * abx + apz * abz) / abLenSq, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}
