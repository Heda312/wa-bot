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

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export function formatLocal(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
        deps.log.warn(
          { attempt, rowIndex: d.rowIndex, err: lastErr },
          "gagal kirim, retry",
        );
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
