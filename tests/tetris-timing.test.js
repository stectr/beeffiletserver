const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createGame(initialTheme = null) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const elements = new Map();
  const context2d = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) {
      return target[key] || (() => {});
    }
  });
  function element() {
    const listeners = {};
    return {
      hidden: false, disabled: false, textContent: "", style: { setProperty() {} }, dataset: {},
      width: 200, height: 400, clientWidth: 200, clientHeight: 400,
      classList: { add() {}, remove() {} },
      getContext: () => context2d,
      getBoundingClientRect: () => ({ left: 0, width: 200, height: 400 }),
      addEventListener(type, callback) { listeners[type] = callback; },
      dispatch(type, event = {}) { listeners[type]?.(event); },
      setAttribute() {}, append() {}, replaceChildren() {}, focus() {},
      setPointerCapture() {}, closest: () => null,
      querySelector: () => element()
    };
  }
  const document = {
    hidden: false, body: element(), documentElement: element(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    querySelector: () => element(),
    addEventListener(type, callback) { this[type] = callback; }
  };
  const storage = new Map(initialTheme === null ? [] : [["tetris-theme", initialTheme]]);
  const context = vm.createContext({
    document,
    navigator: { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 1 },
    window: { innerWidth: 400, innerHeight: 800, devicePixelRatio: 1,
      matchMedia: () => ({ matches: true }), addEventListener() {} },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value)
    },
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() {},
    fetch: async () => ({ ok: true, json: async () => ({ entries: [] }) }),
    console
  });
  const html = fs.readFileSync(path.join(__dirname, "..", "tetris.html"), "utf8");
  let script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  const end = script.lastIndexOf("    })();");
  assert.notEqual(end, -1);
  script = `${script.slice(0, end)}
    globalThis.game = {
      frame, move, rotate, holdPiece, hardDrop, spawn, newGame, resumeGame, togglePause, lockPiece, scoreClear,
      gravityInterval, createPiece, emptyGrid,
      setState(state) {
        if ("grid" in state) grid = state.grid;
        if ("current" in state) current = state.current;
        if ("level" in state) level = state.level;
        if ("lines" in state) lines = state.lines;
        if ("score" in state) score = state.score;
        if ("combo" in state) combo = state.combo;
        if ("backToBack" in state) backToBack = state.backToBack;
        if ("lastMoveWasRotation" in state) lastMoveWasRotation = state.lastMoveWasRotation;
        if ("lastKickIndex" in state) lastKickIndex = state.lastKickIndex;
        if ("held" in state) held = state.held;
        if ("holdUsed" in state) holdUsed = state.holdUsed;
        if ("paused" in state) paused = state.paused;
        if ("gameOver" in state) gameOver = state.gameOver;
        if ("gravityElapsed" in state) gravityElapsed = state.gravityElapsed;
        if ("spawnGraceRemaining" in state) spawnGraceRemaining = state.spawnGraceRemaining;
        if ("softDropHeld" in state) softDropHeld = state.softDropHeld;
        if ("lockStarted" in state) lockStarted = state.lockStarted;
        if ("lockElapsed" in state) lockElapsed = state.lockElapsed;
        if ("lockResets" in state) lockResets = state.lockResets;
        if ("lastTime" in state) lastTime = state.lastTime;
      },
      state() {
        return { current, gravityElapsed, spawnGraceRemaining, lockStarted, lockElapsed, lockResets, score, lines, level,
          paused, gameOver, gameStarted, resumeCountdownTimer };
      }
    };
  ${script.slice(end)}`;
  vm.runInContext(script, context);

  function advance(time) {
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.at <= time)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = time;
  }
  function frame(time) {
    advance(time);
    context.game.frame(time);
  }
  return { game: context.game, document, elements, storage, advance, frame };
}

test("pixel is the default and selected styles are saved and restored", () => {
  const fresh = createGame();
  assert.equal(fresh.document.body.dataset.theme, "pixel");
  assert.equal(fresh.elements.get("theme-button").textContent, "Pixel");
  fresh.elements.get("theme-button").dispatch("click");
  assert.equal(fresh.document.body.dataset.theme, "modern");
  assert.equal(fresh.storage.get("tetris-theme"), "modern");
  assert.equal(createGame(fresh.storage.get("tetris-theme")).document.body.dataset.theme, "modern");
  assert.equal(createGame("pixel").document.body.dataset.theme, "pixel");
  assert.equal(createGame("classic").document.body.dataset.theme, "modern");
  assert.equal(createGame("modretro").document.body.dataset.theme, "pixel");
  assert.equal(createGame("invalid").document.body.dataset.theme, "pixel");
});

test("starting a new game exits debug mode until the entry sequence is repeated", () => {
  const { game, elements } = createGame();
  const themeButton = elements.get("theme-button");
  const debugClearButton = elements.get("debug-clear");
  for (let i = 0; i < 7; i++) themeButton.dispatch("click");
  assert.equal(debugClearButton.hidden, false);

  game.newGame(false);
  assert.equal(debugClearButton.hidden, true);
  for (let i = 0; i < 6; i++) themeButton.dispatch("click");
  assert.equal(debugClearButton.hidden, true);
  themeButton.dispatch("click");
  assert.equal(debugClearButton.hidden, false);
});

function setLandedPiece(game, type = "O") {
  const piece = game.createPiece(type);
  piece.y = 20;
  game.setState({ grid: game.emptyGrid(), current: piece, paused: false, gameOver: false,
    lockStarted: null, lockElapsed: 0, lockResets: 0, gravityElapsed: 0, spawnGraceRemaining: 0, lastTime: 0 });
  return piece;
}

test("grounded pieces lock after 500 ms, not before", () => {
  const { game, frame } = createGame();
  const piece = setLandedPiece(game);
  frame(100);
  frame(599);
  assert.equal(game.state().current, piece);
  frame(600);
  assert.notEqual(game.state().current, piece);
});

test("grounded rotations, including O, reset lock delay up to 15 times", () => {
  const { game, frame, advance } = createGame();
  const piece = setLandedPiece(game);
  frame(100);
  for (let i = 1; i <= 15; i++) {
    advance(100 + i * 400);
    game.rotate(1);
    assert.equal(game.state().lockResets, i);
    frame(100 + i * 400);
    assert.equal(game.state().current, piece);
  }
  advance(6500);
  game.rotate(1);
  assert.equal(game.state().lockResets, 15);
  frame(6599);
  assert.equal(game.state().current, piece);
  frame(6600);
  assert.notEqual(game.state().current, piece);
});

test("successful grounded movement and T rotation reset the timer but blocked moves do not", () => {
  const { game, frame, advance } = createGame();
  const piece = setLandedPiece(game);
  piece.x = 0;
  frame(100);
  frame(300);
  assert.equal(game.move(-1, 0), false);
  assert.equal(game.state().lockResets, 0);
  advance(400);
  assert.equal(game.move(1, 0), true);
  assert.equal(game.state().lockResets, 1);
  frame(899);
  assert.equal(game.state().current, piece);
  frame(900);
  assert.notEqual(game.state().current, piece);

  const t = setLandedPiece(game, "T");
  t.y = 21;
  frame(1000);
  advance(1400);
  game.rotate(1);
  assert.equal(game.state().lockResets, 1);
  assert.equal(t.rotation, 1);
  frame(1899);
  assert.equal(game.state().current, t);
  frame(1900);
  assert.notEqual(game.state().current, t);
});

test("exhausted lock delay pauses in the air and cannot lock a piece off a ledge", () => {
  const { game, frame, advance } = createGame();
  const piece = game.createPiece("O");
  piece.y = 19;
  const grid = game.emptyGrid();
  grid[21][4] = "I";
  game.setState({ current: piece, grid, paused: false, gameOver: false, lockStarted: null,
    lockElapsed: 0, lockResets: 15, gravityElapsed: 0, spawnGraceRemaining: 0, lastTime: 0 });
  frame(100);
  frame(400);
  advance(400);
  assert.equal(game.move(1, 0), true);
  frame(1200);
  assert.equal(game.state().current, piece);
  piece.y = 20;
  frame(1300);
  frame(1499);
  assert.equal(game.state().current, piece);
  frame(1500);
  assert.notEqual(game.state().current, piece);
});

test("spawns and both hold paths reset gravity and lock timing", () => {
  const { game } = createGame();
  for (const held of [null, "T"]) {
    game.setState({ paused: false, gameOver: false, holdUsed: false, held,
      gravityElapsed: 500, lockStarted: 10, lockElapsed: 300, lockResets: 10 });
    game.holdPiece();
    const state = game.state();
    assert.equal(state.gravityElapsed, 0);
    assert.equal(state.spawnGraceRemaining, 150);
    assert.equal(state.lockStarted, null);
    assert.equal(state.lockElapsed, 0);
    assert.equal(state.lockResets, 0);
  }
  game.setState({ gravityElapsed: 500, lockStarted: 10, lockElapsed: 300, lockResets: 10 });
  game.spawn();
  assert.equal(game.state().gravityElapsed, 0);
  assert.equal(game.state().spawnGraceRemaining, 150);
  assert.equal(game.state().lockElapsed, 0);
  assert.equal(game.state().lockResets, 0);
});

test("new pieces get 150 ms to move and rotate before high-level gravity", () => {
  const { game, frame, advance } = createGame();
  game.newGame(false);
  game.setState({ level: 20, grid: game.emptyGrid(), current: game.createPiece("T") });
  const piece = game.state().current;
  const startY = piece.y;
  frame(100);
  frame(200);
  advance(225);
  assert.equal(game.move(1, 0), true);
  game.rotate(1);
  assert.equal(piece.rotation, 1);
  frame(249);
  assert.equal(piece.y, startY);
  frame(250);
  assert.equal(piece.y, startY);
  frame(251);
  assert.ok(piece.y > startY);
});

test("soft and hard drop bypass the spawn grace", () => {
  const { game, frame } = createGame();
  game.newGame(false);
  game.setState({ level: 20, grid: game.emptyGrid(), current: game.createPiece("T"), softDropHeld: true });
  const piece = game.state().current;
  const startY = piece.y;
  frame(100);
  frame(101);
  assert.equal(game.state().spawnGraceRemaining, 0);
  assert.ok(piece.y > startY);
  game.newGame(false);
  const next = game.state().current;
  assert.equal(game.state().spawnGraceRemaining, 150);
  game.hardDrop();
  assert.notEqual(game.state().current, next);
  assert.equal(game.state().spawnGraceRemaining, 150);
});

test("pause preserves the remaining spawn grace", () => {
  const { game, frame, advance } = createGame();
  game.newGame(false);
  game.setState({ level: 20 });
  const piece = game.state().current;
  const startY = piece.y;
  frame(100);
  frame(150);
  assert.equal(game.state().spawnGraceRemaining, 100);
  game.togglePause();
  advance(1000);
  game.resumeGame();
  advance(4000);
  frame(4000);
  frame(4099);
  assert.equal(piece.y, startY);
  frame(4101);
  assert.ok(piece.y > startY);
});

test("resume counts down 3, 2, 1 and gives a fresh lock delay", () => {
  const { game, frame, advance, elements } = createGame();
  game.newGame(false);
  const piece = setLandedPiece(game);
  frame(100);
  frame(450);
  game.togglePause();
  advance(10000);
  game.resumeGame();
  assert.equal(elements.get("countdown-number").textContent, "3");
  assert.equal(elements.get("overlay").hidden, true);
  assert.equal(elements.get("countdown-overlay").hidden, false);
  assert.equal(game.state().paused, true);
  advance(11000);
  assert.equal(elements.get("countdown-number").textContent, "2");
  advance(12000);
  assert.equal(elements.get("countdown-number").textContent, "1");
  advance(13000);
  assert.equal(game.state().paused, false);
  assert.equal(elements.get("countdown-overlay").hidden, true);
  frame(13000);
  frame(13499);
  assert.equal(game.state().current, piece);
  frame(13500);
  assert.notEqual(game.state().current, piece);
});

test("cancel or hiding the page stops the resume countdown", () => {
  const { game, document, advance, elements } = createGame();
  game.newGame(false);
  game.togglePause();
  game.resumeGame();
  elements.get("countdown-cancel").dispatch("click");
  advance(4000);
  assert.equal(game.state().paused, true);
  assert.equal(game.state().resumeCountdownTimer, null);
  assert.equal(elements.get("countdown-overlay").hidden, true);
  assert.equal(elements.get("overlay").hidden, false);
  game.resumeGame();
  document.hidden = true;
  document.visibilitychange();
  advance(8000);
  assert.equal(game.state().paused, true);
  assert.equal(game.state().resumeCountdownTimer, null);
});

test("clear results show actual scoring, combo, back-to-back and perfect clear", () => {
  const { game, elements } = createGame();
  game.newGame(false);
  game.setState({ level: 2, score: 0, combo: -1, backToBack: false });
  game.scoreClear(4, null, false);
  assert.equal(elements.get("clear-result").textContent, "Tetris +1,600");
  assert.equal(game.state().score, 1600);
  game.scoreClear(4, null, false);
  assert.equal(elements.get("clear-result").textContent, "Tetris · B2B +2,400 · Combo 1 +100 = +2,500");
  assert.equal(game.state().score, 4100);
  game.scoreClear(1, "T-spin", true);
  assert.equal(elements.get("clear-result").textContent, "T-spin Single · Perfect Clear · B2B +4,000 · Combo 2 +200 = +4,200");
  assert.equal(game.state().score, 8300);
  game.setState({ level: 1, combo: -1, backToBack: true, score: 0 });
  game.scoreClear(4, null, true);
  assert.equal(elements.get("clear-result").textContent, "Tetris · Perfect Clear · B2B +3,200");
  assert.equal(game.state().score, 3200);
});

test("perfect-clear points are added to regular line-clear points", () => {
  const { game, elements } = createGame();
  game.newGame(false);
  game.setState({ level: 1, score: 0, combo: -1, backToBack: false });
  game.scoreClear(3, null, true);
  assert.equal(elements.get("clear-result").textContent, "Triple · Perfect Clear +2,300");
  assert.equal(game.state().score, 2300);
});

test("a no-line T-spin shows its points without breaking back-to-back", () => {
  const { game, elements } = createGame();
  game.newGame(false);
  const piece = game.createPiece("T");
  piece.y = 20;
  const grid = game.emptyGrid();
  grid[19][3] = "I";
  grid[19][5] = "I";
  grid[21][3] = "I";
  game.setState({ current: piece, grid, score: 0, level: 1, backToBack: true,
    lastMoveWasRotation: true, lastKickIndex: 0 });
  game.lockPiece();
  assert.equal(game.state().score, 400);
  assert.equal(elements.get("clear-result").textContent, "T-spin · No lines +400");
  game.scoreClear(4, null, false);
  assert.equal(elements.get("clear-result").textContent, "Tetris · B2B +1,200");
});

test("a real clear that levels up retains its scoring result", () => {
  const { game, elements } = createGame();
  game.newGame(false);
  const piece = setLandedPiece(game);
  const grid = game.emptyGrid();
  for (let x = 0; x < 10; x++) {
    if (x !== 4 && x !== 5) grid[21][x] = "I";
  }
  game.setState({ current: piece, grid, lines: 9, level: 1, score: 0 });
  game.lockPiece();
  assert.equal(game.state().level, 2);
  assert.equal(game.state().score, 100);
  assert.equal(elements.get("clear-result").textContent, "Single +100");
});

test("hiding the page during play pauses until the countdown completes", () => {
  const { game, document, advance } = createGame();
  game.newGame(false);
  document.hidden = true;
  document.visibilitychange();
  assert.equal(game.state().paused, true);
  document.hidden = false;
  document.visibilitychange();
  assert.equal(game.state().paused, true);
  game.resumeGame();
  advance(3000);
  assert.equal(game.state().paused, false);
});

test("level six uses the documented gravity speed", () => {
  const { game } = createGame();
  game.setState({ level: 6 });
  assert.ok(Math.abs(game.gravityInterval() - 1000 / (60 * 0.06361)) < 1e-9);
  game.setState({ level: 19 });
  assert.ok(Math.abs(game.gravityInterval() - 1000 / (60 * 20)) < 1e-9);
  game.setState({ level: 50 });
  assert.ok(Math.abs(game.gravityInterval() - 1000 / (60 * 20)) < 1e-9);
});
