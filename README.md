# BuatQris Vercel Standalone

Versi ini tidak meneruskan callback ke hosting private. Vercel menerima
callback BuatQris dan menyimpannya di Vercel Postgres. Bot di hosting private
mengambil status dengan request keluar.

## Environment Variables di Vercel

Hubungkan Vercel Postgres agar `POSTGRES_URL` tersedia, lalu tambahkan:

```env
BUATQRIS_SECRET_TOKEN=secret_token_buatqris
BOT_POLL_TOKEN=token_acak_yang_sama_dengan_bot_private
```

## Callback BuatQris

Gunakan URL berikut di BuatQris atau saat membuat transaksi:

```text
https://PROJECT.vercel.app/api/buatqris
```

## Endpoint polling bot

```text
GET /api/buatqris?transaction_id=ID_TRANSAKSI
X-Bot-Poll-Token: nilai_BOT_POLL_TOKEN
```

Bot private harus melakukan request keluar ke endpoint tersebut. Tidak ada
`BOT_CALLBACK_TARGET_URL` dan tidak ada koneksi masuk ke hosting private.

## Catatan integrasi bot

Kode bot perlu menambahkan polling ke endpoint ini. Saat response
`payment.status` bernilai `paid`, bot memproses order lokal dan mengaktifkan
Premium. Database transaksi bot dan database callback Vercel tetap perlu
memakai `transaction_id` yang sama.