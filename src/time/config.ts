// Starting constants from the spec (section 2.1). Tune in playtest; the debug
// panel may mutate a copy of this object at runtime.

export interface TimeConfig {
  base: number;
  kMove: number;
  kLook: number;
  kAction: number;
  riseMs: number;
  fallMs: number;
  floor: number;
  /** Mouse angular speed (rad/s) that counts as a full-strength look. */
  lookFullSpeed: number;
  /** Real-time duration over which an action spike decays to zero. */
  actionDecayMs: number;
}

export const DEFAULT_TIME_CONFIG: Readonly<TimeConfig> = {
  base: 0.02,
  kMove: 1.0,
  // Raised from the spec's 0.15 after playtest: scanning the room should move
  // time a little (roughly 0.1–0.3x) while standing still stays at the floor.
  kLook: 0.3,
  kAction: 0.6,
  riseMs: 60,
  fallMs: 150,
  floor: 0.02,
  lookFullSpeed: 3,
  actionDecayMs: 120,
};
