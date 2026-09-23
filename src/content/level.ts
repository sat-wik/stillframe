import { z } from 'zod';

// Level format (spec section 6.1). Levels are primitives only, so a file is a
// few kilobytes and diffs cleanly.

const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
const weaponId = z.enum(['pistol', 'shotgun']);
const enemyKind = z.enum(['grunt', 'gunner', 'heavy']);

const box = z.object({ kind: z.literal('box'), min: vec3, max: vec3, solid: z.boolean() });
const cylinder = z.object({ kind: z.literal('cylinder'), center: vec3, r: z.number().positive(), h: z.number().positive() });

const trigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start') }),
  z.object({ kind: z.literal('killed'), count: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('zone'), min: vec3, max: vec3 }),
]);

export const LevelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    bounds: z.object({ w: z.number().positive(), d: z.number().positive(), h: z.number().positive() }),
    playerSpawn: z.object({ pos: vec3, yaw: z.number() }),
    playerWeapon: weaponId.nullable(),
    geometry: z.array(z.discriminatedUnion('kind', [box, cylinder])),
    props: z.array(z.object({ kind: z.enum(['bottle', 'chair', 'gun']), pos: vec3, weapon: weaponId.optional() })),
    enemies: z.array(z.object({ kind: enemyKind, pos: vec3, yaw: z.number(), weapon: weaponId.nullable(), wave: z.number().int() })),
    waves: z.array(z.object({ id: z.number().int(), trigger })),
    parTimeSec: z.number().positive().optional(),
  })
  .superRefine((lvl, ctx) => {
    const waveIds = new Set(lvl.waves.map((w) => w.id));
    lvl.enemies.forEach((e, i) => {
      if (!waveIds.has(e.wave)) ctx.addIssue({ code: 'custom', path: ['enemies', i, 'wave'], message: `unknown wave ${e.wave}` });
    });
    lvl.geometry.forEach((g, i) => {
      if (g.kind === 'box' && (g.min.x >= g.max.x || g.min.y >= g.max.y || g.min.z >= g.max.z)) {
        ctx.addIssue({ code: 'custom', path: ['geometry', i], message: 'box min must be below max on every axis' });
      }
    });
  });

export type LevelDef = z.infer<typeof LevelSchema>;
export type LevelGeometry = LevelDef['geometry'][number];
export type WaveTrigger = LevelDef['waves'][number]['trigger'];

export function parseLevel(json: unknown): LevelDef {
  return LevelSchema.parse(json);
}

export function safeParseLevel(json: unknown) {
  return LevelSchema.safeParse(json);
}
