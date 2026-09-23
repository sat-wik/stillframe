// Pass 1 writes one RGBA half-float target per pixel: R = lit luminance,
// G = object class / 16, B = linear depth / far. (The spec's three outputs,
// packed into a single target.) Pass 2 turns that into glyphs.

export const SCENE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const SCENE_FRAG = /* glsl */ `
uniform float uClass;
uniform float uBright;
uniform float uFar;
uniform float uFloor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(vec3(0.45, 0.85, 0.3))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.6, 0.25, -0.7))), 0.0);
  float lum = (0.16 + 0.6 * key + 0.24 * fill) * uBright;
  if (uFloor > 0.5) {
    // A 1 m grid on the floor so movement and distance always read.
    vec2 g = abs(fract(vWorld.xz) - 0.5);
    float line = step(0.44, max(g.x, g.y));
    lum = mix(0.1, 0.42, line);
  }
  gl_FragColor = vec4(lum, uClass / 16.0, clamp(vDepth / uFar, 0.0, 1.0), 1.0);
}`;

export const ASCII_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const ASCII_FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uScene;
uniform sampler2D uAtlas;
uniform sampler2D uOverlay;
uniform vec2 uGrid;        // cells (cols, rows)
uniform vec2 uCellPx;      // device pixels per cell
uniform vec2 uResolution;  // device pixels
uniform vec2 uAtlasGrid;
uniform vec3 uPalette[16];
uniform vec3 uTint;
uniform float uFar;
uniform int uView;         // 0 ascii, 1 raw luminance, 2 depth, 3 class id
out vec4 fragColor;

const int RAMP[10] = int[10](0, 14, 26, 13, 29, 11, 10, 3, 5, 32); // " .:-=+*#%@" as glyph indices
const int G_PIPE = 92, G_SLASH = 15, G_DASH = 13, G_BACK = 60;     // | / - \\

vec4 scene(vec2 uv) { return texture(uScene, uv); }
int clsOf(vec4 s) { return int(s.g * 16.0 + 0.5); }

float glyphMask(int g, vec2 local) {
  float col = float(g % 16);
  float row = float(g / 16);
  vec2 uv = (vec2(col, row) + vec2(local.x, 1.0 - local.y)) / uAtlasGrid;
  return texture(uAtlas, uv).r;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (uView > 0) {
    vec4 s = scene(frag / uResolution);
    vec3 c = uView == 1 ? vec3(s.r) : uView == 2 ? vec3(1.0 - s.b) : uPalette[clsOf(s)] * (0.3 + 0.7 * s.r);
    fragColor = vec4(c, 1.0);
    return;
  }

  vec2 cell = floor(frag / uCellPx);
  if (cell.x >= uGrid.x || cell.y >= uGrid.y) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 local = fract(frag / uCellPx);

  // Four samples per cell: average luminance, nearest depth, enemy wins ties.
  vec2 uv = (cell + 0.5) / uGrid;
  vec2 o = 0.25 / uGrid;
  vec4 s0 = scene(uv + vec2(-o.x, -o.y));
  vec4 s1 = scene(uv + vec2( o.x, -o.y));
  vec4 s2 = scene(uv + vec2(-o.x,  o.y));
  vec4 s3 = scene(uv + vec2( o.x,  o.y));
  float lum = (s0.r + s1.r + s2.r + s3.r) * 0.25;
  float depth = min(min(s0.b, s1.b), min(s2.b, s3.b));
  vec4 near = s0;
  if (s1.b < near.b) near = s1;
  if (s2.b < near.b) near = s2;
  if (s3.b < near.b) near = s3;
  int cls = clsOf(near);
  // Priority classes claim the cell if any sample hits them, so thin shapes
  // (a gun barrel, a distant enemy) never vanish in cell averaging. Guns win
  // over the enemy holding them. The viewmodel is always nearest anyway.
  int c0 = clsOf(s0), c1 = clsOf(s1), c2 = clsOf(s2), c3 = clsOf(s3);
  if (cls != 11) {
    if (c0 == 2 || c1 == 2 || c2 == 2 || c3 == 2) cls = 2;
    if (c0 == 10 || c1 == 10 || c2 == 10 || c3 == 10) cls = 10;
  }
  bool vivid = cls == 2 || cls == 10 || cls == 13; // enemies, enemy guns, the player's gun

  // Overlay (bullets, debris, HUD) bypasses the ASCII filter entirely.
  vec4 ov = texelFetch(uOverlay, ivec2(cell), 0);
  int og = int(ov.r * 255.0 + 0.5);
  if (og > 0) {
    float od = ov.b;
    bool onTop = od == 0.0;
    bool visible = onTop || od <= depth + 2.0 / 255.0;
    if (visible) {
      int oc = int(ov.g * 255.0 + 0.5);
      float m = glyphMask(og, local);
      fragColor = vec4(uPalette[oc] * uTint * m * ov.a, 1.0);
      return;
    }
  }

  if (cls == 0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Silhouette edges. Inverse depth is affine across any plane in screen
  // space, so its Laplacian is zero on flat surfaces and strongly negative
  // where this cell sits in front of its neighbors (silhouettes, convex
  // corners). A class change against something farther away is also an edge.
  vec2 cs = 1.0 / uGrid;
  vec4 nL = scene(uv - vec2(cs.x, 0.0));
  vec4 nR = scene(uv + vec2(cs.x, 0.0));
  vec4 nD = scene(uv - vec2(0.0, cs.y));
  vec4 nU = scene(uv + vec2(0.0, cs.y));
  // All edge terms use cell-center samples so they compare like with like.
  vec4 sC = scene(uv);
  int cC = clsOf(sC);
  float iC = 1.0 / max(sC.b, 1e-4);
  float iL = 1.0 / max(nL.b, 1e-4), iR = 1.0 / max(nR.b, 1e-4);
  float iD = 1.0 / max(nD.b, 1e-4), iU = 1.0 / max(nU.b, 1e-4);
  float lx = (iL + iR - 2.0 * iC) / iC;
  float ly = (iD + iU - 2.0 * iC) / iC;
  bool clsEdgeX = (clsOf(nL) != cC && nL.b > sC.b) || (clsOf(nR) != cC && nR.b > sC.b);
  bool clsEdgeY = (clsOf(nD) != cC && nD.b > sC.b) || (clsOf(nU) != cC && nU.b > sC.b);
  float ex = max(-lx, clsEdgeX ? 1.0 : 0.0);
  float ey = max(-ly, clsEdgeY ? 1.0 : 0.0);
  bool edge = cC != 0 && max(ex, ey) > 0.12;
  float gx = iR - iL;
  float gy = iU - iD;

  int g;
  if (edge) {
    if (ex > 2.0 * ey) g = G_PIPE;
    else if (ey > 2.0 * ex) g = G_DASH;
    else g = gx * gy > 0.0 ? G_SLASH : G_BACK;
  } else {
    // Minimum contrast: enemies never go sparse, and enemy guns are always the
    // densest glyphs on screen.
    float l = cls == 10 ? max(lum, 0.85) : vivid ? max(lum, 0.55) : lum;
    g = RAMP[int(clamp(l, 0.0, 0.999) * 10.0)];
  }

  // Depth fog: far cells darken and thin out.
  float meters = depth * uFar;
  float fog = 1.0 - 0.7 * smoothstep(8.0, 45.0, meters);
  float bright = vivid ? max(0.85, fog) : mix(0.45, 1.0, clamp(lum, 0.0, 1.0)) * fog;
  if (edge) bright = max(bright, vivid ? 1.0 : 0.75 * fog);
  float m = glyphMask(g, local);
  fragColor = vec4(uPalette[cls] * uTint * bright * m, 1.0);
}`;
