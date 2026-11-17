const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createApp(storage = new Map(), failWrite = false, confirmAnswer = true) {
  const elements = new Map();
  function element(tag = "div") {
    const listeners = {};
    return {
      nodeType: 1, tagName: tag.toUpperCase(), hidden: false, value: "", className: "",
      children: [], childNodes: [], attributes: {}, style: {},
      dataset: {},
      get textContent() { return this.childNodes.map((child) => child.textContent).join(""); },
      set textContent(value) {
        this.children = [];
        this.childNodes = value ? [{ nodeType: 3, data: value, textContent: value, parentNode: this }] : [];
      },
      get classList() { return { contains: (name) => this.className.split(" ").includes(name), toggle: (name, on) => { const names = this.className.split(" ").filter((n) => n && n !== name); if (on) names.push(name); this.className = names.join(" "); } }; },
      addEventListener(type, callback) { listeners[type] = callback; },
      dispatch(type, event = {}) { listeners[type]?.({ preventDefault() {}, ...event }); },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      append(...children) {
        for (const child of children) { child.parentNode = this; this.children.push(child); this.childNodes.push(child); }
      },
      insertBefore(child, before) {
        child.parentNode = this;
        const index = this.children.indexOf(before);
        this.children.splice(index < 0 ? 0 : index, 0, child);
        this.childNodes.splice(index < 0 ? 0 : index, 0, child);
      },
      querySelectorAll(selector) {
        const names = selector.split(",").map((part) => part.trim().slice(1));
        const found = [];
        const walk = (node) => node.children.forEach((child) => {
          if (child.className.split(" ").some((name) => names.includes(name))) found.push(child);
          walk(child);
        });
        walk(this);
        return found;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      get firstChild() { return this.childNodes[0] ?? null; },
      replaceChildren() { this.children = []; this.childNodes = []; },
      focus() { this.focused = true; document.activeElement = this; }, select() {},
      getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 10, width: 700 }; },
      getContext() { return { measureText: (text) => ({ width: text.length * 8 }) }; },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const node = element();
        node.hidden = [].includes(id);
        elements.set(id, node);
      }
      return elements.get(id);
    },
    createElement: element,
    createTextNode: (text) => ({ nodeType: 3, data: text, textContent: text }),
    createRange: () => ({
      setStart() {}, setEnd() {}, selectNodeContents(node) { this.node = node; },
      getBoundingClientRect() { return this.node?.getBoundingClientRect() ?? { left: 0, right: 0, top: 0 }; },
    }),
    addEventListener() {},
  };
  const alerts = [];
  let prints = 0;
  const context = vm.createContext({
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) {
        if (failWrite) throw new Error("storage unavailable");
        storage.set(key, value);
      },
    },
    alert: (message) => alerts.push(message),
    confirm: () => confirmAnswer,
    window: { print: () => prints++, addEventListener() {} },
    getComputedStyle: (node) => ({
      fontSize: "14.6667px", fontFamily: "Georgia, serif", width: "700px", columnGap: "40px",
      paddingLeft: node.style.paddingLeft || "0px", paddingRight: "0px",
    }),
    requestAnimationFrame() {},
    console: { error() {} },
  });
  const html = fs.readFileSync(path.join(__dirname, "..", "worship.html"), "utf8");
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) document.getElementById(match[1]);
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"))
    .replace("      function applyPageOffset", "      globalThis.pageMetricsForTest = pageMetrics;\n      globalThis.spaceChordsForTest = spaceChords;\n      function applyPageOffset");
  vm.runInContext(script, context);
  return {
    elements, storage, alerts, prints: () => prints,
    pageMetrics: () => context.pageMetricsForTest(),
    spaceChords: () => context.spaceChordsForTest(),
    active: () => document.activeElement,
    click(id) { elements.get(id).dispatch("click"); },
    row(line) { return elements.get("lyrics").children[line]; },
    text() { return JSON.parse(storage.get("worship-notes-sheet-v1")).text; },
    saved() { return JSON.parse(storage.get("worship-notes-sheet-v1")); },
    paste(input, text, start = input.value.length, end = start) {
      input.selectionStart = start;
      input.selectionEnd = end;
      input.dispatch("paste", { clipboardData: { getData: () => text } });
    },
    setLyrics(text) { this.paste(this.tail(0), text); },
    word(line, index) {
      return this.row(line).children.filter((child) => child.className.startsWith("word"))[index];
    },
    lyric(line, index) { return this.word(line, index).children[1].children[1]; },
    tail(line) { const row = this.row(line); return row.children[row.children.length - 1].children[0]; },
    chord(line, index) { return this.word(line, index).children[0].children[1]; },
    setChord(line, index, value) {
      const input = this.chord(line, index);
      input.value = value;
      input.dispatch("input");
    },
    type(input, value, caret = value.length) {
      input.value = value;
      input.selectionStart = input.selectionEnd = caret;
      input.dispatch("input");
    },
    key(input, key, caret = input.value.length, extra = {}) {
      input.selectionStart = input.selectionEnd = caret;
      input.dispatch("keydown", { key, ...extra });
    },
  };
}

test("chord spacing is added only when neighboring chords need it", () => {
  const app = createApp();
  app.setLyrics("First next");
  app.setChord(0, 0, "C");
  app.setChord(0, 1, "G");
  const first = app.word(0, 0), second = app.word(0, 1);
  let firstRight = 5, secondLeft = 30;
  first.children[0].children[0].getBoundingClientRect = () => ({ left: 0, right: firstRight, top: 0 });
  second.children[0].children[0].getBoundingClientRect = () => {
    const left = secondLeft + (parseFloat(first.style.marginRight) || 0);
    return { left, right: left + 5, top: 0 };
  };
  app.spaceChords();
  assert.equal(first.style.marginRight, "");
  firstRight = 12;
  secondLeft = 15;
  app.spaceChords();
  assert.ok(Math.abs(parseFloat(first.style.marginRight) - (14.6667 * .4 - 3)) < .001);
  assert.equal(second.style.marginRight, "");
  app.setChord(0, 1, "");
  app.spaceChords();
  assert.equal(first.style.marginRight, "");
});



test("section cues are bold lines and skipped by chord navigation", () => {
  const app = createApp();
  app.setLyrics("Verse 1:\nFirst words\n  chorus2:\nNext line\nBRIDGE\n(Repeat twice)\nVerses remain lyrics");
  for (const index of [0, 2, 4, 5]) {
    assert.match(app.row(index).className, /section-cue/);
    assert.equal(app.row(index).children[0].children[1].className, "lyric-input");
  }
  assert.equal(app.lyric(6, 0).value, "Verses");
  app.chord(1, 1).focus();
  app.active().dispatch("keydown", { key: "Tab" });
  app.active().dispatch("keydown", { key: "Tab" });
  assert.equal(app.active(), app.chord(3, 0));
});

test("page flow counts overflowing columns and drops trailing empty pages", () => {
  const app = createApp();
  const lyrics = app.elements.get("lyrics");
  app.setLyrics("First\nSecond\n");
  const rect = (left) => () => ({ left, right: left, top: 0, bottom: 10, width: 0 });
  app.row(0).getBoundingClientRect = rect(0);
  app.row(1).getBoundingClientRect = rect(740);
  app.row(2).getBoundingClientRect = rect(1480);
  lyrics.scrollWidth = 700;
  assert.equal(app.pageMetrics().count, 1);
  lyrics.scrollWidth = 1070;
  assert.equal(app.pageMetrics().count, 2);
  assert.equal(app.pageMetrics().step, 740);
  lyrics.scrollWidth = 2000;
  assert.equal(app.pageMetrics().count, 2);
});

test("pasting lyrics, chords, and titles persist and a new sheet clears them", () => {
  const app = createApp();
  assert.equal(app.tail(0).placeholder, "Click here and start typing lyrics");
  app.setLyrics("First words\nSecond line");
  app.setChord(0, 1, "Am7");
  const restored = createApp(app.storage);
  assert.equal(restored.chord(0, 1).value, "Am7");
  assert.equal(restored.lyric(1, 0).value, "Second");
  app.click("newSheet");
  assert.equal(app.text(), "");
  assert.equal(createApp(app.storage).row(0).className, "lyric-line blank");
});

test("editing a word in place keeps its chord and moves the chords after it", () => {
  const app = createApp();
  app.setLyrics("First middle last");
  for (const [index, chord] of [[0, "C"], [1, "G"], [2, "Am"]]) app.setChord(0, index, chord);
  app.type(app.lyric(0, 1), "changed");
  assert.equal(app.text(), "First changed last");
  assert.deepEqual(app.saved().chords, { 0: "C", 6: "G", 14: "Am" });
  assert.equal(app.active(), app.lyric(0, 1));
  assert.equal(app.active().value, "changed");
});

test("emptying a word removes it and its chord, and typing a space splits it", () => {
  const app = createApp();
  app.setLyrics("First middle last");
  for (const [index, chord] of [[0, "C"], [1, "G"], [2, "Am"]]) app.setChord(0, index, chord);
  app.type(app.lyric(0, 1), "mid dle", 4);
  assert.equal(app.text(), "First mid dle last");
  assert.deepEqual(app.saved().chords, { 0: "C", 6: "G", 14: "Am" });
  assert.equal(app.active(), app.lyric(0, 2));
  app.type(app.lyric(0, 1), "");
  assert.equal(app.text(), "First dle last");
  assert.deepEqual(app.saved().chords, { 0: "C", 10: "Am" });
});

test("Enter and Backspace split and join lines without losing chords", () => {
  const app = createApp();
  app.setLyrics("First middle last");
  app.setChord(0, 1, "G");
  app.key(app.lyric(0, 0), "Enter");
  assert.equal(app.text(), "First\nmiddle last");
  assert.equal(app.active(), app.lyric(1, 0));
  assert.deepEqual(app.saved().chords, { 6: "G" });
  app.key(app.lyric(1, 0), "Backspace", 0);
  assert.equal(app.text(), "First middle last");
  assert.equal(app.active(), app.lyric(0, 0));
  app.key(app.lyric(0, 1), "Backspace", 0);
  assert.equal(app.text(), "Firstmiddle last");
});

test("the end of a line adds words, Enter adds lines, and arrows move between words", () => {
  const app = createApp();
  app.type(app.tail(0), "Hello");
  assert.equal(app.text(), "Hello");
  assert.equal(app.active(), app.lyric(0, 0));
  app.type(app.lyric(0, 0), "Hello ");
  assert.equal(app.text(), "Hello");
  app.type(app.lyric(0, 0), "Hello w");
  assert.equal(app.text(), "Hello w");
  assert.equal(app.active(), app.lyric(0, 1));
  app.key(app.lyric(0, 1), "ArrowLeft", 0);
  assert.equal(app.active(), app.lyric(0, 0));
  app.key(app.tail(0), "Enter");
  assert.equal(app.text(), "Hello w\n");
  assert.equal(app.active(), app.tail(1));
  app.key(app.tail(1), "Backspace");
  assert.equal(app.text(), "Hello w");
  assert.equal(app.active(), app.lyric(0, 1));
});

test("clicking blank line space focuses that line and empty space below the lyrics does nothing", () => {
  const app = createApp();
  app.setLyrics("First\nSecond");
  app.tail(0).parentNode.getBoundingClientRect = () => ({ left: 700, right: 800, top: 0, bottom: 10, width: 100 });
  app.elements.get("lyrics").dispatch("click", { target: app.row(0), clientX: 810, clientY: 5 });
  assert.equal(app.active(), app.tail(0));
  app.elements.get("lyrics").dispatch("click", { target: app.row(1), clientX: 5000, clientY: 5 });
  assert.equal(app.active(), app.tail(0));
  app.row(1).dataset.line = "1";
  app.elements.get("lyrics").dispatch("click", { target: app.elements.get("lyrics") });
  assert.equal(app.active(), app.tail(0));
});

test("clicking the upper half of an empty line focuses its lyric input", () => {
  const app = createApp();
  app.setLyrics("First\n\nLast");
  const row = app.row(1), slot = app.tail(1).parentNode;
  slot.parentElement = row;
  app.lyric(0, 0).focus();
  app.elements.get("lyrics").dispatch("click", { target: slot, clientX: 400, clientY: 2 });
  assert.equal(app.active(), app.tail(1));
  app.type(app.active(), "New");
  assert.equal(app.text(), "First\nNew\nLast");
});

test("legacy cue chords survive edits to other words", () => {
  const storage = new Map([["worship-notes-sheet-v1", JSON.stringify({
    title: "", text: "Verse 1\nFirst words", chords: { 0: "G", 8: "C" }, pauses: { 7: ["D"] },
  })]]);
  const app = createApp(storage);
  app.type(app.lyric(1, 0), "Firsts");
  const saved = app.saved();
  assert.deepEqual(saved.chords, { 0: "G", 8: "C" });
  assert.deepEqual(saved.pauses, { 7: ["D"] });
});

test("typing a section name turns a line into a cue and keeps the cursor", () => {
  const app = createApp();
  app.setLyrics("Chorus");
  assert.match(app.row(0).className, /section-cue/);
  app.type(app.row(0).children[0].children[1], "Chorus 2");
  assert.equal(app.text(), "Chorus 2");
  assert.equal(app.active(), app.row(0).children[0].children[1]);
});

test("tab navigation creates and preserves multiple pauses, including at line boundaries", () => {
  const app = createApp();
  app.setLyrics("First next\nThird");
  const first = app.chord(0, 0);
  first.focus();
  first.dispatch("keydown", { key: "Tab" });
  let pause = app.active();
  assert.equal(pause.getAttribute("aria-label"), "Chord in pause");
  pause.value = "G";
  pause.dispatch("input");
  pause.dispatch("keydown", { key: "Tab" });
  pause = app.active();
  assert.equal(pause.getAttribute("aria-label"), "Chord in pause");
  pause.value = "D";
  pause.dispatch("input");
  pause.dispatch("keydown", { key: "Tab" });
  pause = app.active();
  assert.equal(pause.value, "");
  pause.dispatch("keydown", { key: "Tab" });
  assert.equal(app.active(), app.chord(0, 1));
  app.active().dispatch("keydown", { key: "Tab" });
  pause = app.active();
  pause.value = "A";
  pause.dispatch("input");
  pause.dispatch("keydown", { key: "Tab" });
  app.active().dispatch("keydown", { key: "Tab" });
  assert.equal(app.active(), app.chord(1, 0));
  app.active().dispatch("keydown", { key: "Tab", shiftKey: true });
  pause = app.active();
  assert.equal(pause.getAttribute("aria-label"), "Chord in pause");
  pause.value = "F";
  pause.dispatch("input");
  pause.dispatch("keydown", { key: "Tab", shiftKey: true });
  pause = app.active();
  assert.equal(pause.value, "");
  pause.value = "E";
  pause.dispatch("input");
  const saved = JSON.parse(app.storage.get("worship-notes-sheet-v1"));
  assert.deepEqual(saved.pauses, { 5: ["G", "D"], 10: ["A"], 11: ["E", "F"] });
  const restored = createApp(app.storage);
  assert.equal(restored.word(0, 0).children[1].textContent, "First");
  assert.equal(JSON.parse(restored.storage.get("worship-notes-sheet-v1")).pauses[5].join(","), "G,D");
});



test("edits retain pauses that belong to the edited word", () => {
  const app = createApp();
  app.setLyrics("First next");
  app.setChord(0, 0, "C");
  app.chord(0, 0).focus();
  app.active().dispatch("keydown", { key: "Tab" });
  app.active().value = "G";
  app.active().dispatch("input");
  app.type(app.lyric(0, 0), "Firsts");
  const saved = app.saved();
  assert.equal(saved.chords[0], "C");
  assert.deepEqual(saved.pauses[6], ["G"]);
});

test("instrumental lines are edited inline and keep later chords", () => {
  const app = createApp();
  app.setLyrics("Intro: | G / / / | A / / / |\nFirst words");
  assert.equal(app.row(0).className, "lyric-line instrumental");
  app.setChord(1, 0, "C");
  const line = app.row(0).children[0].children[1];
  app.type(line, "Intro: | D / / / | A / / / |", 9);
  assert.equal(app.text(), "Intro: | D / / / | A / / / |\nFirst words");
  assert.deepEqual(app.saved().chords, { 29: "C" });
});

test("legacy title and key become a first line and chords keep their words", () => {
  const storage = new Map([["worship-notes-sheet-v1", JSON.stringify({
    title: "Song", songKey: "A#", version: "Live", text: "First words", chords: { 0: "G" }, pauses: { 5: ["D"] },
  })]]);
  const app = createApp(storage);
  assert.equal(app.row(0).children[0].children[1].value, "Song (A#)");
  assert.match(app.row(0).className, /key-line section-cue/);
  assert.equal(app.chord(1, 0).value, "G");
  app.type(app.lyric(1, 0), "Firsts");
  assert.deepEqual(app.saved().pauses, { 16: ["D"] });
});

test("Shift+Enter starts a new page and Backspace removes the break", () => {
  const app = createApp();
  app.setLyrics("Hello world again");
  app.key(app.lyric(0, 1), "Enter", 2, { shiftKey: true });
  assert.equal(app.text(), "Hello wo\n\f\nrld again");
  assert.match(app.row(1).className, /page-break/);
  assert.equal(app.active(), app.lyric(2, 0));
  app.key(app.lyric(2, 0), "Backspace", 0);
  assert.equal(app.text(), "Hello wo\nrld again");
});

test("Tab and Shift+Tab move between lyrics instead of chords", () => {
  const app = createApp();
  app.setLyrics("Hello world");
  app.key(app.lyric(0, 0), "Tab");
  assert.equal(app.active(), app.lyric(0, 1));
  app.key(app.lyric(0, 1), "Tab", 0, { shiftKey: true });
  assert.equal(app.active(), app.lyric(0, 0));
});
