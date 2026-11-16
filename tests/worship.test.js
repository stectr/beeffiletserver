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
      get classList() { return { contains: (name) => this.className.split(" ").includes(name) }; },
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
      get firstChild() { return this.childNodes[0] ?? null; },
      replaceChildren() { this.children = []; this.childNodes = []; },
      focus() { this.focused = true; document.activeElement = this; }, select() {},
      getBoundingClientRect() { return { left: 0, right: 0, top: 0, width: 700 }; },
      getContext() { return { measureText: (text) => ({ width: text.length * 8 }) }; },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const node = element();
        node.hidden = ["editActions", "editPanel", "lyricsEditor", "editOverlay"].includes(id);
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
    setLyrics(text) {
      this.click("editLyrics");
      const editor = elements.get("lyricsEditor");
      editor.textContent = text;
      editor.dispatch("input");
      this.click("saveLyrics");
    },
    word(line, index) {
      return elements.get("lyrics").children[line].children.filter((child) => child.className.startsWith("word"))[index];
    },
    chord(line, index) { return this.word(line, index).children[0].children[1]; },
    setChord(line, index, value) {
      const input = this.chord(line, index);
      input.value = value;
      input.dispatch("input");
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

test("section cues are bold and skipped by chord navigation", () => {
  const app = createApp();
  app.setLyrics("Verse 1:\nFirst words\n  chorus2:\nNext line\nBRIDGE\n(Repeat twice)\nVerses remain lyrics");
  const rows = app.elements.get("lyrics").children;
  for (const index of [0, 2, 4, 5]) {
    assert.match(rows[index].className, /section-cue/);
    assert.equal(rows[index].children.length, 0);
  }
  assert.equal(app.word(6, 0).children[1].textContent, "Verses");
  app.chord(1, 1).focus();
  app.active().dispatch("keydown", { key: "Tab" });
  app.active().dispatch("keydown", { key: "Tab" });
  assert.equal(app.active(), app.chord(3, 0));
  app.click("editLyrics");
  assert.equal(app.elements.get("lyricsEditor").children.filter((child) => child.className === "section-cue").length, 4);
});

test("a lone long chord does not add word spacing while editing lyrics", () => {
  const app = createApp();
  app.setLyrics("I am yours");
  app.setChord(0, 0, "Am7sus");
  app.click("editLyrics");
  assert.equal(app.elements.get("lyricsEditor").style.wordSpacing, "0px");
});

test("legacy cue chords survive unrelated edits, but converting lyrics into a cue warns", () => {
  const storage = new Map([["worship-notes-sheet-v1", JSON.stringify({
    title: "", text: "Verse 1\nFirst words", chords: { 0: "G", 8: "C" }, pauses: { 7: ["D"] },
  })]]);
  const app = createApp(storage, false, false);
  app.click("editLyrics");
  app.elements.get("lyricsEditor").textContent = "Verse 1\nFirst words again";
  app.elements.get("lyricsEditor").dispatch("input");
  app.click("saveLyrics");
  let saved = JSON.parse(storage.get("worship-notes-sheet-v1"));
  assert.equal(saved.chords[0], "G");
  assert.deepEqual(saved.pauses[7], ["D"]);
  assert.equal(saved.chords[8], "C");

  app.click("editLyrics");
  app.elements.get("lyricsEditor").textContent = "Verse 1\nChorus words again";
  app.elements.get("lyricsEditor").dispatch("input");
  app.click("saveLyrics");
  assert.equal(app.elements.get("editPanel").hidden, false);
  saved = JSON.parse(storage.get("worship-notes-sheet-v1"));
  assert.equal(saved.text, "Verse 1\nFirst words again");
});

test("page flow counts overflowing columns and accounts for lyric editor padding", () => {
  const app = createApp();
  const lyrics = app.elements.get("lyrics");
  lyrics.scrollWidth = 700;
  assert.equal(app.pageMetrics().count, 1);
  lyrics.scrollWidth = 1070;
  assert.equal(app.pageMetrics().count, 2);

  app.setLyrics("First word");
  app.click("editLyrics");
  const editor = app.elements.get("lyricsEditor");
  editor.style.paddingLeft = "20px";
  editor.scrollWidth = 1050;
  assert.equal(app.pageMetrics().step, 720);
  assert.equal(app.pageMetrics().count, 2);
});

test("lyrics and chords can be edited, persist, and are cleared by a new sheet", () => {
  const app = createApp();
  app.elements.get("title").value = "My song";
  app.elements.get("title").dispatch("input");
  app.setLyrics("First words\nSecond line");
  app.word(0, 1).children[1].dispatch("click");
  assert.equal(app.chord(0, 1).focused, true);
  app.setChord(0, 1, "Am7");
  app.setLyrics("First words\nSecond line\n\nAnother verse");

  const restored = createApp(app.storage);
  assert.equal(restored.elements.get("title").value, "My song");
  assert.equal(restored.chord(0, 1).value, "Am7");
  assert.equal(restored.word(3, 0).children[1].textContent, "Another");
  restored.setChord(0, 1, "");
  assert.equal(createApp(app.storage).chord(0, 1).value, "");
});

test("editing lyrics keeps chords outside the changed portion and removes changed words", () => {
  const app = createApp();
  app.setLyrics("First middle last");
  for (const [index, chord] of [[0, "C"], [1, "G"], [2, "Am"]]) {
    app.setChord(0, index, chord);
  }
  app.click("editLyrics");
  app.elements.get("lyricsEditor").textContent = "First changed last";
  app.elements.get("lyricsEditor").dispatch("input");
  app.click("saveLyrics");
  assert.equal(app.chord(0, 0).value, "C");
  assert.equal(app.chord(0, 1).value, "");
  assert.equal(app.chord(0, 2).value, "Am");

  app.click("editLyrics");
  app.elements.get("lyricsEditor").textContent = "First last";
  app.elements.get("lyricsEditor").dispatch("input");
  app.click("saveLyrics");
  assert.equal(app.chord(0, 0).value, "C");
  assert.equal(app.chord(0, 1).value, "Am");
  app.click("newSheet");
  assert.equal(app.elements.get("emptyState").hidden, false);
  assert.equal(createApp(app.storage).elements.get("emptyState").hidden, false);
});

test("unsaved edits block printing, and storage failures are visible", () => {
  const app = createApp(new Map(), true);
  app.setLyrics("Words");
  assert.match(app.elements.get("saveStatus").textContent, /Could not save/);
  app.click("editLyrics");
  app.click("printSheet");
  assert.equal(app.alerts.length, 1);
  assert.equal(app.prints(), 0);
  app.click("cancelLyrics");
  assert.match(app.elements.get("saveStatus").textContent, /Could not save/);
  app.setChord(0, 0, "C");
  app.click("printSheet");
  assert.equal(app.prints(), 1);
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

test("in-place edits retain pauses and let users cancel potentially destructive changes", () => {
  const app = createApp(new Map(), false, false);
  app.setLyrics("First next");
  app.setChord(0, 0, "C");
  app.chord(0, 0).focus();
  app.active().dispatch("keydown", { key: "Tab" });
  app.active().value = "G";
  app.active().dispatch("input");
  app.click("editLyrics");
  app.elements.get("lyricsEditor").textContent = "Firsts next";
  app.elements.get("lyricsEditor").dispatch("input");
  app.click("saveLyrics");
  let saved = JSON.parse(app.storage.get("worship-notes-sheet-v1"));
  assert.equal(saved.chords[0], "C");
  assert.deepEqual(saved.pauses[6], ["G"]);
  app.click("editLyrics");
  app.elements.get("lyricsEditor").textContent = "next";
  app.elements.get("lyricsEditor").dispatch("input");
  app.click("saveLyrics");
  assert.equal(app.elements.get("editPanel").hidden, false);
  app.click("cancelLyrics");
  saved = JSON.parse(app.storage.get("worship-notes-sheet-v1"));
  assert.equal(saved.text, "Firsts next");
  assert.equal(saved.chords[0], "C");
  assert.deepEqual(saved.pauses[6], ["G"]);
});

test("legacy sheets keep their chords and save title, key, and version", () => {
  const storage = new Map([["worship-notes-sheet-v1", JSON.stringify({
    title: "Song", text: "First words", chords: { 0: "G" },
  })]]);
  const app = createApp(storage);
  assert.equal(app.chord(0, 0).value, "G");
  app.elements.get("songKey").value = "A#";
  app.elements.get("songKey").dispatch("input");
  app.elements.get("version").value = "Artist (Live)";
  app.elements.get("version").dispatch("input");
  const restored = createApp(storage);
  assert.equal(restored.elements.get("title").value, "Song");
  assert.equal(restored.elements.get("songKey").value, "A#");
  assert.equal(restored.elements.get("version").value, "Artist (Live)");
  assert.equal(restored.chord(0, 0).value, "G");
  restored.click("newSheet");
  assert.equal(restored.elements.get("songKey").value, "");
  assert.equal(restored.elements.get("version").value, "");
});

test("instrumental lines can be added, edited, and restored with lyrics", () => {
  const app = createApp();
  app.setLyrics("Intro: | G / / / | A / / / |\nFirst words");
  assert.equal(app.elements.get("lyrics").children[0].className, "lyric-line instrumental");
  assert.equal(app.elements.get("lyrics").children[0].textContent, "Intro: | G / / / | A / / / |");
  app.setChord(1, 0, "C");
  app.click("editLyrics");
  app.elements.get("lyricsEditor").textContent = "Intro: | D / / / | E / / / |\nFirst words";
  app.elements.get("lyricsEditor").dispatch("input");
  app.click("saveLyrics");
  const restored = createApp(app.storage);
  assert.equal(restored.elements.get("lyrics").children[0].textContent, "Intro: | D / / / | E / / / |");
  assert.equal(restored.chord(1, 0).value, "C");
});

test("lyrics are added through the edit panel and a new sheet clears them", () => {
  const app = createApp();
  assert.equal(app.elements.has("pasteLyrics"), false);
  assert.equal(app.elements.has("addLyrics"), false);
  assert.equal(app.elements.has("clearLyrics"), false);
  assert.equal(app.elements.get("editActions").hidden, false);

  app.setLyrics("First words");
  assert.equal(app.word(0, 0).children[1].textContent, "First");
  app.click("newSheet");
  assert.equal(app.elements.get("emptyState").hidden, false);
  assert.equal(createApp(app.storage).elements.get("emptyState").hidden, false);
});
