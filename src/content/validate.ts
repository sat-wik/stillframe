import { ENEMIES, PLAYER } from './defs';
import { safeParseLevel, type LevelDef } from './level';
import { capsuleOverlapsLevel } from '../sim/collision';
import type { Box, Cylinder } from '../sim/types';

// Pure level checks shared by the CI script and the tests (spec section 6.3).
// Reachability and solution-replay checks arrive with the editor in M4.

export function validateLevelJson(json: unknown): string[] {
  const parsed = safeParseLevel(json);
  if (!parsed.success) return parsed.error.issues.map((i) => `schema: ${i.path.join('.')}: ${i.message}`);
  return validateLevel(parsed.data);
}

export function validateLevel(level: LevelDef): string[] {
  const errors: string[] = [];
  const boxes: Box[] = [];
  const cylinders: Cylinder[] = [];
  for (const g of level.geometry) {
    if (g.kind === 'box' && g.solid) boxes.push(g);
    if (g.kind === 'cylinder') cylinders.push(g);
  }
  const inBounds = (p: { x: number; z: number }, r: number) => p.x >= r && p.z >= r && p.x <= level.bounds.w - r && p.z <= level.bounds.d - r;

  const sp = level.playerSpawn.pos;
  if (!inBounds(sp, PLAYER.radius)) errors.push('player spawn is outside the level bounds');
  if (capsuleOverlapsLevel(sp, PLAYER.radius, PLAYER.height, boxes, cylinders)) errors.push('player spawn is inside geometry');

  level.enemies.forEach((e, i) => {
    const def = ENEMIES[e.kind];
    if (!inBounds(e.pos, def.radius)) errors.push(`enemy ${i} (${e.kind}) is outside the level bounds`);
    if (capsuleOverlapsLevel(e.pos, def.radius, def.height, boxes, cylinders)) errors.push(`enemy ${i} (${e.kind}) spawns inside geometry`);
  });
  level.props.forEach((p, i) => {
    if (!inBounds(p.pos, 0)) errors.push(`prop ${i} is outside the level bounds`);
    if (p.kind === 'gun' && !p.weapon) errors.push(`prop ${i} is a gun with no weapon`);
  });
  if (level.enemies.length === 0) errors.push('level has no enemies, so it can never be won');
  return errors;
}
