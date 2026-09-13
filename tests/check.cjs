// Jalankan: node tests/check.cjs (tanpa dependency).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const noop = () => {};
const paint = new Proxy({}, { get: () => noop, set: () => true });
const element = (dataset = {}) => ({ dataset, style: {}, classList: { toggle: noop },
  setAttribute: noop, addEventListener: noop, focus: noop,
  getBoundingClientRect: () => ({ width: 800, height: 140, left: 0, top: 0 }) });
const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], element()]));
const buttons = ['fight', 'act', 'item', 'mercy'].map(action => element({ action }));
elements.battle.getContext = () => paint;
elements.battle.getBoundingClientRect = () => ({ width: 800, height: 800, left: 0, top: 0 });
const document = { getElementById: id => elements[id] || null,
  querySelectorAll: selector => selector === '[data-action]' ? buttons : [],
  querySelector: () => element(), body: element(), documentElement: { style: { setProperty: noop } },
  addEventListener: noop };
const scope = vm.createContext({ document, window: { matchMedia: () => ({ matches: false }),
  addEventListener: noop }, ResizeObserver: class { observe() {} }, requestAnimationFrame: noop, console });
const run = code => vm.runInContext(code, scope);
assert.doesNotThrow(() => run(fs.readFileSync(path.join(root, 'script.js'), 'utf8')), 'game harus bisa dimuat dengan DOM asli');
assert.equal(run('game.state'), 'intro');
assert.equal(run('soundEnabled'), true, 'audio default ON');
run('unlockAudio()'); // Browser tanpa AudioContext juga tidak boleh crash.
run('openMenu(); chooseAction("fight")');
assert.equal(run('game.bossHp'), 156);
run('startAttack(); game.invincible = 0; hitPlayer(); hitPlayer()');
assert.equal(run('game.hp'), 36, 'dua hit bersamaan hanya memberi satu damage');
run('keys.add("arrowleft"); keys.add("arrowup"); updatePlayer(99)');
assert.equal(run('game.x'), run('ARENA.x + 9'));
assert.equal(run('game.y'), run('ARENA.y + 9'));
run('game.bossHp = 54; updatePhase()');
assert.equal(run('game.phase'), 2);
run('game.bossHp = 53; updatePhase()');
assert.equal(run('game.phase'), 3);
run('game.hazards = []; spawnFlame(0)');
assert.ok(run('game.hazards.length >= 2'), 'final flame mengejar dengan beberapa pillar');
run('game.x = game.hazards[0].x + 10; game.y = ARENA.y + 30');
assert.equal(run('checkCollision(game.hazards[0])'), false, 'warning tidak melukai');
run('game.hazards[0].age = game.hazards[0].warn');
assert.equal(run('checkCollision(game.hazards[0])'), true);
for (let variant = 0; variant < 5; variant++) {
  run(`game.hazards = []; spawnSpears(${variant})`);
  assert.ok(run('game.hazards.length >= 3'));
  assert.ok(run('game.hazards.every(h => h.warn >= .4 && h.x >= ARENA.x && h.x <= ARENA.x + ARENA.w)'));
}
run('game.hazards = []; spawnWall(3)');
assert.ok(run('game.hazards[0].gapSpeed !== 0'), 'varian wall dengan celah bergerak');
for (let combo = 0; combo < 3; combo++) {
  run(`game.pattern = 5; game.wave = ${combo}; game.hazards = []; spawnAttackPattern()`);
  const types = run('[...new Set(game.hazards.map(h => h.type))].sort().join(",")');
  assert.equal(types, ['pillar,spear', 'spiral,wall', 'pillar,slash'][combo]);
}
run('game.hazards = []; spawnZones(0)');
assert.ok(run('game.hazards[0].warn - game.hazards[0].reveal > ARENA.w / 3 / (310 * combatScale())'));
run('resetGame(); openMenu(); game.hp = 10; chooseAction("item")');
assert.equal(run('game.hp'), 30);
assert.equal(run('game.items'), 1);
run('chooseAction("item")');
assert.equal(run('game.items'), 1, 'double click tidak memakai item lagi');
run('openMenu(); game.bossHp = 24; chooseAction("fight")');
assert.equal(run('game.state'), 'victory');
run('resetGame(); openMenu(); game.bossHp = 36; chooseAction("mercy")');
assert.equal(run('game.result'), 'mercy');
run('resetGame(); openMenu(); startAttack(); game.hp = 4; game.invincible = 0; hitPlayer()');
assert.equal(run('game.state'), 'gameOver');
run('continueGame()');
assert.equal(run('game.hp'), 40);
assert.equal(run('game.phase'), 1);
elements.battle.getBoundingClientRect = () => ({ width: 1920, height: 1200, left: 0, top: 0 });
run('resizeGame()');
assert.ok(run('ARENA.y + ARENA.h + 18 + 140 < VIEW.h - 100'), 'arena dan HUD terpusat, bukan menempel bawah');
run('openMenu(); startAttack(); game.hazards = []; spawnPulse(0)');
assert.equal(run('game.hazards[0].type'), 'pulse');
run('game.hazards[0].age = game.hazards[0].warn; game.moving = false');
assert.equal(run('checkCollision(game.hazards[0])'), false, 'pulse biru aman saat diam');
run('game.moving = true');
assert.equal(run('checkCollision(game.hazards[0])'), true);
run('game.hazards = []; spawnPulse(1); game.hazards[0].age = game.hazards[0].warn');
assert.equal(run('checkCollision(game.hazards[0])'), false, 'pulse oranye aman saat bergerak');
run('keys.clear(); touchTarget = null; updatePlayer(1 / 120)');
assert.equal(run('checkCollision(game.hazards[0])'), true);
run('game.hazards = []; spawnRing(0); game.bullets = []; releaseBullets(game.hazards[0])');
assert.ok(run('game.bullets.length >= 12 && game.bullets.length < 30'), 'ring padat dengan celah');
run('game.x = game.hazards[0].x; game.y = game.hazards[0].y');
assert.equal(run('checkCollision(game.hazards[0])'), false, 'inti ring masih aman selama warning');
run('game.hazards[0].age = game.hazards[0].warn');
assert.equal(run('checkCollision(game.hazards[0])'), true, 'inti ring aktif mencegah camping di sumber');
run('game.hazards = []; spawnVolley(0, true); game.bullets = []; releaseBullets(game.hazards[0])');
assert.ok(run('game.bullets.every(b => b.bounces === 2 && b.life > 0)'));
run('game.bullets[0].x = ARENA.x + ARENA.w - 6; game.bullets[0].vx = 200; moveBullet(game.bullets[0], .05)');
assert.ok(run('game.bullets[0].vx < 0 && game.bullets[0].x < ARENA.x + ARENA.w'), 'peluru memantul di dalam arena');
run('game.hazards = []; spawnBloom(0); game.bullets = []; releaseBullets(game.hazards[0])');
assert.ok(run('game.bullets.length >= 7 && game.bullets.every(b => b.gravity > 0)'));
run('game.turn = 2; game.phase = 3; game.pattern = 5');
for (let combo = 0; combo < 3; combo++) {
  run(`game.wave = ${combo}; game.hazards = []; spawnAttackPattern()`);
  assert.equal(run('[...new Set(game.hazards.map(h => h.type))].sort().join(",")'), ['ring,volley', 'bloom,volley', 'pulse'][combo]);
}
console.log('PASS: startup, audio fallback, movement, warning, invulnerability, phases, patterns, items, endings, restart');
