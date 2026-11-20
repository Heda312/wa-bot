# PRD — WhatsApp Reminder Bot (wa-bot)

- **Tanggal**: 2026-11-20
- **Status**: Draft untuk review
- **Pemilik**: User (developer)
- **Platform target**: Docker di server Linux pribadi

## 1. Latar Belakang & Masalah

User mengelola tasking tim dalam Google Sheets (berisi id task, Role, Nama PIC, tanggal deadline, deskripsi task, dll). Saat ini pengingat deadline ke setiap PIC dilakukan manual, yang rawan terlewat dan memakan waktu.

Dibutuhkan bot WhatsApp yang otomatis mengirim pesan reminder custom ke nomor WA setiap PIC sesuai jadwal yang ditentukan per task, dengan sumber data sepenuhnya dari Google Sheets yang sudah ada.

## 2. Tujuan

1. Mengirim reminder WA otomatis ke nomor PIC berdasarkan baris task di Google Sheets.
2. Isi pesan 100% custom per task (ditulis user di sheet).
3. Waktu kirim custom per task (tanggal + jam), dikirim tepat satu kali.
4. Zero-effort setelah setup: bot jalan 24/7 di server, tidak perlu scan QR ulang tiap restart.

## 3. Ruang Lingkup

### In Scope
- Integrasi WhatsApp unofficial (Baileys) — 1 nomor bot.
- Baca & tulis Google Sheets via service account.
- Scheduler berbasis polling (cron tiap 1 menit).
- Lookup nomor WA dari sheet mapping kontak.
- Penandaan status terkirim di sheet (anti dobel-kirim).
- Deployment Docker (Dockerfile + docker-compose + volume untuk session WA).

### Out of Scope (v1)
- WhatsApp Cloud API resmi / broadcast massal.
- Web dashboard atau UI apa pun.
- Interaksi dua arah (membalas chat user, command via WA).
- Reminder berulang (repeat) — v1 hanya kirim sekali per baris task.
- Multi nomor bot / multi spreadsheet.

## 4. Pengguna & Skenario

**Persona**: User sebagai admin/operator (satu-satunya yang mengelola sheet dan bot). Penerima reminder adalah PIC task (anggota tim).

**Skenario utama**:
1. User mengisi baris baru di sheet `Reminders`: ID Tugas, PIC Role, Nama Tugas, pesan reminder, waktu kirim (mis. `2026-11-25 09:00`).
2. Bot polling tiap menit; pada `09:00` (atau menit pertama setelahnya) bot mengambil baris tersebut.
3. Bot mencari nomor WA di sheet `Contacts` berdasarkan PIC Role.
4. Bot mengirim isi kolom Pesan Reminder (setelah placeholder diganti) ke nomor tersebut via WA.
5. Bot menulis `TERKIRIM` + timestamp di kolom Status Kirim & Waktu Terkirim baris itu.
6. User bisa melihat status pengiriman langsung di sheet.

## 5. Kebutuhan Fungsional

### FR-1 Koneksi WhatsApp
- FR-1.1 Bot terhubung ke WhatsApp Web menggunakan Baileys (multi-device).
- FR-1.2 Saat pertama kali jalan, bot menampilkan QR code di log terminal untuk di-scan nomor bot.
- FR-1.3 Credentials session disimpan di direktori yang di-mount sebagai Docker volume; setelah scan pertama, restart tidak perlu scan ulang.
- FR-1.4 Bot auto-reconnect jika koneksi terputus, dengan backoff.

### FR-2 Sumber Data Google Sheets
- FR-2.1 Bot mengakses spreadsheet via Google Sheets API v4 dengan service account (JSON key).
- FR-2.2 Service account diberi akses **Editor** pada spreadsheet (butuh tulis status).
- FR-2.3 Dua sheet dipakai bot (sheet Tasks asli yang kompleks TIDAK dibaca bot sama sekali):
  - `Reminders` — sheet sederhana khusus bot, self-contained per baris reminder.
  - `Contacts` — mapping PIC Role → nomor WA.
- FR-2.4 Nama spreadsheet, nama sheet, dan rentang kolom dikonfigurasi via `.env`.

### FR-3 Skema Data

Sheet Tasks asli milik user (ID Tugas, Path/Role, PIC Role, Periode, Nama Tugas & Rincian Aktivitas, Target Deliverable, Indikator Keberhasilan, Prioritas, Status, Catatan) **tidak dibaca bot** — terlalu kompleks dan dikelola manusia. Bot memakai sheet sederhana khusus:

**Sheet `Reminders`** (dibuat user, satu baris = satu reminder):

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID Tugas | teks | Referensi ke sheet Tasks asli (untuk manusia) |
| PIC Role | teks | Kunci lookup ke sheet Contacts (mis. `Data Scientist 1`) |
| Nama Tugas | teks | Nama singkat task, dipakai placeholder `{task}` |
| Waktu Kirim | datetime | Kapan reminder dikirim (timezone Asia/Jakarta) |
| Pesan Reminder | teks | Isi pesan WA, dukung placeholder |
| Status Kirim | teks | Kosong/`PENDING` → `TERKIRIM` / `GAGAL` / `ERROR: <alasan>` (ditulis bot) |
| Waktu Terkirim | datetime | Timestamp aktual pengiriman (ditulis bot) |

**Sheet `Contacts`**:

| Kolom | Tipe | Keterangan |
|---|---|---|
| PIC Role | teks | Harus cocok dengan `PIC Role` di Reminders (case-insensitive, trim) |
| Nomor WA | teks | Format internasional atau lokal; bot menormalisasi ke `62xxx` |

- FR-3.1 Header sheet mengikuti nama persis di atas; user bebas menambah kolom lain di sebelah kanan — bot hanya membaca kolom bernama sesuai daftar.

### FR-4 Scheduler & Pengiriman
- FR-4.1 Bot polling sheet setiap 1 menit (interval configurable).
- FR-4.2 Baris dikirim jika: `waktu_kirim <= sekarang` DAN `status` kosong/`PENDING` DAN `pesan_reminder` terisi. Baris yang jadwalnya sudah lewat saat bot baru dinyalakan tetap langsung dikirim (catch-up), tanpa batas maksimal keterlambatan.
- FR-4.3 Setiap baris dikirim tepat satu kali (idempoten lewat kolom status; proses kirim meng-claim baris dengan menulis status sebelum/sesudah kirim).
- FR-4.4 Nomor lookup: cari `PIC Role` di sheet Contacts (case-insensitive, trim).
- FR-4.5 Pesan diambil dari kolom `Pesan Reminder` dengan dukungan placeholder yang diganti dari kolom lain di baris yang sama: `{pic}` (PIC Role), `{task}` (Nama Tugas), `{id}` (ID Tugas). Placeholder yang tidak dikenal dibiarkan apa adanya.
- FR-4.6 Pengiriman antar baris diberi jeda kecil (mis. 2–5 detik acak) untuk menghindari rate-limit WA.
- FR-4.7 Semua waktu diproses dalam timezone `Asia/Jakarta` (configurable).

### FR-5 Penulisan Status Balik
- FR-5.1 Sukses → tulis `TERKIRIM` di kolom status + waktu aktual di `waktu_terkirim`.
- FR-5.2 Nomor tidak ditemukan di Contacts → tulis `ERROR: nomor tidak ditemukan untuk <nama_pic>`; tidak mengirim apa pun; tidak memblokir baris lain.
- FR-5.3 Gagal kirim (error jaringan/WA) → retry sampai 3x dengan jeda meningkat; jika tetap gagal → tulis `GAGAL: <alasan singkat>`.
- FR-5.4 Baris berstatus `ERROR`/`GAGAL` tidak dicoba ulang otomatis; user memperbaikinya di sheet lalu mereset status ke kosong/`PENDING`.

### FR-6 Logging & Observability
- FR-6.1 Bot menulis log terstruktur ke stdout (siap `docker logs`): siklus poll, baris diproses, hasil kirim, error.
- FR-6.2 Saat start: log status koneksi WA, akses sheet (sukses/gagal), jumlah baris pending.

## 6. Kebutuhan Non-Fungsional

- **NFR-1 Keandalan**: container restart tidak menyebabkan dobel-kirim (status di sheet = source of truth).
- **NFR-2 Ringan**: image & runtime kecil (Node.js Alpine/slim, tanpa browser) — target RAM < 256 MB.
- **NFR-3 Keamanan**: JSON key service account dan `.env` tidak boleh masuk image/git; secret via environment/mount file.
- **NFR-4 Maintainability**: TypeScript, struktur file datar per tanggung jawab (`config.ts`, `sheets.ts`, `wa.ts`, `scheduler.ts`, `index.ts`) tanpa abstraksi berlebihan; versi Baileys di-pin di package.json; config `.env` divalidasi saat start (fail fast dengan pesan error jelas); README memuat panduan setup lengkap dari nol.

## 7. Arsitektur

```
┌────────────────────────── Docker container ──────────────────────────┐
│                                                                      │
│  node-cron (tiap 1 menit)                                            │
│      │                                                               │
│      ▼                                                               │
│  Scheduler ──► Sheets Client (googleapis) ──► Google Sheets API      │
│      │              baca Reminders+Contacts / tulis status           │
│      ▼                                                               │
│  ReminderProcessor ──► WA Client (Baileys) ──► WhatsApp servers      │
│                                                                      │
│  Volume: /app/auth_info (session WA)                                 │
│  Env: .env (SPREADSHEET_ID, SHEET_TASKS, SHEET_CONTACTS, TZ, dll.)   │
└──────────────────────────────────────────────────────────────────────┘
```

**Komponen**:
1. `wa-client` — wrapper Baileys: connect, simpan session, kirim pesan, reconnect.
2. `sheets-client` — baca range Reminders/Contacts, tulis status per baris.
3. `scheduler` — cron loop: ambil due rows → proses → update status.
4. `contact-mapper` — lookup PIC Role → nomor, normalisasi format nomor ke 62xxx.
5. `config` — parsing `.env` + validasi saat start (fail fast kalau ada yang kurang).

**Stack**: Node.js 22 + TypeScript, `@whiskeysockets/baileys`, `googleapis`, `node-cron`, `dotenv`, `pino` (logging).

## 8. Deployment

- `Dockerfile`: build TypeScript → image runtime slim.
- `docker-compose.yml`: satu service `wa-bot`, `restart: unless-stopped`, env_file `.env`, volume untuk session WA (`./auth_info:/app/auth_info`).
- Setup sekali:
  1. Buat service account di Google Cloud, enable Sheets API, share spreadsheet ke email service account (Editor).
  2. Isi `.env` (SPREADSHEET_ID, dsb.) dan letakkan `service-account.json`.
  3. `docker compose up -d`, scan QR dari `docker compose logs -f`.

## 9. Error Handling (ringkasan)

| Kondisi | Perilaku |
|---|---|
| Sheet tidak bisa dibaca | Log error, skip siklus ini, coba lagi menit depan (tidak crash) |
| Koneksi WA putus | Auto-reconnect Baileys; baris due ditahan sampai tersambung |
| Nomor PIC tidak ada di Contacts | Status `ERROR` di sheet, lanjut baris lain |
| Gagal kirim | Retry 3x backoff → status `GAGAL` |
| `waktu_kirim` invalid/kosong | Log warning, skip baris, status `ERROR: waktu kirim tidak valid` |
| Bot restart | Aman — status di sheet mencegah dobel kirim |

## 10. Metrik Sukses

- 100% baris task dengan `waktu_kirim` valid terkirim maksimal ±2 menit dari jadwal (saat koneksi sehat).
- Tidak ada dobel kirim setelah restart container.
- Setup di server baru < 15 menit mengikuti README.

## 11. Keputusan Final (hasil konfirmasi dengan user)

1. **Struktur sheet**: bot TIDAK membaca sheet Tasks asli yang kompleks; bot memakai sheet `Reminders` sederhana + sheet `Contacts` (skema di FR-3).
2. **Placeholder**: dipakai — `{pic}`, `{task}`, `{id}` diganti otomatis dari kolom baris yang sama.
3. **Catch-up**: baris yang waktu kirimnya sudah lewat saat bot dinyalakan langsung dikirim.
4. **Maintainability**: struktur file datar, validasi config fail-fast, README setup lengkap, versi Baileys di-pin.
