import test from "node:test";
import assert from "node:assert/strict";
import { parseContacts, parseReminders, parseSendTime, parseTaskStatus } from "./sheets.js";

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

test("parseTaskStatus mapping id ke status", () => {
  const map = parseTaskStatus([
    ["ID Tugas", "Path / Role", "Status"],
    ["TSK-DS-01", "Data Scientist", "Selesai"],
    ["TSK-DS-03", "Data Scientist", "Sedang Berjalan"],
  ]);
  assert.equal(map.get("TSK-DS-01"), "Selesai");
  assert.equal(map.get("TSK-DS-03"), "Sedang Berjalan");
  assert.equal(map.has("TSK-X"), false);
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
