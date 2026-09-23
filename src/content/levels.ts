import { parseLevel, type LevelDef } from './level';

/** Parses and orders raw level JSON by id. Pure: the caller supplies the files. */
export function loadLevels(files: Record<string, unknown>): LevelDef[] {
  return Object.entries(files)
    .map(([path, json]) => {
      try {
        return parseLevel(json);
      } catch (err) {
        throw new Error(`Invalid level ${path}: ${String(err)}`, { cause: err });
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
