import type { EnemyKind, WeaponId } from '../content/defs';
import type { LevelDef } from '../content/level';
import type { SimStreams } from '../rng/rng';
import type { Vec3 } from './vec';

export type { Vec3 } from './vec';

export const STEP_HZ = 120;
export const STEP_DT = 1 / STEP_HZ;

/** What one fixed step receives. Recorded per step for replays. */
export interface StepInput {
  /** Strafe, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward, -1 (back) .. 1 (forward). */
  moveY: number;
  /** Absolute aim; the camera turns in real time, the sim just reads it. */
  yaw: number;
  pitch: number;
  /** Edge-triggered: consumed by the first step after the press. */
  fire: boolean;
  alt: boolean;
}

export const IDLE_INPUT: Readonly<StepInput> = { moveX: 0, moveY: 0, yaw: 0, pitch: 0, fire: false, alt: false };

export interface Player {
  pos: Vec3; // feet
  prevPos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  weapon: WeaponId | null;
  ammo: number;
  /** A non-gun throwable in hand. Mutually exclusive with `weapon`. */
  item: 'bottle' | 'chair' | null;
  cooldown: number;
  punchCooldown: number;
}

export type AiStateName = 'idle' | 'approach' | 'aim' | 'fire' | 'reposition';

export interface AiState {
  state: AiStateName;
  /** Seconds left in the current timed state (aim telegraph, reposition). */
  timer: number;
  /** Seconds until the next line-of-sight check. */
  losTimer: number;
  hasLos: boolean;
  /** -1 or 1: which way to strafe while repositioning. */
  strafeDir: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pos: Vec3;
  prevPos: Vec3;
  yaw: number;
  hp: number;
  weapon: WeaponId | null;
  cooldown: number;
  /** Stun from a thrown object, in seconds. */
  stun: number;
  ai: AiState;
}

export interface Bullet {
  id: number;
  owner: 'player' | 'enemy';
  /** Id of the enemy that fired it, for "who killed me" debugging. */
  shooter: number;
  pos: Vec3;
  vel: Vec3; // m/s in game time
  prevPos: Vec3; // for swept collision + trail
  origin: Vec3; // where it was fired, for "what killed me" reports
  ttl: number; // game seconds left
}

export type PropKind = 'bottle' | 'chair' | 'gun';

export interface Prop {
  id: number;
  kind: PropKind;
  pos: Vec3;
  weapon: WeaponId | null;
  ammo: number;
}

/** An object in flight after a throw. It settles back into a Prop at rest. */
export interface Thrown {
  id: number;
  kind: PropKind;
  weapon: WeaponId | null;
  ammo: number;
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  /** Seconds in the air, capped by THROW.maxFlight. */
  age: number;
  /** Whether it already struck an enemy (a throw stuns at most once). */
  spent: boolean;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface Cylinder {
  center: Vec3; // base center
  r: number;
  h: number;
}

export interface PendingEnemy {
  kind: EnemyKind;
  pos: Vec3;
  yaw: number;
  weapon: WeaponId | null;
  wave: number;
}

export interface LevelRuntime {
  def: LevelDef;
  /** Solid boxes block movement and bullets; non-solid boxes are decor. */
  boxes: Box[];
  cylinders: Cylinder[];
  pending: PendingEnemy[];
  firedWaves: number[];
}

export interface WorldState {
  step: number; // sim steps since level start
  gameTime: number; // seconds of game time
  seed: number;
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  props: Prop[]; // throwables, dropped guns
  thrown: Thrown[];
  level: LevelRuntime; // static colliders, triggers, wave state
  kills: number;
  nextId: number;
  rng: SimStreams;
  outcome: 'playing' | 'won' | 'lost';
  /** Set on loss: the bullet (or enemy id for a punch) that killed the player. */
  killedBy: { kind: 'bullet'; origin: Vec3; shooter: number } | { kind: 'punch'; shooter: number } | null;
}

export type SimEvent =
  | { type: 'shot'; owner: 'player' | 'enemy'; weapon: WeaponId; pos: Vec3 }
  | { type: 'punch'; by: 'player' | 'enemy'; hit: boolean; pos: Vec3 }
  | { type: 'hit'; target: 'enemy' | 'player' | 'wall' | 'bullet'; pos: Vec3 }
  | { type: 'enemyDeath'; id: number; kind: EnemyKind; pos: Vec3 }
  | { type: 'disarm'; id: number; pos: Vec3 }
  | { type: 'wave'; id: number }
  | { type: 'throw'; kind: PropKind; pos: Vec3 }
  | { type: 'impact'; kind: PropKind; target: 'enemy' | 'wall'; broke: boolean; pos: Vec3 }
  | { type: 'pickup'; kind: PropKind; weapon: WeaponId | null }
  | { type: 'outcome'; outcome: 'won' | 'lost' };
