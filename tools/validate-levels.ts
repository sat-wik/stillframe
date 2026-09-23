// CI level validation: `npm run validate-levels`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLevelJson } from '../src/content/validate';

const dir = join(import.meta.dirname, '..', 'levels');
let failed = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
for (const file of files) {
  const errors = validateLevelJson(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (errors.length) {
    failed++;
    console.error(`✗ ${file}`);
    for (const e of errors) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${file}`);
  }
}
if (failed) process.exit(1);
console.log(`${files.length} level(s) valid`);
