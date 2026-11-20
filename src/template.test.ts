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
  assert.equal(
    renderMessage("cek {unknown}", { id: "a", pic: "b", task: "c" }),
    "cek {unknown}",
  );
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
