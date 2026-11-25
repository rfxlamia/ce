/**
 * Captures a PNG screenshot of a running examples/demo-app (Requirement 2.2).
 * Needs no API key.
 *
 * Start the demo app first (Vite dev server, default http://localhost:5173):
 *   npm run dev --workspace examples/demo-app      (from the repo root)
 *   or: npm run dev                                (from examples/demo-app)
 *
 * Then, from spike/jev-openrouter:
 *   npx tsx fixtures/capture-screenshot.ts http://localhost:5173
 *
 * Chromium must be installed once: npx playwright install chromium
 * Output: spike/jev-openrouter/fixtures/demo-app-screenshot.png
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx fixtures/capture-screenshot.ts <demo-app-url>");
    process.exitCode = 2;
    return;
  }

  const out = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "demo-app-screenshot.png",
  );

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.screenshot({ path: out, type: "png" });
    console.log(`Wrote ${out}`);
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
