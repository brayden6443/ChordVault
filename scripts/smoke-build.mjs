import { access, stat } from "node:fs/promises";

const requiredBuildFiles = ["dist/index.html", "dist/chord.html", "dist/review.html"];

for (const file of requiredBuildFiles) {
  await access(file);
  const details = await stat(file);
  if (!details.isFile() || details.size === 0) {
    throw new Error(`Production build smoke check failed: ${file} is missing or empty.`);
  }
}

console.log(`Production build smoke check passed: ${requiredBuildFiles.join(", ")}`);
