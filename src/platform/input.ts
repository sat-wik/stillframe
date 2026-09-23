// Pointer-lock mouse look plus layout-independent keys (KeyboardEvent.code).
// Mouse look turns the camera at real speed; the sim only reads the result.

export interface Bindings {
  forward: string;
  back: string;
  left: string;
  right: string;
  restart: string;
  next: string;
  debug: string;
  debugView: string;
  aim: string;
}

export const DEFAULT_BINDINGS: Bindings = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  restart: 'KeyR',
  next: 'KeyN',
  debug: 'Backquote',
  debugView: 'KeyV',
  aim: 'ShiftLeft',
};

export interface FrameInput {
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  /** Radians the view turned since the last sample (for the time controller). */
  lookRadians: number;
  /** True on the frame a fire/alt press first arrives. */
  newAction: boolean;
  /** Aim-down-sights key held. */
  aim: boolean;
}

export interface LatchedAction {
  fire: boolean;
  alt: boolean;
  /** Aim at the moment of the click, so a slow-motion shot goes where you clicked. */
  yaw: number;
  pitch: number;
}

const MAX_PITCH = 1.45;

export class Input {
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0022;
  /** Extra look scale, e.g. slower while aiming down sights. */
  lookScale = 1;
  bindings: Bindings = { ...DEFAULT_BINDINGS };
  private keys = new Set<string>();
  private look = 0;
  private latch: LatchedAction = { fire: false, alt: false, yaw: 0, pitch: 0 };
  private fresh = false;
  private onKey = new Map<string, () => void>();
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKey.get(e.code)?.();
      if (Object.values(this.bindings).includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = e.movementX * this.sensitivity * this.lookScale;
      const dy = e.movementY * this.sensitivity * this.lookScale;
      this.yaw -= dx;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy));
      this.look += Math.hypot(dx, dy);
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.latch.fire = true;
      else if (e.button === 2) this.latch.alt = true;
      else return;
      this.latch.yaw = this.yaw;
      this.latch.pitch = this.pitch;
      this.fresh = true;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.keys.clear();
      this.onLockChange(this.locked);
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestLock(): void {
    const req = this.target.requestPointerLock() as unknown;
    if (req instanceof Promise) req.catch(() => {});
  }

  on(action: keyof Bindings, fn: () => void): void {
    this.onKey.set(this.bindings[action], fn);
  }

  setAim(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  sample(): FrameInput {
    const b = this.bindings;
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    const out: FrameInput = {
      moveX: k(b.right) - k(b.left),
      moveY: k(b.forward) - k(b.back),
      yaw: this.yaw,
      pitch: this.pitch,
      lookRadians: this.look,
      newAction: this.fresh,
      // Either Shift key aims.
      aim: this.keys.has(b.aim) || (b.aim === 'ShiftLeft' && this.keys.has('ShiftRight')),
    };
    this.look = 0;
    this.fresh = false;
    return out;
  }

  /** The pending click, if any. Stays latched until a sim step consumes it. */
  pending(): LatchedAction {
    return this.latch;
  }

  consume(): void {
    this.latch.fire = false;
    this.latch.alt = false;
  }

  clear(): void {
    this.consume();
    this.keys.clear();
  }
}
