# wa-bot (WhatsApp Reminder Bot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot Docker yang tiap menit membaca Google Sheets (`Reminders` + `Contacts`), mengirim pesan WA custom ke nomor PIC pada waktu yang dijadwalkan, lalu menulis status terkirim balik ke sheet.

**Architecture:** Single Node.js (TypeScript, ESM) process. `node` interval loop = scheduler; Baileys untuk koneksi WA (session di volume); `googleapis` untuk baca/tulis sheet. Logika murni (parse, template, select due rows) dipisah agar bisa diunit-test tanpa jaringan.

**Tech Stack:** Node 24, TypeScript (NodeNext ESM), @whiskeysockets/baileys, googleapis, dotenv, pino, qrcode, tsx (dev/test), node:test.

**Spec:** `docs/PRD-wa-reminder-bot.md`

## Global Constraints

- Bahasa komunikasi & isi pesan log: Indonesia untuk pesan yang dibaca user (status sheet), Inggris untuk identifier kode.
- Timezone proses WAJIB `Asia/Jakarta` (set via env `TZ` di docker-compose & saat dev).
- Versi Baileys di-pin exact di package.json (jangan pakai `^`).
- File datar di `src/`: `config.ts`, `template.ts`, `sheets.ts`, `wa.ts`, `scheduler.ts`, `index.ts` (+ `*.test.ts`).
- Secret (`.env`, `service-account.json`, `auth_info/`) tidak boleh masuk git maupun image Docker.
- Test: `npm test` = `node --import tsx --test src/`. Build: `npm run build` = `tsc`.
- Commit tiap task selesai.

## File Structure

| File | Tanggung jawab |
|---|---|
| `src/config.ts` | Load + validasi `.env` (fail-fast) |
| `src/template.ts` | `renderMessage` (placeholder) + `normalizePhone` |
| `src/sheets.ts` | Google Sheets client + parser murni (`parseReminders`, `parseContacts`, `parseSendTime`) |
| `src/wa.ts` | Wrapper Baileys: connect, QR, reconnect, `sendText` |
| `src/scheduler.ts` | `selectDueRows` (murni) + `runCycle` (orkestrasi kirim & tulis status) |
| `src/index.ts` | Wiring: config → sheets → wa → interval loop |
| `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`, `README.md` | Deploy & setup |

---

### Task 1: Scaffold proyek + config

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/config.ts`, `src/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` dengan `interface Config { spreadsheetId: string; sheetReminders: string; sheetContacts: string; timezone: string; pollIntervalMs: number; googleCredsPath: string; sessionDir: string; }`

- [ ] **Step 1: Tulis test gagal**

`src/config.test.ts`:
```ts
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test`
Expected: FAIL (module `./config.js` belum ada).

- [ ] **Step 3: Scaffold + implementasi**

`package.json`:
```json
{
  "name": "wa-bot",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "node --import tsx --test src/"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "7.0.0-rc.9",
    "dotenv": "17.2.3",
    "googleapis": "166.0.0",
    "pino": "10.1.0",
    "qrcode": "1.5.4"
  },
  "devDependencies": {
    "@types/node": "24.10.1",
    "@types/qrcode": "1.5.6",
    "tsx": "4.20.6",
    "typescript": "5.9.3"
  }
}
```
(Catatan executor: kalau versi pin di atas tidak tersedia di registry, ambil versi stabil terdekat dan tetap pin exact tanpa `^`.)

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

`.gitignore`:
```
node_modules/
dist/
auth_info/
.env
service-account.json
```

`.env.example`:
```
SPREADSHEET_ID=
GOOGLE_CREDENTIALS_PATH=./service-account.json
SHEET_REMINDERS=Reminders
SHEET_CONTACTS=Contacts
TIMEZONE=Asia/Jakarta
POLL_INTERVAL_MINUTES=1
SESSION_DIR=./auth_info
```

`src/config.ts`:
```ts
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
```

- [ ] **Step 4: Install deps & jalankan test**

Run: `npm install && npm test`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/config.ts src/config.test.ts
git commit -m "feat: scaffold project with validated env config"
```

---

### Task 2: Template pesan + normalisasi nomor

**Files:**
- Create: `src/template.ts`, `src/template.test.ts`

**Interfaces:**
- Produces: `renderMessage(template: string, row: { id: string; pic: string; task: string }): string` dan `normalizePhone(raw: string): string | null`

- [ ] **Step 1: Tulis test gagal**

`src/template.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, renderMessage } from "./template.js";

test("placeholder diganti dari kolom baris", () => {
  const out = renderMessage("Halo {pic}, task {id}: {task} segera ya!", {
    id: "TSK-DS-03",
    pic: "Data Scientist 2",
    task: "Desain skema database",
  });
  assert.equal(
    out,
    "Halo Data Scientist 2, task TSK-DS-03: Desain skema database segera ya!",
  );
});

test("placeholder tak dikenal dibiarkan", () => {
  assert.equal(renderMessage("cek {unknown}", { id: "a", pic: "b", task: "c" }), "cek {unknown}");
});

test("normalisasi nomor Indonesia", () => {
  assert.equal(normalizePhone("0812-3456-7890"), "6281234567890");
  assert.equal(normalizePhone("+62 812 3456 7890"), "6281234567890");
  assert.equal(normalizePhone("81234567890"), "6281234567890");
  assert.equal(normalizePhone("6281234567890"), "6281234567890");
});

test("nomor kosong/invalid null", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("abc"), null);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test`
Expected: FAIL (`./template.js` belum ada).

- [ ] **Step 3: Implementasi**

`src/template.ts`:
```ts
export interface MessageRow {
  id: string;
  pic: string;
  task: string;
}

export function renderMessage(template: string, row: MessageRow): string {
  return template
    .replaceAll("{id}", row.id)
    .replaceAll("{pic}", row.pic)
    .replaceAll("{task}", row.task);
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add src/template.ts src/template.test.ts
git commit -m "feat: message placeholder rendering and phone normalization"
```

---

### Task 3: Sheets client + parser

**Files:**
- Create: `src/sheets.ts`, `src/sheets.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` dari `template.ts`, `Config` dari `config.ts`.
- Produces:
  - `interface ReminderRow { rowIndex: number; id: string; pic: string; task: string; sendAt: Date | null; message: string; status: string; }`
  - `parseSendTime(value: unknown): Date | null`
  - `parseReminders(values: unknown[][]): ReminderRow[]`
  - `parseContacts(values: unknown[][]): Map<string, string>` (key = PIC Role lowercase-trim, value = nomor ternormalisasi)
  - `interface SheetsClient { fetchReminders(): Promise<ReminderRow[]>; fetchContacts(): Promise<Map<string, string>>; setStatus(rowIndex: number, status: string, sentAt: string | null): Promise<void>; }`
  - `createSheetsClient(cfg: Config): Promise<SheetsClient>`

- [ ] **Step 1: Tulis test gagal**

`src/sheets.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseContacts, parseReminders, parseSendTime } from "./sheets.js";

const HEADER = [
  "ID Tugas",
  "PIC Role",
  "Nama Tugas",
  "Waktu Kirim",
  "Pesan Reminder",
  "Status Kirim",
  "Waktu Terkirim",
];

test("parseSendTime angka serial sheet (2026-11-25 09:00)", () => {
  const d = parseSendTime(46351.375);
  assert.ok(d);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 25);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 0);
});

test("parseSendTime string ISO dan format tanggal-jam", () => {
  assert.equal(parseSendTime("2026-11-25T09:00")?.getHours(), 9);
  assert.equal(parseSendTime("2026-11-25 09:00")?.getDate(), 25);
  assert.equal(parseSendTime("bukan tanggal"), null);
  assert.equal(parseSendTime(""), null);
});

test("parseReminders ambil baris valid, lewati baris kosong", () => {
  const rows = parseReminders([
    HEADER,
    ["TSK-01", "Data Scientist 1", "Tugas A", 46351.375, "Halo {pic}", "", ""],
    ["", "", "", "", "", "", ""],
    ["TSK-02", "Data Scientist 2", "Tugas B", "2026-12-01 08:00", "Msg B", "TERKIRIM", "x"],
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowIndex, 2);
  assert.equal(rows[0].pic, "Data Scientist 1");
  assert.equal(rows[0].status, "");
  assert.equal(rows[1].rowIndex, 4);
  assert.equal(rows[1].status, "TERKIRIM");
});

test("parseReminders throw kalau header wajib tidak ada", () => {
  assert.throws(() => parseReminders([["ID Tugas", "PIC Role"]]), /header/);
});

test("parseContacts mapping role ke nomor ternormalisasi", () => {
  const map = parseContacts([
    ["PIC Role", "Nomor WA"],
    ["Data Scientist 1", "0812-3456-7890"],
    [" data scientist 2 ", "+62 813 1111 2222"],
    ["Broken", "abc"],
  ]);
  assert.equal(map.get("data scientist 1"), "6281234567890");
  assert.equal(map.get("data scientist 2"), "6281311112222");
  assert.equal(map.has("broken"), false);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test`
Expected: FAIL (`./sheets.js` belum ada).

- [ ] **Step 3: Implementasi**

`src/sheets.ts`:
```ts
import { readFileSync } from "node:fs";
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
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
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

export interface SheetsClient {
  fetchReminders(): Promise<ReminderRow[]>;
  fetchContacts(): Promise<Map<string, string>>;
  setStatus(rowIndex: number, status: string, sentAt: string | null): Promise<void>;
}

export async function createSheetsClient(cfg: Config): Promise<SheetsClient> {
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
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS semua (test parse tidak menyentuh jaringan).

- [ ] **Step 5: Commit**

```bash
git add src/sheets.ts src/sheets.test.ts
git commit -m "feat: google sheets client with pure parsers for reminders and contacts"
```

---

### Task 4: WhatsApp client (Baileys)

**Files:**
- Create: `src/wa.ts`

**Interfaces:**
- Produces: `interface WaClient { sendText(phone: string, text: string): Promise<void>; }` dan `createWaClient(sessionDir: string, log: Logger): Promise<WaClient>`

- [ ] **Step 1: Implementasi** (tidak ada unit test — integrasi jaringan; diverifikasi manual di Task 7)

`src/wa.ts`:
```ts
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import QRCode from "qrcode";

export interface WaClient {
  sendText(phone: string, text: string): Promise<void>;
}

export async function createWaClient(sessionDir: string, log: Logger): Promise<WaClient> {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  let sock: WASocket | undefined;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const connect = async (): Promise<void> => {
    sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update) => {
      if (update.qr) {
        const qr = await QRCode.toString(update.qr, { type: "terminal", small: true });
        log.info("\n%s\nScan QR di atas pakai WhatsApp nomor bot", qr);
      }
      if (update.connection === "open") {
        log.info("WhatsApp terhubung");
        readyResolve();
      }
      if (update.connection === "close") {
        const code = (
          update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          log.error("Session logged out. Hapus isi folder session, restart, scan QR ulang.");
          process.exit(1);
        }
        log.warn({ code }, "Koneksi WA tertutup, reconnect dalam 3 detik");
        setTimeout(() => void connect(), 3000);
      }
    });
  };

  await connect();

  return {
    async sendText(phone, text) {
      await ready;
      if (!sock) throw new Error("Socket WA belum siap");
      await sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
    },
  };
}
```

- [ ] **Step 2: Pastikan compile**

Run: `npm run build`
Expected: sukses tanpa error TypeScript.

- [ ] **Step 3: Commit**

```bash
git add src/wa.ts
git commit -m "feat: baileys whatsapp client with qr login and auto reconnect"
```

---

### Task 5: Scheduler (select due rows + run cycle)

**Files:**
- Create: `src/scheduler.ts`, `src/scheduler.test.ts`

**Interfaces:**
- Consumes: `ReminderRow`, `SheetsClient` dari `sheets.ts`; `renderMessage` dari `template.ts`; `WaClient` dari `wa.ts`.
- Produces:
  - `selectDueRows(rows: ReminderRow[], contacts: Map<string, string>, now: Date): { due: DueRow[]; errors: RowError[] }` dengan `DueRow = { rowIndex: number; phone: string; text: string }`, `RowError = { rowIndex: number; status: string }`
  - `runCycle(deps: { sheets: SheetsClient; wa: WaClient; log: Logger; now?: Date }): Promise<void>`

- [ ] **Step 1: Tulis test gagal**

`src/scheduler.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { selectDueRows, type ReminderRowStub } from "./scheduler.js";

const row = (over: Partial<ReminderRowStub>): ReminderRowStub => ({
  rowIndex: 2,
  id: "T1",
  pic: "ds 1",
  task: "Tugas",
  sendAt: new Date(2026, 10, 25, 9, 0),
  message: "Halo {pic}",
  status: "",
  ...over,
});

const contacts = new Map([["ds 1", "6281234567890"]]);
const NOW = new Date(2026, 10, 25, 10, 0);

test("baris due dipilih dan pesan dirender", () => {
  const { due, errors } = selectDueRows([row({})], contacts, NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0].phone, "6281234567890");
  assert.equal(due[0].text, "Halo ds 1");
  assert.equal(errors.length, 0);
});

test("baris masa depan, terkirim, dan pesan kosong dilewati", () => {
  const { due } = selectDueRows(
    [
      row({ rowIndex: 2, sendAt: new Date(2026, 10, 25, 11, 0) }),
      row({ rowIndex: 3, status: "TERKIRIM" }),
      row({ rowIndex: 4, message: "" }),
      row({ rowIndex: 5, status: "PENDING" }),
    ],
    contacts,
    NOW,
  );
  assert.deepEqual(due.map((d) => d.rowIndex), [5]);
});

test("kontak tidak ditemukan jadi error, bukan due", () => {
  const { due, errors } = selectDueRows([row({ pic: "unknown" })], contacts, NOW);
  assert.equal(due.length, 0);
  assert.match(errors[0].status, /ERROR: nomor tidak ditemukan/);
});

test("waktu kirim invalid jadi error", () => {
  const { due, errors } = selectDueRows([row({ sendAt: null })], contacts, NOW);
  assert.equal(due.length, 0);
  assert.match(errors[0].status, /waktu kirim tidak valid/);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test`
Expected: FAIL (`./scheduler.js` belum ada).

- [ ] **Step 3: Implementasi**

`src/scheduler.ts`:
```ts
import type { Logger } from "pino";
import type { ReminderRow, SheetsClient } from "./sheets.js";
import { renderMessage } from "./template.js";
import type { WaClient } from "./wa.js";

export type ReminderRowStub = ReminderRow;

export interface DueRow {
  rowIndex: number;
  phone: string;
  text: string;
}

export interface RowError {
  rowIndex: number;
  status: string;
}

const isPending = (status: string): boolean =>
  status === "" || status.toLowerCase() === "pending";

export function selectDueRows(
  rows: ReminderRow[],
  contacts: Map<string, string>,
  now: Date,
): { due: DueRow[]; errors: RowError[] } {
  const due: DueRow[] = [];
  const errors: RowError[] = [];
  for (const r of rows) {
    if (!isPending(r.status) || r.message === "") continue;
    if (r.sendAt === null) {
      errors.push({ rowIndex: r.rowIndex, status: "ERROR: waktu kirim tidak valid" });
      continue;
    }
    if (r.sendAt.getTime() > now.getTime()) continue;
    const phone = contacts.get(r.pic.toLowerCase());
    if (!phone) {
      errors.push({
        rowIndex: r.rowIndex,
        status: `ERROR: nomor tidak ditemukan untuk ${r.pic || "(PIC kosong)"}`,
      });
      continue;
    }
    due.push({
      rowIndex: r.rowIndex,
      phone,
      text: renderMessage(r.message, { id: r.id, pic: r.pic, task: r.task }),
    });
  }
  return { due, errors };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function formatLocal(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function runCycle(deps: {
  sheets: SheetsClient;
  wa: WaClient;
  log: Logger;
  now?: Date;
}): Promise<void> {
  const now = deps.now ?? new Date();
  const [rows, contacts] = await Promise.all([
    deps.sheets.fetchReminders(),
    deps.sheets.fetchContacts(),
  ]);
  const { due, errors } = selectDueRows(rows, contacts, now);
  deps.log.info({ due: due.length, error: errors.length }, "siklus: baris diproses");

  for (const e of errors) {
    await deps.sheets.setStatus(e.rowIndex, e.status, null);
    deps.log.warn({ rowIndex: e.rowIndex, status: e.status }, "baris error");
  }

  for (const d of due) {
    let ok = false;
    let lastErr = "";
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await deps.wa.sendText(d.phone, d.text);
        ok = true;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        deps.log.warn({ attempt, rowIndex: d.rowIndex, err: lastErr }, "gagal kirim, retry");
        await sleep(2000 * attempt);
      }
    }
    if (ok) {
      await deps.sheets.setStatus(d.rowIndex, "TERKIRIM", formatLocal(now));
      deps.log.info({ rowIndex: d.rowIndex, phone: d.phone }, "reminder terkirim");
    } else {
      await deps.sheets.setStatus(d.rowIndex, `GAGAL: ${lastErr.slice(0, 80)}`, null);
      deps.log.error({ rowIndex: d.rowIndex }, "reminder gagal setelah 3 percobaan");
    }
    await sleep(2000 + Math.floor(Math.random() * 3000));
  }
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts src/scheduler.test.ts
git commit -m "feat: scheduler cycle with due-row selection, retry and status writeback"
```

---

### Task 6: Wiring utama (index.ts)

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `loadConfig`, `createSheetsClient`, `createWaClient`, `runCycle`.

- [ ] **Step 1: Implementasi**

`src/index.ts`:
```ts
import pino from "pino";
import { loadConfig } from "./config.js";
import { createSheetsClient } from "./sheets.js";
import { runCycle } from "./scheduler.js";
import { createWaClient } from "./wa.js";

const log = pino({ base: undefined });

const cfg = loadConfig();
log.info({ spreadsheet: cfg.spreadsheetId, intervalMs: cfg.pollIntervalMs }, "config ok");

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
```

- [ ] **Step 2: Build + test penuh**

Run: `npm run build && npm test`
Expected: build sukses, semua test PASS.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire config, sheets, wa client into polling loop"
```

---

### Task 7: Docker, README, verifikasi akhir

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `README.md`

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ENV TZ=Asia/Jakarta
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: docker-compose.yml**

```yaml
services:
  wa-bot:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      TZ: Asia/Jakarta
    volumes:
      - ./auth_info:/app/auth_info
      - ./service-account.json:/app/service-account.json:ro
```

- [ ] **Step 3: README.md**

```markdown
# wa-bot — WhatsApp Reminder Bot

Bot yang membaca Google Sheets (`Reminders` + `Contacts`) tiap menit, mengirim pesan
WhatsApp custom ke nomor PIC sesuai jadwal, lalu menulis status terkirim balik ke sheet.
Detail produk: [docs/PRD-wa-reminder-bot.md](docs/PRD-wa-reminder-bot.md).

## Setup sekali

1. **Google Cloud**: buat project → enable *Google Sheets API* → buat *service account*
   → download JSON key → simpan sebagai `service-account.json` di root repo (jangan commit).
2. **Spreadsheet**: share spreadsheet ke email service account dengan akses **Editor**.
   Buat 2 sheet:
   - `Reminders` dengan header persis: `ID Tugas | PIC Role | Nama Tugas | Waktu Kirim | Pesan Reminder | Status Kirim | Waktu Terkirim`
   - `Contacts` dengan header: `PIC Role | Nomor WA`
   Kolom `Status Kirim` & `Waktu Terkirim` diisi bot. Placeholder pesan: `{pic}`, `{task}`, `{id}`.
   Format `Waktu Kirim`: datetime (mis. `2026-11-25 09:00`), zona waktu Asia/Jakarta.
3. **Env**: `cp .env.example .env`, isi `SPREADSHEET_ID` (dari URL sheet) dan path kredensial.
4. **Jalankan**: `docker compose up -d --build`, lalu `docker compose logs -f` dan
   scan QR yang muncul dengan nomor WA bot. Session tersimpan di `./auth_info`,
   restart tidak perlu scan ulang.

## Operasional

- Lihat log: `docker compose logs -f`
- Reset session (ganti nomor bot): hapus isi `./auth_info`, restart, scan ulang.
- Baris error (`ERROR:`/`GAGAL:`) tidak dicoba ulang otomatis; perbaiki di sheet lalu
  kosongkan kolom `Status Kirim` untuk mengirim ulang.

## Development

- `npm install`
- `npm test` — unit test (parser, template, scheduler)
- `npm run dev` — jalan lokal (butuh `.env` + `service-account.json` + scan QR)
- `npm run build` — compile ke `dist/`
```

- [ ] **Step 4: Verifikasi build Docker lokal**

Run: `docker build -t wa-bot:local .`
Expected: image terbentuk tanpa error. (Kalau Docker tidak tersedia di mesin dev, catat dan verifikasi di server.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml README.md
git commit -m "feat: docker deployment and setup readme"
```
