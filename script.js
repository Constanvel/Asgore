'use strict';

// 1. KONFIGURASI. Canvas memenuhi halaman; ARENA adalah satu-satunya area battle.
// State: intro, menu, playerAction, bossAttack, victory, gameOver.
const canvas = document.getElementById('battle');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const VIEW = { w: 800, h: 600, dpr: 1, bossScale: 1 };
const ARENA = { x: 12, y: 140, w: 776, h: 260 };
const MAX_HP = 40;
const MAX_BOSS_HP = 180;
const PHASES = [null,
  { speed: 1, warning: 0.7, duration: 10, bpm: 124 },
  { speed: 1.28, warning: 0.58, duration: 11, bpm: 144 },
  { speed: 1.48, warning: 0.52, duration: 15, bpm: 176 }
];
let touchTarget = null;
let touchPointer = null;
const keys = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const actionButtons = [...document.querySelectorAll('[data-action]')];
let game;

function resetGame() {
  keys.clear();
  game = {
    state: 'intro', hp: MAX_HP, bossHp: MAX_BOSS_HP, items: 2, turn: 0,
    x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h * 0.75,
    invincible: 0, time: 0, attackTime: 0, phase: 1, transition: 0, moving: false,
    spawnTime: 0, wave: 0, pattern: 0, hazards: [], bullets: [], particles: [],
    bossX: VIEW.w / 2, bossY: bossCenterY(), bossTarget: 0.5,
    charge: 0, dash: 0, teleport: 0, shake: 0, hurtFlash: 0,
    introIndex: 0, actCount: 0, paused: false, flash: 0, musicTime: 0, note: 0
  };
  touchTarget = null;
  touchPointer = null;
  $('pause-overlay').hidden = true;
  showDialogue('KING AVARON', introLines[0]);
  $('continue-button').innerHTML = 'ENTER <span aria-hidden="true">↵</span>';
  drawUI();
}

const introLines = [
  '“Di balik gerbang ini, tak ada takhta. Hanya dunia yang belum mengenal lukanya.”',
  '“Aku Avaron. Mahkotaku retak, tetapi sumpahku belum. Tunjukkan apa yang kau lindungi.”',
  'WASD / panah: bergerak. Shift: pelan. Enter: pilih. Esc: jeda. Di layar sentuh, geser hati atau gunakan panah.'
];

function showDialogue(speaker, text) {
  $('speaker').textContent = speaker;
  $('dialogue').textContent = text;
}

function isFinalPhase() { return game.bossHp > 0 && game.bossHp < MAX_BOSS_HP * 0.3; }
function canSpare() { return game.bossHp <= MAX_BOSS_HP * 0.2; }
// BOSS PHASE SYSTEM: perubahan hanya menaikkan fase; restart mengembalikan fase I.
function updatePhase() {
  const phase = isFinalPhase() ? 3 : game.bossHp <= MAX_BOSS_HP * 0.6 ? 2 : 1;
  if (phase <= game.phase || game.bossHp <= 0) return;
  game.phase = phase;
  game.transition = 1.6;
  game.shake = 0.55;
  game.musicTime = 0;
  game.bossTarget = phase === 3 ? 0.7 : 0.3;
  playSFX(phase === 3 ? 'final' : 'phase');
}
function combatScale() { return clamp(Math.min(ARENA.w / 500, ARENA.h / 300), 0.5, 1); }
function bossScale() { return VIEW.bossScale; }
function bossCenterY() { return ARENA.y - 30 - 78 * bossScale(); }

function drawUI() {
  $('player-hp').textContent = `${game.hp} / ${MAX_HP}`;
  $('boss-hp').textContent = `${game.bossHp} / ${MAX_BOSS_HP}`;
  $('player-fill').style.width = `${game.hp / MAX_HP * 100}%`;
  $('boss-fill').style.width = `${game.bossHp / MAX_BOSS_HP * 100}%`;
  $('player-meter').setAttribute('aria-valuenow', game.hp);
  $('boss-meter').setAttribute('aria-valuenow', game.bossHp);
  $('item-count').textContent = `ITEM ${game.items}/2`;
  $('phase-label').textContent = ['','PHASE I','PHASE II','FINAL PHASE'][game.phase];
  document.body.dataset.phase = game.phase;
  document.body.dataset.state = game.state;
  for (const button of actionButtons) {
    button.disabled = game.state !== 'menu' || game.paused || (button.dataset.action === 'item' && game.items === 0);
    button.classList.toggle('ready', button.dataset.action === 'mercy' && canSpare());
    button.classList.toggle('selected', actionButtons.indexOf(button) === (game.menuIndex || 0));
  }
  $('continue-button').hidden = !['intro', 'playerAction', 'gameOver', 'victory'].includes(game.state);
  $('continue-button').disabled = game.paused;
}

function openMenu() {
  game.state = 'menu';
  touchTarget = null;
  touchPointer = null;
  game.menuIndex = 0;
  keys.clear();
  game.bullets = [];
  game.hazards = [];
  showDialogue('WANDERER', canSpare()
    ? 'Tombaknya merendah. Untuk pertama kalinya, Avaron tampak siap mendengarkan. MERCY kini bisa berhasil.'
    : 'Abu berjatuhan seperti salju. Sang raja menunggu pilihanmu.');
  drawUI();
}

// 2. SISTEM GILIRAN. Aksi hanya diterima dalam state menu agar klik ganda aman.
function chooseAction(action) {
  if (game.state !== 'menu' || game.paused) return;
  // Simpan aksi agar X/Escape bisa membatalkan dialog tanpa heal/damage ganda.
  game.actionSnapshot = { hp: game.hp, bossHp: game.bossHp, items: game.items,
    actCount: game.actCount, phase: game.phase };
  playSFX('select');
  let text;
  if (action === 'fight') {
    game.bossHp = Math.max(0, game.bossHp - 24);
    game.flash = 0.24;
    playSFX('fight');
    playSFX('bossHit');
    burst(game.bossX, game.bossY, 22);
    updatePhase();
    if (game.bossHp === 0) { finishGame('victory'); return; }
    text = 'Seranganmu menembus jubah abu. King Avaron kehilangan 24 HP. “Masih ada bara dalam dirimu.”';
  } else if (action === 'act') {
    const lines = [
      '“Siapa yang kau tunggu?” tanyamu. Avaron diam. “Seseorang yang tak akan kembali.”',
      'Kau menyebut bunga di luar gerbang. “Jadi... musim semi masih menemukan jalan pulang?”',
      '“Kau boleh berhenti menjaga,” katamu. Tangannya bergetar, tetapi tombaknya tetap menyala.'
    ];
    text = lines[game.actCount++ % lines.length];
  } else if (action === 'item') {
    if (game.items === 0) return;
    game.items--;
    const healed = Math.min(20, MAX_HP - game.hp);
    game.hp += healed;
    text = `Kau memakan Roti Fajar. Hangatnya memulihkan ${healed} HP. Tersisa ${game.items} roti.`;
    tone(660, 0.18, 'triangle');
  } else if (action === 'mercy') {
    if (canSpare()) { finishGame('mercy'); return; }
    text = 'Kau menurunkan senjata. “Belum,” bisik Avaron. “Sumpahku belum melepaskanku.” Lemahkan dia hingga HP tersisa 20%.';
  } else return;
  game.state = 'playerAction';
  showDialogue(action === 'act' || action === 'mercy' ? 'KING AVARON' : 'WANDERER', text);
  drawUI();
  $('continue-button').focus({ preventScroll: true });
}


function continueGame() {
  if (game.paused) return;
  if (game.state === 'intro') {
    game.introIndex++;
    if (game.introIndex >= introLines.length) openMenu();
    else showDialogue(game.introIndex === 2 ? 'CARA BERMAIN' : 'KING AVARON', introLines[game.introIndex]);
  } else if (game.state === 'playerAction') startAttack();
  else if (game.state === 'victory' || game.state === 'gameOver') resetGame();
}

function startAttack() {
  updatePhase();
  game.state = 'bossAttack';
  // Pola baru masuk giliran normal; ACT/ITEM memperpanjang rotasi hingga semua pola tampil.
  const deck = game.phase === 1 ? [2, 7, 8, 0, 9, 6, 10, 1, 11, 3, 4] : [2, 7, 8, 9, 10, 11, 1, 6, 4, 0, 3];
  game.pattern = game.phase === 3 ? 5 : deck[game.turn % deck.length];
  game.turn++;
  game.attackTime = 0;
  game.spawnTime = 0.9;
  game.wave = 0;
  game.hazards = [];
  game.bullets = [];
  game.x = ARENA.x + ARENA.w / 2;
  game.y = ARENA.y + ARENA.h * 0.75;
  game.invincible = 0.8;
  touchTarget = null;
  keys.clear();
  const tips = [
    'Api mengunci posisi TERAKHIR hatimu. Tinggalkan kolom bertanda sebelum menyala.',
    'Spiral makin cepat. Bergerak mengikuti celah, jangan mendekati sumber api.',
    'Tombak berganti: acak, berbaris, lalu membidikmu. Baca jalur putus-putus.',
    'Tiga arah tebasan bergantian. Garis lebar bertanda akan menyala; menjauh tegak lurus.',
    'Sudut biru menandai zona asli. Pindah sebelum zona X terbakar.',
    'Combo berganti tiap giliran. Biru: DIAM. Oranye: GERAK. Baca celah dan warning.',
    'Dinding tombak mendekat. Pindah ke celah bertanda dua garis biru sebelum dinding melintas.',
    'SUMPAH DUA WARNA — Biru: diam. Oranye: terus bergerak saat nyalanya aktif.',
    'MAHKOTA PECAH — Cincin mengembang. Lewati bukaan biru; jangan terjebak dekat sumber.',
    'BARA PANTUL — Pecahan memantul dua kali. Perhatikan arah setelah menyentuh border.',
    'TENUN BARA — Tembakan mengunci posisi terakhir. Tinggalkan garis bidik sebelum dilepas.',
    'HUJAN KELOPAK — Bara melengkung lalu jatuh. Cari sela saat kipas mulai terbuka.'
  ];
  showDialogue(isFinalPhase() ? 'KING AVARON — SUMPAH TERAKHIR' : 'BERTAHAN', tips[game.pattern]);
  drawUI();
  canvas.focus({ preventScroll: true });
}

function finishGame(result) {
  game.state = result === 'defeat' ? 'gameOver' : 'victory';
  game.result = result;
  game.bullets = [];
  game.hazards = [];
  keys.clear();
  const endings = {
    defeat: ['GAME OVER', 'Hatimu padam, tetapi perjalananmu belum selesai. Bangkitlah; kini kau mengenal nyala api sang raja.'],
    victory: ['KING AVARON', '“Akhirnya... sumpahku selesai.” Mahkota retak itu jatuh. Di balik gerbang, fajar menyentuh dunia untuk pertama kalinya.'],
    mercy: ['KING AVARON', '“Kau melihat seorang manusia, ketika aku hanya melihat seorang raja.” Avaron memadamkan tombaknya dan membuka gerbang. Kalian melangkah menuju fajar.']
  };
  showDialogue(...endings[result]);
  $('continue-button').innerHTML = 'MAIN LAGI <span aria-hidden="true">↵</span>';
  touchTarget = null;
  playSFX(result === 'defeat' ? 'gameOver' : 'victory');
  drawUI();
}

// 3. POLA SERANGAN. Peringatan selalu muncul sebelum objek berbahaya aktif.
function addHazard(type, data, warn = PHASES[game.phase].warning, active = 0.5) {
  game.hazards.push({ type, age: 0, warn, life: warn + active, fired: false, ...data });
}
function spawnFlame(w, delay = 0) {
  const width = clamp(ARENA.w * 0.085, 24, 44);
  // Posisi dikunci saat warning, tidak mengejar pemain setelah tanda muncul.
  const targets = [game.x];
  if (game.phase > 1) targets.push(game.x + (w % 2 ? -1 : 1) * ARENA.w * 0.25);
  if (game.phase === 3 && game.pattern !== 5) targets.push(game.x - (w % 2 ? -1 : 1) * ARENA.w * 0.25);
  for (const x of targets) addHazard('pillar', {
    x: clamp(x - width / 2, ARENA.x, ARENA.x + ARENA.w - width),
    y: ARENA.y, w: width, h: ARENA.h, age: -delay
  }, undefined, 0.55);
}
function spawnSpiral(w, combo = false) {
  if (game.hazards.some(h => h.type === 'spiral')) return;
  addHazard('spiral', { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h * (combo ? 0.12 : 0.5),
    rotation: w * 0.7, emit: 0, combo, direction: w % 2 ? -1 : 1 }, undefined, combo ? 2.4 : 3.7);
}
function spawnSpears(w, combo = false) {
  const count = combo ? 5 : game.phase + 5;
  const gap = ARENA.w / (count + 1);
  const lanes = [];
  const variant = w % 5;
  for (let i = 0; i < count; i++) {
    let x;
    if (variant === 0) x = ARENA.x + gap * (i + 0.7 + Math.random() * 0.6);
    else if (variant === 3) x = game.x + (i - Math.floor(count / 2)) * Math.max(32, gap);
    else x = ARENA.x + gap * (i + 1);
    x = clamp(x, ARENA.x + 14, ARENA.x + ARENA.w - 14);
    if (lanes.some(lane => Math.abs(lane - x) < 25)) continue;
    lanes.push(x);
    const order = variant === 1 ? i : variant === 2 ? count - 1 - i : variant === 4 ? Math.min(i, count - 1 - i) : 0;
    addHazard('spear', { x, y: ARENA.y + 14, age: -order * 0.065 }, undefined, 0.05);
  }
}
function spawnSlash(w, delay = 0) {
  const { x, y, w: width, h } = ARENA;
  const px = clamp(game.x, x + width * 0.15, x + width * 0.85);
  const py = clamp(game.y, y + h * 0.15, y + h * 0.85);
  const lines = [[x, py, x + width, py], [px, y, px, y + h],
    [x, y, x + width, y + h], [x, y + h, x + width, y]];
  const [x1, y1, x2, y2] = lines[w % 4];
  addHazard('slash', { x: x1, y: y1, x2, y2, width: 18, age: -delay }, 0.5, 0.26);
  game.dash = 0.32;
}
function spawnZones(w) {
  const width = ARENA.w / 3;
  // Zona asli selalu dekat posisi sekarang: waktu reaksi cukup pada layar lebar.
  const current = clamp(Math.floor((game.x - ARENA.x) / width), 0, 2);
  const safe = current === 1 ? (w % 2 ? 0 : 2) : 1;
  // Zona asli bersebelahan, bukan selalu tepat di bawah hati. Cukup waktu berpindah.
  const reaction = width * 1.5 / (310 * combatScale()) + 0.35;
  addHazard('zones', { safe, reveal: 0.55, w: width, seed: w }, Math.max(1.8, 0.55 + reaction), 0.65);
}
function spawnWall(w, combo = false) {
  const gap = Math.min(ARENA.h * 0.55, Math.max(54, ARENA.h * (combo ? 0.42 : 0.29)));
  const center = clamp(ARENA.y + ARENA.h * [0.18, 0.5, 0.82, 0.5][w % 4],
    ARENA.y + gap / 2 + 10, ARENA.y + ARENA.h - gap / 2 - 10);
  const velocity = (w % 2 ? -1 : 1) * 215 * PHASES[game.phase].speed * combatScale();
  addHazard('wall', { x: w % 2 ? ARENA.x + ARENA.w - 12 : ARENA.x + 12,
    y: ARENA.y, gapY: center - gap / 2, gap, vx: velocity, width: 20,
    gapSpeed: w % 4 === 3 && !combo ? 28 * combatScale() : 0 },
    // Waktu warning cukup untuk mencapai celah, bahkan saat hati dekat sisi datangnya wall.
    Math.max(0.7, Math.abs(game.y - center) / (310 * combatScale()) + 0.3),
    ARENA.w / Math.abs(velocity) + 0.15);
  game.dash = 0.3;
}
// Pola baru memakai warning, peluru, dan collision yang sama dengan serangan lama.
function spawnPulse(w, delay = 0) {
  addHazard('pulse', { rule: w % 2 ? 'move' : 'still', age: -delay }, 0.85, 0.34);
}
function spawnRing(w) {
  const x = ARENA.x + ARENA.w * 0.5, y = ARENA.y + ARENA.h * 0.45;
  const angle = Math.atan2(game.y - y, game.x - x) + (w % 3 - 1) * 0.42;
  addHazard('ring', { x, y, angle, opening: 1.15 }, 0.8, 0.24);
}
function spawnVolley(w, bounce = false, delay = 0) {
  const x = ARENA.x + (w % 2 ? ARENA.w - 12 : 12);
  const y = ARENA.y + ARENA.h * (w % 3 === 0 ? 0.22 : 0.78);
  addHazard('volley', { x, y, angle: Math.atan2(game.y - y, game.x - x),
    count: bounce ? 3 : 3 + game.phase, spread: bounce ? 0.32 : 0.19,
    bounce, age: -delay }, bounce ? 0.8 : 0.65, 0.05);
}
function spawnBloom(w) {
  addHazard('bloom', { x: ARENA.x + ARENA.w * (w % 2 ? 0.7 : 0.3),
    y: ARENA.y + Math.min(40, ARENA.h * 0.3) }, 0.75, 0.05);
}
function spawnAttackPattern() {
  const w = game.wave++;
  playSFX('warning');
  game.charge = PHASES[game.phase].warning;
  if (w % 3 === 2) {
    burst(game.bossX, game.bossY, 16);
    game.bossTarget = [0.25, 0.72, 0.48][Math.floor(w / 3) % 3];
    game.bossX = VIEW.w / 2 + ARENA.w * (w % 2 ? -0.16 : 0.16);
    game.teleport = 0.4;
  } else game.bossTarget = w % 2 ? 0.68 : 0.32;
  if (game.pattern === 0) spawnFlame(w);
  if (game.pattern === 1) spawnSpiral(w);
  if (game.pattern === 2) spawnSpears(w);
  if (game.pattern === 3) spawnSlash(w);
  if (game.pattern === 4) spawnZones(w);
  if (game.pattern === 5) {
    if (game.turn % 2 === 0) {
      if (w % 3 === 0) { spawnRing(w); spawnVolley(w, false, 0.4); return 4.2; }
      if (w % 3 === 1) { spawnVolley(w, true); spawnBloom(w); return 5.8; }
      // Pulse tidak ditumpuk dengan peluru: perintah DIAM harus benar-benar bisa dipatuhi.
      spawnPulse(0); spawnPulse(1, 1.45);
      return 3.2;
    }
    // Tiga pasangan dengan jeda bersih; pola berikutnya menunggu peluru lama keluar.
    if (w % 3 === 0) { spawnFlame(w); spawnSpears(w, true); return 3.2; }
    if (w % 3 === 1) { spawnSpiral(w, true); spawnWall(w, true); return 5.8; }
    spawnSlash(w); spawnSlash(w + 1, 0.8); spawnSlash(w + 2, 1.6);
    spawnFlame(w, 0.85);
    return 3.2;
  } else if (game.phase === 2 && w % 2 === 1 && game.pattern < 3) {
    spawnSlash(w + game.pattern);
  }
  if (game.pattern === 6) spawnWall(w + game.turn);
  if (game.pattern === 7) spawnPulse(w);
  if (game.pattern === 8) spawnRing(w);
  if (game.pattern === 9) spawnVolley(w, true);
  if (game.pattern === 10) { spawnVolley(w); if (game.phase > 1) spawnVolley(w + 1, false, 0.35); }
  if (game.pattern === 11) spawnBloom(w);
  return [1.35, 5.8, 1.25, 1.1, 3.6, 3.2,
    1.6 + ARENA.w / (215 * PHASES[game.phase].speed * combatScale()),
    1.55, 2.1, 2.6, 1.8, 2.1][game.pattern];
}

function releaseBullets(h) {
  const speed = PHASES[game.phase].speed * combatScale();
  if (h.type === 'spear') {
    game.bullets.push({ type: 'spear', x: h.x, y: h.y, vx: 0, vy: 390 * speed, r: 5 });
  } else if (h.type === 'ring') {
    const count = 22 + game.phase * 4;
    for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / count;
      const offset = Math.atan2(Math.sin(angle - h.angle), Math.cos(angle - h.angle));
      if (Math.abs(offset) < h.opening / 2) continue;
      game.bullets.push({ type: 'ring', x: h.x + Math.cos(angle) * 20, y: h.y + Math.sin(angle) * 20,
        vx: Math.cos(angle) * 155 * speed, vy: Math.sin(angle) * 155 * speed, r: 4 });
    }
  } else if (h.type === 'volley') {
    for (let i = 0; i < h.count; i++) {
      const angle = h.angle + (i - (h.count - 1) / 2) * h.spread;
      const velocity = (h.bounce ? 160 : 230) * speed;
      game.bullets.push({ type: h.bounce ? 'shard' : 'fire', x: h.x, y: h.y,
        vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
        r: 5, bounces: h.bounce ? 2 : 0, life: h.bounce ? 4.2 : 3 });
    }
  } else if (h.type === 'bloom') {
    const count = 7 + game.phase * 2;
    for (let i = 0; i < count; i++) {
      game.bullets.push({ type: 'petal', x: h.x, y: h.y,
        vx: (i - (count - 1) / 2) * 38 * speed, vy: -65 * speed,
        gravity: 185 * speed, r: 4, life: 3 });
    }
  } else if (h.type === 'spiral') {
    const elapsed = h.age - h.warn;
    const count = h.combo ? 4 : game.phase === 1 ? 5 : 6;
    // Satu lengan kosong menjadi celah berputar, bukan lingkaran tertutup.
    for (let i = 1; i < count; i++) {
      const angle = h.rotation + i * Math.PI * 2 / count;
      const velocity = (140 + elapsed * 16) * speed;
      game.bullets.push({ type: 'fire', x: h.x, y: h.y,
        vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, r: 5 });
    }
    const direction = game.phase === 3 && elapsed > (h.combo ? 1.2 : 1.85) ? -h.direction : h.direction;
    h.rotation += direction * (0.25 + elapsed * 0.035);
  }
}
function burst(x, y, count = 12) {
  for (let i = 0; i < count && game.particles.length < 160; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 25 + Math.random() * 110;
    game.particles.push({ x, y, vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 30, life: 0.4 + Math.random() * 0.5, boss: y < ARENA.y });
  }
}


// 4. GERAK DAN TABRAKAN. Delta time menjaga kecepatan sama di berbagai FPS.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function distanceToLine(px, py, line) {
  const dx = line.x2 - line.x;
  const dy = line.y2 - line.y;
  const t = clamp(((px - line.x) * dx + (py - line.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - line.x - t * dx, py - line.y - t * dy);
}
// Satu pintu collision: warning/objek di luar box tidak pernah memberi damage.
function checkCollision(object, previous = null) {
  const { x, y } = game;
  if (game.state !== 'bossAttack' || x < ARENA.x + 4 || x > ARENA.x + ARENA.w - 4 ||
      y < ARENA.y + 4 || y > ARENA.y + ARENA.h - 4) return false;
  const h = object;
  if (!previous) {
    if (h.age < h.warn || h.age >= h.life) return false;
    if (h.type === 'pulse') return h.rule === 'still' ? game.moving : !game.moving;
    if (h.type === 'ring') return Math.hypot(x - h.x, y - h.y) < 22;
    if (h.type === 'pillar') return x + 4 > h.x && x - 4 < h.x + h.w && y + 4 > h.y && y - 4 < h.y + h.h;
    if (h.type === 'slash') return distanceToLine(x, y, h) < h.width / 2 + 4;
    if (h.type === 'zones') return x - 4 < ARENA.x + h.safe * h.w || x + 4 > ARENA.x + (h.safe + 1) * h.w;
    if (h.type === 'wall') return Math.abs(x - h.x) < h.width / 2 + 4 && (y - 4 < h.gapY || y + 4 > h.gapY + h.gap);
    return false;
  }
  if (h.type === 'spear') return Math.abs(x - h.x) < 8 && y > Math.min(previous.y, h.y) - 14 && y < Math.max(previous.y, h.y) + 14;
  return distanceToLine(x, y, { ...previous, x2: h.x, y2: h.y }) < h.r + 4;
}
function hitPlayer() {
  if (game.invincible > 0 || game.state !== 'bossAttack') return;
  game.hp = Math.max(0, game.hp - 4);
  game.invincible = 1.1;
  game.hurtFlash = 0.28;
  game.shake = 0.2;
  burst(game.x, game.y);
  playSFX('playerHit');
  if (game.hp === 0) finishGame('defeat');
  else drawUI();
}

function updateBoss(dt) {
  const rhythm = Math.sin(game.time * PHASES[game.phase].bpm / 60 * Math.PI);
  const target = VIEW.w / 2 + (game.bossTarget - 0.5) * ARENA.w * 0.55 + Math.sin(game.time * 0.8) * ARENA.w * 0.04;
  game.bossX += (target - game.bossX) * Math.min(1, dt * (game.dash > 0 ? 15 : 1.8));
  game.bossY = bossCenterY() + (reducedMotion ? 0 : rhythm * 3);
}
// PLAYER MOVEMENT: diagonal dinormalisasi; sentuh bergerak dengan kecepatan yang sama.
function updatePlayer(dt) {
  const previousX = game.x, previousY = game.y;
  let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
  let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
  const speed = (keys.has('shift') ? 135 : 310) * combatScale();
  let step = speed * dt;
  if (touchTarget && !dx && !dy) {
    dx = touchTarget.x - game.x; dy = touchTarget.y - game.y;
    step = Math.min(step, Math.hypot(dx, dy));
  }
  const length = Math.hypot(dx, dy) || 1;
  game.x = clamp(game.x + dx / length * step, ARENA.x + 9, ARENA.x + ARENA.w - 9);
  game.y = clamp(game.y + dy / length * step, ARENA.y + 9, ARENA.y + ARENA.h - 9);
  // Ukur gerakan nyata, bukan tombol: menahan arah ke border tetap dihitung diam.
  game.moving = Math.hypot(game.x - previousX, game.y - previousY) > 0.001;
}
function moveBullet(b, dt) {
  if (b.gravity) b.vy += b.gravity * dt;
  b.x += b.vx * dt; b.y += b.vy * dt;
  if (Number.isFinite(b.life)) b.life -= dt;
  if (b.bounces > 0) {
    const left = ARENA.x + b.r, right = ARENA.x + ARENA.w - b.r;
    const top = ARENA.y + b.r, bottom = ARENA.y + ARENA.h - b.r;
    if (b.x < left || b.x > right) {
      b.x = clamp(b.x < left ? 2 * left - b.x : 2 * right - b.x, left, right);
      b.vx *= -1; b.bounces--;
    }
    if (b.y < top || b.y > bottom) {
      b.y = clamp(b.y < top ? 2 * top - b.y : 2 * bottom - b.y, top, bottom);
      b.vy *= -1; b.bounces = Math.max(0, b.bounces - 1);
    }
  }
}
function update(dt) {
  if (game.paused) return;
  game.time += dt;
  for (const timer of ['flash', 'hurtFlash', 'shake', 'transition', 'charge', 'dash', 'teleport']) {
    game[timer] = Math.max(0, game[timer] - dt);
  }
  updateBoss(dt);
  for (const p of game.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  game.particles = game.particles.filter(p => p.life > 0);
  playMusic(dt);
  if (game.state !== 'bossAttack') return;
  game.attackTime += dt;
  game.invincible = Math.max(0, game.invincible - dt);
  updatePlayer(dt);
  const duration = PHASES[game.phase].duration;
  game.spawnTime -= dt;
  if (game.spawnTime <= 0 && game.attackTime < duration - 2.6) game.spawnTime += spawnAttackPattern();
  // COLLISION DETECTION: warning tidak memberi damage, hitbox hati radius 4 pixel.
  for (const h of game.hazards) {
    h.age += dt;
    if (h.age < h.warn || h.age >= h.life) continue;
    if (!h.fired) {
      h.fired = true;
      playSFX('attack');
      if (['spear', 'ring', 'volley', 'bloom'].includes(h.type)) releaseBullets(h);
      if (['pillar', 'slash', 'zones', 'wall'].includes(h.type)) {
        game.shake = 0.22; playSFX('heavy');
        burst(h.x || ARENA.x + ARENA.w / 2, h.y || ARENA.y + ARENA.h / 2, 8);
      }
    }
    if (h.type === 'spiral') {
      h.emit -= dt;
      if (h.emit <= 0) {
        releaseBullets(h);
        h.emit += Math.max(0.15, (h.combo ? 0.28 : 0.23) - (game.phase - 1) * 0.015 - (h.age - h.warn) * 0.015);
      }
    }
    if (h.type === 'wall') {
      h.x += h.vx * dt;
      h.gapY += h.gapSpeed * dt;
      const low = ARENA.y + 8, high = ARENA.y + ARENA.h - h.gap - 8;
      if (h.gapY < low || h.gapY > high) h.gapSpeed *= -1;
      h.gapY = clamp(h.gapY, low, high);
    }
    if (checkCollision(h)) hitPlayer();
    if (game.state !== 'bossAttack') return;
  }
  game.hazards = game.hazards.filter(h => h.age < h.life);
  for (const b of game.bullets) {
    const previous = { x: b.x, y: b.y };
    moveBullet(b, dt);
    if (b.life <= 0) continue;
    // Swept collision menghindari peluru menembus pemain saat FPS rendah.
    if (checkCollision(b, previous)) hitPlayer();
    if (game.state !== 'bossAttack') return;
  }
  game.bullets = game.bullets.filter(b => !(b.life <= 0) && b.x > ARENA.x - 40 && b.x < ARENA.x + ARENA.w + 40 && b.y > ARENA.y - 40 && b.y < ARENA.y + ARENA.h + 40);
  if (game.attackTime >= duration) openMenu();
}

// 5. PIXEL ART ORIGINAL. Sprite digambar dari persegi kecil, tanpa file gambar.
const COLORS = { white: '#e9e5dc', dim: '#66635e', gold: '#dcb56d', red: '#f04a55' };
function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}
function line(x, y, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
}
function pixelSprite(rows, x, y, scale, palette) {
  rows.forEach((row, ry) => [...row].forEach((pixel, rx) => {
    if (palette[pixel]) rect(x + rx * scale, y + ry * scale, scale, scale, palette[pixel]);
  }));
}
const heartSprite = ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'];
function drawHeart(x, y, broken = false) {
  pixelSprite(heartSprite, x - 7, y - 6, 2, { r: COLORS.red });
  if (broken) { rect(x, y - 6, 2, 6, '#080909'); rect(x - 2, y, 2, 5, '#080909'); }
}
const kingSprite = [
  '.......g......g......g.......',
  '.......gg....ggg....gg.......',
  '.......gggggg.gggggggg.......',
  '........ggggg..ggggggg.......',
  '........gggggg.ggggggg.......',
  '........wwwwwwwwwwwww.......',
  '.......wwwddwwwwwddwww.......',
  '.......wwwdwwwwwwwdwww.......',
  '........wwwwwwwwwwwww.......',
  '........wwdwdddwdwwww.......',
  '.........wwddddddwww.........',
  '......dddwwwwwwwwwwwddd......',
  '....ddwwwddwwwwwwwddwwwdd....',
  '...dwwwwwddwwwwwwwddwwwwwd...',
  '..dwwwwwddddwwwwwddddwwwwwd..',
  '..dwwwwdddgddwwwddgdddwwwwd..',
  '.dwwwddddddgggwgggddddddwwwd.',
  '.dwwwdddddddgggggdddddddwwwd.',
  'dwwwdddddddddgggdddddddddwwwd',
  'dwwwddddddddddgddddddddddwwwd',
  'dwwdddddwdddddddddddwddddwwwd',
  '.wwwdddwdddddddddddddwddwww..',
  '..wwddwwdddddddddddddwwddww..',
  '...ddwwwdddddddddddddwwwdd...',
  '.....wwwdddddddddddddwww.....',
  '....wwwwdddwdddddwdddwwww....',
  '....wwwdddwdddddddwdddwww....',
  '...wwwwddwdddddddddwddwwww...',
  '...wwwdddwdddddddddwdddwww...',
  '..wwwwddwdddddddddddwddwwww..',
  '..wwwdddwdddddddddddwdddwww..',
  '.wwwwddwwdddddddddddwwddwwww.',
  '.wwwdddwwdddddddddddwwdddwww.',
  'wwwwdddwwwdddddddddwwwdddwwww',
  'wwwwwwwwwwwwwwwwwwwwwwwwwwww',
  '.....dddddd......dddddd.....',
  '....wwwwwww......wwwwwww....'
];

function drawBackdrop() {
  rect(0, 0, VIEW.w, VIEW.h, game.phase === 3 ? '#160404' : '#030303');
  // Bara dekoratif hanya di belakang boss. Isi battle box selalu hitam pekat.
  for (let i = 0; i < 22; i++) {
    const x = VIEW.w / 2 + Math.sin(i * 17.3) * Math.min(VIEW.w * 0.42, 300);
    const span = Math.max(20, 190 * bossScale());
    const y = ARENA.y - span + ((i * 43 - game.time * 9) % span + span) % span;
    rect(x, y, 2, 2, game.phase === 3 ? '#743120' : '#28221a');
  }
}

function drawFlame(x, y, scale = 1) {
  const frame = Math.floor(game.time * 7) % 2;
  const rows = frame ? ['...g...', '..gg...', '.ggwg..', '.gwwgg.', 'ggwwgg.', '.gggg..'] : ['....g..', '..g.g..', '..gwgg.', '.ggwwg.', '.gwwgg.', '..ggg..'];
  pixelSprite(rows, x - 7 * scale, y - 12 * scale, 2 * scale, { g: COLORS.gold, w: COLORS.white });
}

function drawKing() {
  const bob = reducedMotion ? 0 : Math.round(Math.sin(game.time * 1.8));
  const scale = bossScale();
  ctx.save();
  const rage = game.phase === 3 && !reducedMotion ? Math.sin(game.time * 47) * 2 : 0;
  ctx.translate(game.bossX + rage, game.bossY);
  const aura = game.phase === 3 ? '#ff593a' : '#a787db';
  ctx.strokeStyle = aura; ctx.lineWidth = game.charge > 0 ? 3 : 1;
  ctx.globalAlpha = game.charge > 0 ? 0.8 : 0.25;
  ctx.beginPath(); ctx.arc(0, 0, 52 * scale + (game.charge > 0 ? game.charge * 24 : 0), 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  if (game.phase === 3) for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9 + game.time * 0.7;
    drawFlame(Math.cos(a) * 63 * scale, Math.sin(a) * 55 * scale, 0.7);
  }
  if (game.teleport > 0) ctx.globalAlpha = 0.35 + Math.abs(Math.sin(game.teleport * 24)) * 0.65;
  ctx.scale(scale, scale);
  ctx.translate(-400, -158);
  if (game.state === 'victory' && game.result === 'victory') ctx.globalAlpha = 0.28;
  pixelSprite(kingSprite, 344, 84 + bob, 4, {
    w: game.flash > 0 ? '#ffffff' : '#d8d5cd', d: '#484946', g: '#bfa16a'
  });
  // Tombak api dengan dua kait kecil: siluet berbeda dari karakter rujukan.
  rect(480, 100 + bob, 4, 137, '#938774');
  rect(478, 139 + bob, 8, 11, '#ddd5be');
  pixelSprite(['....w....', '...www...', '...www...', '..wwwww..', '.wwwwwww.', '...www...', 'w..www..w', 'ww.www.ww', '.wwwwwww.', '...www...'], 464, 67 + bob, 4, { w: '#d8c393' });
  if (game.result !== 'mercy') drawFlame(482, 74 + bob, 1.5);
  ctx.restore();
}

function drawHazard(h) {
  if (h.age < 0) return;
  const active = h.age >= h.warn;
  const pulse = Math.floor(h.age * 9) % 2 ? '#b39158' : '#706044';
  if (h.type === 'pulse') {
    const color = h.rule === 'still' ? '#62dfff' : '#ff9d46';
    rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h, `${color}${active ? '24' : '08'}`);
    ctx.strokeStyle = color; ctx.lineWidth = active ? 4 : 2;
    ctx.setLineDash(active ? [] : [8, 8]);
    ctx.strokeRect(ARENA.x + 7, ARENA.y + 7, ARENA.w - 14, ARENA.h - 14);
    ctx.setLineDash([]);
    const cx = ARENA.x + ARENA.w / 2;
    rect(cx - 43, ARENA.y + 12, 86, 24, '#000000');
    ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = '11px "Crown Pixel", monospace';
    ctx.fillText(h.rule === 'still' ? 'II DIAM' : '>> GERAK', cx, ARENA.y + 29);
    if (!active) rect(cx - 38, ARENA.y + 37, 76 * h.age / h.warn, 2, color);
  } else if (h.type === 'ring') {
    ctx.globalAlpha = active ? 1 : 0.5;
    drawFlame(h.x, h.y + 7, 1.1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(h.x, h.y, 28, h.angle + h.opening / 2, h.angle + Math.PI * 2 - h.opening / 2); ctx.stroke();
    ctx.setLineDash([]);
    for (const edge of [-1, 1]) {
      const a = h.angle + edge * h.opening / 2;
      line(h.x + Math.cos(a) * 23, h.y + Math.sin(a) * 23, h.x + Math.cos(a) * 48, h.y + Math.sin(a) * 48, '#7fe9de', 2);
    }
  } else if (h.type === 'volley') {
    const color = h.bounce ? '#bd9eff' : '#ffbf65';
    ctx.setLineDash([4, 10]);
    for (let i = 0; i < h.count; i++) {
      const a = h.angle + (i - (h.count - 1) / 2) * h.spread;
      const length = Math.max(ARENA.w, ARENA.h);
      line(h.x, h.y, h.x + Math.cos(a) * length, h.y + Math.sin(a) * length, `${color}77`, 1);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.strokeRect(h.x - 6, h.y - 6, 12, 12);
  } else if (h.type === 'bloom') {
    ctx.strokeStyle = '#f49ab6'; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(h.x, h.y);
      ctx.quadraticCurveTo(h.x + i * 20, h.y - 24, h.x + i * 40, h.y + 55); ctx.stroke();
    }
    ctx.setLineDash([]);
    drawFlame(h.x, h.y + 6, 0.7);
  } else if (h.type === 'pillar') {
    if (!active) {
      rect(h.x, ARENA.y + ARENA.h - 5, h.w, 5, pulse);
      for (let y = h.y; y < ARENA.y + ARENA.h - 7; y += 10) rect(h.x + h.w / 2, y, 1, 4, '#564832');
      rect(h.x, h.y, h.w, h.h, '#eab25a14');
    } else {
      rect(h.x, h.y, h.w, h.h, '#e95c36a0');
      rect(h.x + h.w * 0.25, h.y, h.w * 0.5, h.h, '#ffbf65');
      rect(h.x + h.w * 0.45, h.y, h.w * 0.1, h.h, '#fff0c3');
      for (let y = h.y + 16; y < h.y + h.h; y += 42) drawFlame(h.x + h.w / 2, y, 1.3);
    }
  } else if (h.type === 'spear') {
    for (let y = ARENA.y; y < ARENA.y + ARENA.h; y += 12) rect(h.x, y, 1, 5, pulse);
    pixelSprite(['wwwww', '.www.', '..w..'], h.x - 5, ARENA.y + 4, 2, { w: COLORS.gold });
  } else if (h.type === 'zones') {
    const revealed = h.age >= h.reveal;
    for (let i = 0; i < 3; i++) {
      const safe = i === h.safe;
      const color = !revealed ? '#b1b78c' : safe ? '#7fe9de' : '#ff7059';
      const x = ARENA.x + i * h.w;
      rect(x + 2, ARENA.y, h.w - 4, ARENA.h, active && !safe ? '#e64d39b0' : `${color}16`);
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.setLineDash(!revealed ? [6, 6] : []);
      ctx.strokeRect(x + 7, ARENA.y + 7, h.w - 14, ARENA.h - 14);
      ctx.setLineDash([]);
      // Clue sejak awal: dua sudut biru selalu menandai zona asli.
      if (safe && !revealed) {
        line(x + 7, ARENA.y + 16, x + 7, ARENA.y + 7, '#7fe9de', 3);
        line(x + 7, ARENA.y + 7, x + 17, ARENA.y + 7, '#7fe9de', 3);
        line(x + h.w - 17, ARENA.y + ARENA.h - 7, x + h.w - 7, ARENA.y + ARENA.h - 7, '#7fe9de', 3);
      }
      ctx.textAlign = 'center'; ctx.fillStyle = color;
      ctx.font = '16px "Crown Pixel", monospace';
      ctx.fillText(!revealed ? '?' : safe ? 'OK' : 'X', x + h.w / 2, ARENA.y + 34);
      if (active && !safe) for (let y = ARENA.y + 60; y < ARENA.y + ARENA.h; y += 65) drawFlame(x + h.w / 2, y, 2);
    }
  } else if (h.type === 'wall') {
    const color = active ? '#fff3ca' : '#ffb52e';
    if (!active) {
      rect(h.x - 10, ARENA.y, 20, ARENA.h, '#ffb52e33');
      line(ARENA.x, h.gapY, ARENA.x + ARENA.w, h.gapY, '#71e4e4', 2);
      line(ARENA.x, h.gapY + h.gap, ARENA.x + ARENA.w, h.gapY + h.gap, '#71e4e4', 2);
    }
    for (let y = ARENA.y + 4; y < ARENA.y + ARENA.h; y += 12) {
      if (y + 5 > h.gapY && y - 5 < h.gapY + h.gap) continue;
      rect(h.x - 8, y - 2, 16, 4, color);
      const tip = h.vx > 0 ? h.x + 8 : h.x - 8;
      line(tip, y, tip - Math.sign(h.vx) * 6, y - 5, color, 2);
      line(tip, y, tip - Math.sign(h.vx) * 6, y + 5, color, 2);
    }
  } else if (h.type === 'spiral') {
    ctx.strokeStyle = pulse; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(h.x, h.y, 16 + Math.sin(h.age * 12) * 3, 0, Math.PI * 2); ctx.stroke();
    drawFlame(h.x, h.y + 5);
  } else if (h.type === 'slash') {
    ctx.setLineDash(active ? [] : [7, 7]);
    line(h.x, h.y, h.x2, h.y2, active ? '#ff6946' : '#e4a45924', h.width);
    line(h.x, h.y, h.x2, h.y2, active ? COLORS.white : pulse, active ? 10 : 2);
    if (active) line(h.x, h.y, h.x2, h.y2, COLORS.gold, 4);
    ctx.setLineDash([]);
  }
}

function drawBattleBox() {
  rect(ARENA.x - 4, ARENA.y - 4, ARENA.w + 8, ARENA.h + 8, '#ffffff');
  rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h, '#000000');
}

// UI RENDERING: dunia digambar di canvas; menu dan HP tetap elemen HTML aksesibel.
function draw() {
  ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  ctx.save();
  // Hanya latar/boss bergetar. Warning dan hitbox tidak bergeser.
  if (!reducedMotion && (game.shake > 0 || (game.phase === 3 && game.state === 'bossAttack'))) {
    const power = game.shake > 0 ? 5 : 1.5;
    ctx.translate(Math.sin(game.time * 43) * power, Math.cos(game.time * 37) * power);
  }
  drawBackdrop();
  drawKing();
  for (const p of game.particles) if (p.boss) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    rect(p.x, p.y, 3, 3, '#ffbe71');
  }
  ctx.restore();
  drawBattleBox();
  ctx.save();
  // Clipping yang sama untuk SEMUA warning, spiral, peluru, dan hati.
  ctx.beginPath(); ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h); ctx.clip();
  for (const h of game.hazards) drawHazard(h);
  for (const b of game.bullets) {
    if (b.type === 'spear') {
      rect(b.x - 1, b.y - 13, 3, 23, COLORS.gold);
      pixelSprite(['wwwww', '.www.', '..w..'], b.x - 5, b.y + 6, 2, { w: COLORS.white });
    } else {
      const color = b.type === 'shard' ? '#bd9eff' : b.type === 'petal' ? '#f49ab6' : b.type === 'ring' ? '#f5eee0' : COLORS.gold;
      if (b.type === 'shard' || b.type === 'petal') {
        line(b.x - 5, b.y, b.x, b.y - 5, color, 2);
        line(b.x, b.y - 5, b.x + 5, b.y, color, 2);
        line(b.x + 5, b.y, b.x, b.y + 5, color, 2);
        line(b.x, b.y + 5, b.x - 5, b.y, color, 2);
      } else {
        rect(b.x - 5, b.y - 3, 10, 6, color);
        rect(b.x - 3, b.y - 5, 6, 10, color);
      }
      rect(b.x - 2, b.y - 2, 4, 4, '#fff0cc');
    }
  }
  if (game.state === 'gameOver' || game.state === 'victory') {
    const center = ARENA.y + ARENA.h / 2;
    drawHeart(VIEW.w / 2, center - 30, game.state === 'gameOver');
    ctx.textAlign = 'center';
    ctx.fillStyle = game.state === 'gameOver' ? COLORS.white : COLORS.gold;
    ctx.font = `bold ${VIEW.w < 500 ? 18 : 24}px "Crown Pixel", monospace`;
    ctx.fillText(game.state === 'gameOver' ? 'GAME OVER' : 'GATE UNSEALED', VIEW.w / 2, center + 10);
    ctx.font = '11px monospace'; ctx.fillStyle = '#a7a294';
    ctx.fillText(game.state === 'gameOver' ? 'Masih ada esok untuk mencoba.' : 'Fajar tidak lagi menunggu.', VIEW.w / 2, center + 36);
  } else if (game.invincible <= 0 || Math.floor(game.invincible * 12) % 2 === 0 || game.state !== 'bossAttack') {
    drawHeart(game.x, game.y);
    if (keys.has('shift') && game.state === 'bossAttack') {
      ctx.strokeStyle = '#dfd8c1'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(game.x) - 10, Math.round(game.y) - 9, 20, 19);
      rect(game.x - 1, game.y - 1, 2, 2, '#ffffff');
    }
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h); ctx.clip();
  for (const p of game.particles) if (!p.boss) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    rect(p.x, p.y, 3, 3, game.hurtFlash > 0 ? '#ff5463' : '#ffbe71');
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (game.hurtFlash > 0) {
    ctx.globalAlpha = (reducedMotion ? 0.12 : 0.3) * game.hurtFlash / 0.28;
    rect(0, 0, VIEW.w, VIEW.h, '#ff2445'); ctx.globalAlpha = 1;
  }
  if (game.transition > 0) {
    ctx.globalAlpha = Math.min(0.8, game.transition);
    rect(ARENA.x, ARENA.y + 15, ARENA.w, 44, '#220f24');
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffc28b';
    ctx.font = `${ARENA.w < 400 ? 10 : 14}px "Crown Pixel", monospace`;
    ctx.fillText(game.phase === 3 ? 'FINAL: THE OATH IGNITES' : 'PHASE II: CROWN OF CINDERS', VIEW.w / 2, ARENA.y + 43);
    ctx.globalAlpha = 1;
  }
  if (game.state === 'bossAttack') {
    rect(ARENA.x, ARENA.y + ARENA.h + 5, ARENA.w, 2, '#302c24');
    rect(ARENA.x, ARENA.y + ARENA.h + 5, Math.max(0, ARENA.w * (1 - game.attackTime / PHASES[game.phase].duration)), 2, COLORS.gold);
  }
}

// 6. AUDIO ORIGINAL. Melodi pendek disintesis memakai Web Audio, tanpa lagu luar.
let audio = null;
let soundEnabled = true;
let lastAttackSound = -1;
// unlockAudio(): coba autoplay; ulangi dalam gesture jika browser masih menangguhkan audio.
// Listener tetap terpasang untuk pemulihan interupsi audio mobile, tanpa menggandakan context.
function unlockAudio() {
  if (!soundEnabled || game?.paused) return;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) {
    $('sound-button').disabled = true;
    $('sound-button').title = 'Web Audio tidak didukung browser ini';
    return;
  }
  try {
    if (!audio || audio.state === 'closed') audio = new AudioEngine();
    if (audio.state !== 'running') {
      audio.resume().then(() => {
        if (!soundEnabled || game?.paused) return audio.suspend();
        if (game) game.musicTime = 0;
      }).catch(() => {});
    }
  } catch {
    // Autoplay diblokir atau context belum tersedia: gameplay tetap berjalan, gesture berikutnya mencoba lagi.
  }
}
for (const event of ['click', 'keydown', 'touchstart', 'pointerdown']) {
  window.addEventListener(event, unlockAudio, { capture: true, passive: true });
}
function tone(frequency, duration, type = 'triangle', volume = 0.025, delay = 0, endFrequency = frequency) {
  if (!soundEnabled || !audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  const start = audio.currentTime + delay;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.start(start); oscillator.stop(start + duration + 0.02);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
// AUDIO SYSTEM: komposisi original 32 langkah, bass, arpeggio pulse, dan perkusi sintetis.
const SCORE = [0, 7, 12, 3, 10, 7, 1, 0, 12, 15, 7, 10, 6, 3, 1, 7,
  0, 3, 13, 12, 7, 6, 10, 3, 15, 12, 10, 7, 1, 6, 3, -1];
const hz = semitone => 110 * Math.pow(2, semitone / 12);
function playSFX(name) {
  if (name === 'attack') {
    if (!audio || audio.currentTime - lastAttackSound < 0.06) return;
    lastAttackSound = audio.currentTime;
  }
  const sounds = {
    cursor: [[680, .05, 'square', .016, 0, 900]],
    select: [[440, .09, 'square', .02], [880, .12, 'triangle', .025, .06]],
    fight: [[340, .2, 'sawtooth', .035, 0, 65]],
    bossHit: [[95, .2, 'square', .035, .12, 40]],
    playerHit: [[180, .22, 'sawtooth', .04, 0, 35]],
    warning: [[740, .09, 'square', .014], [980, .09, 'square', .014, .13]],
    attack: [[260, .07, 'triangle', .014, 0, 100]],
    heavy: [[125, .32, 'sawtooth', .025, 0, 25]],
    phase: [[110, .6, 'sawtooth', .03, 0, 440], [466, .3, 'square', .025, .25], [622, .4, 'square', .02, .5]],
    final: [[55, .7, 'sawtooth', .035, 0, 220], [311, .3, 'square', .02, .15], [440, .3, 'square', .02, .35], [622, .6, 'triangle', .035, .55]],
    gameOver: [[330, .3, 'triangle', .035], [233, .35, 'triangle', .035, .25], [110, .9, 'triangle', .035, .55, 55]],
    victory: [[220, .25, 'square', .022], [277, .25, 'square', .022, .18], [330, .3, 'square', .022, .36], [440, .8, 'triangle', .035, .6]]
  };
  for (const note of sounds[name] || []) tone(...note);
}
function playMusic(dt) {
  if (!soundEnabled || !audio || audio.state !== 'running' || ['victory', 'gameOver'].includes(game.state)) return;
  game.musicTime -= dt;
  if (game.musicTime > 0) return;
  const index = game.note++ % SCORE.length;
  const step = 60 / PHASES[game.phase].bpm / 4;
  const root = [0, -2, -5, -1][Math.floor(index / 8)];
  if (SCORE[index] >= 0) tone(hz(SCORE[index] + 12), step * 0.85, 'square', .013);
  if (index % 2 === 0) tone(hz(root + (index % 4 === 2 ? 7 : 0)), step * 1.8, 'triangle', .04);
  if (index % 4 === 0) tone(120, .13, 'sine', .06, 0, 32);
  if (index % 8 === 4) tone(190, .08, 'sawtooth', .019, 0, 65);
  if (index % 2 === 1) tone(5400, .025, 'square', .006, 0, 2700);
  if (game.phase === 3 && index % 2 === 0) tone(hz(SCORE[index] + 24), step * .5, 'triangle', .014);
  game.musicTime += step;
}
$('sound-button').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('sound-button').textContent = `♪ ${soundEnabled ? 'ON' : 'OFF'}`;
  $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
  $('sound-button').setAttribute('aria-label', soundEnabled ? 'Matikan suara' : 'Aktifkan suara');
  if (soundEnabled) unlockAudio();
  else if (audio) audio.suspend().catch(() => {});
});

// 7. INPUT DAN GAME LOOP. Jeda otomatis mencegah pemain terluka saat pindah tab.
function setPaused(paused) {
  if (!['bossAttack', 'menu', 'playerAction'].includes(game.state)) return;
  game.paused = paused;
  touchTarget = null;
  keys.clear();
  if (audio && soundEnabled) {
    (paused ? audio.suspend() : audio.resume()).catch(() => {});
  }
  $('pause-overlay').hidden = !paused;
  drawUI();
  if (paused) $('resume-button').focus({ preventScroll: true });
  else canvas.focus({ preventScroll: true });
}
for (const button of actionButtons) {
  button.addEventListener('click', () => chooseAction(button.dataset.action));
  const select = () => {
    if (button.disabled) return;
    game.menuIndex = actionButtons.indexOf(button);
    drawUI(); playSFX('cursor');
  };
  button.addEventListener('focus', select);
  button.addEventListener('pointerenter', select);
}
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else $('fullscreen-button').textContent = 'LAYAR BROWSER';
  } catch { $('fullscreen-button').textContent = 'LAYAR BROWSER'; }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen-button').textContent = document.fullscreenElement ? 'KELUAR FULLSCREEN' : 'LAYAR PENUH';
});
$('continue-button').addEventListener('click', continueGame);
$('resume-button').addEventListener('click', () => setPaused(false));
const movementKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (game.state === 'menu' && !game.paused && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd'].includes(key)) {
    event.preventDefault();
    const enabled = actionButtons.filter(button => !button.disabled);
    const index = enabled.indexOf(actionButtons[game.menuIndex || 0]);
    const direction = ['arrowleft', 'arrowup', 'a'].includes(key) ? -1 : 1;
    enabled[(index + direction + enabled.length) % enabled.length].focus({ preventScroll: true });
    return;
  }
  if (movementKeys.includes(key) && game.state === 'bossAttack' && !game.paused) {
    event.preventDefault(); keys.add(key);
  }
  if (event.repeat) return;
  if (key === 'escape' || key === 'x') {
    event.preventDefault();
    if (game.state === 'playerAction' && !game.paused) {
      Object.assign(game, game.actionSnapshot);
      game.transition = 0; game.flash = 0; game.shake = 0; game.particles = [];
      openMenu(); actionButtons[0].focus({ preventScroll: true });
    } else if (game.state === 'intro' && key === 'x') {
      game.introIndex = Math.max(0, game.introIndex - 1);
      showDialogue('KING AVARON', introLines[game.introIndex]);
    } else setPaused(!game.paused);
    return;
  }
  if (key === 'enter' || key === 'z') {
    // Enter pada utility tetap memakai perilaku tombol browser; aksi tidak terpicu dua kali.
    if (key === 'enter' && event.target.closest('.utility, #resume-button, a')) return;
    event.preventDefault();
    if (game.state === 'menu') chooseAction(actionButtons[game.menuIndex || 0].dataset.action);
    else continueGame();
    return;
  }
  if (['1', '2', '3', '4'].includes(key)) {
    event.preventDefault(); chooseAction(['fight', 'act', 'item', 'mercy'][Number(key) - 1]);
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); if (game.state === 'bossAttack') setPaused(true); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keys.clear(); if (game.state === 'bossAttack') setPaused(true); }
});
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (game.state !== 'bossAttack' || game.paused) return;
    button.setPointerCapture(event.pointerId);
    keys.add(button.dataset.key);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(name, () => keys.delete(button.dataset.key));
  }
}
// RESIZE: remap semua objek bersama agar warning dan tabrakan tetap sejajar.
function resizeGame() {
  const bounds = canvas.getBoundingClientRect();
  const hud = document.querySelector('.battle-hud').getBoundingClientRect();
  const old = { ...ARENA };
  VIEW.w = Math.max(1, bounds.width); VIEW.h = Math.max(1, bounds.height);
  VIEW.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(VIEW.w * VIEW.dpr); canvas.height = Math.round(VIEW.h * VIEW.dpr);
  ctx.imageSmoothingEnabled = false;
  document.documentElement.style.setProperty('--hud-height', `${hud.height}px`);
  // Pusatkan seluruh kelompok: status boss, sprite, arena, dan HUD.
  const short = VIEW.h < 540;
  const margin = short ? 30 : 44;
  const gap = short ? 12 : 18;
  const statusHeight = document.querySelector('.boss-status').getBoundingClientRect().height;
  const available = Math.max(100, VIEW.h - margin * 2 - statusHeight - hud.height - gap);
  ARENA.w = Math.round(Math.min(500, VIEW.w - 32));
  ARENA.h = Math.round(Math.min(300, ARENA.w * 0.6, available * 0.66));
  const bossHeight = Math.min(200, available - ARENA.h);
  VIEW.bossScale = clamp((bossHeight - 30) / 180, 0.18, 1);
  const groupHeight = statusHeight + bossHeight + ARENA.h + gap + hud.height;
  const top = Math.max(margin, (VIEW.h - groupHeight) / 2);
  ARENA.x = Math.round((VIEW.w - ARENA.w) / 2);
  ARENA.y = Math.round(top + statusHeight + bossHeight);
  document.documentElement.style.setProperty('--boss-top', `${Math.round(top)}px`);
  document.documentElement.style.setProperty('--hud-top', `${ARENA.y + ARENA.h + gap}px`);
  document.documentElement.style.setProperty('--box-width', `${ARENA.w}px`);
  if (!game) return;
  const sx = ARENA.w / old.w; const sy = ARENA.h / old.h;
  const remap = object => {
    if (Number.isFinite(object.x)) object.x = ARENA.x + (object.x - old.x) * sx;
    if (Number.isFinite(object.y)) object.y = ARENA.y + (object.y - old.y) * sy;
    if (Number.isFinite(object.x2)) object.x2 = ARENA.x + (object.x2 - old.x) * sx;
    if (Number.isFinite(object.y2)) object.y2 = ARENA.y + (object.y2 - old.y) * sy;
    if (object.w) object.w *= sx;
    if (object.h) object.h *= sy;
    if (Number.isFinite(object.gapY)) object.gapY = ARENA.y + (object.gapY - old.y) * sy;
    if (object.gap) object.gap *= sy;
    if (object.gapSpeed) object.gapSpeed *= sy;
    if (object.type === 'wall') object.width *= sx;
  };
  remap(game);
  game.x = clamp(game.x, ARENA.x + 9, ARENA.x + ARENA.w - 9);
  game.y = clamp(game.y, ARENA.y + 9, ARENA.y + ARENA.h - 9);
  for (const object of [...game.hazards, ...game.bullets, ...game.particles]) remap(object);
  game.bossX = clamp(ARENA.x + (game.bossX - old.x) * sx, VIEW.w * .15, VIEW.w * .85);
  game.bossY = bossCenterY();
  touchTarget = null;
  // Orientasi/resize tidak menghukum pemain dengan bahaya yang tiba-tiba bergeser.
  if (game.state === 'bossAttack') game.invincible = Math.max(game.invincible, 0.8);
  draw(); // Resize menghapus bitmap canvas; gambar ulang agar tidak ada frame kosong.
}
function setTouchTarget(event) {
  const bounds = canvas.getBoundingClientRect();
  touchTarget = { x: clamp(event.clientX - bounds.left, ARENA.x + 9, ARENA.x + ARENA.w - 9),
    y: clamp(event.clientY - bounds.top, ARENA.y + 9, ARENA.y + ARENA.h - 9) };
}
canvas.addEventListener('pointerdown', event => {
  if (game.state !== 'bossAttack' || game.paused || touchPointer !== null) return;
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
  if (x < ARENA.x || x > ARENA.x + ARENA.w || y < ARENA.y || y > ARENA.y + ARENA.h) return;
  event.preventDefault(); touchPointer = event.pointerId;
  canvas.setPointerCapture(event.pointerId); setTouchTarget(event);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId === touchPointer) setTouchTarget(event);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, event => {
    if (event.pointerId === touchPointer) { touchPointer = null; touchTarget = null; }
  });
}
window.addEventListener('resize', resizeGame);
const resizeObserver = new ResizeObserver(resizeGame);
resizeObserver.observe(document.querySelector('.battle-hud'));
resizeObserver.observe(document.querySelector('.game-shell'));
// GAME LOOP: langkah maksimal 1/120 detik mengurangi tunneling tanpa mengubah kecepatan.
let lastFrame = 0;
function frame(timestamp) {
  const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.033) : 0;
  lastFrame = timestamp;
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  for (let i = 0; i < steps; i++) update(dt / steps);
  draw();
  requestAnimationFrame(frame);
}
resizeGame();
resetGame();
unlockAudio();
requestAnimationFrame(frame);

