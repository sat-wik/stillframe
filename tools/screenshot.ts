// Renders each level at a fixed seed in headless Chromium and saves a PNG of
// the ASCII pass: `npm run screenshot [outDir]`. Groundwork for the visual
// baseline tests in section 7.3.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Game } from '../src/game';

type Win = Window & { stillframe: { game: Game } };

const outDir = process.argv[2] ?? 'test-results/screens';
mkdirSync(outDir, { recursive: true });
const port = 4173;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });

try {
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(500);

  const count = await page.evaluate(() => (window as unknown as Win).stillframe.game.levels.length);
  for (let i = 0; i < count; i++) {
    // Unpause without pointer lock, walk forward briefly so time runs, then freeze.
    await page.evaluate((i) => {
      const g = (window as unknown as Win).stillframe.game;
      g.load(i);
      g.debug = false;
      g.setPaused(false);
      document.querySelector<HTMLElement>('.menu')!.hidden = true;
    }, i);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    const file = join(outDir, `level-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(`saved ${file}`);
  }
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  server.kill();
}
