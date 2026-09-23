import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLevel, type LevelDef } from '../src/content/level';
import type { StepInput } from '../src/sim/types';

const levelsDir = join(import.meta.dirname, '..', 'levels');

export function levelFiles(): string[] {
  return readdirSync(levelsDir).filter((f) => f.endsWith('.json'));
}

export function loadLevel(id: string): LevelDef {
  return parseLevel(JSON.parse(readFileSync(join(levelsDir, `${id}.json`), 'utf8')));
}

export function input(over: Partial<StepInput> = {}): StepInput {
  return { moveX: 0, moveY: 0, yaw: 0, pitch: 0, fire: false, alt: false, ...over };
}

/** A tiny open test room: no geometry beyond the bounds, one wave at start. */
export function testLevel(over: Partial<LevelDef> = {}): LevelDef {
  return parseLevel({
    id: 'test',
    name: 'Test',
    version: 1,
    bounds: { w: 30, d: 30, h: 3 },
    playerSpawn: { pos: { x: 15, y: 0, z: 25 }, yaw: 0 },
    playerWeapon: 'pistol',
    geometry: [],
    props: [],
    enemies: [],
    waves: [{ id: 0, trigger: { kind: 'start' } }],
    ...over,
  });
}
