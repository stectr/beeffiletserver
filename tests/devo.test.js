const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, mainHtml } = require("../server");

function source(body, footnotes = "") {
  return `<div id=alistair_begg_devotional>
    <h1>A title</h1>
    <div class=devotional_scripture_text>Opening verse</div>
    <div class=devotional_scripture_reference>Reference</div>
    <div class="content-body" data-swiftype-name=resource_content>${body}</div>
    <p class=devotional-questions__text>A question?</p>
    <div class=reading>
      <div class=reading__title>Psalm 1</div>
      <div class="reading__passage passage"><h3 class="section psalm-book">Book Three</h3><h3 class=section>Section title</h3><h4 class=psalm-title>Psalm subtitle</h4><p>Reading <em>text</em>.</p><p>Second paragraph<br>continued.</p><span class=line-group></span><p class="line indent2"><sup>1</sup>Verse line<a class=footnote href="#fn">2</a></p></div>
      <a class="reading__link">Open</a>
    </div>
    <div class=devotional_topics>Topics</div>
    ${footnotes}
    <div class=content-credits>Credits</div>
  </div>`;
}

test("preserves body blocks and does not render devotional footnotes", () => {
  const data = parse(source(
    '<p>Before &amp; after.</p><blockquote>First line<br>Second line<a class=ab_footnote href="#note">[1]</a></blockquote><div><p><em>Last</em> paragraph.</p></div>',
    '<div class=devotional_footnotes_list_item><a href="#note">1</a> A <i>reference</i>.</div>'
  ));
  const result = mainHtml(new Date(2026, 10, 18), data);
  assert.match(result, /<h2 class="devotional-title">A title<\/h2>/);
  assert.match(result, /<p>Before &amp; after\.<\/p><blockquote>First line<br>Second line<\/blockquote><p><em>Last<\/em> paragraph\.<\/p>/);
  assert.doesNotMatch(result, /\[1\]/);
  assert.doesNotMatch(result, /Footnotes|reference/);
  assert.match(result, /<li>A question\?<\/li>/);
  assert.match(result, /<details class="further-reading"><summary>Psalm 1<\/summary>/);
  assert.doesNotMatch(result, /<details class="further-reading" open>/);
  assert.match(result, /<div class="reading-text"><h3 class="psalm-book">Book Three<\/h3><h3>Section title<\/h3><h4>Psalm subtitle<\/h4><p>Reading <em>text<\/em>\.<\/p><p>Second paragraph<br>continued\.<\/p><p class="scripture-stanza"><\/p><p class="scripture-line indent2"><sup>1<\/sup>Verse line<\/p><\/div>/);
  assert.doesNotMatch(result, /class="reading-title"|class="footnote"|Verse line2/);
});

test("does not render unsafe source markup", () => {
  const data = parse(source('<p onclick="alert(1)">Text<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">link</a></p>'));
  const result = mainHtml(new Date(2026, 10, 18), data);
  assert.match(result, /<p>Textlink<\/p>/);
  assert.doesNotMatch(result, /onclick|onerror|javascript:|alert\(/);
});

test("reports a missing or unclosed devotional body", () => {
  assert.throws(() => parse(source("")), /Could not find devotional content/);
  assert.throws(() => parse('<div id=alistair_begg_devotional><h1>Title</h1><div class=content-body>Text'), /Unclosed content-body/);
});
