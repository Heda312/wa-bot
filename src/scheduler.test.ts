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
  assert.deepEqual(
    due.map((d) => d.rowIndex),
    [5],
  );
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
