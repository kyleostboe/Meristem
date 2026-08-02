/* Regression tests for Meristem.
 *
 *   npm install && npm test
 *
 * Each test covers a bug that actually shipped. They drive the real page in a
 * real browser, because the interactions that broke — a microphone closing
 * after you have navigated away, a discarded overlay leaving state behind —
 * only exist in the browser.
 *
 * The app keeps no test hooks. State is read back out of the autosave blob in
 * localStorage, which is the same JSON the Export button writes.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, a === e ? '' : `expected ${e}\n      actual   ${a}`);
}

/* ---------- harness ---------- */

const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();

/* A speech engine we control. `endDelay` models the gap between letting go and
 * the transcript arriving — on a phone that is a network round trip. */
const FAKE_SPEECH = () => {
  window.__said = '';
  window.__endDelay = 20;
  class FakeSR {
    constructor() { this.continuous = false; this.interimResults = true; this.lang = 'en-US'; }
    start() {
      if (this._on) throw new Error('already started');
      this._on = true;
      setTimeout(() => this.onstart && this.onstart(), 5);
      setTimeout(() => {
        if (!this._on) return;
        const results = [{ 0: { transcript: window.__said }, isFinal: true }];
        results.length = 1;
        this.onresult && this.onresult({ results });
      }, 20);
    }
    stop() {
      if (!this._on) return;
      this._on = false;
      setTimeout(() => this.onend && this.onend(), window.__endDelay);
    }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = FakeSR;
};

async function newPage({ confirm = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await ctx.addInitScript(FAKE_SPEECH);
  await ctx.addInitScript(`window.confirm = () => ${confirm};`);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.split('\n')[0]));
  await page.goto(URL_);
  await page.waitForTimeout(200);
  page.close_ = () => ctx.close();
  return page;
}

/* Read the autosave blob: the app's own view of the world. */
async function state(page) {
  await page.waitForTimeout(500);            // outlast the autosave debounce
  return page.evaluate(() => {
    const raw = localStorage.getItem('meristem.thread.v1');
    return raw ? JSON.parse(raw) : null;
  });
}
const notesOn = (s, id) => (s?.nodes.find(n => n.id === id)?.notes ?? []).map(n => n.text);
const sheet = page => page.$$eval('.note .said', ns => ns.map(n => n.textContent));

async function type(page, tokenIndex, text) {
  await page.locator(`.w[data-i="${tokenIndex}"]`).scrollIntoViewIfNeeded();
  await page.locator(`.w[data-i="${tokenIndex}"]`).click();
  await page.waitForTimeout(250);
  await page.fill('#typetxt', text);
  await page.click('#typesave');
  await page.waitForTimeout(250);
}
async function speak(page, tokenIndex, text) {
  await page.evaluate(t => window.__said = t, text);
  await page.locator(`.w[data-i="${tokenIndex}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const box = await page.locator(`.w[data-i="${tokenIndex}"]`).boundingBox();
  if (!box) throw new Error(`token ${tokenIndex} has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();
}
async function reply(page, body) {
  await page.click('#replybar'); await page.waitForTimeout(200);
  await page.fill('#replytxt', body);
  await page.click('#replysave'); await page.waitForTimeout(400);
}

/* ---------- tests ---------- */

console.log('\nspeech note is filed on the page it was spoken on');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await speak(page, 1, 'ROOT NOTE');
  await page.waitForTimeout(500);
  await reply(page, '[[notes]]\n1 → a short reply\n[[/notes]]');

  // Speak on the root, then open the reply before the microphone closes.
  await page.evaluate(() => window.__endDelay = 600);
  await speak(page, 140, 'SPOKEN ON THE ROOT');
  await page.waitForTimeout(60);
  await page.locator('.rhead').first().click();
  await page.waitForTimeout(1400);

  const s = await state(page);
  eq('note stays on the root, not the page opened mid-flight', notesOn(s, 'n0'), ['SPOKEN ON THE ROOT']);
  eq('the reply page gets no stray note', notesOn(s, 'n1'), []);
  eq('no exception is thrown', page.errors, []);
  await page.close_();
}

console.log('\na stale anchor never blanks the note list');
{
  const page = await newPage();
  await page.click('#importbtn'); await page.waitForTimeout(150);
  await page.fill('#importtxt', JSON.stringify({
    nodes: [{ id: 'r', text: 'four words only here', parents: [],
              notes: [{ id: 1, s: 99, e: 120, text: 'anchored past the end' }] }],
    cur: 'r',
  }));
  await page.click('#importsave'); await page.waitForTimeout(600);
  eq('the note still renders', await sheet(page), ['anchored past the end']);
  eq('import throws nothing', page.errors, []);
  const prompt = await page.locator('#preview').inputValue();
  check('the prompt still builds', prompt.length > 0, `length ${prompt.length}`);
  await page.close_();
}

console.log('\ndiscarding a cross-page note does not capture the next one');
{
  const page = await newPage();
  await page.click('#sampletree'); await page.waitForTimeout(500);
  await page.click('#treebtn'); await page.waitForTimeout(900);
  await page.click('#tselect'); await page.waitForTimeout(400);

  const first = await page.locator('.tnode').first().boundingBox();
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  await page.waitForTimeout(500);

  // tap empty background to start a note across the selection, then discard it
  const body = await page.locator('#treebody').boundingBox();
  const cards = await page.$$eval('.tnode', ns => ns.map(n => {
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  let spot = null;
  for (let y = body.y + 20; y < body.y + body.height - 20 && !spot; y += 15)
    for (let x = body.x + 20; x < body.x + body.width - 20 && !spot; x += 15)
      if (!cards.some(r => x > r.x - 8 && x < r.x + r.w + 8 && y > r.y - 8 && y < r.y + r.h + 8))
        spot = { x, y };
  await page.mouse.click(spot.x, spot.y); await page.waitForTimeout(700);
  check('the cross-page note box opened',
    await page.locator('#typein').evaluate(e => e.classList.contains('on')));
  await page.click('#typecancel'); await page.waitForTimeout(300);
  await page.click('#treeclose'); await page.waitForTimeout(500);

  await type(page, 2, 'AN ORDINARY NOTE');
  eq('the next note lands on the page', await sheet(page),
     ['AN ORDINARY NOTE', 'An unanswered note, left on the root to check that notes stay put per page.']);
  await page.close_();
}

console.log('\ndeleting a note deletes it for good');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'ANSWER ME');       // consumed by the reply below
  await type(page, 30, 'KEEP ME');
  await type(page, 60, 'DELETE ME');
  // attach a reply to note 1 only, so a child page exists to navigate into
  await reply(page, '[[notes]]\n1 → reply so there is somewhere to navigate\n[[/notes]]');
  await page.click('#grab'); await page.waitForTimeout(400);

  const at = await page.$$eval('.note .said', ns => ns.findIndex(n => n.textContent === 'DELETE ME'));
  await page.locator('.note .kill').nth(at).click(); await page.waitForTimeout(300);
  eq('it goes from the sheet', await sheet(page), ['KEEP ME']);
  eq('it goes from the saved state', notesOn(await state(page), 'n0'), ['KEEP ME']);

  await page.locator('.rhead').first().click(); await page.waitForTimeout(500);
  await page.click('#up'); await page.waitForTimeout(500);
  eq('it does not come back after navigating', await sheet(page), ['KEEP ME']);
  await page.close_();
}

console.log('\nthe thread survives a reload');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'NOTE BEFORE RELOAD');
  await reply(page, '[[notes]]\n1 → a reply that should also survive\n[[/notes]]');
  await page.waitForTimeout(600);

  await page.reload(); await page.waitForTimeout(700);
  const text = await page.locator('#reader').innerText();
  check('the text comes back', text.includes('The bottleneck'), text.slice(0, 60));
  check('the reply comes back', text.includes('a reply that should also survive'));
  eq('reload throws nothing', page.errors, []);
  await page.close_();
}

console.log('\nreply parsing');
{
  const page = await newPage();
  for (const [label, body, expected] of [
    ['arrow',       '[[notes]]\n1 → answer one\n2 → answer two\n[[/notes]]', 2],
    ['1. period',   '[[notes]]\n1. answer one\n2. answer two\n[[/notes]]',             2],
    ['1) paren',    '[[notes]]\n1) answer one\n2) answer two\n[[/notes]]',             2],
    ['hyphen',      '[[notes]]\n1 - answer one\n2 - answer two\n[[/notes]]',           2],
  ]) {
    await page.goto(URL_); await page.waitForTimeout(200);
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL_); await page.waitForTimeout(200);
    await page.click('#sample'); await page.waitForTimeout(300);
    await type(page, 1, 'note one');
    await type(page, 30, 'note two');
    await reply(page, body);
    eq(`"${label}" is understood`, await page.locator('.rnode').count(), expected);
  }
  await page.close_();
}

console.log('\nunfenced prose is not mistaken for answers');
{
  const page = await newPage({ confirm: false });   // user declines the prompt
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'note one');
  await type(page, 30, 'note two');
  await reply(page, 'Some thoughts:\n1 - this is prose, not an answer\n2 - so is this\nmore prose after.');
  eq('nothing is attached when the user declines', await page.locator('.rnode').count(), 0);
  eq('the notes are left alone', await sheet(page), ['note one', 'note two']);
  await page.close_();
}

console.log('\nediting a page asks before destroying replies');
{
  const page = await newPage({ confirm: false });   // user declines
  await page.click('#sampletree'); await page.waitForTimeout(500);
  const before = await page.locator('.rnode').count();
  await page.click('#edit'); await page.waitForTimeout(400);
  eq('declining keeps the replies', await page.locator('.rnode').count(), before);
  check('there were replies to lose', before > 0, `saw ${before}`);
  await page.close_();
}

console.log('\nthe prompt carries the text as written');
{
  // Typed in: line breaks inside a paragraph used to be flattened to spaces,
  // because the prompt was rebuilt by re-joining the token array.
  const page = await newPage();
  const formatted = 'Intro line.\n\n- bullet one\n- bullet two\n\nEnd.';
  await page.evaluate(t => {
    document.getElementById('reader').innerHTML =
      t.split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
  }, formatted);
  await page.click('#go'); await page.waitForTimeout(300);
  await type(page, 0, 'a note');
  let prompt = await page.locator('#preview').inputValue();
  check('a list stays a list', /- bullet one\n- bullet two/.test(prompt), prompt.slice(0, 240));

  // Imported: the page text is taken verbatim, so indentation survives too.
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL_); await page.waitForTimeout(200);
  await page.click('#importbtn'); await page.waitForTimeout(150);
  await page.fill('#importtxt', JSON.stringify({
    nodes: [{ id: 'r', parents: [], text: 'Intro line.\n\n    indented code();\n\nEnd.',
              notes: [{ id: 1, s: 0, e: 0, text: 'a note' }] }],
    cur: 'r',
  }));
  await page.click('#importsave'); await page.waitForTimeout(500);
  prompt = await page.locator('#preview').inputValue();
  check('indentation survives', /\n {4}indented code\(\);/.test(prompt), prompt.slice(0, 240));
  await page.close_();
}

console.log('\n"Fit all" puts every page on screen');
{
  const page = await newPage();
  await page.click('#sampletree'); await page.waitForTimeout(500);
  await page.click('#treebtn'); await page.waitForTimeout(1000);
  await page.click('#fitbtn'); await page.waitForTimeout(1200);
  const off = await page.evaluate(() => {
    const b = document.getElementById('treebody').getBoundingClientRect();
    return [...document.querySelectorAll('.tnode')]
      .map(c => { const r = c.getBoundingClientRect();
        return { id: c.dataset.id,
                 out: Math.max(0, b.left - r.left, r.right - b.right,
                                  b.top - r.top, r.bottom - b.bottom) }; })
      .filter(c => c.out > 1);
  });
  eq('no page hangs off an edge', off, []);
  await page.close_();
}

/* ---------- done ---------- */

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('failing: ' + fails.join(', ')); process.exit(1); }
