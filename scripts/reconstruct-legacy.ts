import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { reconstructLegacyApproved, reconstructionEnvelope } from "../src/chords/legacy-reconstruction.ts";

const args = process.argv.slice(2); const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const inputArg = value("--input"); const outputArg = value("--output-dir"); const dryRun = args.includes("--dry-run");
if (!inputArg || !outputArg) throw new Error("Usage: npm run legacy:reconstruct -- --input <workspace.json> --output-dir <directory> [--dry-run]");
const input = resolve(inputArg); const output = resolve(outputArg); const original = await readFile(input); const raw = JSON.parse(original.toString("utf8")) as unknown;
const result = reconstructLegacyApproved(raw); await mkdir(output, { recursive: true });
const stem = basename(input, ".json"); const backupPath = join(output, `${stem}.untouched.json`); const reportPath = join(output, `${stem}.reconstruction-report.json`);
const unresolvedPath = join(output, `${stem}.unresolved.json`); const importPath = join(output, `${stem}.import-ready.json`);
const reportContents = JSON.stringify(result.report, null, 2); const unresolvedContents = JSON.stringify({ unresolved: result.unresolved, quarantined: result.quarantined }, null, 2);
await writeFile(backupPath, original, { flag: "wx" }); await writeFile(reportPath, reportContents, { encoding: "utf8", flag: "wx" });
await writeFile(unresolvedPath, unresolvedContents, { encoding: "utf8", flag: "wx" });
if (!dryRun && result.report.importReady) await writeFile(importPath, JSON.stringify(reconstructionEnvelope(result, raw as Record<string, unknown>), null, 2), { encoding: "utf8", flag: "wx" });
const files = [backupPath, reportPath, unresolvedPath, ...(!dryRun && result.report.importReady ? [importPath] : [])];
const hashes = Object.fromEntries(await Promise.all(files.map(async (path) => [path, createHash("sha256").update(await readFile(path)).digest("hex")] as const)));
console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "write", input, inputSha256: createHash("sha256").update(original).digest("hex"), importReady: result.report.importReady,
  outputs: files, sha256: hashes, report: result.report, issues: [...result.unresolved, ...result.quarantined] }, null, 2));
if (!result.report.importReady) process.exitCode = 2;
