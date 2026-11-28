/**
 * Page shell of report.html: <head> (charset, CSP, title, one <style>), skip link,
 * <header> with the one Logo_Image, the level 1 title, <main> holding the seven sections,
 * the signal note, the in-page <nav>, and the one inline <script> (Copy JSON only).
 *
 * Pure and total: no I/O, no clock, no environment. The Outcome is read from the
 * Run_Record as data; nothing here decides or names one.
 *
 * The note below is the only visible text of the page that uses the words
 * "verdict" and "correct", and it says classifier values are not one (Requirement 11).
 */
import type { RunRecord } from '../schema.js';
import { escapeAttr, escapeHtml } from './escape.js';
import { LOGO_ALT, LOGO_DATA_URI, LOGO_HEIGHT, LOGO_WIDTH } from './logo.js';
import { PALETTE } from './palette.js';
import { BANNER_CSS } from './sections/banner.js';

/** The seven rendered sections, each already a complete HTML string. */
export interface SectionsHtml {
  banner: string;
  claims: string;
  assessment: string;
  timeline: string;
  final: string;
  logs: string;
  raw: string;
}

/** The one Content-Security-Policy of the page: no network origin. */
export const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:";

/** In-page navigation, in section order (Requirement 2). */
const NAV: readonly { id: string; label: string }[] = [
  { id: 'banner', label: 'Outcome' },
  { id: 'claims', label: 'Claims' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'final', label: 'Final screenshot' },
  { id: 'logs', label: 'Logs' },
  { id: 'raw', label: 'Raw run.json' },
];

const SIGNAL_NOTE =
  '<p class="note" role="note"><strong>How to read the numbers.</strong> Every probability on this page is a ' +
  "<strong>signal</strong>: the classifier's reading of the input. It is not a verdict on whether the software " +
  'is correct. The Assessment decides whether runtime Evidence is needed, not whether the Change is correct.</p>';

/** Enhancement only: the page is fully readable without this. */
const COPY_SCRIPT =
  "document.getElementById('copy').addEventListener('click', function () {\n" +
  "  var pre = document.getElementById('rawjson');\n" +
  '  if (navigator.clipboard && pre) { navigator.clipboard.writeText(pre.textContent); }\n' +
  '});';

function rootVariables(): string {
  const p = PALETTE;
  const tones = Object.entries(p.outcomeTones)
    .map(([name, value]) => `--tone-${name.toLowerCase()}:${value};`)
    .join(' ');
  return (
    ':root{' +
    `--bg:${p.bg}; --surface:${p.surface}; --surface-2:${p.surface2}; --border:${p.border}; ` +
    `--text:${p.text}; --muted:${p.muted}; --link:${p.link}; --focus:${p.focus}; ` +
    `${tones} --bar:${p.bar}; --bar-track:${p.barTrack}; --box:${p.box};` +
    '}'
  );
}

/** Section styles: every class name documented by the section modules. */
const SECTION_CSS = [
  // base
  '*{box-sizing:border-box}',
  'html{color-scheme:dark}',
  'body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:break-word}',
  'a{color:var(--link)}',
  // type scale: h1 1.8rem > h2 1.44rem > h3 1.1rem > body 1rem
  'h1{font-size:1.8rem;line-height:1.15;font-weight:700;margin:0}',
  'h2{font-size:1.44rem;line-height:1.25;font-weight:700;margin:0 0 .75rem}',
  'h3{font-size:1.1rem;line-height:1.3;font-weight:650;margin:0 0 .35rem}',
  // focus
  'a:focus-visible,summary:focus-visible,button:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:3px}',
  // skip link
  '.skip{position:absolute;left:-999px;top:0;background:var(--focus);color:#000;padding:.5rem 1rem;z-index:10}',
  '.skip:focus{left:0}',
  '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  // layout
  '.wrap{max-width:62rem;margin:0 auto;padding:0 1rem 4rem}',
  'header.top{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem;padding:1.1rem 0 .2rem}',
  'header.top img{width:7.5rem;max-width:100%;height:auto;flex:none}',
  'header.top h1{min-width:0;flex:1 1 14rem}',
  'header.top h1 span{display:block;font-size:.88rem;font-weight:400;color:var(--muted);margin-top:.15rem}',
  'main>section{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.1rem 1.25rem;margin:1.1rem 0;min-width:0}',
  'main>section.banner{margin:1.1rem 0}',
  '.muted{color:var(--muted)}',
  '.mono,code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88rem}',
  '.mono{overflow-wrap:anywhere}',
  // note and nav
  '.note{border:1px dashed var(--border);border-radius:8px;padding:.7rem 1rem;color:var(--muted);margin:1.1rem 0;max-width:75ch}',
  '.note strong{color:var(--text)}',
  'nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.4rem}',
  'nav a{display:inline-block;padding:.25rem .7rem;border:1px solid var(--border);border-radius:999px;text-decoration:none}',
  'nav a:hover{background:var(--surface-2)}',
  // chips and signal tags
  '.chip{display:inline-block;border:1px solid var(--border);border-radius:999px;padding:0 .6rem;font-size:.8rem;color:var(--text);background:var(--surface-2);margin-right:.35rem;overflow-wrap:anywhere}',
  '.chip b{color:var(--link);font-weight:600}',
  '.tag-signal{display:inline-block;font-size:.72rem;font-weight:500;text-transform:uppercase;letter-spacing:.07em;color:var(--bar);border:1px solid var(--bar);border-radius:4px;padding:0 .35rem;margin-left:.4rem;white-space:nowrap}',
  // claims
  '.claim{border-bottom:1px solid var(--border);padding:.75rem 0}',
  '.claim-text{margin:.1rem 0 .4rem;max-width:75ch}',
  '.claim-declared,.no-claim,.context-reduction,.context-null{margin:.4rem 0}',
  '.candidates{margin:.6rem 0}',
  '.candidates .claim:last-child{border-bottom:0}',
  // bars
  '.bar{display:grid;grid-template-columns:minmax(8rem,16rem) 1fr 3.2rem;gap:.6rem;align-items:center;margin:.2rem 0}',
  '.bar .lbl{min-width:0;overflow-wrap:anywhere}',
  '.bar .track{height:.7rem;background:var(--bar-track);border-radius:99px;overflow:hidden;border:1px solid var(--border)}',
  '.bar .fill{height:100%;background:var(--bar)}',
  '.bar .val{text-align:right;font-variant-numeric:tabular-nums}',
  '.bar.chosen .fill{background:var(--tone-evidenced)}',
  '.bar.no-answer{grid-template-columns:minmax(8rem,16rem) 1fr}',
  '.bar.no-answer .val{text-align:left;color:var(--muted)}',
  // assessment
  '.q{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:.8rem 1rem;margin:.7rem 0}',
  '.q blockquote,.q-text{margin:.3rem 0 .7rem;padding:.55rem .8rem;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)}',
  '.q-noanswer{margin:.3rem 0}',
  // tables
  'table{border-collapse:collapse;width:100%}',
  'th,td{text-align:left;padding:.3rem .6rem;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}',
  'th{color:var(--muted);font-weight:600;font-size:.85rem}',
  '.files,.checks,.per-claim,.assessment-summary,.event-log{margin:.5rem 0}',
  // timeline
  'ol.steps{list-style:none;margin:0;padding:0}',
  'ol.steps>li{display:grid;grid-template-columns:15rem minmax(0,1fr);gap:1rem;padding:1rem 0;border-bottom:1px solid var(--border)}',
  'ol.steps>li:last-child{border-bottom:0}',
  '.shot{display:block;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--surface-2);line-height:0}',
  '.shot img{display:block;width:100%;max-width:100%;height:auto}',
  '.step-body{min-width:0}',
  '.step-body p{margin:.1rem 0}',
  '.stepno{display:inline-block;min-width:1.8rem;text-align:center;background:var(--bar);color:#000;border-radius:5px;font-weight:700;margin-right:.4rem}',
  '.exec-yes{color:var(--tone-evidenced)}',
  '.exec-no{color:var(--tone-error)}',
  '.refusal{margin:.3rem 0}',
  '.alt{display:flex;flex-wrap:wrap;align-items:center;gap:.2rem .6rem}',
  '.alt .bar{flex:1 1 20rem}',
  '.taken-mark{color:var(--tone-evidenced);font-weight:600}',
  '.no-alternatives,.empty,.no-final,.no-events,.no-log-artifacts{color:var(--muted);margin:.4rem 0}',
  'details{margin:.4rem 0}',
  'summary{cursor:pointer;color:var(--link)}',
  // final
  '.final{position:relative;display:block;max-width:34rem;border:1px solid var(--border);border-radius:6px;overflow:hidden;line-height:0}',
  '.final img{display:block;width:100%;max-width:100%;height:auto}',
  '.box{position:absolute;border:3px solid var(--box);box-shadow:0 0 0 1px #000;pointer-events:none}',
  '.box-coords,.no-box{margin:.5rem 0}',
  '.final-error{border:1px solid var(--tone-error);border-radius:6px;padding:.5rem .8rem;margin:.5rem 0}',
  // logs
  '.stop-reason,.jev-calls-note,.stage-durations,.jev-config,.settings{margin:.5rem 0}',
  '.log-artifacts{padding-left:1.2rem;margin:.5rem 0}',
  '.artifact-note{color:var(--muted)}',
  '.jev-models ul{margin:.2rem 0;padding-left:1.2rem}',
  // raw
  'pre{background:#010409;border:1px solid var(--border);border-radius:8px;padding:1rem;overflow:auto;max-height:26rem;margin:.5rem 0 0;max-width:100%}',
  'button{background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:.3rem .8rem;font:inherit;cursor:pointer}',
  // small viewports and motion
  '@media (max-width:640px){',
  '  ol.steps>li{grid-template-columns:minmax(0,1fr)}',
  '  .bar{grid-template-columns:minmax(0,1fr) 3.2rem}',
  '  .bar .track{grid-column:1/-1;grid-row:2}',
  '  .bar.no-answer{grid-template-columns:minmax(0,1fr)}',
  '}',
  '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}',
].join('\n');

function css(): string {
  return [rootVariables(), SECTION_CSS, BANNER_CSS].join('\n');
}

function navHtml(): string {
  const items = NAV.map((n) => `<li><a href="#${escapeAttr(n.id)}">${escapeHtml(n.label)}</a></li>`).join('');
  return `<nav aria-label="Report sections"><ul>${items}</ul></nav>`;
}

/** The complete report.html text for one record and its seven rendered sections. */
export function renderDocument(record: RunRecord, sections: SectionsHtml): string {
  const started = record.timings.startedAt;
  const title = `${record.outcome} · CE run ${started}`;
  const logo =
    `<img src="${escapeAttr(LOGO_DATA_URI)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="${escapeAttr(LOGO_ALT)}">`;
  return (
    '<!doctype html>\n' +
    '<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>\n${css()}\n</style>\n` +
    '</head>\n<body>\n' +
    '<a class="skip" href="#main">Skip to content</a>\n' +
    '<div class="wrap">\n' +
    `<header class="top">${logo}<h1>Evidence report<span class="mono">run ${escapeHtml(started)}</span></h1></header>\n` +
    '<main id="main">\n' +
    `${sections.banner}\n${SIGNAL_NOTE}\n${navHtml()}\n` +
    `${sections.claims}\n${sections.assessment}\n${sections.timeline}\n` +
    `${sections.final}\n${sections.logs}\n${sections.raw}\n` +
    '</main>\n</div>\n' +
    `<script>\n${COPY_SCRIPT}\n</script>\n` +
    '</body>\n</html>\n'
  );
}
