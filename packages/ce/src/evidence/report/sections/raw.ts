/**
 * Raw_Section: the full Run_Record as pretty-printed JSON inside a closed <details>.
 * Pure. Decides no Outcome. The "Copy JSON" click handler lives in document.ts and
 * finds the button by `id="copy"` / `data-copy-target="rawjson"`.
 */
import type { RunRecord } from '../../schema.js';
import { hrefFor, rawJsonScriptSafe } from '../escape.js';

export function renderRaw(record: RunRecord): string {
  const json = rawJsonScriptSafe(JSON.stringify(record, null, 2));
  return (
    `<section id="raw" aria-labelledby="h-raw">` +
    `<h2 id="h-raw">Raw run.json</h2>` +
    `<details>` +
    `<summary>Show the full record (<a href="${hrefFor('run.json')}">run.json</a>)</summary>` +
    `<button type="button" id="copy" data-copy-target="rawjson">Copy JSON</button>` +
    `<pre id="rawjson">${json}</pre>` +
    `</details>` +
    `</section>`
  );
}
