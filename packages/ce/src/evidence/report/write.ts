import path from 'node:path';
import { REPORT_HTML_FILE, type BundleFs } from '../bundle.js';

const REPORT_HTML_TMP_FILE = `${REPORT_HTML_FILE}.tmp`;

/** The file system operations the report writer needs. `BundleFs` satisfies it. */
export type ReportFs = Pick<BundleFs, 'writeFile' | 'rename' | 'rm'>;

/**
 * Writes `report.html.tmp`, then renames it to `report.html`, so a reader never sees a partial report.
 * Writes only inside `runDir`, under fixed file names. On failure the temp file is removed
 * (best effort) and the original error is rethrown. The caller decides what a failure means.
 */
export async function writeReportFile(runDir: string, text: string, fs: ReportFs): Promise<void> {
  const tmp = path.join(runDir, REPORT_HTML_TMP_FILE);
  const target = path.join(runDir, REPORT_HTML_FILE);
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
  } catch (cause) {
    try {
      await fs.rm(tmp, { force: true });
    } catch {
      // best effort: the original failure is the one that matters
    }
    throw cause;
  }
}
