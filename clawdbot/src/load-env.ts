import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const envPath = [
  join(process.cwd(), ".env"),
  join(process.cwd(), "..", ".env"),
  join(process.cwd(), "..", "..", ".env"),
].find((p) => existsSync(p));
if (envPath) config({ path: envPath });
