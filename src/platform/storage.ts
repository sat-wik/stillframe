// Versioned progress + settings blob in localStorage (spec section 7.1), with
// migrations from day one. Storage can be missing or throw; the game must run
// without it.

export interface SaveData {
  version: 1;
  settings: {
    sensitivity: number;
    cellW: number;
    cellH: number;
    threatHighlight: boolean;
    fov: number;
  };
  progress: {
    unlocked: number;
    bestGameTime: Record<string, number>;
    bestRealTime: Record<string, number>;
  };
}

const KEY = 'stillframe.save';

export const DEFAULT_SAVE: SaveData = {
  version: 1,
  settings: { sensitivity: 0.0022, cellW: 8, cellH: 14, threatHighlight: true, fov: 75 },
  progress: { unlocked: 1, bestGameTime: {}, bestRealTime: {} },
};

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;
/** migrations[n] upgrades a version-n blob to version n+1. */
const migrations: Record<number, Migration> = {};

export function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_SAVE);
  let data = raw as Record<string, unknown>;
  let v = typeof data.version === 'number' ? data.version : 0;
  while (v < DEFAULT_SAVE.version) {
    const m = migrations[v];
    if (!m) return structuredClone(DEFAULT_SAVE);
    data = m(data);
    v++;
  }
  const d = data as Partial<SaveData>;
  return {
    version: 1,
    settings: { ...DEFAULT_SAVE.settings, ...(d.settings ?? {}) },
    progress: { ...DEFAULT_SAVE.progress, ...(d.progress ?? {}) },
  };
}

export function loadSave(): SaveData {
  try {
    const s = localStorage.getItem(KEY);
    return migrate(s ? JSON.parse(s) : null);
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode or full storage: progress just won't persist.
  }
}
