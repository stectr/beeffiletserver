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
    const file = req.url === "/chords.html" ? "chords.html" :
      req.url === "/It%20Is%20Well%20With%20My%20Soul%20(C).chords.json" ?
        "It Is Well With My Soul (C).chords.json" : null;
    if (!file) { res.writeHead(404).end(); return; }
    try { res.end(await fs.readFile(path.join(root, file))); }
    catch (error) { res.writeHead(500).end(error.message); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const browser = await playwright[process.env.CHORDS_BROWSER || "webkit"].launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
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
    const output = await page.locator(".print-page").evaluateAll((pages) => pages.map((item) => ({
      values: [...item.querySelectorAll("input, textarea")].map((input) => input.value)
    })));
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
    await page.waitForFunction(() => [...document.querySelectorAll(".print-page input")].some((input) => input.value === "Bravely"));
    await page.waitForFunction(() => [...document.querySelectorAll(".print-page input")].some((input) => input.value === "Am"));
    await page.evaluate(() => { window.print = () => { window.printCalled = true; }; });
    await page.getByRole("button", { name: "Print / PDF" }).click();
    assert.equal(await page.evaluate(() => window.printCalled), true);
  });

  await t.test("printing flushes pending edits without rebuilding them afterwards", async () => {
    const result = await page.evaluate(async () => {
      const input = document.querySelector('#lyrics .chord-input[aria-label="Chord above Bravely"]');
      input.value = "Dm";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      window.print = () => {
        const pages = document.querySelector("#printPages");
        window.printedPage = pages.firstElementChild;
        window.printedChord = [...pages.querySelectorAll(".chord-input")].some((item) => item.value === "Dm");
        window.dispatchEvent(new Event("beforeprint"));
      };
      document.querySelector("#printSheet").click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        updated: window.printedChord,
        unchanged: document.querySelector("#printPages").firstElementChild === window.printedPage
      };
    });
    assert.deepEqual(result, { updated: true, unchanged: true });
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
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("worship-notes-sheet-v1")).text.includes("Bravely"));
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
    await page.evaluate(() => localStorage.setItem("worship-notes-sheet-v1", JSON.stringify({
      text: Array.from({ length: 32 }, (_, i) => `Line ${i}`).join("\n"),
      chords: {}, pauses: {}, extras: {}
    })));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#printPages .print-row-clip").length === 32);
    const screen = await page.locator("#lyrics").evaluate((lyrics) => {
      const base = lyrics.getBoundingClientRect();
      return [...lyrics.querySelectorAll(".lyric-line:not(.virtual-line)")].map((row) => {
        const rect = row.getBoundingClientRect();
        return { x: rect.x - base.x, y: rect.y - base.y, width: rect.width, height: rect.height };
      });
    });
    assert.ok(screen.some((row) => row.x > 300), "fixture must occupy the second column");
    await page.emulateMedia({ media: "print" });
    const printed = await page.locator(".print-page").first().evaluate((sheet) => {
      const wrap = sheet.querySelector(".lyrics-wrap").getBoundingClientRect();
      return [...sheet.querySelectorAll(".print-row-clip")].map((clip) => {
        const row = clip.firstElementChild.getBoundingClientRect();
        return { x: row.x - wrap.x, y: row.y - wrap.y, width: row.width, height: clip.getBoundingClientRect().height };
      });
    });
    assert.equal(printed.length, screen.length);
    screen.forEach((row, i) => {
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(printed[i][key] - row[key]) < 1, `line ${i} ${key}: ${printed[i][key]} vs ${row[key]}`);
      }
    });
    const dimensions = await page.locator(".print-page .lyrics-wrap").first().boundingBox();
    assert.ok(Math.abs(dimensions.width - 720) < 1 && Math.abs(dimensions.height - 960) < 1);
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
      rows.map((row) => ({ top: parseFloat(row.style.top), value: row.querySelector("textarea").value })));
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
