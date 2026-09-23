import * as THREE from 'three';
import { WEAPONS } from '../content/defs';
import type { SimEvent, WorldState } from '../sim/types';
import { ATLAS_COLS, ATLAS_ROWS, G, bakeAtlas } from './ascii/atlas';
import { ASCII_FRAG, ASCII_VERT } from './ascii/shaders';
import { Overlay } from './overlay';
import { Cls, paletteArray } from './palette';
import { FAR, SceneView } from './scene';

export type ViewMode = 0 | 1 | 2 | 3; // ascii, raw, depth, class id
export const VIEW_NAMES = ['ascii', 'raw 3d', 'depth', 'class id'] as const;

export interface RenderSettings {
  cellW: number; // CSS px
  cellH: number;
  threatHighlight: boolean;
  fov: number;
}

export interface HudInfo {
  levelName: string;
  levelIndex: number;
  levelCount: number;
  timeScale: number;
  paused: boolean;
  debugLines: string[];
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly view = new SceneView();
  readonly overlay = new Overlay();
  private gl: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private uniforms: Record<string, THREE.IUniform>;
  private settings: RenderSettings;
  viewMode: ViewMode = 0;

  constructor(canvas: HTMLCanvasElement, settings: RenderSettings) {
    this.canvas = canvas;
    this.settings = settings;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.setClearColor(0x000000, 1);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.uniforms = {
      uScene: { value: this.target.texture },
      uAtlas: { value: bakeAtlas() },
      uOverlay: { value: this.overlay.grid.texture },
      uGrid: { value: new THREE.Vector2(1, 1) },
      uCellPx: { value: new THREE.Vector2(8, 14) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAtlasGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      uPalette: { value: toVec3s(paletteArray()) },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uFar: { value: FAR },
      uView: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: ASCII_VERT,
      fragmentShader: ASCII_FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.resize();
  }

  updateSettings(s: Partial<RenderSettings>): void {
    Object.assign(this.settings, s);
    this.overlay.threatHighlight = this.settings.threatHighlight;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(cssW, cssH, false);
    const pxW = Math.floor(cssW * dpr);
    const pxH = Math.floor(cssH * dpr);
    const cellW = this.settings.cellW * dpr;
    const cellH = this.settings.cellH * dpr;
    const cols = Math.max(1, Math.floor(pxW / cellW));
    const rows = Math.max(1, Math.floor(pxH / cellH));
    // Low internal resolution is fine: 2×2 samples per cell.
    this.target.setSize(cols * 2, rows * 2);
    this.overlay.grid.resize(cols, rows);
    this.uniforms.uOverlay!.value = this.overlay.grid.texture;
    (this.uniforms.uGrid!.value as THREE.Vector2).set(cols, rows);
    (this.uniforms.uCellPx!.value as THREE.Vector2).set(cellW, cellH);
    (this.uniforms.uResolution!.value as THREE.Vector2).set(pxW, pxH);
    this.view.camera.aspect = (cols * cellW) / (rows * cellH);
    this.view.camera.fov = this.settings.fov;
    this.view.camera.updateProjectionMatrix();
  }

  reset(seed: number): void {
    this.overlay.reset(seed);
  }

  onEvents(events: readonly SimEvent[]): void {
    this.overlay.onEvents(events);
  }

  render(w: WorldState, alpha: number, look: { yaw: number; pitch: number }, gameDt: number, hud: HudInfo): void {
    this.view.sync(w, alpha, look, w.gameTime + alpha / 120);
    this.overlay.advance(gameDt);

    const grid = this.overlay.grid;
    grid.clear();
    this.overlay.drawWorld(w, alpha, this.view.camera, FAR);
    this.drawHud(w, hud);
    grid.upload();

    this.uniforms.uView!.value = this.viewMode;
    this.gl.setRenderTarget(this.target);
    this.gl.setClearColor(new THREE.Color(0, 0, 1), 1); // lum 0, class 0, depth 1
    this.gl.clear();
    this.gl.render(this.view.scene, this.view.camera);
    this.gl.setRenderTarget(null);
    this.gl.setClearColor(0x000000, 1);
    this.gl.render(this.quadScene, this.quadCam);
  }

  private drawHud(w: WorldState, hud: HudInfo): void {
    const g = this.overlay.grid;
    const { cols, rows } = g;
    const p = w.player;

    // Status bars: the top and bottom rows are solid, like a terminal.
    g.blank(0, 0, cols);
    g.blank(0, rows - 1, cols);
    g.blank(0, rows - 2, cols);

    // Crosshair.
    if (p.alive) g.put(Math.floor(cols / 2), Math.floor(rows / 2), G.RING, Cls.HudDim, 0, 0.8);

    g.text(1, 0, `${String(hud.levelIndex + 1).padStart(2, '0')}/${String(hud.levelCount).padStart(2, '0')} ${hud.levelName.toUpperCase()}`, Cls.HudDim);

    // Weapon and ammo, bottom-left.
    const bottom = rows - 2;
    if (p.weapon) {
      const max = WEAPONS[p.weapon].ammo;
      g.text(1, bottom, `${p.weapon.toUpperCase()} `, Cls.Hud);
      for (let i = 0; i < max; i++) g.put(2 + p.weapon.length + i, 1, i < p.ammo ? G.BLOCK : G.SHADE, i < p.ammo ? Cls.Hud : Cls.HudDim, 0, 1);
      if (p.ammo === 0) g.text(3 + p.weapon.length + max, bottom, 'EMPTY - [RMB] DROP', Cls.HudAlert);
    } else {
      g.text(1, bottom, 'FISTS  [RMB] PUNCH / GRAB', Cls.Hud);
    }

    // Time-scale meter, bottom-right.
    const meterW = 16;
    const label = `${hud.timeScale.toFixed(2)}x`;
    const x0 = cols - meterW - label.length - 9;
    g.text(x0, bottom, 'TIME [', Cls.HudDim);
    const filled = Math.round(hud.timeScale * meterW);
    for (let i = 0; i < meterW; i++) g.put(x0 + 6 + i, 1, i < filled ? G.BLOCK : G.SHADE, i < filled ? Cls.Hud : Cls.HudDim, 0, 1);
    g.text(x0 + 6 + meterW, bottom, `] ${label}`, Cls.HudDim);

    const mid = Math.floor(rows / 2);
    if (w.outcome === 'lost') {
      banner(g, mid - 3, 'YOU DIED', Cls.HudAlert);
      banner(g, mid + 3, '[R] RESTART', Cls.Hud);
    } else if (w.outcome === 'won') {
      banner(g, mid - 3, 'ROOM CLEAR', Cls.HudAlert);
      banner(g, mid + 3, `${(w.gameTime).toFixed(2)}s GAME TIME   [N] NEXT   [R] AGAIN`, Cls.Hud);
    }

    hud.debugLines.forEach((line, i) => {
      const x = Math.max(0, cols - line.length - 1);
      g.blank(x - 1, 1 + i, line.length + 2);
      g.text(x, 1 + i, line, Cls.HudDim);
    });
  }
}

function banner(g: Overlay['grid'], rowFromTop: number, text: string, cls: number): void {
  const x = Math.floor((g.cols - text.length) / 2);
  g.blank(x - 2, rowFromTop, text.length + 4);
  g.text(x, rowFromTop, text, cls);
}

function toVec3s(arr: Float32Array): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < arr.length; i += 3) out.push(new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2]));
  return out;
}
