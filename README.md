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
- Reset session (ganti nomor bot): hapus isi `./auth_info`, restart, scan QR ulang.
- Baris error (`ERROR:`/`GAGAL:`) tidak dicoba ulang otomatis; perbaiki di sheet lalu
  kosongkan kolom `Status Kirim` untuk mengirim ulang.

## Development

- `npm install`
- `npm test` — unit test (parser, template, scheduler)
- `npm run dev` — jalan lokal (butuh `.env` + `service-account.json` + scan QR)
- `npm run build` — compile ke `dist/`
