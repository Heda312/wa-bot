import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("throw kalau env wajib kurang", () => {
  assert.throws(() => loadConfig({}), /SPREADSHEET_ID/);
  assert.throws(
    () => loadConfig({ SPREADSHEET_ID: "x" }),
    /GOOGLE_CREDENTIALS_PATH/,
  );
});

test("nilai default terisi", () => {
  const c = loadConfig({
    SPREADSHEET_ID: "abc",
    GOOGLE_CREDENTIALS_PATH: "sa.json",
  });
  assert.equal(c.sheetReminders, "Reminders");
  assert.equal(c.sheetContacts, "Contacts");
  assert.equal(c.timezone, "Asia/Jakarta");
  assert.equal(c.pollIntervalMs, 60_000);
  assert.equal(c.sessionDir, "./auth_info");
});

test("interval bisa dioverride", () => {
  const c = loadConfig({
    SPREADSHEET_ID: "abc",
    GOOGLE_CREDENTIALS_PATH: "sa.json",
    POLL_INTERVAL_MINUTES: "5",
  });
  assert.equal(c.pollIntervalMs, 300_000);
});
