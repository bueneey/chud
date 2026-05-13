import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const envPath = [join(root, ".env"), join(process.cwd(), ".env"), join(process.cwd(), "..", ".env")].find((p) =>
  existsSync(p)
);
if (envPath) config({ path: envPath });


