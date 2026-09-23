import * as THREE from 'three';
import { ENEMIES, PLAYER } from '../content/defs';
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

interface EnemyView {
  root: THREE.Group;
  arm: THREE.Mesh;
}

export class SceneView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, FAR);
  private levelGroup = new THREE.Group();
  private enemies = new Map<number, EnemyView>();
  private props = new Map<number, THREE.Mesh>();
  private mats = {
    world: material(Cls.World),
    decor: material(Cls.World, 0.7),
    floor: material(Cls.World, 1, true),
    enemy: material(Cls.Enemy),
    pickup: material(Cls.Pickup),
  };
  private geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    gun: new THREE.BoxGeometry(0.12, 0.14, 0.45),
    arm: new THREE.BoxGeometry(0.12, 0.12, 0.7),
  };
  private level: LevelDef | null = null;

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

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(level.bounds.w, level.bounds.d), this.mats.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(level.bounds.w / 2, 0, level.bounds.d / 2);
    this.levelGroup.add(floor);

    for (const g of level.geometry) {
      if (g.kind === 'box') {
        const m = new THREE.Mesh(this.geo.box, g.solid ? this.mats.world : this.mats.decor);
        m.scale.set(g.max.x - g.min.x, g.max.y - g.min.y, g.max.z - g.min.z);
        m.position.set((g.min.x + g.max.x) / 2, (g.min.y + g.max.y) / 2, (g.min.z + g.max.z) / 2);
        this.levelGroup.add(m);
      } else {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(g.r, g.r, g.h, 20), this.mats.world);
        m.position.set(g.center.x, g.center.y + g.h / 2, g.center.z);
        this.levelGroup.add(m);
      }
    }
  }

  private enemyView(e: Enemy): EnemyView {
    let v = this.enemies.get(e.id);
    if (v) return v;
    const def = ENEMIES[e.kind];
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(def.radius, def.height - def.radius * 2, 6, 14), this.mats.enemy);
    body.position.y = def.height / 2;
    root.add(body);
    const arm = new THREE.Mesh(this.geo.arm, this.mats.enemy);
    root.add(arm);
    this.scene.add(root);
    v = { root, arm };
    this.enemies.set(e.id, v);
    return v;
  }

  sync(w: WorldState, alpha: number, look: { yaw: number; pitch: number }, gameTime: number): void {
    this.setLevel(w.level.def);

    const seen = new Set<number>();
    for (const e of w.enemies) {
      seen.add(e.id);
      const def = ENEMIES[e.kind];
      const v = this.enemyView(e);
      const p = lerp(e.prevPos, e.pos, alpha);
      v.root.position.set(p.x, p.y, p.z);
      v.root.rotation.y = e.yaw;
      // Aim telegraph: the arm snaps up to point at the player before a shot.
      const aiming = e.ai.state === 'aim' || e.ai.state === 'fire';
      v.arm.visible = e.weapon !== null || aiming;
      v.arm.position.set(def.radius * 0.9, def.height * (aiming ? 0.78 : 0.5), aiming ? -0.35 : -0.1);
      v.arm.rotation.x = aiming ? 0 : -1.2;
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
        m = new THREE.Mesh(pr.kind === 'gun' ? this.geo.gun : this.geo.box, this.mats.pickup);
        if (pr.kind !== 'gun') m.scale.setScalar(0.3);
        this.scene.add(m);
        this.props.set(pr.id, m);
      }
      m.position.set(pr.pos.x, 0.35 + Math.sin(gameTime * 3 + pr.id) * 0.06, pr.pos.z);
      m.rotation.y = gameTime * 1.5 + pr.id;
    }
    for (const [id, m] of this.props) {
      if (!seenProps.has(id)) {
        this.scene.remove(m);
        this.props.delete(id);
      }
    }

    const pp = lerp(w.player.prevPos, w.player.pos, alpha);
    const eye = w.player.alive ? PLAYER.eyeHeight : 0.6;
    this.camera.position.set(pp.x, pp.y + eye, pp.z);
    this.camera.rotation.set(look.pitch, look.yaw, w.player.alive ? 0 : 0.35);
    this.camera.updateMatrixWorld();
  }
}
