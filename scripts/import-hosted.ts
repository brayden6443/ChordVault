import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { backupThenUpload, prepareHostedImport, uploadPreparedImport } from "../src/chords/hosted-import.ts";

const args = process.argv.slice(2); const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const input = value("--input"); const apiBase = value("--api"); const apply = args.includes("--apply");
if (!input) throw new Error("Usage: npm run hosted:import -- --input <backup.json> [--api http://localhost:8787/api] [--apply]");
const inputPath = resolve(input); const rawText = await readFile(inputPath, "utf8"); let raw: unknown;
try { raw = JSON.parse(rawText); } catch { throw new Error("Input backup is not valid JSON."); }
const prepared = prepareHostedImport(raw); const backupPath = `${inputPath}.pre-hosted-import.${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
if (!apiBase) { await writeFile(backupPath, prepared.backup, { encoding: "utf8", flag: "wx" }); console.log(JSON.stringify({ mode: "validation-only", backupPath, ...prepared.report }, null, 2)); process.exit(0); }
const response = await backupThenUpload(prepared, () => writeFile(backupPath, prepared.backup, { encoding: "utf8", flag: "wx" }), () => uploadPreparedImport(prepared, { apiBase, dryRun: !apply }));
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", backupPath, localValidation: prepared.report, hosted: response }, null, 2));
