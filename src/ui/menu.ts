import type { LevelDef } from '../content/level';
import type { SaveData } from '../platform/storage';

// Plain DOM, styled as a terminal. Shown whenever the pointer isn't locked.

const TITLE = String.raw`
 ___ _   _ _ _  __ ___  _   __  __ ___
/ __| |_(_) | |/ _| _ \/_\ |  \/  | __|
\__ \  _| | | |  _|   / _ \| |\/| | _|
|___/\__|_|_|_|_| |_|_\/ \_\_|  |_|___|`;

export class Menu {
  readonly el: HTMLDivElement;
  private list: HTMLDivElement;
  onPlay: () => void = () => {};
  onSelect: (index: number) => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = `
      <pre class="title"></pre>
      <p class="tag">time moves when you move.</p>
      <button class="play">[ click to play ]</button>
      <div class="levels"></div>
      <pre class="help">WASD move    MOUSE aim    LMB fire    RMB punch / grab
SHIFT aim down sights    R restart    N next room    ESC pause    \` debug</pre>`;
    this.el.querySelector('.title')!.textContent = TITLE;
    this.list = this.el.querySelector('.levels')!;
    this.el.querySelector('.play')!.addEventListener('click', () => this.onPlay());
    parent.appendChild(this.el);
  }

  show(levels: LevelDef[], current: number, save: SaveData): void {
    this.list.replaceChildren(
      ...levels.map((lvl, i) => {
        const b = document.createElement('button');
        const best = save.progress.bestGameTime[lvl.id];
        const locked = i >= save.progress.unlocked && !import.meta.env.DEV;
        b.textContent = `${i === current ? '>' : ' '} ${String(i + 1).padStart(2, '0')} ${lvl.name}${best !== undefined ? `  best ${best.toFixed(2)}s` : ''}${locked ? '  [locked]' : ''}`;
        b.disabled = locked;
        b.addEventListener('click', () => this.onSelect(i));
        return b;
      }),
    );
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
