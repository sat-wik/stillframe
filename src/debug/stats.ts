import type { WorldState } from '../sim/types';

/** Rolling frame statistics for the dev overlay (backtick). */
export class FrameStats {
  private dts: number[] = [];
  private steps: number[] = [];

  record(dt: number, steps: number): void {
    this.dts.push(dt);
    this.steps.push(steps);
    if (this.dts.length > 60) {
      this.dts.shift();
      this.steps.shift();
    }
  }

  get fps(): number {
    const sum = this.dts.reduce((a, b) => a + b, 0);
    return sum > 0 ? this.dts.length / sum : 0;
  }

  get maxSteps(): number {
    return Math.max(0, ...this.steps);
  }

  get lastSteps(): number {
    return this.steps[this.steps.length - 1] ?? 0;
  }
}

export function debugLines(w: WorldState, s: FrameStats, timeScale: number, view: string): string[] {
  const states = w.enemies.map((e) => `${e.kind[0]}${e.id}:${e.ai.state}${e.ai.hasLos ? '*' : ''}`);
  return [
    `fps ${s.fps.toFixed(0)}  steps ${s.lastSteps} (max ${s.maxSteps})`,
    `timeScale ${timeScale.toFixed(3)}  step ${w.step}  t ${w.gameTime.toFixed(2)}s`,
    `enemies ${w.enemies.length}  bullets ${w.bullets.length}  props ${w.props.length}`,
    `rng ai ${w.rng.ai.state.toString(16)} spread ${w.rng.spread.state.toString(16)}`,
    `view ${view} [V]`,
    ...states,
  ];
}
