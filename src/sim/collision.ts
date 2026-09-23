import type { Box, Cylinder } from './types';
import type { Vec3 } from './vec';

// No physics engine: characters are vertical capsules on a flat floor, level
// geometry is axis-aligned boxes and vertical cylinders, bullets are swept
// segments (spec section 5.2).

const EPS = 1e-9;

export interface Bounds {
  w: number;
  d: number;
}

/**
 * Pushes a capsule (feet at `pos`, radius `r`, height `h`) out of every box and
 * cylinder it overlaps, and keeps it inside the level bounds. Mutates `pos`.
 * A few relaxation passes give sliding along walls and into corners.
 */
export function resolveCapsule(pos: Vec3, r: number, h: number, boxes: readonly Box[], cylinders: readonly Cylinder[], bounds: Bounds): void {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const b of boxes) {
      if (pos.y + h <= b.min.y || pos.y >= b.max.y) continue;
      const cx = Math.min(Math.max(pos.x, b.min.x), b.max.x);
      const cz = Math.min(Math.max(pos.z, b.min.z), b.max.z);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > EPS) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (r - d);
        pos.z += (dz / d) * (r - d);
      } else {
        // Center is inside the box: leave along the axis of least penetration.
        const left = pos.x - b.min.x + r;
        const right = b.max.x - pos.x + r;
        const back = pos.z - b.min.z + r;
        const front = b.max.z - pos.z + r;
        const m = Math.min(left, right, back, front);
        if (m === left) pos.x -= left;
        else if (m === right) pos.x += right;
        else if (m === back) pos.z -= back;
        else pos.z += front;
      }
      moved = true;
    }
    for (const c of cylinders) {
      if (pos.y + h <= c.center.y || pos.y >= c.center.y + c.h) continue;
      const dx = pos.x - c.center.x;
      const dz = pos.z - c.center.z;
      const minD = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      if (d > EPS) {
        pos.x += (dx / d) * (minD - d);
        pos.z += (dz / d) * (minD - d);
      } else {
        pos.x += minD;
      }
      moved = true;
    }
    pos.x = Math.min(Math.max(pos.x, r), bounds.w - r);
    pos.z = Math.min(Math.max(pos.z, r), bounds.d - r);
    if (!moved) break;
  }
}

/** Separates two capsules on the XZ plane, splitting the correction by `wa` : 1-`wa`. */
export function separateCircles(a: Vec3, ra: number, b: Vec3, rb: number, wa = 0.5): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const minD = ra + rb;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minD * minD) return;
  const d = Math.sqrt(d2);
  const nx = d > EPS ? dx / d : 1;
  const nz = d > EPS ? dz / d : 0;
  const push = minD - d;
  a.x -= nx * push * wa;
  a.z -= nz * push * wa;
  b.x += nx * push * (1 - wa);
  b.z += nz * push * (1 - wa);
}

/** Slab test. Returns the entry parameter t in [0, 1] along p0→p1, or null. */
export function segmentBox(p0: Vec3, p1: Vec3, b: Box): number | null {
  let tmin = 0;
  let tmax = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = p0[axis];
    const d = p1[axis] - o;
    const lo = b.min[axis];
    const hi = b.max[axis];
    if (Math.abs(d) < EPS) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Segment vs vertical cylinder (side and top cap). Returns entry t or null. */
export function segmentCylinder(p0: Vec3, p1: Vec3, c: Cylinder): number | null {
  const y0 = c.center.y;
  const y1 = c.center.y + c.h;
  const inside = (p: Vec3) => p.y >= y0 && p.y <= y1 && (p.x - c.center.x) ** 2 + (p.z - c.center.z) ** 2 <= c.r * c.r;
  if (inside(p0)) return 0;

  let best: number | null = null;
  const ox = p0.x - c.center.x;
  const oz = p0.z - c.center.z;
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const a = dx * dx + dz * dz;
  if (a > EPS) {
    const bq = 2 * (ox * dx + oz * dz);
    const cq = ox * ox + oz * oz - c.r * c.r;
    const disc = bq * bq - 4 * a * cq;
    if (disc >= 0) {
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= 1) {
        const y = p0.y + (p1.y - p0.y) * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  for (const capY of [y0, y1]) {
    const dy = p1.y - p0.y;
    if (Math.abs(dy) < EPS) continue;
    const t = (capY - p0.y) / dy;
    if (t < 0 || t > 1 || (best !== null && t >= best)) continue;
    const x = p0.x + dx * t - c.center.x;
    const z = p0.z + dz * t - c.center.z;
    if (x * x + z * z <= c.r * c.r) best = t;
  }
  return best;
}

/** Closest points between segments p0→p1 and q0→q1 (Ericson 5.1.9). */
export function closestSegmentSegment(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): { dist2: number; s: number; t: number } {
  const d1x = p1.x - p0.x, d1y = p1.y - p0.y, d1z = p1.z - p0.z;
  const d2x = q1.x - q0.x, d2y = q1.y - q0.y, d2z = q1.z - q0.z;
  const rx = p0.x - q0.x, ry = p0.y - q0.y, rz = p0.z - q0.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cx = p0.x + d1x * s - (q0.x + d2x * t);
  const cy = p0.y + d1y * s - (q0.y + d2y * t);
  const cz = p0.z + d1z * s - (q0.z + d2z * t);
  return { dist2: cx * cx + cy * cy + cz * cz, s, t };
}

/**
 * Segment vs vertical capsule standing on `feet`. Returns an entry t in [0, 1]
 * or null. The entry is found by backing off from the closest approach, which
 * is exact for the cylindrical part and a close approximation at the caps.
 */
export function segmentCapsule(p0: Vec3, p1: Vec3, feet: Vec3, r: number, h: number): number | null {
  const a = { x: feet.x, y: feet.y + r, z: feet.z };
  const b = { x: feet.x, y: feet.y + Math.max(r, h - r), z: feet.z };
  const { dist2, s } = closestSegmentSegment(p0, p1, a, b);
  if (dist2 > r * r) return null;
  const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  if (segLen <= EPS) return 0;
  const back = Math.sqrt(Math.max(0, r * r - dist2)) / segLen;
  return Math.max(0, s - back);
}

/**
 * Minimum distance between two points moving linearly over the same interval
 * (a0→a1 and b0→b1). Returns the distance and the time of closest approach.
 */
export function movingPointsClosest(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): { dist: number; t: number } {
  const px = a0.x - b0.x, py = a0.y - b0.y, pz = a0.z - b0.z;
  const vx = a1.x - a0.x - (b1.x - b0.x);
  const vy = a1.y - a0.y - (b1.y - b0.y);
  const vz = a1.z - a0.z - (b1.z - b0.z);
  const vv = vx * vx + vy * vy + vz * vz;
  const t = vv > EPS ? clamp01(-(px * vx + py * vy + pz * vz) / vv) : 0;
  return { dist: Math.hypot(px + vx * t, py + vy * t, pz + vz * t), t };
}

/** First static-geometry hit along p0→p1, or null. */
export function segmentVsLevel(p0: Vec3, p1: Vec3, boxes: readonly Box[], cylinders: readonly Cylinder[]): number | null {
  let best: number | null = null;
  for (const b of boxes) {
    const t = segmentBox(p0, p1, b);
    if (t !== null && (best === null || t < best)) best = t;
  }
  for (const c of cylinders) {
    const t = segmentCylinder(p0, p1, c);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

export function lineOfSight(p0: Vec3, p1: Vec3, boxes: readonly Box[], cylinders: readonly Cylinder[]): boolean {
  return segmentVsLevel(p0, p1, boxes, cylinders) === null;
}

/** Whether a capsule at `feet` overlaps any solid geometry (used by level validation). */
export function capsuleOverlapsLevel(feet: Vec3, r: number, h: number, boxes: readonly Box[], cylinders: readonly Cylinder[]): boolean {
  for (const b of boxes) {
    if (feet.y + h <= b.min.y || feet.y >= b.max.y) continue;
    const cx = Math.min(Math.max(feet.x, b.min.x), b.max.x);
    const cz = Math.min(Math.max(feet.z, b.min.z), b.max.z);
    if ((feet.x - cx) ** 2 + (feet.z - cz) ** 2 < r * r) return true;
  }
  for (const c of cylinders) {
    if (feet.y + h <= c.center.y || feet.y >= c.center.y + c.h) continue;
    if ((feet.x - c.center.x) ** 2 + (feet.z - c.center.z) ** 2 < (r + c.r) ** 2) return true;
  }
  return false;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
