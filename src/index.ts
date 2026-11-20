import pino from "pino";
import { loadConfig } from "./config.js";
import { createSheetsClient } from "./sheets.js";
import { runCycle } from "./scheduler.js";
import { createWaClient } from "./wa.js";

const log = pino({ base: undefined });

const cfg = loadConfig();
log.info(
  { spreadsheet: cfg.spreadsheetId, intervalMs: cfg.pollIntervalMs },
  "config ok",
);

const sheets = await createSheetsClient(cfg);
log.info("google sheets siap");

const wa = await createWaClient(cfg.sessionDir, log);

let running = false;
const tick = async (): Promise<void> => {
  if (running) return;
  running = true;
  try {
    await runCycle({ sheets, wa, log });
  } catch (err) {
    log.error({ err }, "siklus gagal, dicoba lagi interval berikutnya");
  } finally {
    running = false;
  }
};

await tick();
const timer = setInterval(() => void tick(), cfg.pollIntervalMs);

process.on("SIGTERM", () => {
  clearInterval(timer);
  process.exit(0);
});
