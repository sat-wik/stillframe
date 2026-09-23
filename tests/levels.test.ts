import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateLevelJson } from '../src/content/validate';
import { levelFiles } from './helpers';

describe('level files', () => {
  it.each(levelFiles())('%s is valid', (file) => {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'levels', file), 'utf8'));
    expect(validateLevelJson(json)).toEqual([]);
  });

  it('rejects a spawn inside geometry', () => {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'levels', levelFiles()[0]!), 'utf8'));
    json.geometry.push({ kind: 'box', min: { ...json.playerSpawn.pos, y: 0 }, max: { x: json.playerSpawn.pos.x + 1, y: 2, z: json.playerSpawn.pos.z + 1 }, solid: true });
    expect(validateLevelJson(json)).toContain('player spawn is inside geometry');
  });
});
