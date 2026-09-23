import type { LevelDef } from './content/level';
import { debugLines, FrameStats } from './debug/stats';
import { Input } from './platform/input';
import { writeSave, type SaveData } from './platform/storage';
import { Renderer, VIEW_NAMES, type ViewMode } from './render/renderer';
import { step } from './sim/step';
import { STEP_DT, type WorldState } from './sim/types';
import { createWorld } from './sim/world';
import { DEFAULT_TIME_CONFIG, type TimeConfig } from './time/config';
import { decayActionPulse, normalizeLookSpeed, updateTimeScale } from './time/controller';

const MAX_STEPS_PER_FRAME = 8;
const MAX_REAL_DT = 0.1;

/**
 * The frame loop (spec section 3.2): sample input, compute timeScale in real
 * time, run whole fixed steps of game time, then render with interpolation.
 */
export class Game {
  world!: WorldState;
  levelIndex = 0;
  timeScale = DEFAULT_TIME_CONFIG.floor;
  timeConfig: TimeConfig = { ...DEFAULT_TIME_CONFIG };
  paused = true;
  debug = import.meta.env.DEV;
  private pulse = 0;
  private acc = 0;
  private last = 0;
  private stats = new FrameStats();
  private startedAt = 0;
  onPauseChange: (paused: boolean) => void = () => {};

  constructor(
    readonly levels: LevelDef[],
    readonly renderer: Renderer,
    readonly input: Input,
    readonly save: SaveData,
  ) {
    input.on('restart', () => this.restart());
    input.on('next', () => {
      if (this.world.outcome === 'won') this.load(this.levelIndex + 1);
    });
    input.on('debug', () => (this.debug = !this.debug));
    input.on('debugView', () => {
      if (this.debug) this.renderer.viewMode = (((this.renderer.viewMode + 1) % VIEW_NAMES.length) as ViewMode);
    });
    input.onLockChange = (locked) => this.setPaused(!locked);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setPaused(true);
    });
    this.load(0);
  }

  get level(): LevelDef {
    return this.levels[this.levelIndex]!;
  }

  load(index: number): void {
    this.levelIndex = ((index % this.levels.length) + this.levels.length) % this.levels.length;
    this.restart();
  }

  /** Instant restart: rebuild from the level and its seed. Same spawn state every time. */
  restart(): void {
    this.world = createWorld(this.level);
    this.renderer.reset(this.world.seed);
    this.input.setAim(this.level.playerSpawn.yaw, 0);
    this.input.consume();
    this.timeScale = this.timeConfig.floor;
    this.pulse = 0;
    this.acc = 0;
    this.startedAt = performance.now();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.input.clear();
    this.onPauseChange(paused);
  }

  start(): void {
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame((now) => {
      this.last = now;
      loop(now);
    });
  }

  private frame(now: number): void {
    const realDt = Math.min(MAX_REAL_DT, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const w = this.world;
    let steps = 0;
    let gameDt = 0;

    if (!this.paused) {
      const inp = this.input.sample();
      if (inp.newAction) this.pulse = 1;
      const playing = w.outcome === 'playing';
      const moveMag = playing ? Math.min(1, Math.hypot(inp.moveX, inp.moveY)) : 0;
      const lookSpeed = normalizeLookSpeed(inp.lookRadians, realDt, this.timeConfig);
      this.timeScale = updateTimeScale(this.timeScale, { moveMag, lookSpeed, actionPulse: this.pulse }, this.timeConfig, realDt);
      this.pulse = decayActionPulse(this.pulse, this.timeConfig, realDt);

      if (playing) {
        gameDt = realDt * this.timeScale;
        this.acc += gameDt;
        while (this.acc >= STEP_DT && steps < MAX_STEPS_PER_FRAME) {
          const act = this.input.pending();
          const clicked = act.fire || act.alt;
          const events = step(w, {
            moveX: inp.moveX,
            moveY: inp.moveY,
            yaw: clicked ? act.yaw : inp.yaw,
            pitch: clicked ? act.pitch : inp.pitch,
            fire: act.fire,
            alt: act.alt,
          });
          this.input.consume();
          this.renderer.onEvents(events);
          for (const e of events) if (e.type === 'outcome') this.onOutcome(e.outcome);
          this.acc -= STEP_DT;
          steps++;
          if (w.outcome !== 'playing') break;
        }
        if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, STEP_DT);
      } else {
        // Let debris settle after the room ends.
        gameDt = realDt * 0.5;
      }
    }

    this.stats.record(realDt, steps);
    const alpha = w.outcome === 'playing' ? Math.min(1, this.acc / STEP_DT) : 1;
    this.renderer.render(w, alpha, { yaw: this.input.yaw, pitch: this.input.pitch }, gameDt, {
      levelName: this.level.name,
      levelIndex: this.levelIndex,
      levelCount: this.levels.length,
      timeScale: this.timeScale,
      paused: this.paused,
      debugLines: this.debug ? debugLines(w, this.stats, this.timeScale, VIEW_NAMES[this.renderer.viewMode]) : [],
    });
  }

  private onOutcome(outcome: 'won' | 'lost'): void {
    const w = this.world;
    if (outcome === 'lost' && import.meta.env.DEV) {
      // So "I didn't see it" reports become reproducible.
      console.info('[stillframe] killed by', w.killedBy, 'at step', w.step);
    }
    if (outcome !== 'won') return;
    const id = this.level.id;
    const p = this.save.progress;
    const real = (performance.now() - this.startedAt) / 1000;
    p.unlocked = Math.max(p.unlocked, Math.min(this.levels.length, this.levelIndex + 2));
    if (!(p.bestGameTime[id]! <= w.gameTime)) p.bestGameTime[id] = w.gameTime;
    if (!(p.bestRealTime[id]! <= real)) p.bestRealTime[id] = real;
    writeSave(this.save);
  }
}
