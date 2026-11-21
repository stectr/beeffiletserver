const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

let playwrightPath;
try {
  playwrightPath = require.resolve("playwright");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
const playwright = playwrightPath && require(playwrightPath);

test("chord sheet browser behavior", { skip: !playwright && "Playwright is not installed" }, async (t) => {
  const root = path.join(__dirname, "..");
  const server = http.createServer(async (req, res) => {
    const file = req.url === "/chords.html" ? (process.env.CHORDS_TEST_HTML || "chords.html") :
      req.url === "/It%20Is%20Well%20With%20My%20Soul%20(C).chords.json" ?
        "It Is Well With My Soul (C).chords.json" : null;
    if (!file) { res.writeHead(404).end(); return; }
    try { res.end(await fs.readFile(path.isAbsolute(file) ? file : path.join(root, file))); }
    catch (error) { res.writeHead(500).end(error.message); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const browser = await playwright[process.env.CHORDS_BROWSER || "webkit"].launch({
    headless: true, executablePath: process.env.CHORDS_BROWSER_EXECUTABLE || undefined
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.printSnapshots = [];
    window.print = () => window.printSnapshots.push([...document.querySelectorAll(".print-page")].map((page) =>
      [...page.querySelectorAll(".print-text")].map((text) => text.textContent)));
    if (!localStorage.getItem("worship-notes-sheet-v1")) localStorage.setItem("worship-notes-sheet-v1", JSON.stringify({
      text: "First (C)\nAlpha\n\f\nSecond (G)\nBravo",
      chords: { 10: "C", 29: "G" }, pauses: {}, extras: {}
    }));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/chords.html`);
  try {
    await page.waitForFunction(() => document.querySelectorAll(".page-card").length === 2, null, { timeout: 5000 });
  } catch (error) {
    const layout = await page.locator("#lyrics").evaluate((el) => ({
      width: el.scrollWidth, rect: el.getBoundingClientRect().toJSON(),
      rows: [...el.children].map((row) => ({ name: row.className, rect: row.getBoundingClientRect().toJSON() }))
    }));
    throw new Error(`Page previews did not appear: ${JSON.stringify(errors)}; layout=${JSON.stringify(layout)}`, { cause: error });
  }

  await t.test("previews fit and page controls reorder the sheet", async () => {
    const size = await page.locator(".page-thumbnail .paper-page").first().boundingBox();
    assert.ok(Math.abs(size.width - 107.7) < 1, `preview width: ${size.width}`);
    await page.getByRole("button", { name: "Move page 2 up" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("worship-notes-sheet-v1")).text.startsWith("Second"));
    assert.equal(await page.locator(".page-card").count(), 2);
    await page.locator(".page-card").nth(1).dragTo(page.locator(".page-card").nth(0));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("worship-notes-sheet-v1")).text.startsWith("First"));
    await page.getByRole("button", { name: "Move page 2 up" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("worship-notes-sheet-v1")).text.startsWith("Second"));
  });

  async function assertSidebarMatches() {
    const comparisons = await page.evaluate(() => {
      const live = document.querySelector("#lyrics"), base = live.getBoundingClientRect();
      return [...document.querySelectorAll(".page-thumbnail")].flatMap((thumbnail) => {
        const content = thumbnail.querySelector(".lyrics"), previewBase = content.getBoundingClientRect();
        return [...content.querySelectorAll(".lyric-line:not(.snapshot-placeholder):not(.page-break):not(.virtual-line)")].map((row) => {
          const original = live.querySelector(`[data-line="${row.dataset.line}"]`);
          const a = original.getBoundingClientRect(), b = row.getBoundingClientRect();
          const selector = ".word, .line-slot, .chord-input, .lyric-input, .formatted-display";
          const liveFields = [...original.querySelectorAll(selector)];
          const previewFields = [...row.querySelectorAll(selector)];
          return {
            line: row.dataset.line,
            liveFont: getComputedStyle(original).font,
            previewFont: getComputedStyle(row).font,
            liveAlign: getComputedStyle(original).textAlign,
            previewAlign: getComputedStyle(row).textAlign,
            liveX: a.x - base.x, liveY: a.y - base.y, liveHeight: a.height,
            previewX: (b.x - previewBase.x) / .132, previewY: (b.y - previewBase.y) / .132,
            previewHeight: b.height / .132,
            fields: previewFields.map((field, index) => {
              const first = liveFields[index].getBoundingClientRect(), second = field.getBoundingClientRect();
              return {
                liveX: first.x - base.x, liveY: first.y - base.y, liveWidth: first.width,
                previewX: (second.x - previewBase.x) / .132, previewY: (second.y - previewBase.y) / .132,
                previewWidth: second.width / .132
              };
            })
          };
        });
      });
    });
    assert.ok(comparisons.length > 0);
    for (const row of comparisons) {
      assert.equal(row.previewFont, row.liveFont, `line ${row.line} font`);
      assert.equal(row.previewAlign, row.liveAlign, `line ${row.line} alignment`);
      for (const axis of ["X", "Y", "Height"]) {
        assert.ok(Math.abs(row[`live${axis}`] - row[`preview${axis}`]) < 1, `line ${row.line} ${axis}`);
      }
      for (const field of row.fields) {
        for (const axis of ["X", "Y", "Width"]) {
          assert.ok(Math.abs(field[`live${axis}`] - field[`preview${axis}`]) < 1, `line ${row.line} field ${axis}`);
        }
      }
    }
  }

  await t.test("sidebar pages use the same layout as the editor", assertSidebarMatches);

  await t.test("previews stay reachable at narrow desktop widths", async () => {
    await page.setViewportSize({ width: 550, height: 900 });
    await page.locator("#paperStack").scrollIntoViewIfNeeded();
    const preview = page.locator(".page-thumbnail .paper-page").first();
    assert.ok(Math.abs((await preview.boundingBox()).width - 60) < 1);
    await page.getByRole("button", { name: "Go to page 2" }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => window.scrollX > 0));
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await t.test("print pages survive print media hiding the editor", async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const prepared = await page.locator("#printPages").evaluate((pages) => {
      const rect = pages.firstElementChild.querySelector(".print-row-clip").getBoundingClientRect();
      window.preparedPrintPage = pages.firstElementChild;
      window.dispatchEvent(new Event("beforeprint"));
      return {
        offscreen: rect.right < 0,
        laidOut: rect.width > 0 && rect.height > 0,
        unchanged: pages.firstElementChild === window.preparedPrintPage,
        inert: pages.inert
      };
    });
    assert.deepEqual(prepared, { offscreen: true, laidOut: true, unchanged: true, inert: true });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    assert.equal(await page.locator(".print-page").count(), 2);
    assert.equal(await page.locator("#lyrics").evaluate((el) => el.getBoundingClientRect().width), 0);
    assert.equal(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
    const printGeometry = await page.locator(".print-page").evaluateAll((pages) => pages.map((item) => {
      const sheet = item.getBoundingClientRect();
      const content = item.querySelector(".lyrics-wrap").getBoundingClientRect();
      return { width: sheet.width, height: sheet.height, left: content.left - sheet.left, top: content.top - sheet.top };
    }));
    for (const sheet of printGeometry) {
      assert.deepEqual(sheet, { width: 720, height: 1, left: 0, top: 0 });
    }
    if ((process.env.CHORDS_BROWSER || "webkit") === "chromium") {
      for (const inches of [0, .25, .5, .75]) {
        const margin = Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, `${inches}in`]));
        const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true, margin });
        const pageTree = pdf.toString("latin1").match(/\/Type\s*\/Pages\s*\/Count\s+(\d+)/);
        assert.ok(pageTree, "PDF page tree is present");
        assert.equal(Number(pageTree[1]), 2, `two sheets should print on two pages with ${inches}in margins`);
      }
    }
    const output = await page.locator(".print-page").evaluateAll((pages) => pages.map((item) => ({
      values: [...item.querySelectorAll(".print-text")].map((text) => text.textContent),
      editable: item.querySelectorAll("input, textarea, [contenteditable]").length
    })));
    assert.ok(output.every((item) => item.editable === 0));
    assert.ok(output[0].values.includes("Bravo"));
    assert.ok(output[0].values.includes("G"));
    assert.ok(output[1].values.includes("Alpha"));
    assert.ok(!output[0].values.includes("Alpha"));
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    assert.equal(await page.locator(".print-page").count(), 2);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.querySelector("#printPages").firstElementChild === window.preparedPrintPage), true);
    await page.emulateMedia({ media: "screen" });
  });

  await t.test("editing updates saved and printable content", async () => {
    const lyric = page.getByRole("textbox", { name: "Lyric Bravo" }).first();
    await lyric.fill("Bravely");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("worship-notes-sheet-v1")).text.includes("Bravely"));
    await page.getByRole("textbox", { name: "Chord above Bravely" }).fill("Am");
    await page.waitForFunction(() => [...document.querySelectorAll(".print-page .print-text")].some((text) => text.textContent === "Bravely"));
    await page.waitForFunction(() => [...document.querySelectorAll(".print-page .print-text")].some((text) => text.textContent === "Am"));
    await page.getByRole("button", { name: "Print / PDF" }).click();
    assert.ok(await page.evaluate(() => window.printSnapshots[0][0].includes("Bravely")));
  });

  await t.test("printing includes pending edits", async () => {
    await page.evaluate(() => {
      const input = document.querySelector('#lyrics .chord-input[aria-label="Chord above Bravely"]');
      input.value = "Dm";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#printSheet").click();
    });
    const snapshot = await page.evaluate(() => window.printSnapshots[1]);
    assert.equal(snapshot.length, 2);
    assert.ok(snapshot[0].includes("Dm"));
    assert.ok(snapshot[0].includes("Bravely"));
    assert.ok(snapshot[1].includes("Alpha"));
  });

  await t.test("print button and keyboard shortcut use the same prepared pages", async () => {
    await page.locator('#lyrics .chord-input[aria-label="Chord above Bravely"]').focus();
    await page.keyboard.press("Control+p");
    await page.keyboard.press("Meta+p");
    await page.getByRole("button", { name: "Print / PDF" }).click();
    const snapshots = await page.evaluate(() => window.printSnapshots.slice(2));
    assert.equal(snapshots.length, 3);
    assert.deepEqual(snapshots[0], snapshots[1]);
    assert.deepEqual(snapshots[0], snapshots[2]);
    assert.ok(snapshots[0].flat().includes("Dm"));
  });

  await t.test("export preserves edited lyrics and chords", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Json" }).click();
    const data = JSON.parse(await fs.readFile(await (await download).path(), "utf8"));
    assert.ok(data.text.includes("Bravely"));
    assert.ok(Object.values(data.chords).includes("Dm"));
  });

  await t.test("sample import can be undone", async () => {
    await page.getByRole("button", { name: /Import .It Is Well/ }).click();
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("worship-notes-sheet-v1")).text.includes("It Is Well"));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertSidebarMatches();
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("worship-notes-sheet-v1")).text.includes("Bravely"));
  });

  await t.test("time signatures remain plain text in the editor and print", async (t) => {
    const sample = JSON.parse(await fs.readFile(path.join(root, "It Is Well With My Soul (C).chords.json"), "utf8"));
    const detail = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    t.after(() => detail.close());
    await detail.addInitScript((sheet) => localStorage.setItem("worship-notes-sheet-v1", JSON.stringify(sheet)), sample);
    await detail.goto(`http://127.0.0.1:${server.address().port}/chords.html`);
    await detail.waitForSelector("#printPages .intro .formatted-display", { state: "attached" });
    const intro = sample.text.split("\n").find((line) => line.startsWith("Intro:"));
    for (const media of ["screen", "print"]) {
      await detail.emulateMedia({ media });
      const display = detail.locator(media === "screen" ? "#lyrics .intro .formatted-display" : ".print-page .intro .formatted-display").first();
      assert.equal(await display.textContent(), intro);
      assert.ok(intro.includes("4/4"));
      assert.equal(await display.locator("strong").textContent(), "Intro:");
      assert.equal(await display.locator("math").count(), 0);
      assert.equal(await display.evaluate((element) => getComputedStyle(element).visibility), "visible");
    }
  });

  await t.test("a break in the second column starts the next page", async () => {
    await page.evaluate(() => localStorage.setItem("worship-notes-sheet-v1", JSON.stringify({
      text: `${Array.from({ length: 28 }, (_, i) => `Line ${i}`).join("\n")}\n\f\nNext page`,
      chords: {}, pauses: {}, extras: {}
    })));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".page-card").length === 2);
    assert.equal(await page.locator(".print-page").count(), 2);
    assert.equal(await page.locator("#lyrics .page-break-extra").count(), 0);
  });

  await t.test("printed rows match both editor columns on Letter paper", async () => {
    await page.evaluate(() => {
      const text = Array.from({ length: 32 }, (_, i) => `Line ${i}`).join("\n");
      localStorage.setItem("worship-notes-sheet-v1", JSON.stringify({
        text, chords: { 0: "Am", [text.indexOf("Line 25")]: "G" }, pauses: {}, extras: {}
      }));
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#printPages .print-row-clip").length === 32);
    const screen = await page.locator("#lyrics").evaluate((lyrics) => {
      const base = lyrics.getBoundingClientRect();
      return [...lyrics.querySelectorAll(".lyric-line:not(.virtual-line)")].map((row) => {
        const rect = row.getBoundingClientRect();
        const fields = [...row.querySelectorAll(".chord-input, .lyric-input")].map((field) => {
          const box = field.getBoundingClientRect();
          return { x: box.x - rect.x, y: box.y - rect.y, width: box.width, height: box.height, font: getComputedStyle(field).font };
        });
        return { x: rect.x - base.x, y: rect.y - base.y, width: rect.width, height: rect.height, fields };
      });
    });
    assert.ok(screen.some((row) => row.x > 300), "fixture must occupy the second column");
    await page.emulateMedia({ media: "print" });
    const printWidth = await page.locator(".print-page").first().evaluate((sheet) => ({
      width: sheet.clientWidth, overflow: sheet.scrollWidth
    }));
    assert.deepEqual(printWidth, { width: 720, overflow: 720 }, "row overhang must not widen the printable page");
    const printed = await page.locator(".print-page").first().evaluate((sheet) => {
      const wrap = sheet.querySelector(".lyrics-wrap").getBoundingClientRect();
      return [...sheet.querySelectorAll(".print-row-clip")].map((clip) => {
        const row = clip.firstElementChild, rect = row.getBoundingClientRect();
        const fields = [...row.querySelectorAll(".chord-input, .lyric-input")].map((field) => {
          const box = field.getBoundingClientRect();
          return { x: box.x - rect.x, y: box.y - rect.y, width: box.width, height: box.height, font: getComputedStyle(field).font };
        });
        return { x: rect.x - wrap.x, y: rect.y - wrap.y, width: rect.width, height: clip.getBoundingClientRect().height, fields };
      });
    });
    assert.equal(printed.length, screen.length);
    screen.forEach((row, i) => {
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(printed[i][key] - row[key]) < 1, `line ${i} ${key}: ${printed[i][key]} vs ${row[key]}`);
      }
      assert.equal(printed[i].fields.length, row.fields.length);
      row.fields.forEach((field, j) => {
        assert.equal(printed[i].fields[j].font, field.font, `line ${i} field ${j} font`);
        for (const key of ["x", "y", "width", "height"]) {
          assert.ok(Math.abs(printed[i].fields[j][key] - field[key]) < 1, `line ${i} field ${j} ${key}`);
        }
      });
    });
    const dimensions = await page.locator(".print-page .lyrics-wrap").first().boundingBox();
    assert.ok(Math.abs(dimensions.width - 720) < 1 && dimensions.height === 0);
    await page.emulateMedia({ media: "screen" });
  });

  await t.test("a line split between columns retains its print fragments", async () => {
    await page.evaluate(() => localStorage.setItem("worship-notes-sheet-v1", JSON.stringify({
      text: `Title (C)\nVerse ${Array.from({ length: 300 }, (_, i) => `token${i}`).join(" ")}\nAfter`,
      chords: {}, pauses: {}, extras: {}
    })));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#printPages .print-row-clip [data-line="1"]').length > 1);
    const fragments = await page.locator('#lyrics [data-line="1"]').evaluate((row) =>
      [...row.getClientRects()].map((rect) => rect.height));
    const copies = await page.locator('#printPages .print-row-clip [data-line="1"]').evaluateAll((rows) =>
      rows.map((row) => ({ top: parseFloat(row.style.top), value: row.querySelector(".print-text.lyric-input").textContent })));
    assert.equal(copies.length, fragments.length);
    let offset = 0;
    copies.forEach((copy, i) => {
      assert.ok(Math.abs(copy.top + offset) < 1);
      assert.ok(copy.value.includes("token299"));
      offset += fragments[i];
    });
  });

  assert.deepEqual(errors, []);
});
