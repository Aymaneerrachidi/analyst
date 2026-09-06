import fs from "node:fs";
import { config } from "dotenv";

async function main() {
  const [walletFile, historyFile, envFile = ".env.local"] = process.argv.slice(2);
  if (!walletFile || !historyFile) throw new Error("Usage: node --conditions=react-server --import tsx scripts/import-defined.ts wallets.json history.json [env-file]");
  config({ path: envFile, quiet: true });
  const { importDefinedSnapshot } = await import("../lib/services/defined-import");
  console.log(await importDefinedSnapshot(JSON.parse(fs.readFileSync(walletFile, "utf8")), JSON.parse(fs.readFileSync(historyFile, "utf8"))));
}
main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "Import failed"); process.exit(1); });
