import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const files = (await readdir("dist/assets")).filter((name) => name.endsWith(".js"));
const forbidden = [/CLOUDFLARE_API_TOKEN/i, /CLOUDFLARE_API_KEY/i, /ALLOW_ADMIN_MUTATIONS/i, /ACCESS_TEAM_DOMAIN/i, /ACCESS_AUD/i, /ADMIN_EMAILS/i, /00000000-0000-0000-0000-000000000000/i, /database_id/i];
for (const file of files) { const contents = await readFile(join("dist/assets", file), "utf8"); for (const pattern of forbidden) if (pattern.test(contents)) throw new Error(`Forbidden server configuration marker found in client asset ${file}`); }
console.log(`Client bundle secret scan passed: ${files.length} JavaScript assets checked.`);
