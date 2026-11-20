import { readFileSync, statSync } from "node:fs";
import { google } from "googleapis";
import type { Config } from "./config.js";
import { normalizePhone } from "./template.js";

export interface ReminderRow {
  rowIndex: number;
  id: string;
  pic: string;
  task: string;
  sendAt: Date | null;
  message: string;
  status: string;
}

const REMINDER_HEADERS = [
  "ID Tugas",
  "PIC Role",
  "Nama Tugas",
  "Waktu Kirim",
  "Pesan Reminder",
  "Status Kirim",
  "Waktu Terkirim",
] as const;

export function parseSendTime(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const unixMs = Math.round((value - 25569) * 86_400_000);
    const utc = new Date(unixMs);
    return new Date(
      utc.getUTCFullYear(),
      utc.getUTCMonth(),
      utc.getUTCDate(),
      utc.getUTCHours(),
      utc.getUTCMinutes(),
      utc.getUTCSeconds(),
    );
  }
  if (typeof value === "string" && value.trim() !== "") {
    const m = value
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (m) {
      return new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
      );
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

export function parseReminders(values: unknown[][]): ReminderRow[] {
  const header = (values[0] ?? []).map(str);
  const idx = REMINDER_HEADERS.map((h) => header.indexOf(h));
  if (idx.includes(-1)) {
    const missing = REMINDER_HEADERS.filter((_, i) => idx[i] === -1);
    throw new Error(`Sheet Reminders kekurangan header: ${missing.join(", ")}`);
  }
  const rows: ReminderRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const cells = values[i] ?? [];
    const message = str(cells[idx[4]]);
    const id = str(cells[idx[0]]);
    const pic = str(cells[idx[1]]);
    if (message === "" && id === "" && pic === "") continue;
    rows.push({
      rowIndex: i + 1,
      id,
      pic,
      task: str(cells[idx[2]]),
      sendAt: parseSendTime(cells[idx[3]]),
      message,
      status: str(cells[idx[5]]),
    });
  }
  return rows;
}

export function parseContacts(values: unknown[][]): Map<string, string> {
  const header = (values[0] ?? []).map(str);
  const roleIdx = header.indexOf("PIC Role");
  const phoneIdx = header.indexOf("Nomor WA");
  if (roleIdx === -1 || phoneIdx === -1) {
    throw new Error("Sheet Contacts harus punya header 'PIC Role' dan 'Nomor WA'");
  }
  const map = new Map<string, string>();
  for (let i = 1; i < values.length; i++) {
    const cells = values[i] ?? [];
    const role = str(cells[roleIdx]).toLowerCase();
    const phone = normalizePhone(str(cells[phoneIdx]));
    if (role !== "" && phone) map.set(role, phone);
  }
  return map;
}

export function parseTaskStatus(values: unknown[][]): Map<string, string> {
  const header = (values[0] ?? []).map(str);
  const idIdx = header.indexOf("ID Tugas");
  const statusIdx = header.indexOf("Status");
  if (idIdx === -1 || statusIdx === -1) {
    throw new Error("Sheet Task Tracker harus punya header 'ID Tugas' dan 'Status'");
  }
  const map = new Map<string, string>();
  for (let i = 1; i < values.length; i++) {
    const cells = values[i] ?? [];
    const id = str(cells[idIdx]);
    if (id !== "") map.set(id, str(cells[statusIdx]));
  }
  return map;
}

export interface SheetsClient {
  fetchReminders(): Promise<ReminderRow[]>;
  fetchContacts(): Promise<Map<string, string>>;
  fetchTaskStatus(): Promise<Map<string, string>>;
  setStatus(rowIndex: number, status: string, sentAt: string | null): Promise<void>;
}

export async function createSheetsClient(cfg: Config): Promise<SheetsClient> {
  if (!statSync(cfg.googleCredsPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      `GOOGLE_CREDENTIALS_PATH (${cfg.googleCredsPath}) bukan file. ` +
        "Kalau isinya direktori kosong, itu dibuat otomatis oleh Docker: hapus direktori itu, " +
        "letakkan file JSON service account di path tersebut, lalu restart container.",
    );
  }
  const credentials = JSON.parse(readFileSync(cfg.googleCredsPath, "utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const api = google.sheets({ version: "v4", auth });

  const read = async (sheet: string): Promise<unknown[][]> => {
    const res = await api.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: sheet,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    return (res.data.values ?? []) as unknown[][];
  };

  return {
    fetchReminders: async () => parseReminders(await read(cfg.sheetReminders)),
    fetchContacts: async () => parseContacts(await read(cfg.sheetContacts)),
    fetchTaskStatus: async () => parseTaskStatus(await read(cfg.sheetTasks)),
    setStatus: async (rowIndex, status, sentAt) => {
      await api.spreadsheets.values.update({
        spreadsheetId: cfg.spreadsheetId,
        range: `'${cfg.sheetReminders}'!F${rowIndex}:G${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[status, sentAt ?? ""]] },
      });
    },
  };
}
