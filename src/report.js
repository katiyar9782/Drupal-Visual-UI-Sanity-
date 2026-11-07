import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
// Keep report markup and its client-side code separately editable.
const template = readFileSync(new URL('./report-template.html', import.meta.url), 'utf8');
import { redact } from './safety.js';
export async function imageData(file) {
  return 'data:image/png;base64,' + (await fs.readFile(file)).toString('base64');
}
export function reportHtml(result) {
  const data = redact(JSON.stringify(result))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  // Callback replacement keeps dollar signs in page content literal.
  return template.replace('"__REPORT_DATA__"', () => data);
}
