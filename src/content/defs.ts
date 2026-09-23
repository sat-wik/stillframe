// Weapon and enemy tuning (spec sections 2.3 and 2.5). All times are game time.

export type WeaponId = 'pistol' | 'shotgun';
export type EnemyKind = 'grunt' | 'gunner' | 'heavy';

export interface WeaponDef {
  ammo: number;
  cooldown: number; // seconds between shots
  pellets: number;
  coneDeg: number; // full cone angle for pellets
  bulletSpeed: number; // m/s
  bulletTtl: number; // seconds
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  pistol: { ammo: 6, cooldown: 0.35, pellets: 1, coneDeg: 0, bulletSpeed: 40, bulletTtl: 2 },
  shotgun: { ammo: 2, cooldown: 0.8, pellets: 5, coneDeg: 12, bulletSpeed: 30, bulletTtl: 1 },
};

export interface EnemyDef {
  speed: number; // m/s
  hp: number;
  radius: number;
  height: number;
  /** Seconds the aim telegraph is shown before a shot or punch. */
  aimTime: number;
  /** Seconds between shots for ranged enemies. */
  fireInterval: number;
  /** Ranged: preferred distance band. */
  minRange: number;
  maxRange: number;
  /** Aim spread, standard deviation in degrees. */
  spreadDeg: number;
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyDef>> = {
  grunt: { speed: 3.2, hp: 1, radius: 0.4, height: 1.8, aimTime: 0.25, fireInterval: 0.9, minRange: 0, maxRange: 1.5, spreadDeg: 0 },
  gunner: { speed: 2.2, hp: 1, radius: 0.4, height: 1.8, aimTime: 0.4, fireInterval: 1.2, minRange: 6, maxRange: 12, spreadDeg: 1.5 },
  heavy: { speed: 1.4, hp: 2, radius: 0.55, height: 2.0, aimTime: 0.5, fireInterval: 1.6, minRange: 0, maxRange: 8, spreadDeg: 1 },
};

export const PLAYER = {
  speed: 4.5,
  radius: 0.35,
  height: 1.8,
  eyeHeight: 1.6,
  /** Hit radius used for enemy bullets; a touch forgiving. */
  hitRadius: 0.3,
  punchRange: 1.5,
  punchCooldown: 0.4,
} as const;

/** Thrown objects (spec section 2.3): any prop or gun; stuns and disarms on hit. */
export const THROW = {
  speed: 15, // m/s
  /** Extra upward angle so throws arc. */
  loft: 0.08,
  gravity: 9.8,
  radius: 0.12,
  /** Velocity kept along the axis of a bounce. */
  restitution: 0.35,
  /** Horizontal velocity kept on each floor bounce. */
  floorFriction: 0.6,
  /** Below this speed on the floor, a thrown object settles into a prop. */
  restSpeed: 0.6,
  maxFlight: 4,
  stun: 1.2,
  cooldown: 0.35,
} as const;

/** Radius used when testing player bullets against enemy bullets. */
export const BULLET_CLASH_RADIUS = 0.2;
