import * as THREE from 'three';
import { ENEMIES, PLAYER, type WeaponId } from '../content/defs';
import type { LevelDef } from '../content/level';
import type { Enemy, WorldState } from '../sim/types';
import { lerp } from '../sim/vec';
import { SCENE_FRAG, SCENE_VERT } from './ascii/shaders';
import { Cls } from './palette';

// Syncs Three.js meshes from WorldState. Reads state only; never writes back.

export const FAR = 60;

function material(cls: number, bright = 1, floor = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SCENE_VERT,
    fragmentShader: SCENE_FRAG,
    uniforms: { uClass: { value: cls }, uBright: { value: bright }, uFar: { value: FAR }, uFloor: { value: floor ? 1 : 0 } },
  });
}

const MATS = {
  world: material(Cls.World),
  decor: material(Cls.World, 0.7),
  floor: material(Cls.World, 1, true),
  enemy: material(Cls.Enemy),
  weapon: material(Cls.Weapon, 1.15),
  pickup: material(Cls.Pickup),
  hands: material(Cls.Hands),
  viewGun: material(Cls.ViewGun),
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** A box of the given size centered at (x, y, z) in its parent. */
function box(mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}

/**
 * A gun model with its barrel along local -Y, grip at the origin. Guns are
 * built oversized so they survive the cell grid at combat distances.
 */
function enemyGun(weapon: WeaponId): THREE.Group {
  const g = new THREE.Group();
  // Chunky cross-sections: even pointed straight at the camera, a gun covers
  // a few cells and wins them via the shader's class priority.
  if (weapon === 'pistol') {
    g.add(box(MATS.weapon, 0.15, 0.46, 0.2, 0, -0.17, -0.04)); // slide + barrel
    g.add(box(MATS.weapon, 0.12, 0.12, 0.26, 0, 0.03, 0.1)); // grip
  } else {
    g.add(box(MATS.weapon, 0.13, 1.0, 0.13, 0, -0.4, -0.05)); // barrel
    g.add(box(MATS.weapon, 0.16, 0.34, 0.2, 0, -0.02, 0)); // receiver
    g.add(box(MATS.weapon, 0.14, 0.16, 0.34, 0, 0.14, 0.12)); // stock
  }
  return g;
}

// ── Enemies ─────────────────────────────────────────────────────────────────

interface Humanoid {
  root: THREE.Group;
  body: THREE.Group; // leans when stunned
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  gun: THREE.Group | null;
  gunKind: WeaponId | null;
  phase: number;
  last: { x: number; z: number };
}

/**
 * A readable human silhouette from boxes and a sphere: separated head,
 * shoulders wider than hips, arms and legs on pivots so they can walk, aim
 * and punch. Heavies are wider and taller.
 */
function makeHumanoid(e: Enemy): Humanoid {
  const def = ENEMIES[e.kind];
  const wide = e.kind === 'heavy' ? 1.35 : 1;
  const tall = def.height / 1.8;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.set(1, tall, 1);
  root.add(body);

  const hip = 0.9;
  const leg = (side: number) => {
    const pivot = new THREE.Group();
    // Legs and arms are set wider than anatomy so the gaps survive the cell
    // grid: a readable silhouette beats a realistic one.
    pivot.position.set(side * 0.16 * wide, hip, 0);
    pivot.add(box(MATS.enemy, 0.16 * wide, 0.86, 0.2, 0, -0.43, 0));
    pivot.add(box(MATS.enemy, 0.18 * wide, 0.08, 0.3, 0, -0.86, -0.05)); // foot
    body.add(pivot);
    return pivot;
  };
  const legL = leg(-1);
  const legR = leg(1);

  body.add(box(MATS.enemy, 0.34 * wide, 0.2, 0.22, 0, hip + 0.1, 0)); // pelvis
  body.add(box(MATS.enemy, 0.5 * wide, 0.44, 0.27, 0, hip + 0.44, 0)); // chest
  body.add(box(MATS.enemy, 0.1, 0.07, 0.1, 0, hip + 0.7, 0)); // neck
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14 * Math.sqrt(wide), 14, 10), MATS.enemy);
  head.scale.set(1, 1.15 / tall, 1);
  head.position.set(0, hip + 0.86, 0);
  body.add(head);

  const arm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (0.31 * wide + 0.07), hip + 0.62, 0);
    pivot.add(box(MATS.enemy, 0.13, 0.62, 0.14, 0, -0.31, 0));
    pivot.add(box(MATS.enemy, 0.15, 0.13, 0.15, 0, -0.66, 0)); // fist
    body.add(pivot);
    return pivot;
  };
  const armL = arm(-1);
  const armR = arm(1);

  return { root, body, legL, legR, armL, armR, gun: null, gunKind: null, phase: 0, last: { x: e.pos.x, z: e.pos.z } };
}

function syncGun(h: Humanoid, weapon: WeaponId | null): void {
  if (h.gunKind === weapon) return;
  if (h.gun) h.armR.remove(h.gun);
  h.gun = weapon ? enemyGun(weapon) : null;
  h.gunKind = weapon;
  if (h.gun) {
    h.gun.position.set(0, -0.68, 0);
    h.armR.add(h.gun);
  }
}

/** Arm pitch that points a hanging arm forward (+pi/2) and up by `pitch`. */
const forward = (pitch: number) => Math.PI / 2 + pitch;

function poseHumanoid(h: Humanoid, e: Enemy, stride: number, aimPitch: number): void {
  h.phase += stride * 3.2;
  const moving = Math.min(1, stride / 0.02);
  const swing = Math.sin(h.phase) * 0.65 * moving;
  h.legL.rotation.x = swing;
  h.legR.rotation.x = -swing;
  h.body.rotation.z = e.stun > 0 ? 0.3 : 0;

  const state = e.ai.state;
  const aiming = state === 'aim' || state === 'fire';
  h.armL.rotation.set(0, 0, 0);
  h.armR.rotation.set(0, 0, 0);

  // Positive z swings a hanging arm toward +x: inward for the left arm,
  // outward for the right.
  if (e.weapon && aiming) {
    // Aim telegraph: gun raised in both hands and tracking the player.
    h.armR.rotation.set(forward(aimPitch), 0, -0.15);
    h.armL.rotation.set(forward(aimPitch) - 0.05, 0, 0.5);
    h.gun?.rotation.set(0, 0, 0);
  } else if (e.weapon === 'pistol') {
    // Carried low at the side, barrel down: a steel bar beside the leg that
    // reads from every angle, unlike a gun pointed at the camera.
    h.armR.rotation.set(0.2 + swing * 0.2, 0, 0.18);
    h.armL.rotation.set(-swing * 0.8, 0, -0.15);
    h.gun?.rotation.set(0, 0, 0);
  } else if (e.weapon === 'shotgun') {
    // Port arms: held diagonally across the chest.
    h.armR.rotation.set(0.9, 0, -0.7);
    h.armL.rotation.set(1.1, 0, 0.5);
    h.gun?.rotation.set(0.2, 0, -1.2);
  } else {
    // Unarmed: a boxer's guard, cocked back during the windup, thrown on the punch.
    const guard = 1.25;
    h.armL.rotation.set(guard, 0, 0.3);
    h.armR.rotation.set(guard, 0, -0.3);
    if (state === 'aim') h.armR.rotation.x = 0.35;
    else if (state === 'fire' || (state === 'reposition' && e.ai.timer > 0.35)) {
      h.armR.rotation.set(forward(0.1), 0, -0.2);
    }
  }
}

// ── First-person viewmodel ──────────────────────────────────────────────────

/**
 * The player's own hands and gun, rendered in a second pass with a cleared
 * depth buffer so they never clip into walls. Animations run in real time so
 * they respond instantly even while the world is slow.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  private root = new THREE.Group();
  private sway = new THREE.Group();
  private pistol = new THREE.Group();
  private shotgun = new THREE.Group();
  private fists = new THREE.Group();
  private fistL = new THREE.Group();
  private fistR = new THREE.Group();
  private muzzles: Record<WeaponId, THREE.Object3D> = { pistol: new THREE.Object3D(), shotgun: new THREE.Object3D() };
  private recoil = 0;
  private punchT = -1;
  private punchSide = 1;
  private bob = 0;
  // A raised guard: both fists sit in the lower view, knuckles forward.
  private rest = { l: new THREE.Vector3(-0.19, -0.15, -0.42), r: new THREE.Vector3(0.19, -0.15, -0.42) };

  constructor() {
    this.scene.add(this.root);
    this.root.add(this.sway);
    this.sway.add(this.pistol, this.shotgun, this.fists);
    // Shrink each model about its own grip; scaling the whole group about the
    // camera would not change its size on screen.
    this.pistol.scale.setScalar(0.8);
    this.shotgun.scale.setScalar(0.8);
    this.fistL.scale.setScalar(0.85);
    this.fistR.scale.setScalar(0.85);

    // Pistol, held in the right hand.
    this.pistol.position.set(0.22, -0.18, -0.42);
    this.pistol.rotation.order = 'YXZ';
    this.pistol.add(box(MATS.viewGun, 0.055, 0.07, 0.27, 0, 0.045, -0.1)); // slide
    this.pistol.add(box(MATS.viewGun, 0.03, 0.03, 0.05, 0, 0.03, -0.25)); // muzzle
    this.pistol.add(box(MATS.viewGun, 0.012, 0.025, 0.02, 0, 0.09, -0.2)); // front sight
    const grip = box(MATS.viewGun, 0.05, 0.14, 0.07, 0, -0.04, 0.02);
    grip.rotation.x = -0.25;
    this.pistol.add(grip);
    this.pistol.add(box(MATS.hands, 0.085, 0.095, 0.11, 0, -0.03, 0.035)); // fist on grip
    const armR = box(MATS.hands, 0.08, 0.08, 0.42, 0.03, -0.1, 0.26);
    armR.rotation.x = 0.4;
    this.pistol.add(armR);
    this.muzzles.pistol.position.set(0, 0.045, -0.3);
    this.pistol.add(this.muzzles.pistol);

    // Shotgun, two-handed.
    this.shotgun.position.set(0.17, -0.19, -0.36);
    this.shotgun.rotation.order = 'YXZ';
    this.shotgun.add(box(MATS.viewGun, 0.05, 0.05, 0.62, 0, 0.05, -0.3)); // barrel
    this.shotgun.add(box(MATS.viewGun, 0.04, 0.04, 0.46, 0, 0.005, -0.24)); // magazine tube
    this.shotgun.add(box(MATS.viewGun, 0.075, 0.065, 0.15, 0, 0.0, -0.36)); // pump
    this.shotgun.add(box(MATS.viewGun, 0.065, 0.09, 0.2, 0, 0.03, 0.02)); // receiver
    const stock = box(MATS.viewGun, 0.055, 0.08, 0.25, 0.01, -0.02, 0.2);
    stock.rotation.x = 0.15;
    this.shotgun.add(stock);
    this.shotgun.add(box(MATS.hands, 0.085, 0.09, 0.11, 0, -0.04, 0.06)); // right fist
    this.shotgun.add(box(MATS.hands, 0.09, 0.08, 0.11, -0.01, -0.045, -0.36)); // left hand on pump
    const armSR = box(MATS.hands, 0.08, 0.08, 0.4, 0.04, -0.12, 0.26);
    armSR.rotation.x = 0.45;
    this.shotgun.add(armSR);
    const armSL = box(MATS.hands, 0.075, 0.075, 0.45, -0.1, -0.16, -0.14);
    armSL.rotation.set(0.5, -0.5, 0);
    this.shotgun.add(armSL);
    this.muzzles.shotgun.position.set(0, 0.05, -0.62);
    this.shotgun.add(this.muzzles.shotgun);

    // Bare fists.
    const fist = (side: number, g: THREE.Group) => {
      g.add(box(MATS.hands, 0.1, 0.1, 0.12, 0, 0, 0)); // knuckles
      g.add(box(MATS.hands, 0.03, 0.045, 0.1, side * -0.055, 0.02, 0.02)); // thumb
      const fore = box(MATS.hands, 0.085, 0.085, 0.4, side * 0.02, -0.08, 0.22);
      fore.rotation.x = 0.35;
      g.add(fore);
      this.fists.add(g);
    };
    fist(-1, this.fistL);
    fist(1, this.fistR);
    this.fistL.position.copy(this.rest.l);
    this.fistR.position.copy(this.rest.r);
  }

  onShot(): void {
    this.recoil = 1;
  }

  onPunch(): void {
    this.punchT = 0;
    this.punchSide = -this.punchSide;
  }

  /** World position of the current gun's muzzle, for the flash. */
  muzzleWorld(weapon: WeaponId, out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.muzzles[weapon].getWorldPosition(out);
  }

  update(camera: THREE.Camera, weapon: WeaponId | null, alive: boolean, moveSpeed: number, realDt: number): void {
    this.root.visible = alive;
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);

    this.bob += moveSpeed * realDt * 9;
    this.sway.position.set(Math.sin(this.bob) * 0.012, -Math.abs(Math.cos(this.bob)) * 0.014, 0);

    this.recoil = Math.max(0, this.recoil - realDt / 0.14);
    const k = this.recoil * this.recoil;
    this.pistol.visible = weapon === 'pistol';
    this.shotgun.visible = weapon === 'shotgun';
    this.fists.visible = weapon === null;
    const gun = weapon === 'pistol' ? this.pistol : this.shotgun;
    // Turned inward so the side profile shows: slide, grip and barrel read as a
    // gun silhouette instead of a box seen from behind.
    gun.rotation.set(0.05 + 0.28 * k, weapon === 'pistol' ? 0.5 : 0.35, 0.1);
    gun.position.z = (weapon === 'pistol' ? -0.42 : -0.36) + 0.07 * k;

    // Punch: snap the fist forward to the crosshair, then pull it back.
    this.fistL.position.copy(this.rest.l);
    this.fistR.position.copy(this.rest.r);
    this.fistL.rotation.set(0, 0, 0);
    this.fistR.rotation.set(0, 0, 0);
    if (this.punchT >= 0) {
      this.punchT += realDt;
      const out = 0.07;
      const back = 0.26;
      const t = this.punchT < out ? this.punchT / out : Math.max(0, 1 - (this.punchT - out) / (back - out));
      const e = 1 - (1 - t) * (1 - t);
      const f = this.punchSide > 0 ? this.fistR : this.fistL;
      const rest = this.punchSide > 0 ? this.rest.r : this.rest.l;
      f.position.set(rest.x * (1 - e * 0.85), rest.y + e * 0.1, rest.z - e * 0.38);
      f.rotation.z = this.punchSide * -e * 0.5;
      if (this.punchT > back) this.punchT = -1;
    }
  }
}

// ── Scene ───────────────────────────────────────────────────────────────────

export class SceneView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.03, FAR);
  readonly viewModel = new ViewModel();
  private levelGroup = new THREE.Group();
  private enemies = new Map<number, Humanoid>();
  private props = new Map<number, THREE.Object3D>();
  private level: LevelDef | null = null;
  private lastPlayer = { x: 0, z: 0 };

  constructor() {
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.levelGroup);
  }

  setLevel(level: LevelDef): void {
    if (this.level === level) return;
    this.level = level;
    this.levelGroup.clear();
    for (const v of this.enemies.values()) this.scene.remove(v.root);
    for (const m of this.props.values()) this.scene.remove(m);
    this.enemies.clear();
    this.props.clear();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(level.bounds.w, level.bounds.d), MATS.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(level.bounds.w / 2, 0, level.bounds.d / 2);
    this.levelGroup.add(floor);

    for (const g of level.geometry) {
      if (g.kind === 'box') {
        const m = box(g.solid ? MATS.world : MATS.decor, g.max.x - g.min.x, g.max.y - g.min.y, g.max.z - g.min.z, (g.min.x + g.max.x) / 2, (g.min.y + g.max.y) / 2, (g.min.z + g.max.z) / 2);
        this.levelGroup.add(m);
      } else {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(g.r, g.r, g.h, 20), MATS.world);
        m.position.set(g.center.x, g.center.y + g.h / 2, g.center.z);
        this.levelGroup.add(m);
      }
    }
  }

  sync(w: WorldState, alpha: number, look: { yaw: number; pitch: number }, gameTime: number, realDt: number): void {
    this.setLevel(w.level.def);
    const pp = lerp(w.player.prevPos, w.player.pos, alpha);
    const chestY = pp.y + 1.2;

    const seen = new Set<number>();
    for (const e of w.enemies) {
      seen.add(e.id);
      let h = this.enemies.get(e.id);
      if (!h) {
        h = makeHumanoid(e);
        this.scene.add(h.root);
        this.enemies.set(e.id, h);
      }
      syncGun(h, e.weapon);
      const p = lerp(e.prevPos, e.pos, alpha);
      const stride = Math.hypot(p.x - h.last.x, p.z - h.last.z);
      h.last = { x: p.x, z: p.z };
      h.root.position.set(p.x, p.y, p.z);
      h.root.rotation.y = e.yaw;
      const shoulderY = p.y + ENEMIES[e.kind].height * 0.84;
      const aimPitch = Math.atan2(chestY - shoulderY, Math.max(0.5, Math.hypot(pp.x - p.x, pp.z - p.z)));
      poseHumanoid(h, e, stride, aimPitch);
    }
    for (const [id, v] of this.enemies) {
      if (!seen.has(id)) {
        this.scene.remove(v.root);
        this.enemies.delete(id);
      }
    }

    const seenProps = new Set<number>();
    for (const pr of w.props) {
      seenProps.add(pr.id);
      let m = this.props.get(pr.id);
      if (!m) {
        if (pr.kind === 'gun' && pr.weapon) {
          // Dropped guns glow in the pickup hue so they read as grabbable.
          m = enemyGun(pr.weapon);
          m.traverse((o) => {
            if (o instanceof THREE.Mesh) o.material = MATS.pickup;
          });
          m.rotation.x = Math.PI / 2;
        } else {
          m = box(MATS.pickup, 0.3, 0.3, 0.3);
        }
        const holder = new THREE.Group();
        holder.add(m);
        this.scene.add(holder);
        this.props.set(pr.id, holder);
        m = holder;
      }
      m.position.set(pr.pos.x, 0.4 + Math.sin(gameTime * 3 + pr.id) * 0.06, pr.pos.z);
      m.rotation.y = gameTime * 1.5 + pr.id;
    }
    for (const [id, m] of this.props) {
      if (!seenProps.has(id)) {
        this.scene.remove(m);
        this.props.delete(id);
      }
    }

    const eye = w.player.alive ? PLAYER.eyeHeight : 0.6;
    this.camera.position.set(pp.x, pp.y + eye, pp.z);
    this.camera.rotation.set(look.pitch, look.yaw, w.player.alive ? 0 : 0.35);
    this.camera.updateMatrixWorld();

    const moved = Math.hypot(pp.x - this.lastPlayer.x, pp.z - this.lastPlayer.z);
    this.lastPlayer = { x: pp.x, z: pp.z };
    const moveSpeed = realDt > 0 ? Math.min(1, moved / realDt / PLAYER.speed) : 0;
    this.viewModel.update(this.camera, w.player.weapon, w.player.alive, moveSpeed, realDt);
  }
}
