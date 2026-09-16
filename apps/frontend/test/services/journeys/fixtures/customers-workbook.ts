import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Builds a real, synthetic .xlsx workbook for the import journey tests using openpyxl (the
 *  same library apps/api/main.py reads workbooks with) via a short-lived Python subprocess --
 *  reusing an already-installed backend dependency instead of adding a JS xlsx-writing package
 *  for one test fixture. Rows are plain records of column -> value; the first row's keys become
 *  the header row. */
export function buildWorkbookFile(filename: string, rows: Record<string, string>[]): File {
  const dir = mkdtempSync(join(tmpdir(), "call-center-workbook-"));
  const path = join(dir, filename);
  const headers = Object.keys(rows[0] ?? { bcn: "", customer_name: "", phone: "" });
  const script = `
import json, sys
from openpyxl import Workbook
headers = json.loads(sys.argv[1])
rows = json.loads(sys.argv[2])
wb = Workbook()
ws = wb.active
ws.append(headers)
for row in rows:
    ws.append([row.get(h, "") for h in headers])
wb.save(sys.argv[3])
`;
  const result = spawnSync("python3", ["-c", script, JSON.stringify(headers), JSON.stringify(rows), path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Failed to build synthetic workbook: ${result.stderr}`);
  const bytes = readFileSync(path);
  rmSync(dir, { recursive: true, force: true });
  return new File([bytes], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
