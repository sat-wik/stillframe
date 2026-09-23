import './style.css';
import { loadLevels } from './content/levels';
import { Game } from './game';
import { Input } from './platform/input';
import { loadSave } from './platform/storage';
import { Renderer } from './render/renderer';
import { Menu } from './ui/menu';

const levels = loadLevels(import.meta.glob('../levels/*.json', { eager: true, import: 'default' }));
const save = loadSave();

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const renderer = new Renderer(canvas, { ...save.settings });
renderer.updateSettings({});
const input = new Input(canvas);
input.sensitivity = save.settings.sensitivity;

const game = new Game(levels, renderer, input, save);
const menu = new Menu(document.body);
menu.onPlay = () => input.requestLock();
menu.onSelect = (i) => {
  game.load(i);
  input.requestLock();
};
game.onPauseChange = (paused) => (paused ? menu.show(levels, game.levelIndex, save) : menu.hide());
canvas.addEventListener('click', () => {
  if (!input.locked) input.requestLock();
});
window.addEventListener('resize', () => renderer.resize());

menu.show(levels, game.levelIndex, save);
game.start();

// Handy in the console while tuning: stillframe.game.timeConfig.kLook = 0.3
Object.assign(window, { stillframe: { game } });
