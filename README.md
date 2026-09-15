# King Avaron — Retro Boss Fight

Game HTML, CSS, dan JavaScript Canvas tanpa framework atau proses build.

## Menjalankan

Buka `D:\Asgore\Asgore\index.html` di browser. Pilih START TUTORIAL atau SKIP TUTORIAL. Audio aktif setelah interaksi pengguna.

```powershell
node "D:\Asgore\Asgore\tests\check.cjs"
```

## Urutan presentasi

1. **HTML — `D:\Asgore\Asgore\index.html`:** canvas, HP, dialog, menu, dan tombol sentuh.
2. **CSS — `D:\Asgore\Asgore\style.css`:** tema retro, font tertanam, dan tampilan responsif.
3. **State — `resetGame()`, `chooseAction()`, `continueGame()`:** objek `game` menyimpan data; state menentukan aksi yang boleh dijalankan.
4. **Giliran — `startMinigame()`, `resolveStrike()`, `startAttack()`:** timing menentukan damage pemain, lalu boss menyerang.
5. **Serangan — `spawnAttackPattern()`, `addHazard()`, `releaseBullets()`:** ID memilih pola; warning selalu mendahului bahaya.
6. **Gerak — `updatePlayer()`, `updateJump()`, `checkCollision()`:** kontrol bebas, gravitasi, platform, jalur, perisai, dan tabrakan.
7. **Render/audio — `draw()`, `drawUI()`, `playSFX()`:** menggambar permainan, memperbarui HUD, dan memutar efek suara.
8. **Loop — `frame()`:** menghitung selisih waktu, menjalankan `update()` dalam langkah kecil, lalu menggambar. `resizeGame()` menyesuaikan posisi objek saat layar berubah.

Semua fungsi JavaScript berada di `D:\Asgore\Asgore\script.js`. Cari `//notes` untuk penjelasan. HTML menggunakan `<!-- //notes ... -->` dan CSS menggunakan `/* //notes ... */` agar sintaks valid.

## Kontrol

- WASD / panah: bergerak atau menghadap dengan perisai.
- Shift / SLOW: bergerak pelan.
- Spasi / tombol lompat: melompat dalam mode gravitasi/platform.
- Z / Enter: konfirmasi atau hentikan penanda serangan.
- 1–4: FIGHT, ACT, ITEM, MERCY.
- Esc / X: batalkan dialog aksi yang belum dikonfirmasi atau buka/tutup jeda.
- Ponsel: geser hati atau gunakan tombol sentuh.

## Refactor

Logika berulang disatukan, bukan diminifikasi. Pola serangan, damage, fase boss, durasi, jalur aman, tutorial, ending, audio, dan kontrol dipertahankan.
