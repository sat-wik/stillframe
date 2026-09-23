# Stillframe

A first-person browser shooter rendered entirely in ASCII, where time moves
only when you move. Built from the project spec: TypeScript, Vite, and
Three.js, with a custom GPU glyph shader.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

Click to lock the mouse. **WASD** moves, the **mouse** aims, **LMB** fires,
**RMB** punches or grabs a dropped gun, holding **Shift** aims down
the sights, **R** restarts, **N** goes to the
next room after a clear, **Esc** pauses, and **`** toggles the debug overlay
(**V** cycles through the raw 3D, depth and class-ID views).

## Checks

```sh
npm run check            # typecheck + lint + tests + level validation
npm run screenshot       # build, then save a PNG of every level (headless Chromium)
```

## Layout

```
src/sim       PURE  world state, step(), collision, bullets, AI, weapons
src/time      PURE  time controller + tuning constants
src/content   PURE  level schema (Zod), weapon/enemy defs, validation
src/rng       PURE  mulberry32, named streams
src/render          Three.js scene sync, ASCII shader + atlas, overlay/HUD
src/platform        input (pointer lock), storage
src/ui              DOM menu
src/debug           dev overlay stats
levels/             level JSON
tests/              Vitest unit + fast-check property tests
tools/              level validator, screenshot harness
```

The pure core may never import the renderer, platform code, the DOM or
Three.js, and may not call `Math.random` or `Date.now`. ESLint enforces this.

## How it works

- **Time**: every frame, `updateTimeScale` turns movement, look speed and
  action spikes into a `timeScale` in [0.02, 1], eased so it never snaps.
- **Simulation**: `step()` advances exactly 1/120 s of game time. The loop
  runs `realDelta × timeScale` worth of whole steps (capped at 8 per frame)
  and interpolates rendering between steps. Slow motion means fewer steps
  per second, so physics stays stable and runs are reproducible from inputs.
- **Rendering**: the scene renders to a low-resolution half-float target
  (luminance, class ID, linear depth). One full-screen shader maps each cell
  to a glyph from a baked atlas and draws silhouette edges from the Laplacian
  of inverse depth. Bullets, debris and the HUD are written into a per-cell
  overlay texture, so they bypass the ASCII filter and stay visible at every
  distance unless a wall is in front.

## Status

- **M0 (skeleton)**: done.
- **M1 (readability spike)**: done and ready for playtesting. After the first
  review: bigger bullets whose glow grows as they close in, human-shaped
  enemies holding visible guns, a bold crosshair that turns red on target,
  and a first-person view of your gun and fists with recoil, punches and
  muzzle flashes.
- **M2 onward**: see the spec. Throwing, enemy weapon pickup/drop polish,
  replays, the editor and audio are not built yet.
