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
  { speed: 1.25, warning: 0.58, duration: 13, bpm: 156, name: 'I · OPENING TRIAL' },
  { speed: 1.5, warning: 0.5, duration: 15, bpm: 172, name: 'II · ROYAL PRESSURE' },
  { speed: 1.7, warning: 0.46, duration: 17, bpm: 188, name: 'III · BROKEN CROWN' },
  { speed: 1.9, warning: 0.42, duration: 27, bpm: 208, name: 'IV · LAST GATE COLLAPSE' }
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
    spawnTime: 0, healTime: 5, wave: 0, pattern: 0, hazards: [], bullets: [], particles: [],
    bossX: VIEW.w / 2, bossY: bossCenterY(), bossTarget: 0.5,
    charge: 0, dash: 0, teleport: 0, shake: 0, hurtFlash: 0,
    introIndex: 0, actCount: 0, paused: false, flash: 0,
    movement: 'free', vy: 0, driftX: 0, driftY: 0, grounded: false, jumpHeld: false,
    ruleKnown: false, pendingTrap: false, attackDuration: 13, afterimages: [], attackSide: 0,
    gx: 0, gy: 1, lane: 1, laneHeld: 0, bossMotion: 0, motionTime: 0, shield: 0, guardFlash: 0
  };
  touchTarget = null;
  touchPointer = null;
  $('pause-overlay').hidden = true;
  showDialogue('KING AVARON', introLines[0]);
  $('continue-button').innerHTML = 'ENTER <span aria-hidden="true">↵</span>';
  drawUI();
  syncMusic(true);
}

const introLines = [
  '“Di balik gerbang ini, tak ada takhta. Hanya dunia yang belum mengenal lukanya.”',
  '“Aku Avaron. Mahkotaku retak, tetapi sumpahku belum. Tunjukkan apa yang kau lindungi.”',
  'WASD / panah: bergerak. Shift: pelan. Enter: pilih. Esc: jeda. Di layar sentuh, geser hati atau gunakan panah.'
];

function showDialogue(speaker, text) {
  $('speaker').textContent = speaker;
  $('dialogue').textContent = text;
  playSFX(speaker.includes('KING') ? 'voice' : 'text');
}

function isFinalPhase() { return game.bossHp > 0 && game.bossHp < MAX_BOSS_HP * 0.25; }
function canSpare() { return game.bossHp <= MAX_BOSS_HP * 0.2; }
// BOSS PHASE SYSTEM: perubahan hanya menaikkan fase; restart mengembalikan fase I.
function updatePhase() {
  const phase = isFinalPhase() ? 4 : game.bossHp < MAX_BOSS_HP * 0.5 ? 3 : game.bossHp <= MAX_BOSS_HP * 0.75 ? 2 : 1;
  if (phase <= game.phase || game.bossHp <= 0) return;
  game.phase = phase;
  game.transition = 1.6;
  game.shake = 0.55;
  game.bossTarget = phase === 4 ? 0.7 : 0.3;
  playSFX(phase === 4 ? 'final' : 'phase');
}
function combatScale() { return clamp(Math.min(ARENA.w / 800, ARENA.h / 480), 0.45, 1); }
function bossScale() { return VIEW.bossScale; }
function clampBossX(x) { return clamp(x, 90 * bossScale() + 8, VIEW.w - 104 * bossScale() - 8); }
function bossCenterY() { return ARENA.y - 30 - 78 * bossScale(); }

function drawUI() {
  $('player-hp').textContent = `${game.hp} / ${MAX_HP}`;
  $('boss-hp').textContent = `${game.bossHp} / ${MAX_BOSS_HP}`;
  $('player-fill').style.width = `${game.hp / MAX_HP * 100}%`;
  $('boss-fill').style.width = `${game.bossHp / MAX_BOSS_HP * 100}%`;
  $('player-meter').setAttribute('aria-valuenow', game.hp);
  $('boss-meter').setAttribute('aria-valuenow', game.bossHp);
  $('item-count').textContent = `ITEM ${game.items}/2`;
  $('phase-label').textContent = PHASES[game.phase].name;
  document.body.dataset.movement = game.movement;
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
  setMovement('free');
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
    actCount: game.actCount, phase: game.phase, ruleKnown: game.ruleKnown, pendingTrap: game.pendingTrap };
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
    text = game.ruleKnown ? lines[game.actCount++ % lines.length]
      : 'Kau membaca sumpahnya: MERAH hindari, BIRU diam, ORANYE bergerak. Saat platform muncul, tekan Atas / W / Spasi untuk melompat.';
    game.ruleKnown = true;
  } else if (action === 'item') {
    if (game.items === 0) return;
    game.items--;
    const healed = Math.min(20, MAX_HP - game.hp);
    game.hp += healed;
    text = `Kau memakan Roti Fajar. Hangatnya memulihkan ${healed} HP. Tersisa ${game.items} roti.`;
    tone(660, 0.18, 'triangle');
  } else if (action === 'mercy') {
    if (canSpare()) { finishGame('mercy'); return; }
    game.pendingTrap = true;
    text = '“Belas kasih bukan jalan pintas.” Tombaknya berkilat. Bertahan dari jebakan singkat; MERCY terbuka pada 20% HP.';
    playSFX('trap');
  } else return;
  game.state = 'playerAction';
  showDialogue(action === 'act' || action === 'mercy' ? 'KING AVARON' : 'WANDERER', text);
  drawUI();
  $('continue-button').focus({ preventScroll: true });
}


function continueGame() {
  if (game.paused) return;
  if (['intro', 'playerAction', 'victory', 'gameOver'].includes(game.state)) playSFX('confirm');
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
  const deck = game.phase === 1 ? [15, 17, 19, 16, 8] : game.phase === 2 ? [16, 19, 15, 6, 18, 7] : [19, 18, 17, 16, 13, 7];
  game.pattern = game.pendingTrap ? 14 : game.phase === 4 ? 5 : deck[game.turn % deck.length];
  if (game.pattern === 7 && !game.ruleKnown) {
    game.state = 'playerAction'; game.ruleKnown = true;
    showDialogue('ACT — MEMBACA SUMPAH', 'MERAH: hindari. BIRU: aman saat diam. ORANYE: aman saat bergerak. Warna dan simbol pada peluru menunjukkan aturannya.');
    drawUI(); return;
  }
  game.state = 'bossAttack';
  game.attackDuration = game.pendingTrap ? 6 : PHASES[game.phase].duration;
  game.pendingTrap = false;
  setMovement(game.pattern === 19 ? 'shield' : game.pattern === 13 ? 'platform' : 'free');
  game.afterimages = [];
  if (game.pattern === 5) playSFX('ultimate');
  game.turn++;
  game.attackTime = 0;
  game.healTime = 5;
  game.spawnTime = 0.9;
  game.wave = 0;
  game.hazards = [];
  game.bullets = [];
  game.x = ARENA.x + ARENA.w / 2;
  game.y = ARENA.y + ARENA.h * 0.75;
  if (game.movement === 'shield') game.y = ARENA.y + ARENA.h / 2;
  game.invincible = 0.8;
  touchTarget = null;
  keys.clear();
  const tips = [
    'Api mengunci posisi TERAKHIR hatimu. Tinggalkan kolom bertanda sebelum menyala.',
    'Spiral makin cepat. Bergerak mengikuti celah, jangan mendekati sumber api.',
    'Tombak berganti: acak, berbaris, lalu membidikmu. Baca jalur putus-putus.',
    'Tiga arah tebasan bergantian. Garis lebar bertanda akan menyala; menjauh tegak lurus.',
    'Sudut biru menandai zona asli. Pindah sebelum zona X terbakar.',
    'Combo berganti tiap giliran. Ambil tanda + hijau untuk memulihkan 6 HP. Tetap baca celah dan warning.',
    'Dinding tombak mendekat. Pindah ke celah bertanda dua garis biru sebelum dinding melintas.',
    'SUMPAH DUA WARNA — Biru: diam. Oranye: terus bergerak saat nyalanya aktif.',
    'MAHKOTA PECAH — Cincin mengembang. Lewati bukaan biru; jangan terjebak dekat sumber.',
    'BARA PANTUL — Pecahan memantul dua kali. Perhatikan arah setelah menyentuh border.',
    'TENUN BARA — Tembakan mengunci posisi terakhir. Tinggalkan garis bidik sebelum dilepas.',
    'HUJAN KELOPAK — Bara melengkung lalu jatuh. Cari sela saat kipas mulai terbuka.',
    'TARIKAN MAHKOTA — Panah ungu menunjukkan gravitasi. Lawan tarikan sambil menghindari tembakan.',
    'PIJAKAN ABU — Atas / W / Spasi: lompat. Naiki platform sebelum lantai terbakar; pijakan berkedip sebelum hilang.',
    'SUMPAH PALSU — Tinggalkan garis bidik, baca tebasan. Jebakan berakhir setelah enam detik.',
    'RODA HUKUM — Gravitasi berputar! Spasi / ↥: lompat menjauhi dinding. Lepas lebih cepat untuk lompat pendek.',
    'BENANG TAKDIR — Atas/bawah: pindah jalur. Kiri/kanan: bergerak di jalur. Hindari dua jalur bertanda.',
    'PENGADILAN SINAR — Meriam mengunci posisi saat muncul. Keluar dari garis bidik sebelum sinar menyala.',
    'CROSSFIRE — Tinggalkan titik bidik. Meriam bersilang, lalu cincin menutup ruang gerak.',
    'PERISAI HIJAU — Hati terkunci di tengah. WASD / panah: hadapkan perisai ke asal panah. Panah biru tiba paling dahulu.'
  ];
  showDialogue(isFinalPhase() ? 'KING AVARON — SUMPAH TERAKHIR' : 'BERTAHAN', tips[game.pattern]);
  drawUI();
  canvas.focus({ preventScroll: true });
}

function finishGame(result) {
  game.state = result === 'defeat' ? 'gameOver' : 'victory';
  syncMusic();
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
function spawnHeal() {
  const offset = (game.wave % 2 ? -1 : 1) * 85 * combatScale();
  let x = clamp(game.x + offset, ARENA.x + 18, ARENA.x + ARENA.w - 18), y = game.y;
  if (game.movement === 'shield') { x = ARENA.x + ARENA.w / 2; y = ARENA.y + ARENA.h / 2; }
  else if (game.movement === 'gravity') {
    if (game.gx) { x = game.gx > 0 ? ARENA.x + ARENA.w - 12 : ARENA.x + 12; y += offset; }
    else y = game.gy > 0 ? ARENA.y + ARENA.h - 12 : ARENA.y + 12;
  } else if (game.movement === 'lanes') y = ARENA.y + ARENA.h * (game.lane + 1) / 4;
  else if (game.movement === 'platform') {
    const platforms = game.hazards.filter(h => h.type === 'platform' && h.age >= h.warn && h.life - h.age > 1);
    const nearest = platforms.sort((a, b) => Math.abs(a.x + a.w / 2 - game.x) - Math.abs(b.x + b.w / 2 - game.x))[0];
    if (nearest) { x = nearest.x + nearest.w / 2; y = nearest.y - 14; }
    else y = ARENA.y + ARENA.h - 14;
  }
  addHazard('heal', { x, y: clamp(y, ARENA.y + 12, ARENA.y + ARENA.h - 12) }, .4, 5);
}
function spawnFlame(w, delay = 0) {
  const width = clamp(ARENA.w * 0.085, 24, 44);
  // Posisi dikunci saat warning, tidak mengejar pemain setelah tanda muncul.
  const targets = [game.x];
  if (game.phase > 1) targets.push(game.x + (w % 2 ? -1 : 1) * ARENA.w * 0.25);
  if (game.phase >= 3) targets.push(game.x - (w % 2 ? -1 : 1) * ARENA.w * 0.25);
  for (const x of targets) addHazard('pillar', {
    x: clamp(x - width / 2, ARENA.x, ARENA.x + ARENA.w - width),
    y: ARENA.y, w: width, h: ARENA.h, age: -delay
  }, undefined, 0.55);
}
function spawnSpiral(w, combo = false) {
  if (game.hazards.some(h => h.type === 'spiral')) return;
  addHazard('spiral', { x: clamp(game.bossX, ARENA.x + ARENA.w * .25, ARENA.x + ARENA.w * .75),
    y: ARENA.y + ARENA.h * (combo ? .18 : .42), twin: game.phase > 1,
    rotation: w * 0.7, emit: 0, combo, direction: w % 2 ? -1 : 1 }, undefined, combo ? 2 : 3);
}
function spawnSpears(w, combo = false) {
  const count = combo ? 7 : game.phase + 7;
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
  addHazard('slash', { x: x1, y: y1, x2, y2, width: Math.max(18, ARENA.w * .03), age: -delay }, .5 - game.phase * .04, .23);
  game.dash = 0.32;
  playSFX('dash'); playSFX('slashWarning');
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
function spawnWall(w, combo = false, delay = 0) {
  const gap = Math.min(ARENA.h * .5, Math.max(44, ARENA.h * (combo ? .29 : .2)));
  const center = clamp(ARENA.y + ARENA.h * [0.18, 0.5, 0.82, 0.5][w % 4],
    ARENA.y + gap / 2 + 10, ARENA.y + ARENA.h - gap / 2 - 10);
  const side = game.attackSide || (w % 2 ? 1 : -1);
  const velocity = -side * 295 * PHASES[game.phase].speed * combatScale();
  addHazard('wall', { x: side > 0 ? ARENA.x + ARENA.w - 12 : ARENA.x + 12,
    y: ARENA.y, gapY: center - gap / 2, gap, vx: velocity, width: 20,
    gapSpeed: !combo ? (w % 2 ? -1 : 1) * 45 * combatScale() : 0,
    feint: !combo && w % 4 === 3, age: -delay },
    // Waktu warning cukup untuk mencapai celah, bahkan saat hati dekat sisi datangnya wall.
    Math.max(.65, Math.abs(game.y - center) / (420 * combatScale()) + .25),
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
  const side = game.attackSide || (w % 2 ? 1 : -1);
  const x = ARENA.x + (side > 0 ? ARENA.w - 12 : 12);
  const y = ARENA.y + ARENA.h * (w % 3 === 0 ? 0.22 : 0.78);
  addHazard('volley', { x, y, angle: Math.atan2(game.y - y, game.x - x),
    count: bounce ? 3 : 3 + game.phase, spread: bounce ? 0.32 : 0.19,
    bounce, age: -delay }, bounce ? 0.8 : 0.65, 0.05);
}
function spawnBloom(w) {
  addHazard('bloom', { x: ARENA.x + ARENA.w * (w % 2 ? 0.7 : 0.3),
    y: ARENA.y + Math.min(40, ARENA.h * 0.3) }, 0.75, 0.05);
}
function spawnGravity(w) {
  const [gx, gy] = [[-1, 0], [0, 1], [1, 0], [0, -1]][w % 4];
  addHazard('gravity', { gx, gy }, .75, 2.6);
  playSFX('gravity');
}
function spawnRuleBullets(w) {
  const rule = w % 2 ? 'move' : 'still';
  addHazard('ribbon', { rule, fromRight: w % 2 === 1 }, .85, .05);
  playSFX('rule');
}
function spawnPlatforms(w) {
  if (game.movement !== 'platform') setMovement('platform');
  for (let i = 0; i < 3; i++) addHazard('platform', {
    x: ARENA.x + ARENA.w * (.13 + i * .25), y: ARENA.y + ARENA.h * (i === 1 ? .73 : .58),
    w: ARENA.w * .24, h: 6
  }, .65, 4.8);
  addHazard('pillar', { x: ARENA.x, y: ARENA.y + ARENA.h * .82, w: ARENA.w, h: ARENA.h * .18 }, 1.45, 2.8);
  if (w % 2) spawnVolley(w);
  playSFX('platform');
}
function setMovement(mode, gx = 0, gy = 1) {
  if (game.movement === 'shield' && mode !== 'shield') game.hazards = game.hazards.filter(h => h.type !== 'guardArrow');
  game.movement = mode; game.gx = gx; game.gy = gy;
  game.vy = 0; game.driftX = 0; game.driftY = 0;
  game.grounded = false; game.jumpHeld = false; game.laneHeld = 0;
  game.lane = clamp(Math.round((game.y - ARENA.y) / ARENA.h * 4 - 1), 0, 2);
  if (mode === 'shield') {
    game.x = ARENA.x + ARENA.w / 2; game.y = ARENA.y + ARENA.h / 2;
    game.shield = 0; game.guardFlash = 0;
    game.bullets = []; game.hazards = game.hazards.filter(h => h.type === 'heal');
    for (const heal of game.hazards) { heal.x = game.x; heal.y = game.y; }
  }
  document.body.dataset.movement = mode;
}
function faceShield(key) {
  const direction = { w: 0, arrowup: 0, d: 1, arrowright: 1, s: 2, arrowdown: 2, a: 3, arrowleft: 3 }[key];
  if (game.movement === 'shield' && direction !== undefined) game.shield = direction;
}
function spawnShieldArrows(w) {
  if (game.movement !== 'shield') setMovement('shield');
  const sequence = [0, 1, 2, 3, 1, 3, 0, 2];
  const spacing = .5 - game.phase * .045;
  for (let i = 0; i < 3; i++) addHazard('guardArrow', {
    direction: sequence[(w * 3 + i + game.turn) % sequence.length],
    travel: 1.05 - game.phase * .08, age: -i * spacing
  }, .5, 1.08 - game.phase * .08);
  return spacing * 3 + .18;
}
function spawnGravityRun(w) {
  const [gx, gy] = [[0, 1], [1, 0], [0, -1], [-1, 0]][w % 4];
  addHazard('shift', { gx, gy }, .85, .12);
  const vertical = gy !== 0, scale = combatScale();
  const length = vertical ? ARENA.w : ARENA.h;
  const velocity = (game.phase >= 3 ? 330 : 275) * scale;
  for (let i = 0; i < 3; i++) {
    const size = (i % 2 ? 96 : 50) * scale, thickness = 22 * scale;
    const fromEnd = w % 2 === 1;
    const start = (vertical ? ARENA.x : ARENA.y) + (fromEnd ? length : -thickness);
    addHazard('hurdle', {
      x: vertical ? start : gx > 0 ? ARENA.x + ARENA.w - size : ARENA.x,
      y: vertical ? gy > 0 ? ARENA.y + ARENA.h - size : ARENA.y : start,
      w: vertical ? thickness : size, h: vertical ? size : thickness,
      vx: vertical ? (fromEnd ? -velocity : velocity) : 0,
      vy: vertical ? 0 : (fromEnd ? -velocity : velocity), age: -1.15 - i * .62
    }, .55, length / velocity + .25);
  }
  playSFX('gravity');
  return 3.5 + length / velocity;
}
function spawnCannons(w, lanes = false, count = lanes ? 2 : Math.min(4, game.phase + 1)) {
  const safe = (w + 1) % 3;
  for (let i = 0; i < count; i++) {
    const lane = (safe + i + 1) % 3;
    const fromRight = (w + i + (game.bossX > VIEW.w / 2 ? 1 : 0)) % 2;
    const x = ARENA.x + (fromRight ? ARENA.w - 14 : 14);
    const y = ARENA.y + ARENA.h * (lanes ? (lane + 1) / 4 : [.12, .88, .35, .65][(w + i) % 4]);
    const angle = lanes ? (fromRight ? Math.PI : 0) : Math.atan2(game.y - y, game.x - x);
    addHazard('beam', { x, y, x2: x + Math.cos(angle) * ARENA.w * 2,
      y2: y + Math.sin(angle) * ARENA.w * 2, width: (lanes ? 30 : 40) * combatScale(),
      angle, age: -i * (lanes ? 0 : .18) }, lanes ? .85 : .78, .4);
  }
}
// Posisi teleport menentukan sisi asal volley/wall dan titik spiral berikutnya.
function prepareBossAttack(w) {
  game.bossMotion = (w + game.turn) % 5; game.motionTime = 0;
  game.attackSide = [-1, 0, 1, 0][(w + game.turn) % 4];
  game.bossTarget = .5 + game.attackSide * .4;
  if (game.phase > 1 || w % 2) {
    game.afterimages.push({ x: game.bossX, y: game.bossY, life: .45 });
    game.bossX = clampBossX(VIEW.w / 2 + game.attackSide * ARENA.w * .22);
    game.teleport = .32;
    playSFX('teleport');
  }
}
function spawnAttackPattern() {
  const w = game.wave++;
  playSFX('warning');
  game.charge = PHASES[game.phase].warning;
  prepareBossAttack(w);
  if (game.pattern === 0) spawnFlame(w);
  if (game.pattern === 1) spawnSpiral(w);
  if (game.pattern === 2) spawnSpears(w);
  if (game.pattern === 3) for (let i = 0; i < Math.min(5, game.phase); i++) spawnSlash(w + i, i * .58);
  if (game.pattern === 4) spawnZones(w);
  if (game.pattern === 5) {
    // Urutan cepat dengan jeda transisi mode; aturan DIAM tidak dicampur tarikan gravitasi.
    if (w % 5 === 0) { setMovement('free'); spawnSpiral(w, true); spawnWall(w, true); return 5.4; }
    if (w % 5 === 1) { setMovement('free'); spawnFlame(w); spawnCannons(w); for (let i = 0; i < 4; i++) spawnSlash(w + i, .45 + i * .55); return 3.4; }
    if (w % 5 === 2) { setMovement('free'); spawnGravity(w + game.turn); spawnVolley(w); return spawnGravityRun(game.turn); }
    if (w % 5 === 3) { spawnPlatforms(w); spawnCannons(w); return 5.8; }
    spawnShieldArrows(w); return 3;
  }
  if (game.pattern === 6) {
    spawnWall(w + game.turn);
    const wall = game.hazards[game.hazards.length - 1];
    if (game.phase > 1) {
      addHazard('wall', { ...wall, x: wall.vx > 0 ? ARENA.x + ARENA.w - 12 : ARENA.x + 12,
        vx: -wall.vx, age: -1.15, feint: false });
      spawnSlash(w, .8);
      return wall.life + 1.5;
    }
  }
  if (game.pattern === 7) spawnRuleBullets(w);
  if (game.pattern === 8) spawnRing(w);
  if (game.pattern === 9) spawnVolley(w, true);
  if (game.pattern === 10) { spawnVolley(w); if (game.phase > 1) spawnVolley(w + 1, false, 0.35); }
  if (game.pattern === 11) spawnBloom(w);
  if (game.pattern === 12) { spawnGravity(w); spawnVolley(w, false, .25); }
  if (game.pattern === 13) spawnPlatforms(w);
  if (game.pattern === 14) { spawnVolley(w); spawnSlash(w, .55); return 1.6; }
  if (game.pattern === 15) return spawnGravityRun(w + game.turn - 1);
  if (game.pattern === 16) { if (game.movement !== 'lanes') setMovement('lanes'); spawnCannons(w, true); return 1.45; }
  if (game.pattern === 17) { spawnCannons(w); if (w % 2) spawnVolley(w, false, .4); return 1.65; }
  if (game.pattern === 18) { setMovement('free'); spawnCannons(w); if (w % 2) spawnRing(w); return 2; }
  if (game.pattern === 19) return spawnShieldArrows(w);
  return [1.05, 5.2, .95, .8 + game.phase * .6, 3.6, 3.2,
    1 + ARENA.w / (295 * PHASES[game.phase].speed * combatScale()),
    3.8, 1.7, 2.3, 1.45, 1.7, 3.8, 5.8][game.pattern];
}

function releaseBullets(h) {
  const speed = PHASES[game.phase].speed * combatScale();
  if (h.type === 'spear') {
    game.bullets.push({ type: 'spear', x: h.x, y: h.y, vx: 0, vy: 520 * speed, r: 5 });
  } else if (h.type === 'ribbon') {
    const gapY = clamp(game.y - 32, ARENA.y + 12, ARENA.y + ARENA.h - 76);
    for (let y = ARENA.y + 12; y < ARENA.y + ARENA.h; y += Math.max(18, 26 * combatScale())) {
      if (y > gapY && y < gapY + 64) continue;
      game.bullets.push({ type: 'rule', rule: h.rule, x: h.fromRight ? ARENA.x + ARENA.w - 8 : ARENA.x + 8,
        y, vx: (h.fromRight ? -1 : 1) * 330 * speed, vy: 0, r: 6, life: 3 });
    }
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
    const count = h.combo ? 5 : game.phase === 1 ? 5 : 7;
    // Satu lengan kosong menjadi celah berputar, bukan lingkaran tertutup.
    for (const arm of h.twin ? [-1, 1] : [0]) for (let i = 1; i < count; i++) {
      const angle = h.rotation * (arm || 1) + i * Math.PI * 2 / count;
      const velocity = (140 + elapsed * 16) * speed;
      game.bullets.push({ type: 'fire', x: h.x + arm * ARENA.w * .055, y: h.y,
        vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, r: 5, life: h.combo ? 2.6 : 3.5 });
    }
    const direction = elapsed > (h.combo ? 1 : 1.5) ? -h.direction : h.direction;
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
  if (h.rule && previous && (h.rule === 'still' ? !game.moving : game.moving)) return false;
  if (!previous) {
    if (h.age < h.warn || h.age >= h.life) return false;
    if (h.type === 'pulse') return h.rule === 'still' ? game.moving : !game.moving;
    if (h.type === 'ring') return Math.hypot(x - h.x, y - h.y) < 22;
    if (h.type === 'pillar' || h.type === 'hurdle') return x + 4 > h.x && x - 4 < h.x + h.w && y + 4 > h.y && y - 4 < h.y + h.h;
    if (h.type === 'slash' || h.type === 'beam') return distanceToLine(x, y, h) < h.width / 2 + 4;
    if (h.type === 'zones') return x - 4 < ARENA.x + h.safe * h.w || x + 4 > ARENA.x + (h.safe + 1) * h.w;
    if (h.type === 'wall') return !(h.age < h.safeUntil) && Math.abs(x - h.x) < h.width / 2 + 4 && (y - 4 < h.gapY || y + 4 > h.gapY + h.gap);
    return false;
  }
  if (h.type === 'spear') return Math.abs(x - h.x) < 8 && y > Math.min(previous.y, h.y) - 14 && y < Math.max(previous.y, h.y) + 14;
  return distanceToLine(x, y, { ...previous, x2: h.x, y2: h.y }) < h.r + 4;
}
function hitPlayer() {
  if (game.invincible > 0 || game.state !== 'bossAttack') return;
  game.hp = Math.max(0, game.hp - 4);
  game.invincible = .32; // Cluster berbahaya lebih cepat, hit pada frame yang sama tetap dibatasi.
  game.hurtFlash = 0.28;
  game.shake = 0.2;
  burst(game.x, game.y);
  playSFX('playerHit');
  if (game.hp === 0) finishGame('defeat');
  else drawUI();
}

function updateBoss(dt) {
  game.motionTime += dt;
  const rhythm = Math.sin(game.time * PHASES[game.phase].bpm / 60 * Math.PI);
  const t = game.motionTime, active = game.state === 'bossAttack';
  let offset = game.bossTarget - .5, lift = 0, chase = 2;
  if (active) {
    if (game.bossMotion === 0) { offset = Math.sin(t * 4.8) * .58; lift = Math.cos(t * 4.8) * 18; chase = 9; } // Orbit cepat.
    if (game.bossMotion === 1) { offset = (t % 1.1 < .3 ? -1 : 1) * (Math.floor(t / 1.1) % 2 ? -1 : 1) * .58; chase = t % 1.1 < .3 ? 6 : 24; } // Dash berulang setelah feint.
    if (game.bossMotion === 2) { offset = Math.sin(t * 5.6) * .58; lift = -Math.abs(Math.sin(t * 2.8)) * 34; chase = 18; } // Lompatan zig-zag.
    if (game.bossMotion === 3) {
      const beat = game.phase >= 3 ? .44 : .55;
      offset = (Math.floor(t / beat) % 3 - 1) * .58;
      if (Math.floor(t / beat) !== Math.floor((t - dt) / beat)) {
        game.afterimages.push({ x: game.bossX, y: game.bossY, life: .45 });
        game.bossX = clampBossX(VIEW.w / 2 + offset * ARENA.w * .55);
        game.teleport = .26; playSFX('teleport');
      }
    }
    if (game.bossMotion === 4) { offset = ((game.x - ARENA.x) / ARENA.w - .5) * 1.2; lift = -Math.abs(Math.sin(t * 3)) * 32; chase = 15; } // Mengejar lalu menukik berulang.
  }
  const target = VIEW.w / 2 + offset * ARENA.w * .55;
  game.bossX = clampBossX(game.bossX + (target - game.bossX) * Math.min(1, dt * (game.dash > 0 ? 18 : chase)));
  game.bossY = bossCenterY() + (reducedMotion ? 0 : (rhythm * 4 + lift) * bossScale());
  // Gerakan boss mengubah asal meriam. Tetap beri bidikan penuh, dan jangan ganggu mode lompat/jalur.
  if (active && game.phase >= 2 && game.movement === 'free' && game.attackTime < game.attackDuration - 2 &&
      Math.floor(t / 1.7) > Math.floor((t - dt) / 1.7) && !game.hazards.some(h => h.type === 'beam' || h.type === 'ribbon' || h.type === 'shift')) {
    spawnCannons(game.wave, false, 1);
  }
  for (const ghost of game.afterimages) ghost.life -= dt;
  game.afterimages = game.afterimages.filter(ghost => ghost.life > 0);
  if (!reducedMotion && active && Math.floor(game.time * 8) !== Math.floor((game.time - dt) * 8)) {
    game.afterimages.push({ x: game.bossX + Math.sin(game.time * 9) * 45, y: game.bossY, life: .4 });
  }
}
// PLAYER MOVEMENT: diagonal dinormalisasi; sentuh bergerak dengan kecepatan yang sama.
function updatePlayer(dt) {
  if (game.movement === 'shield') {
    game.x = ARENA.x + ARENA.w / 2; game.y = ARENA.y + ARENA.h / 2;
    if (touchTarget) {
      const dx = touchTarget.x - game.x, dy = touchTarget.y - game.y;
      if (Math.hypot(dx, dy) > 10) game.shield = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    }
    game.moving = false; return;
  }
  const previousX = game.x, previousY = game.y;
  let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
  let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
  const scale = combatScale();
  const speed = (keys.has('shift') ? 175 : 420) * scale;
  let step = speed * dt;
  if (touchTarget && !dx && !dy) {
    dx = touchTarget.x - game.x; dy = touchTarget.y - game.y;
    step = Math.min(step, Math.hypot(dx, dy));
  }
  if (game.movement === 'gravity') {
    const jump = keys.has(' ') || keys.has('jump') || (game.gy > 0 ? keys.has('w') || keys.has('arrowup') : game.gy < 0 ? keys.has('s') || keys.has('arrowdown') : game.gx > 0 ? keys.has('a') || keys.has('arrowleft') : keys.has('d') || keys.has('arrowright'));
    if (jump && !game.jumpHeld && game.grounded) { game.vy = -610 * scale; game.grounded = false; playSFX('jump'); }
    if (!jump && game.jumpHeld && game.vy < -230 * scale) game.vy = -230 * scale;
    game.jumpHeld = jump;
    game.vy = Math.min(850 * scale, game.vy + 1650 * scale * dt);
    if (game.gy) game.x += Math.sign(dx) * Math.min(speed * dt, Math.abs(dx) > 1 ? Math.abs(dx) : Infinity);
    else game.y += Math.sign(dy) * Math.min(speed * dt, Math.abs(dy) > 1 ? Math.abs(dy) : Infinity);
    game.x += game.gx * game.vy * dt; game.y += game.gy * game.vy * dt;
    game.grounded = game.gx > 0 ? game.x >= ARENA.x + ARENA.w - 9 : game.gx < 0 ? game.x <= ARENA.x + 9 : game.gy > 0 ? game.y >= ARENA.y + ARENA.h - 9 : game.y <= ARENA.y + 9;
    if (game.grounded) game.vy = 0;
  } else if (game.movement === 'lanes') {
    game.x += Math.sign(dx) * Math.min(speed * dt, touchTarget && !keys.size ? Math.abs(dx) : Infinity);
    if (touchTarget && !keys.size) game.lane = clamp(Math.round((touchTarget.y - ARENA.y) / ARENA.h * 4 - 1), 0, 2);
    else if (dy && Math.sign(dy) !== game.laneHeld) game.lane = clamp(game.lane + Math.sign(dy), 0, 2);
    game.laneHeld = Math.sign(dy);
    const targetY = ARENA.y + ARENA.h * (game.lane + 1) / 4;
    game.y += clamp(targetY - game.y, -650 * scale * dt, 650 * scale * dt);
  } else if (game.movement === 'platform') {
    // Gravitasi vertikal + lompatan satu kali per tekan. Atas/W juga bekerja pada D-pad.
    const jump = keys.has(' ') || keys.has('jump') || keys.has('w') || keys.has('arrowup');
    if (jump && !game.jumpHeld && game.grounded) { game.vy = -610 * scale; game.grounded = false; playSFX('jump'); }
    if (!jump && game.jumpHeld && game.vy < -230 * scale) game.vy = -230 * scale;
    game.jumpHeld = jump;
    game.x += Math.sign(dx) * Math.min(speed * dt, touchTarget && !keys.size ? Math.abs(dx) : Infinity);
    game.vy += 1250 * scale * dt;
    game.y += game.vy * dt;
    game.grounded = false;
    for (const p of game.hazards) {
      if (p.type !== 'platform' || p.age < p.warn || p.age >= p.life) continue;
      if (game.vy >= 0 && previousY + 7 <= p.y && game.y + 7 >= p.y && game.x + 5 > p.x && game.x - 5 < p.x + p.w) {
        game.y = p.y - 7; game.vy = 0; game.grounded = true;
      }
    }
    if (game.y >= ARENA.y + ARENA.h - 9) { game.y = ARENA.y + ARENA.h - 9; game.vy = 0; game.grounded = true; }
    if (game.y <= ARENA.y + 9) game.vy = Math.max(0, game.vy);
  } else {
    const length = Math.hypot(dx, dy) || 1;
    game.x += dx / length * step; game.y += dy / length * step;
    // Gravity shift tetap memberi kontrol melawan tarikan, tidak memindahkan hati seketika.
    const gravity = game.hazards.find(h => h.type === 'gravity' && h.age >= h.warn && h.age < h.life);
    game.driftX = gravity ? clamp(game.driftX + gravity.gx * 650 * scale * dt, -180 * scale, 180 * scale) : 0;
    game.driftY = gravity ? clamp(game.driftY + gravity.gy * 650 * scale * dt, -180 * scale, 180 * scale) : 0;
    game.x += game.driftX * dt; game.y += game.driftY * dt;
  }
  game.x = clamp(game.x, ARENA.x + 9, ARENA.x + ARENA.w - 9);
  game.y = clamp(game.y, ARENA.y + 9, ARENA.y + ARENA.h - 9);
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
  for (const timer of ['flash', 'hurtFlash', 'shake', 'transition', 'charge', 'dash', 'teleport', 'guardFlash']) {
    game[timer] = Math.max(0, game[timer] - dt);
  }
  updateBoss(dt);
  for (const p of game.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  game.particles = game.particles.filter(p => p.life > 0);
  if (game.state !== 'bossAttack') return;
  game.attackTime += dt;
  game.invincible = Math.max(0, game.invincible - dt);
  updatePlayer(dt);
  const duration = game.attackDuration;
  if (game.phase === 4 && game.attackTime >= game.healTime && game.attackTime < duration - 3) {
    spawnHeal(); game.healTime += 7;
  }
  game.spawnTime -= dt;
  if (game.spawnTime <= 0 && game.attackTime < duration - 2.6) game.spawnTime += spawnAttackPattern();
  // COLLISION DETECTION: warning tidak memberi damage, hitbox hati radius 4 pixel.
  for (const h of game.hazards) {
    h.age += dt;
    if (h.type === 'beam' && h.age >= 0 && !h.charging) { h.charging = true; playSFX('blasterCharge'); }
    if (h.age < h.warn || h.age >= h.life) continue;
    if (h.type === 'guardArrow') {
      if (h.age >= h.warn + h.travel) {
        h.age = h.life;
        if (game.shield === h.direction) { game.guardFlash = .18; playSFX('block'); }
        else hitPlayer();
        if (game.state !== 'bossAttack') return;
      }
      continue;
    }
    if (h.type === 'heal') {
      if (game.hp < MAX_HP && Math.hypot(game.x - h.x, game.y - h.y) < 17) {
        game.hp = Math.min(MAX_HP, game.hp + 6);
        h.age = h.life; playSFX('heal'); drawUI();
      }
      continue;
    }
    if (!h.fired) {
      h.fired = true;
      playSFX('attack');
      if (h.type === 'shift') { setMovement('gravity', h.gx, h.gy); game.vy = 280 * combatScale(); game.shake = .15; }
      if (h.type === 'beam') playSFX('blasterFire');
      if (['spear', 'ring', 'volley', 'bloom', 'ribbon'].includes(h.type)) releaseBullets(h);
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
      // Wall palsu mundur singkat, berhenti memberi damage dan menandai arah baru sebelum kembali.
      if (h.feint && !h.reversed && h.age > h.warn + .45) {
        h.vx *= -1; h.reversed = true; h.turnAt = h.age + .5; h.safeUntil = h.age + .85;
        h.life += .85; playSFX('warning');
      }
      if (h.turnAt && h.age >= h.turnAt) { h.vx *= -1; h.turnAt = 0; }
      h.x += h.vx * dt;
      h.gapY += h.gapSpeed * dt;
      const low = ARENA.y + 8, high = ARENA.y + ARENA.h - h.gap - 8;
      if (h.gapY < low || h.gapY > high) h.gapSpeed *= -1;
      h.gapY = clamp(h.gapY, low, high);
    }
    if (h.type === 'hurdle') { h.x += h.vx * dt; h.y += h.vy * dt; }
    if (h.type === 'platform' && !h.fading && h.life - h.age < .65) { h.fading = true; playSFX('platformOut'); }
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
  const color = game.state === 'bossAttack' ? { shield: '#46ed77', gravity: '#559cff', platform: '#559cff', lanes: '#c18aff' }[game.movement] : null;
  pixelSprite(heartSprite, x - 7, y - 6, 2, { r: color || COLORS.red });
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
  rect(0, 0, VIEW.w, VIEW.h, '#030303');
  if (game.phase === 4 && !reducedMotion) for (let i = 0; i < 3; i++) {
    rect(0, (i * 137 + Math.floor(game.time * 5) * 31) % VIEW.h, VIEW.w, 2, '#46100d44');
  }
  // Bara dekoratif hanya di belakang boss. Isi battle box selalu hitam pekat.
  for (let i = 0; i < 22; i++) {
    const x = VIEW.w / 2 + Math.sin(i * 17.3) * Math.min(VIEW.w * 0.42, 300);
    const span = Math.max(20, 190 * bossScale());
    const y = ARENA.y - span + ((i * 43 - game.time * 9) % span + span) % span;
    rect(x, y, 2, 2, game.phase >= 3 ? '#743120' : '#28221a');
  }
}

function drawFlame(x, y, scale = 1) {
  const frame = Math.floor(game.time * 7) % 2;
  const rows = frame ? ['...g...', '..gg...', '.ggwg..', '.gwwgg.', 'ggwwgg.', '.gggg..'] : ['....g..', '..g.g..', '..gwgg.', '.ggwwg.', '.gwwgg.', '..ggg..'];
  pixelSprite(rows, x - 7 * scale, y - 12 * scale, 2 * scale, { g: COLORS.gold, w: COLORS.white });
}

function drawKing(x = game.bossX, y = game.bossY, ghost = false) {
  if (!ghost && game.teleport > .18) return;
  const bob = reducedMotion ? 0 : Math.round(Math.sin(game.time * 1.8));
  const scale = bossScale();
  ctx.save();
  const rage = game.phase === 4 && !reducedMotion ? Math.sin(game.time * 47) * 3 : 0;
  ctx.translate(clampBossX(x) + rage, y);
  const aura = game.phase >= 3 ? '#ff593a' : '#a787db';
  ctx.strokeStyle = aura; ctx.lineWidth = game.charge > 0 ? 3 : 1;
  ctx.globalAlpha = game.charge > 0 ? 0.8 : 0.25;
  ctx.beginPath(); ctx.arc(0, 0, 52 * scale + (game.charge > 0 ? game.charge * 24 : 0), 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  if (game.phase === 4) for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 9 + game.time * 0.7;
    drawFlame(Math.cos(a) * 76 * scale, Math.sin(a) * 64 * scale, .9);
  }
  if (game.teleport > 0) ctx.globalAlpha = 0.35 + Math.abs(Math.sin(game.teleport * 24)) * 0.65;
  if (ghost) ctx.globalAlpha = .16;
  ctx.scale(scale, scale);
  ctx.translate(-400, -158);
  if (game.state === 'victory' && game.result === 'victory') ctx.globalAlpha = 0.28;
  pixelSprite(kingSprite, 344, 84 + bob, 4, {
    w: game.flash > 0 ? '#ffffff' : '#d8d5cd', d: '#484946', g: '#bfa16a'
  });
  // Tombak api dengan dua kait kecil: siluet berbeda dari karakter rujukan.
  ctx.translate(0, game.charge > 0 ? Math.sin(game.charge * 20) * 5 : 0);
  rect(480, 100 + bob, 4, 137, '#938774');
  rect(478, 139 + bob, 8, 11, '#ddd5be');
  pixelSprite(['....w....', '...www...', '...www...', '..wwwww..', '.wwwwwww.', '...www...', 'w..www..w', 'ww.www.ww', '.wwwwwww.', '...www...'], 464, 67 + bob, 4, { w: '#d8c393' });
  if (game.result !== 'mercy') drawFlame(482, 74 + bob, 1.5);
  ctx.restore();
}

function drawHazard(h) {
  if (h.age < 0) return;
  const active = h.age >= h.warn && !(h.age < h.safeUntil);
  const pulse = Math.floor(h.age * 9) % 2 ? '#b39158' : '#706044';
  if (h.type === 'guardArrow') {
    const next = !game.hazards.some(a => a.type === 'guardArrow' && a.age >= 0 && a.warn + a.travel - a.age < h.warn + h.travel - h.age);
    const angle = h.direction * Math.PI / 2 - Math.PI / 2;
    const progress = clamp((h.age - h.warn) / h.travel, 0, 1);
    const distance = 24 + (Math.min(ARENA.w, ARENA.h) * .43 - 24) * (1 - progress);
    const x = ARENA.x + ARENA.w / 2 + Math.cos(angle) * distance;
    const y = ARENA.y + ARENA.h / 2 + Math.sin(angle) * distance;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle + Math.PI);
    const color = next ? '#63e8ff' : '#faf6ed';
    ctx.globalAlpha = active ? 1 : .55;
    line(-10, 0, 8, 0, color, 4);
    line(2, -6, 8, 0, color, 3); line(2, 6, 8, 0, color, 3);
    ctx.restore();
  } else if (h.type === 'heal') {
    ctx.globalAlpha = active ? (h.life - h.age < 1 ? .45 + .55 * (Math.floor(h.age * 8) % 2) : 1) : .4;
    rect(h.x - 10, h.y - 10, 20, 20, '#071e13');
    ctx.strokeStyle = '#67fa9b'; ctx.lineWidth = 1; ctx.strokeRect(h.x - 10, h.y - 10, 20, 20);
    rect(h.x - 2, h.y - 7, 4, 14, '#67fa9b'); rect(h.x - 7, h.y - 2, 14, 4, '#67fa9b');
    ctx.fillStyle = '#b6ffcf'; ctx.textAlign = 'center'; ctx.font = '10px monospace';
    ctx.fillText('+6', h.x, h.y < ARENA.y + 26 ? h.y + 22 : h.y - 14); ctx.globalAlpha = 1;
  } else if (h.type === 'beam') {
    const color = active ? '#fff3da' : '#ffb52e';
    ctx.setLineDash(active ? [] : [8, 8]);
    line(h.x, h.y, h.x2, h.y2, active ? '#ff573a' : '#ffb52e22', h.width);
    line(h.x, h.y, h.x2, h.y2, color, active ? h.width * .55 : 2);
    ctx.setLineDash([]);
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.angle);
    rect(-12, -12, 23, 24, '#5a4332'); rect(-8, -8, 22, 16, color);
    rect(1, -4, 15, 8, active ? '#ffffff' : '#190706');
    ctx.restore();
  } else if (h.type === 'hurdle') {
    const color = active ? '#f4eee4' : '#a99f8b';
    rect(h.x, h.y, h.w, h.h, active ? '#c8b99a' : '#c8b99a44');
    if (h.vx) { rect(h.x - 3, h.y, h.w + 6, 5, color); rect(h.x - 3, h.y + h.h - 5, h.w + 6, 5, color); }
    else { rect(h.x, h.y - 3, 5, h.h + 6, color); rect(h.x + h.w - 5, h.y - 3, 5, h.h + 6, color); }
  } else if (h.type === 'gravity' || h.type === 'shift') {
    const direction = h.gx < 0 ? '←' : h.gx > 0 ? '→' : h.gy < 0 ? '↑' : '↓';
    ctx.textAlign = 'center'; ctx.font = 'bold 18px monospace'; ctx.fillStyle = '#c8a0ff';
    rect(ARENA.x + ARENA.w / 2 - 78, ARENA.y + 8, 156, 26, '#120c20');
    ctx.fillText(`${h.type === 'shift' ? 'SLAM' : 'GRAV'} ${direction}`, ARENA.x + ARENA.w / 2, ARENA.y + 48);
    if (active) for (let i = 1; i < 5; i++) {
      ctx.globalAlpha = .3;
      ctx.fillText(direction, ARENA.x + ARENA.w * i / 5, ARENA.y + ARENA.h - 12);
    }
    ctx.globalAlpha = 1;
  } else if (h.type === 'platform') {
    const fading = h.life - h.age < .65;
    ctx.globalAlpha = !active || fading ? .35 + (Math.floor(h.age * 10) % 2) * .35 : 1;
    rect(h.x, h.y, h.w, 6, active ? '#c5a1ff' : '#635873');
    for (let x = h.x + 5; x < h.x + h.w; x += 12) rect(x, h.y + 6, 4, 3, '#635873');
    ctx.globalAlpha = 1;
  } else if (h.type === 'ribbon') {
    const color = h.rule === 'still' ? '#62dfff' : '#ff9d46';
    const x = h.fromRight ? ARENA.x + ARENA.w - 9 : ARENA.x + 9;
    ctx.setLineDash([7, 7]);
    line(x, ARENA.y, x, ARENA.y + ARENA.h, color, 3); ctx.setLineDash([]);
    ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = '12px "Crown Pixel", monospace';
    ctx.fillText(h.rule === 'still' ? 'II BIRU: DIAM' : '>> ORANYE: GERAK', ARENA.x + ARENA.w / 2, ARENA.y + 24);
  } else if (h.type === 'pulse') {
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
    for (const arm of h.twin ? [-1, 1] : [0]) {
      const x = h.x + arm * ARENA.w * .055;
      ctx.beginPath(); ctx.arc(x, h.y, 16 + Math.sin(h.age * 12) * 3, 0, Math.PI * 2); ctx.stroke();
      drawFlame(x, h.y + 5);
    }
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
  if (!reducedMotion && (game.shake > 0 || (game.phase === 4 && game.state === 'bossAttack'))) {
    const power = game.shake > 0 ? 5 : 1.5;
    ctx.translate(Math.sin(game.time * 43) * power, Math.cos(game.time * 37) * power);
  }
  drawBackdrop();
  if (!reducedMotion) for (const ghost of game.afterimages) drawKing(ghost.x, ghost.y, true);
  drawKing();
  for (const p of game.particles) if (p.boss) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    rect(p.x, p.y, 3, 3, '#ffbe71');
  }
  ctx.restore();
  drawBattleBox();
  if (game.phase === 4 && game.shake > 0 && !reducedMotion) {
    // Garis luar bergetar; batas gerak dan collision tetap stabil.
    ctx.strokeStyle = '#ff5e5344'; ctx.lineWidth = 2;
    ctx.strokeRect(ARENA.x - 6 + Math.sin(game.time * 60) * 2, ARENA.y - 6, ARENA.w + 12, ARENA.h + 12);
  }
  ctx.save();
  // Clipping yang sama untuk SEMUA warning, spiral, peluru, dan hati.
  ctx.beginPath(); ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h); ctx.clip();
  if (game.movement === 'shield') {
    const cx = ARENA.x + ARENA.w / 2, cy = ARENA.y + ARENA.h / 2;
    ctx.strokeStyle = '#18452a'; ctx.lineWidth = 1; ctx.strokeRect(cx - 29, cy - 29, 58, 58);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(game.shield * Math.PI / 2);
    line(-13, -24, 13, -24, game.guardFlash > 0 ? '#ffffff' : '#46ed77', game.guardFlash > 0 ? 6 : 4);
    ctx.restore();
  }
  if (game.movement === 'lanes') for (let i = 1; i <= 3; i++) {
    line(ARENA.x, ARENA.y + ARENA.h * i / 4, ARENA.x + ARENA.w, ARENA.y + ARENA.h * i / 4, '#81539a88', 2);
  }
  if (game.movement === 'gravity') {
    const x = game.gx > 0 ? ARENA.x + ARENA.w - 3 : ARENA.x;
    const y = game.gy > 0 ? ARENA.y + ARENA.h - 3 : ARENA.y;
    rect(x, y, game.gx ? 3 : ARENA.w, game.gy ? 3 : ARENA.h, '#559cff');
  }
  for (const h of game.hazards) if (h.type !== 'heal') drawHazard(h);
  for (const b of game.bullets) {
    if (b.type === 'spear') {
      rect(b.x - 1, b.y - 13, 3, 23, COLORS.gold);
      pixelSprite(['wwwww', '.www.', '..w..'], b.x - 5, b.y + 6, 2, { w: COLORS.white });
    } else {
      const color = b.rule ? (b.rule === 'still' ? '#62dfff' : '#ff9d46') : b.type === 'shard' ? '#bd9eff' : b.type === 'petal' ? '#f49ab6' : b.type === 'ring' ? '#f5eee0' : '#ff586e';
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
      if (b.rule === 'still') { rect(b.x - 3, b.y - 3, 2, 6, '#142733'); rect(b.x + 1, b.y - 3, 2, 6, '#142733'); }
      if (b.rule === 'move') { line(b.x - 2, b.y - 3, b.x + 2, b.y, '#40200e', 2); line(b.x + 2, b.y, b.x - 2, b.y + 3, '#40200e', 2); }
    }
  }
  for (const h of game.hazards) if (h.type === 'heal') drawHazard(h);
  if (game.state === 'bossAttack') {
    const direction = game.gx < 0 ? '←' : game.gx > 0 ? '→' : game.gy < 0 ? '↑' : '↓';
    const hint = { shield: 'PERISAI: WASD / ↑ → ↓ ←', platform: '↑ / W / SPASI: LOMPAT', gravity: `GRAV ${direction} | SPASI / ↥: LOMPAT`,
      lanes: '↑ ↓: GANTI JALUR | ← →: GERAK' }[game.movement];
    if (hint) {
      ctx.fillStyle = '#d3bbff'; ctx.textAlign = 'center'; ctx.font = '11px monospace';
      ctx.fillText(hint, ARENA.x + ARENA.w / 2, ARENA.y + 22);
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
    ctx.fillText(PHASES[game.phase].name, VIEW.w / 2, ARENA.y + 43);
    ctx.globalAlpha = 1;
  }
  if (game.state === 'bossAttack') {
    rect(ARENA.x, ARENA.y + ARENA.h + 5, ARENA.w, 2, '#302c24');
    rect(ARENA.x, ARENA.y + ARENA.h + 5, Math.max(0, ARENA.w * (1 - game.attackTime / game.attackDuration)), 2, COLORS.gold);
  }
}

// 6. AUDIO. MP3 dari pengguna untuk musik, Web Audio untuk efek serangan.
const music = $('battle-music');
music.volume = .48;
let musicRequest = false;
let audio = null;
let soundEnabled = true;
let lastAttackSound = -1;
let pageActive = !document.hidden;
const activeSounds = new Set();
function audioAllowed() { return soundEnabled && pageActive && !document.hidden && !game?.paused; }
function stopAudio() {
  music.pause();
  for (const oscillator of activeSounds) { oscillator.stop(); oscillator.onended(); }
  if (audio && audio.state !== 'closed') audio.suspend().catch(() => {});
}
function syncMusic(restart = false) {
  if (restart) music.currentTime = 0;
  if (!audioAllowed() || ['victory', 'gameOver'].includes(game?.state)) { music.pause(); return; }
  if (music.paused && !musicRequest) {
    musicRequest = true;
    music.play().then(() => {
      if (!audioAllowed() || ['victory', 'gameOver'].includes(game?.state)) music.pause();
    }).catch(() => {}).finally(() => { musicRequest = false; });
  }
}
music.addEventListener('error', () => { $('sound-button').title = 'Musik gagal dimuat. Periksa assets/megalovania.mp3.'; });
// unlockAudio(): coba autoplay; ulangi dalam gesture jika browser masih menangguhkan audio.
// Listener tetap terpasang untuk pemulihan interupsi audio mobile, tanpa menggandakan context.
function unlockAudio() {
  if (!audioAllowed()) return;
  syncMusic();
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) {
    $('sound-button').title = 'Efek suara tidak tersedia; musik MP3 tetap dapat diputar';
    return;
  }
  try {
    if (!audio || audio.state === 'closed') audio = new AudioEngine();
    if (audio.state !== 'running') {
      audio.resume().then(() => {
        if (!audioAllowed()) return audio.suspend();
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
  if (!audioAllowed() || !audio || audio.state !== 'running') return;
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
  activeSounds.add(oscillator);
  oscillator.onended = () => { activeSounds.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
}
function playSFX(name) {
  if (name === 'attack') {
    if (!audio || audio.currentTime - lastAttackSound < 0.06) return;
    lastAttackSound = audio.currentTime;
  }
  const sounds = {
    cursor: [[880, .035, 'square', .012]],
    select: [[660, .06, 'square', .014], [990, .07, 'square', .012, .05]],
    confirm: [[740, .05, 'square', .012], [1110, .06, 'square', .01, .04]],
    cancel: [[660, .07, 'square', .013, 0, 330]],
    text: [[780, .025, 'square', .006]],
    heal: [[523, .1, 'triangle', .025], [659, .1, 'triangle', .025, .08], [784, .18, 'triangle', .03, .16]],
    block: [[1100, .065, 'square', .025, 0, 550], [2200, .045, 'triangle', .016]],
    voice: [[145, .035, 'square', .01], [163, .035, 'square', .008, .055], [145, .035, 'square', .008, .11]],
    // Efek blaster sintetis: charge naik, lalu tembakan berat dengan beberapa lapis frekuensi.
    blasterCharge: [[160, .5, 'sawtooth', .026, 0, 720], [240, .52, 'square', .012, 0, 1080], [80, .55, 'triangle', .035, 0, 360]],
    blasterFire: [[95, .42, 'sawtooth', .065, 0, 32], [142, .36, 'square', .035, 0, 48], [1800, .24, 'sawtooth', .021, 0, 90], [48, .5, 'triangle', .05, 0, 24]],
    fight: [[340, .2, 'sawtooth', .035, 0, 65]],
    bossHit: [[95, .2, 'square', .035, .12, 40]],
    playerHit: [[180, .22, 'sawtooth', .04, 0, 35]],
    warning: [[740, .09, 'square', .014], [980, .09, 'square', .014, .13]],
    attack: [[260, .07, 'triangle', .014, 0, 100]],
    teleport: [[1100, .12, 'triangle', .024, 0, 180]],
    dash: [[640, .1, 'sawtooth', .018, 0, 75]],
    gravity: [[180, .32, 'triangle', .028, 0, 360]],
    jump: [[190, .14, 'square', .016, 0, 520]],
    slashWarning: [[1200, .07, 'square', .01]],
    ultimate: [[75, .8, 'sawtooth', .032, 0, 300], [523, .35, 'square', .018, .25], [784, .45, 'triangle', .023, .5]],
    trap: [[466, .14, 'square', .024], [220, .3, 'sawtooth', .02, .15, 55]],
    rule: [[660, .08, 'triangle', .024], [990, .1, 'triangle', .02, .1]],
    platform: [[330, .12, 'square', .016, 0, 660]],
    platformOut: [[660, .12, 'triangle', .016, 0, 220]],
    heavy: [[125, .32, 'sawtooth', .025, 0, 25]],
    phase: [[110, .6, 'sawtooth', .03, 0, 440], [466, .3, 'square', .025, .25], [622, .4, 'square', .02, .5]],
    final: [[55, .7, 'sawtooth', .035, 0, 220], [311, .3, 'square', .02, .15], [440, .3, 'square', .02, .35], [622, .6, 'triangle', .035, .55]],
    gameOver: [[330, .3, 'triangle', .035], [233, .35, 'triangle', .035, .25], [110, .9, 'triangle', .035, .55, 55]],
    victory: [[220, .25, 'square', .022], [277, .25, 'square', .022, .18], [330, .3, 'square', .022, .36], [440, .8, 'triangle', .035, .6]]
  };
  for (const note of sounds[name] || []) tone(...note);
}
$('sound-button').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('sound-button').textContent = `♪ ${soundEnabled ? 'ON' : 'OFF'}`;
  $('sound-button').setAttribute('aria-pressed', String(soundEnabled));
  $('sound-button').setAttribute('aria-label', soundEnabled ? 'Matikan suara' : 'Aktifkan suara');
  if (soundEnabled) unlockAudio();
  else stopAudio();
  syncMusic();
});

// 7. INPUT DAN GAME LOOP. Jeda otomatis mencegah pemain terluka saat pindah tab.
function setPaused(paused) {
  if (!['bossAttack', 'menu', 'playerAction'].includes(game.state)) return;
  game.paused = paused;
  syncMusic();
  touchTarget = null;
  keys.clear();
  if (paused) stopAudio();
  else unlockAudio();
  $('pause-overlay').hidden = !paused;
  drawUI();
  if (paused) $('resume-button').focus({ preventScroll: true });
  else canvas.focus({ preventScroll: true });
}
for (const button of actionButtons) {
  button.addEventListener('click', () => chooseAction(button.dataset.action));
  const select = () => {
    if (button.disabled) return;
    const changed = game.menuIndex !== actionButtons.indexOf(button);
    game.menuIndex = actionButtons.indexOf(button);
    drawUI(); if (changed) playSFX('cursor');
  };
  button.addEventListener('focus', select);
  button.addEventListener('pointerenter', select);
}
$('fullscreen-button').addEventListener('click', async () => {
  playSFX('select');
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
const movementKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' '];
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
    event.preventDefault(); keys.add(key); faceShield(key);
  }
  if (event.repeat) return;
  if (key === 'escape' || key === 'x') {
    event.preventDefault();
    playSFX('cancel');
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
function leavePage() {
  pageActive = false; keys.clear(); touchTarget = null;
  if (game.state === 'bossAttack') setPaused(true);
  stopAudio();
}
window.addEventListener('blur', leavePage);
window.addEventListener('pagehide', leavePage);
window.addEventListener('focus', () => { pageActive = !document.hidden; });
window.addEventListener('pageshow', () => { pageActive = !document.hidden; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) leavePage();
  else pageActive = true;
});
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (game.state !== 'bossAttack' || game.paused) return;
    button.setPointerCapture(event.pointerId);
    keys.add(button.dataset.key);
    faceShield(button.dataset.key);
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
  ARENA.w = Math.round(Math.min(800, VIEW.w - 32));
  ARENA.h = Math.round(Math.min(480, ARENA.w * 0.6, available * 0.68));
  const bossHeight = Math.min(270, available - ARENA.h);
  VIEW.bossScale = clamp((bossHeight - 30) / 180, .18, 1.4);
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
  game.bossX = clampBossX(ARENA.x + (game.bossX - old.x) * sx);
  game.bossY = bossCenterY();
  game.afterimages = [];
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

