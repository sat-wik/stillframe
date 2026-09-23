import * as THREE from 'three';

// One pre-baked font atlas holds every glyph the game draws: the density ramp,
// edge glyphs, printable ASCII for the HUD, and a few custom shapes. Glyph
// index = charCode - 32 for printable ASCII, so index 0 (space) means "empty".

export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 8;
const GW = 32;
const GH = 56;

export const G = {
  BULLET: 95,
  DOT: 96,
  BLOCK: 97,
  SHADE: 98,
  RING: 99,
  HBAR: 100,
  VBAR: 101,
} as const;

export function glyphOf(ch: string): number {
  const c = ch.charCodeAt(0);
  return c >= 32 && c <= 126 ? c - 32 : 0;
}

/** Density ramp from empty to full, darkest first. */
export const RAMP = ' .:-=+*#%@';

export function bakeAtlas(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * GW;
  canvas.height = ATLAS_ROWS * GH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(GH * 0.78)}px "DejaVu Sans Mono", Menlo, Consolas, "Courier New", monospace`;

  const cell = (i: number) => ({ x: (i % ATLAS_COLS) * GW, y: Math.floor(i / ATLAS_COLS) * GH });
  for (let c = 33; c <= 126; c++) {
    const { x, y } = cell(c - 32);
    ctx.fillText(String.fromCharCode(c), x + GW / 2, y + GH / 2 + 2);
  }

  const circle = (i: number, r: number, fill: boolean) => {
    const { x, y } = cell(i);
    ctx.beginPath();
    ctx.arc(x + GW / 2, y + GH / 2, r, 0, Math.PI * 2);
    if (fill) ctx.fill();
    else {
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  };
  // Bullet: a solid disc inside a ring, readable at any distance (open item O4).
  circle(G.BULLET, GW * 0.26, true);
  circle(G.BULLET, GW * 0.44, false);
  circle(G.DOT, GW * 0.16, true);
  circle(G.RING, GW * 0.36, false);
  {
    const { x, y } = cell(G.BLOCK);
    ctx.fillRect(x + 2, y + 4, GW - 4, GH - 8);
  }
  {
    // Thick bars for the crosshair: much heavier than '-' and '|'.
    const h = cell(G.HBAR);
    ctx.fillRect(h.x, h.y + GH * 0.38, GW, GH * 0.24);
    const v = cell(G.VBAR);
    ctx.fillRect(v.x + GW * 0.3, v.y, GW * 0.4, GH);
  }
  {
    const { x, y } = cell(G.SHADE);
    for (let yy = 4; yy < GH - 4; yy += 6) for (let xx = (yy / 6) % 2 ? 2 : 5; xx < GW - 2; xx += 6) ctx.fillRect(x + xx, y + yy, 3, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}
