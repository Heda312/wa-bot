import "dotenv/config";

export interface Config {
  spreadsheetId: string;
  sheetReminders: string;
  sheetContacts: string;
  timezone: string;
  pollIntervalMs: number;
  googleCredsPath: string;
  sessionDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = ["SPREADSHEET_ID", "GOOGLE_CREDENTIALS_PATH"] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Config kurang: ${missing.join(", ")}. Salin .env.example jadi .env dan isi.`,
    );
  }
  return {
    spreadsheetId: env.SPREADSHEET_ID!,
    sheetReminders: env.SHEET_REMINDERS || "Reminders",
    sheetContacts: env.SHEET_CONTACTS || "Contacts",
    timezone: env.TIMEZONE || "Asia/Jakarta",
    pollIntervalMs: Number(env.POLL_INTERVAL_MINUTES || 1) * 60_000,
    googleCredsPath: env.GOOGLE_CREDENTIALS_PATH!,
    sessionDir: env.SESSION_DIR || "./auth_info",
  };
}
