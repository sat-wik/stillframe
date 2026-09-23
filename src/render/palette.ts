// Color by class, not by lighting (spec section 4.2, open item O3: mono gray
// world + one enemy hue + one pickup hue). The enemy hue is used by nothing
// else in the game. Deliberately not red-on-white.

export const Cls = {
  Empty: 0,
  World: 1,
  Enemy: 2,
  Pickup: 3,
  PlayerBullet: 4,
  EnemyBullet: 5,
  Threat: 6,
  Hud: 7,
  HudDim: 8,
  HudAlert: 9,
} as const;
export type Cls = (typeof Cls)[keyof typeof Cls];

export const CLASS_COUNT = 16;

type RGB = [number, number, number];

const BASE: Record<number, RGB> = {
  [Cls.Empty]: [0, 0, 0],
  [Cls.World]: [0.78, 0.8, 0.82],
  [Cls.Enemy]: [1.0, 0.6, 0.08], // hot amber: reserved for enemies
  [Cls.Pickup]: [0.35, 0.95, 0.9],
  [Cls.PlayerBullet]: [0.55, 0.75, 1.0],
  [Cls.EnemyBullet]: [1.0, 1.0, 1.0],
  [Cls.Threat]: [1.0, 0.25, 0.55],
  [Cls.Hud]: [0.85, 0.9, 0.85],
  [Cls.HudDim]: [0.45, 0.5, 0.48],
  [Cls.HudAlert]: [1.0, 0.95, 0.6],
};

export function paletteArray(): Float32Array {
  const out = new Float32Array(CLASS_COUNT * 3);
  for (let i = 0; i < CLASS_COUNT; i++) {
    const c = BASE[i] ?? [1, 1, 1];
    out.set(c, i * 3);
  }
  return out;
}
