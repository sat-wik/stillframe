import * as THREE from 'three';
import { ENEMIES, PLAYER } from '../content/defs';
import { createStream, nextFloat, nextRange, type RngStream } from '../rng/rng';
import type { SimEvent, WorldState } from '../sim/types';
import { lerp } from '../sim/vec';
import { G, glyphOf } from './ascii/atlas';
import { Cls } from './palette';

// The overlay is a cell grid drawn after the ASCII pass: one texel per cell
// holding glyph, color class, depth (0 = always on top) and intensity. Bullets,
// debris and the HUD all go through it, so the screen reads as one terminal.

export class CellGrid {
  cols = 0;
  rows = 0;
  data = new Uint8Array(0);
  texture: THREE.DataTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1);

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.data = new Uint8Array(cols * rows * 4);
    this.texture.dispose();
    this.texture = new THREE.DataTexture(this.data, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  clear(): void {
    this.data.fill(0);
  }

  /** `row` counts from the bottom, like gl_FragCoord. `depth` 0 = on top. */
  put(col: number, row: number, glyph: number, cls: number, depth: number, intensity = 1): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = (row * this.cols + col) * 4;
    this.data[i] = glyph;
    this.data[i + 1] = cls;
    this.data[i + 2] = depth;
    this.data[i + 3] = Math.round(Math.max(0, Math.min(1, intensity)) * 255);
  }

  /** HUD text; `rowFromTop` counts down from the top of the screen. */
  text(col: number, rowFromTop: number, str: string, cls: number = Cls.Hud): void {
    for (let i = 0; i < str.length; i++) {
      const g = glyphOf(str[i]!);
      this.put(col + i, this.rows - 1 - rowFromTop, g, cls, 0, 1);
    }
  }

  /** Clears a band of cells (drawn as solid black on top of the scene). */
  blank(col: number, rowFromTop: number, width: number): void {
    for (let i = 0; i < width; i++) this.put(col + i, this.rows - 1 - rowFromTop, G.BLOCK, Cls.Empty, 0, 0);
  }

  textCentered(rowFromTop: number, str: string, cls: number = Cls.Hud): void {
    this.text(Math.floor((this.cols - str.length) / 2), rowFromTop, str, cls);
  }

  upload(): void {
    this.texture.needsUpdate = true;
  }
}

interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  glyph: number;
}

const DEBRIS_GLYPHS = '#%*+=:;.'.split('').map(glyphOf);
const TRAIL = [0.012, 0.024, 0.036, 0.048]; // seconds of game time behind the head (open item O4: 4 cells)

export class Overlay {
  readonly grid = new CellGrid();
  private debris: Debris[] = [];
  /** Cosmetic stream: never shared with the sim, so visuals can't desync gameplay. */
  private rng: RngStream = createStream(0xdeb415);
  private v = new THREE.Vector3();
  threatHighlight = true;

  reset(seed: number): void {
    this.debris = [];
    this.rng = createStream(seed ^ 0xdeb415);
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type !== 'enemyDeath') continue;
      const def = ENEMIES[e.kind];
      // Death shatter: the enemy bursts into scattering characters.
      for (let i = 0; i < 70; i++) {
        const a = nextFloat(this.rng) * Math.PI * 2;
        const sp = nextRange(this.rng, 1, 5);
        this.debris.push({
          x: e.pos.x + Math.cos(a) * def.radius * 0.5,
          y: e.pos.y + nextRange(this.rng, 0.1, def.height),
          z: e.pos.z + Math.sin(a) * def.radius * 0.5,
          vx: Math.cos(a) * sp,
          vy: nextRange(this.rng, 0.5, 4),
          vz: Math.sin(a) * sp,
          life: nextRange(this.rng, 0.8, 2.2),
          glyph: DEBRIS_GLYPHS[Math.floor(nextFloat(this.rng) * DEBRIS_GLYPHS.length)]!,
        });
      }
    }
  }

  /** Debris advances in game time, so it hangs in the air when time slows. */
  advance(gameDt: number): void {
    for (const d of this.debris) {
      d.vy -= 9.8 * gameDt;
      d.x += d.vx * gameDt;
      d.y += d.vy * gameDt;
      d.z += d.vz * gameDt;
      if (d.y < 0.02) {
        d.y = 0.02;
        d.vy *= -0.3;
        d.vx *= 0.6;
        d.vz *= 0.6;
      }
      d.life -= gameDt;
    }
    this.debris = this.debris.filter((d) => d.life > 0);
  }

  /** Projects a world point to a cell. Returns null when behind the camera. */
  private cellOf(camera: THREE.PerspectiveCamera, x: number, y: number, z: number, far: number) {
    this.v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    const viewDepth = -this.v.z;
    if (viewDepth <= camera.near) return null;
    this.v.applyMatrix4(camera.projectionMatrix);
    const col = Math.floor((this.v.x * 0.5 + 0.5) * this.grid.cols);
    const row = Math.floor((this.v.y * 0.5 + 0.5) * this.grid.rows);
    if (col < 0 || row < 0 || col >= this.grid.cols || row >= this.grid.rows) return null;
    return { col, row, depth: Math.max(1, Math.min(255, Math.round((viewDepth / far) * 255))) };
  }

  drawWorld(w: WorldState, alpha: number, camera: THREE.PerspectiveCamera, far: number): void {
    const chest = { x: w.player.pos.x, y: w.player.pos.y + 1.1, z: w.player.pos.z };

    for (const d of this.debris) {
      const c = this.cellOf(camera, d.x, d.y, d.z, far);
      if (c) this.grid.put(c.col, c.row, d.glyph, Cls.Enemy, c.depth, Math.min(1, d.life * 1.5));
    }

    // Aim telegraph cue: a "!" over an enemy that is about to fire.
    for (const e of w.enemies) {
      if (e.ai.state !== 'aim') continue;
      const p = lerp(e.prevPos, e.pos, alpha);
      const c = this.cellOf(camera, p.x, p.y + ENEMIES[e.kind].height + 0.35, p.z, far);
      if (c) this.grid.put(c.col, c.row, glyphOf('!'), Cls.Enemy, c.depth, 1);
    }

    // Trails first, then heads, so a head is never overwritten by a trail.
    for (const pass of [0, 1] as const) {
      for (const b of w.bullets) {
        const p = lerp(b.prevPos, b.pos, alpha);
        let cls: number = b.owner === 'player' ? Cls.PlayerBullet : Cls.EnemyBullet;
        if (b.owner === 'enemy' && this.threatHighlight && w.player.alive && isThreat(p, b.vel, chest)) cls = Cls.Threat;
        const head = this.cellOf(camera, p.x, p.y, p.z, far);
        if (pass === 1) {
          if (head) this.grid.put(head.col, head.row, G.BULLET, cls, head.depth, 1);
          continue;
        }
        TRAIL.forEach((t, i) => {
          const c = this.cellOf(camera, p.x - b.vel.x * t, p.y - b.vel.y * t, p.z - b.vel.z * t, far);
          if (!c || (head && c.col === head.col && c.row === head.row)) return;
          this.grid.put(c.col, c.row, G.DOT, cls, c.depth, 0.75 - i * 0.16);
        });
      }
    }
  }
}

/** On a collision course with the player within 1 s of game time. */
function isThreat(p: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, chest: { x: number; y: number; z: number }): boolean {
  const rx = chest.x - p.x, ry = chest.y - p.y, rz = chest.z - p.z;
  const vv = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
  if (vv < 1e-6) return false;
  const t = (rx * vel.x + ry * vel.y + rz * vel.z) / vv;
  if (t < 0 || t > 1) return false;
  const dx = rx - vel.x * t, dy = ry - vel.y * t, dz = rz - vel.z * t;
  return Math.hypot(dx, dz) < PLAYER.radius + 0.35 && Math.abs(dy) < 1.0;
}
