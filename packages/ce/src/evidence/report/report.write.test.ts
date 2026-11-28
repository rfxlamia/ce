import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_HTML_FILE } from "../bundle.js";
import { writeReportFile, type ReportFs } from "./write.js";

const RUN_DIR = path.join(path.sep, "runs", "run-1");

interface FakeOptions {
  failWrite?: boolean;
  failRename?: boolean;
  failRm?: boolean;
}

function makeFs(opts: FakeOptions = {}) {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const fs: ReportFs = {
    async writeFile(file, data) {
      calls.push(`write:${file}`);
      if (opts.failWrite) {
        files.set(file, data.slice(0, 1)); // a partial file is left behind
        throw new Error("write failed");
      }
      files.set(file, data);
    },
    async rename(from, to) {
      calls.push(`rename:${from}->${to}`);
      if (opts.failRename) throw new Error("rename rejected");
      const data = files.get(from);
      if (data === undefined) throw new Error("ENOENT");
      files.delete(from);
      files.set(to, data);
    },
    async rm(file) {
      calls.push(`rm:${file}`);
      if (opts.failRm) throw new Error("rm failed");
      files.delete(file);
    },
  };
  return { fs, files, calls };
}

const TMP = path.join(RUN_DIR, `${REPORT_HTML_FILE}.tmp`);
const TARGET = path.join(RUN_DIR, REPORT_HTML_FILE);

describe("writeReportFile", () => {
  it("writes the tmp file, then renames it to report.html", async () => {
    const { fs, files, calls } = makeFs();
    await writeReportFile(RUN_DIR, "<html>ok</html>", fs);
    expect(calls).toEqual([`write:${TMP}`, `rename:${TMP}->${TARGET}`]);
    expect([...files.keys()]).toEqual([TARGET]);
    expect(files.get(TARGET)).toBe("<html>ok</html>");
  });

  it("leaves no report.html and no tmp when the tmp write fails, and rethrows", async () => {
    const { fs, files } = makeFs({ failWrite: true });
    await expect(writeReportFile(RUN_DIR, "<html>x</html>", fs)).rejects.toThrow("write failed");
    expect(files.has(TARGET)).toBe(false);
    expect(files.has(TMP)).toBe(false);
  });

  it("removes the tmp file and rethrows the one injected rename rejection", async () => {
    const { fs, files, calls } = makeFs({ failRename: true });
    await expect(writeReportFile(RUN_DIR, "<html>x</html>", fs)).rejects.toThrow("rename rejected");
    expect(calls.filter((c) => c.startsWith("rename:"))).toHaveLength(1);
    expect(files.has(TARGET)).toBe(false);
    expect(files.has(TMP)).toBe(false);
  });

  it("rethrows the original error when cleanup also fails", async () => {
    const { fs } = makeFs({ failRename: true, failRm: true });
    await expect(writeReportFile(RUN_DIR, "x", fs)).rejects.toThrow("rename rejected");
  });

  it("touches only the two fixed paths inside runDir", async () => {
    for (const opts of [{}, { failRename: true }, { failWrite: true }]) {
      const { fs, calls } = makeFs(opts);
      await writeReportFile(RUN_DIR, "x", fs).catch(() => undefined);
      const paths = calls.flatMap((c) => c.replace(/^\w+:/, "").split("->"));
      for (const p of paths) {
        expect(path.dirname(p)).toBe(RUN_DIR);
        expect([TMP, TARGET]).toContain(p);
      }
    }
  });
});
