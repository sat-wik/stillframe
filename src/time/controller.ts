import type { TimeConfig } from './config';

export interface TimeInput {
  /** Normalized walk intent, 0..1. */
  moveMag: number;
  /** Normalized mouse angular speed, 0..1. */
  lookSpeed: number;
  /** Action spike, 1 on fire/punch/grab/throw, decaying to 0. */
  actionPulse: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

export function targetTimeScale(input: TimeInput, cfg: TimeConfig): number {
  const move = clamp(finiteOr(input.moveMag, 0), 0, 1);
  const look = clamp(finiteOr(input.lookSpeed, 0), 0, 1);
  const action = clamp(finiteOr(input.actionPulse, 0), 0, 1);
  const raw = cfg.base + move * cfg.kMove + look * cfg.kLook + action * cfg.kAction;
  return clamp(raw, cfg.floor, 1);
}

/**
 * Eases the time scale toward its target with an exponential filter, using a
 * faster time constant when speeding up than when slowing down, so time never
 * snaps. `realDt` is in seconds of wall-clock time.
 */
export function updateTimeScale(prev: number, input: TimeInput, cfg: TimeConfig, realDt: number): number {
  const target = targetTimeScale(input, cfg);
  const start = clamp(finiteOr(prev, cfg.floor), cfg.floor, 1);
  const dt = Math.max(0, finiteOr(realDt, 0));
  const tauMs = target > start ? cfg.riseMs : cfg.fallMs;
  const k = tauMs <= 0 ? 1 : 1 - Math.exp((-dt * 1000) / tauMs);
  return clamp(start + (target - start) * k, cfg.floor, 1);
}

/** Linear decay of the action spike over `actionDecayMs` of real time. */
export function decayActionPulse(pulse: number, cfg: TimeConfig, realDt: number): number {
  if (cfg.actionDecayMs <= 0) return 0;
  return Math.max(0, pulse - (realDt * 1000) / cfg.actionDecayMs);
}

export function normalizeLookSpeed(radians: number, realDt: number, cfg: TimeConfig): number {
  if (realDt <= 0) return 0;
  return clamp(Math.abs(radians) / realDt / cfg.lookFullSpeed, 0, 1);
}
