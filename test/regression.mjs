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

const TYPES = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  // Strip the query string — a share arrives as ./?text=… and must still
  // resolve to the page.
  let name = decodeURIComponent(req.url.split('?')[0]);
  if (name === '/' || name === '') name = '/index.html';
  if (name.includes('..')) { res.writeHead(400); res.end(); return; }
  const ext = name.slice(name.lastIndexOf('.'));
  try {
    const body = await readFile(join(ROOT, name.slice(1)));
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
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
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 1000 },
    acceptDownloads: true,
  });
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
  // A fresh context per case — clearing storage in place no longer works now
  // that the app flushes a pending save on pagehide, which a reload triggers.
  for (const [label, body, expected] of [
    ['arrow',       '[[notes]]\n1 → answer one\n2 → answer two\n[[/notes]]', 2],
    ['1. period',   '[[notes]]\n1. answer one\n2. answer two\n[[/notes]]',             2],
    ['1) paren',    '[[notes]]\n1) answer one\n2) answer two\n[[/notes]]',             2],
    ['hyphen',      '[[notes]]\n1 - answer one\n2 - answer two\n[[/notes]]',           2],
  ]) {
    const page = await newPage();
    await page.click('#sample'); await page.waitForTimeout(300);
    await type(page, 1, 'note one');
    await type(page, 30, 'note two');
    await reply(page, body);
    eq(`"${label}" is understood`, await page.locator('.rnode').count(), expected);
    await page.close_();
  }
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
  let page = await newPage();
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
  // Fresh context rather than clearing in place — a reload flushes any pending
  // save, which would put the thread straight back.
  await page.close_();
  page = await newPage();
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

console.log('\nthe text can be annotated without a pointer');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);

  const stops = await page.$$eval('.w[tabindex="0"]', ns => ns.length);
  eq('the reader is a single tab stop', stops, 1);

  await page.locator('.w[data-i="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  eq('arrows move the cursor',
     await page.evaluate(() => document.activeElement.dataset.i), '2');

  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  eq('shift+arrow widens to a phrase', await page.$$eval('.w.live', ns => ns.length), 3);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('Enter opens the note box',
    await page.locator('#typein').evaluate(e => e.classList.contains('on')));
  await page.fill('#typetxt', 'typed with the keyboard only');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  eq('the note is filed', await sheet(page), ['typed with the keyboard only']);
  const quote = await page.locator('.note .quote').first().textContent();
  check('it is anchored to the phrase, not one word',
        quote.split(/\s+/).length >= 3, quote);
  await page.close_();
}

console.log('\noverlays behave like dialogs');
{
  const page = await newPage();      // "Paste a thread" only exists before a text is loaded
  for (const [name, opener, overlay] of [
    ['import', '#importbtn', '#importin'],
  ]) {
    await page.click(opener); await page.waitForTimeout(300);
    check(`${name} opens`, await page.locator(overlay).evaluate(e => e.classList.contains('on')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check(`${name} closes on Escape`,
      !(await page.locator(overlay).evaluate(e => e.classList.contains('on'))));
    eq(`${name} hands focus back`,
       await page.evaluate(() => document.activeElement.id), opener.slice(1));
  }
  await page.close_();
}

console.log('\npinch-zoom is not blocked');
{
  const page = await newPage();
  const vp = await page.getAttribute('meta[name=viewport]', 'content');
  check('no user-scalable=no', !/user-scalable\s*=\s*no/.test(vp), vp);
  check('no maximum-scale', !/maximum-scale/.test(vp), vp);
  await page.close_();
}

console.log('\nthe notes basket carries across pages');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'ROOT A');
  await type(page, 30, 'ROOT B');
  await reply(page, '[[notes]]\n1 → the reply to A\n[[/notes]]');
  eq('the unanswered root note remains', await sheet(page), ['ROOT B']);

  await page.locator('.rhead').first().click(); await page.waitForTimeout(500);
  eq('it is still there on the reply page', await sheet(page), ['ROOT B']);

  await type(page, 1, 'CHILD C');
  eq('and the new note joins it', await sheet(page), ['ROOT B', 'CHILD C']);
  eq('the badge counts the whole basket',
     await page.locator('#count').textContent(), '2');

  // the number beside a word must match the number in the prompt
  const marks = await page.$$eval('#reader sup.mk:not(.ans)', ns => ns.map(n => n.textContent));
  eq('marks use the basket numbering, not per-page', marks, ['2']);

  const prompt = await page.locator('#preview').inputValue();
  check('both pages go in whole',
    /--- PAGE 1 \(the original text\) ---/.test(prompt) && /--- PAGE 2 \(/.test(prompt), prompt.slice(0, 300));
  check('note 1 is tagged to page 1', /\[1\] on page 1, /.test(prompt));
  check('note 2 is tagged to page 2', /\[2\] on page 2, /.test(prompt));
  check('the root text is present', prompt.includes('The bottleneck'));
  check('the reply text is present', prompt.includes('the reply to A'));
  check('notes being asked are not also repeated as ledger lines',
    !/Open \(no reply yet\): ROOT B/.test(prompt));

  // one reply, answers routed to two different pages
  await reply(page, '[[notes]]\n1 → answer to ROOT B\n2 → answer to CHILD C\n[[/notes]]');
  eq('the basket empties', await sheet(page), []);
  const s = await state(page);
  const root = s.nodes.find(n => !n.parents.length);
  const child = s.nodes.find(n => n.note === 'ROOT A');
  const byNote = t => s.nodes.find(n => n.note === t);
  eq('the answer to the root note hangs off the root',
     byNote('ROOT B').parents, [root.id]);
  eq('the answer to the child note hangs off the child',
     byNote('CHILD C').parents, [child.id]);
  eq('no exceptions', page.errors, []);
  await page.close_();
}

console.log('\nthe scope switch narrows to one page');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'ROOT A');
  await type(page, 30, 'ROOT B');
  await reply(page, '[[notes]]\n1 → the reply to A\n[[/notes]]');
  await page.locator('.rhead').first().click(); await page.waitForTimeout(500);
  await type(page, 1, 'CHILD C');
  eq('all pages by default', await sheet(page), ['ROOT B', 'CHILD C']);

  await page.click('#grab'); await page.waitForTimeout(300);
  await page.click('#scopebar'); await page.waitForTimeout(400);
  eq('narrowed to this page', await sheet(page), ['CHILD C']);
  eq('the button says so', await page.locator('#scopebar').textContent(), 'This page');

  const prompt = await page.locator('#preview').inputValue();
  check('and the prompt is single-page again', !/--- PAGE 1 \(/.test(prompt), prompt.slice(0, 160));

  await page.click('#scopebar'); await page.waitForTimeout(400);
  eq('and back again', await sheet(page), ['ROOT B', 'CHILD C']);
  await page.close_();
}

console.log('\na note about the page as a whole');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'an ordinary note');

  await page.click('#pagenote'); await page.waitForTimeout(400);
  check('the card says what it is',
    (await page.locator('#typeq').textContent()).includes('as a whole'));
  await page.fill('#typetxt', 'this page is too hedged');
  await page.click('#typesave'); await page.waitForTimeout(300);

  eq('it joins the basket', await sheet(page), ['this page is too hedged', 'an ordinary note']);
  eq('and takes a number', await page.locator('#count').textContent(), '2');
  // it marks no words, so only the anchored note gets a superscript
  eq('it puts no superscript in the text',
     await page.$$eval('#reader sup.mk:not(.ans)', ns => ns.map(n => n.textContent)), ['2']);

  const prompt = await page.locator('#preview').inputValue();
  check('the prompt says it is about the whole page',
    /\[1\] about this page as a whole/.test(prompt), prompt.slice(0, 300));

  // its reply hangs off the page it was about
  await reply(page, '[[notes]]\n1 → the page is indeed hedged\n[[/notes]]');
  const s = await state(page);
  const root = s.nodes.find(n => !n.parents.length);
  const child = s.nodes.find(n => n.note === 'this page is too hedged');
  eq('the reply hangs off that page', child.parents, [root.id]);
  eq('and is marked as answering the whole page', child.whole, true);
  eq('no exceptions', page.errors, []);
  await page.close_();
}

console.log('\nstanding instructions are not questions');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a real note');

  await page.click('#alwaysnote'); await page.waitForTimeout(400);
  await page.fill('#typetxt', 'Answer in British English');
  await page.click('#typesave'); await page.waitForTimeout(300);

  eq('it does not take a note number',
     await page.locator('#count').textContent(), '1');
  check('it is listed separately',
    await page.locator('.alwayshead').isVisible());

  const prompt = await page.locator('#preview').inputValue();
  check('it reaches the model as a standing instruction',
    /Throughout, whichever note you are answering:\n- Answer in British English/.test(prompt),
    prompt.slice(-400));
  check('and is not numbered', !/\[\d+\].*British English/.test(prompt));

  // a reply consumes the note but must leave the instruction alone
  await reply(page, '[[notes]]\n1 → answered\n[[/notes]]');
  eq('a reply does not consume it', await sheet(page), ['Answer in British English']);

  await page.reload(); await page.waitForTimeout(700);
  eq('it survives a reload', await sheet(page), ['Answer in British English']);
  await page.close_();
}

console.log('\na note can carry its own intent');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'note one');
  await type(page, 30, 'note two');
  await page.click('#grab'); await page.waitForTimeout(300);

  let prompt = await page.locator('#preview').inputValue();
  check('untagged notes carry no intent tag', !/ — rewrite/.test(prompt));

  await page.locator('.note .intent').first().click();   // -> Rewrite
  await page.waitForTimeout(300);
  prompt = await page.locator('#preview').inputValue();
  check('the tagged note says so', /\[1\].* — rewrite/.test(prompt), prompt.slice(0, 400));
  check('and the intent is explained once', /Some notes carry their own intent/.test(prompt));
  check('the other note is untouched', !/\[2\].* — /.test(prompt));

  // reloaded immediately, inside the autosave debounce — the pagehide flush
  // is what has to carry this
  await page.reload(); await page.waitForTimeout(700);
  prompt = await page.locator('#preview').inputValue();
  check('the intent survives a reload', /\[1\].* — rewrite/.test(prompt));
  await page.close_();
}

console.log('\nwidening an anchor to a sentence or paragraph');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);

  await page.locator('.w[data-i="6"]').click(); await page.waitForTimeout(300);
  const word = await page.locator('#typeq').textContent();
  await page.locator('.scopebtn', { hasText: 'Sentence' }).click(); await page.waitForTimeout(200);
  const sentence = await page.locator('#typeq').textContent();
  await page.locator('.scopebtn', { hasText: 'Paragraph' }).click(); await page.waitForTimeout(200);
  const para = await page.locator('#typeq').textContent();

  check('a sentence is wider than a word', sentence.length > word.length, `${word} -> ${sentence}`);
  check('the sentence stops at the full stop',
    /^“The bottleneck.*interface\.”$/.test(sentence), sentence);
  check('a paragraph is wider than a sentence', para.length > sentence.length);
  check('the paragraph does not run past its own paragraph',
    !para.includes('What replaced it'), para.slice(-80));

  await page.locator('.scopebtn', { hasText: 'Sentence' }).click(); await page.waitForTimeout(200);
  await page.fill('#typetxt', 'a sentence note');
  await page.click('#typesave'); await page.waitForTimeout(300);
  const q = await page.locator('.note .quote').first().textContent();
  check('the saved note keeps the widened anchor', /interface\.”$/.test(q), q);

  // and it can be adjusted afterwards from the sheet
  await page.click('#grab'); await page.waitForTimeout(300);
  await page.locator('.note .quote').first().click(); await page.waitForTimeout(250);
  check('the sheet offers the same control',
    await page.locator('.note .scoperow').isVisible());
  await page.locator('.note .scopebtn', { hasText: 'Word' }).click(); await page.waitForTimeout(300);
  const narrowed = await page.locator('.note .quote').first().textContent();
  check('narrowing back to a word works', narrowed.length < q.length, `${q} -> ${narrowed}`);
  await page.close_();
}

console.log('\nreadable export');
{
  const page = await newPage();
  await page.click('#sampletree'); await page.waitForTimeout(500);
  await page.click('#alwaysnote'); await page.waitForTimeout(400);
  await page.fill('#typetxt', 'Be terse'); await page.click('#typesave'); await page.waitForTimeout(300);

  const dl = page.waitForEvent('download');
  await page.click('#exportbtn'); await page.waitForTimeout(300);
  await page.click('#exportmd');
  const file = await dl;
  const md = (await (await import('node:fs/promises')).readFile(await file.path())).toString();

  check('it is markdown', md.startsWith('# Meristem thread'), md.slice(0, 60));
  check('the filename is .md', file.suggestedFilename().endsWith('.md'), file.suggestedFilename());
  check('the original text is in it', md.includes('The bottleneck'));
  check('replies become headings', /^### /m.test(md), md.slice(0, 600));
  check('nesting deepens with the thread', /^#### /m.test(md));
  check('anchors appear as quotes', /^> /m.test(md));
  check('standing instructions are carried', md.includes('**Standing instructions:** Be terse'));
  check('open notes are listed', md.includes('**Still open:**'));
  await page.close_();
}

console.log('\nthe prompt size is shown before you paste it');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a note');
  await page.click('#grab'); await page.waitForTimeout(300);

  const label = await page.locator('#psize').textContent();
  check('it reads in words', /^~[\d.]+k? words$/.test(label), label);
  const shown = parseFloat(label.replace(/[^\d.]/g, '')) * (label.includes('k') ? 1000 : 1);
  const actual = (await page.locator('#preview').inputValue()).trim().split(/\s+/).length;
  check('and it matches the real prompt',
    Math.abs(shown - actual) / actual < 0.05, `showed ${shown}, actual ${actual}`);
  await page.close_();
}

console.log('\nshared text opens in the reader');
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await ctx.addInitScript(FAKE_SPEECH);
  await ctx.addInitScript(`window.confirm = () => true;`);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.split('\n')[0]));

  const shared = encodeURIComponent('A shared paragraph of prose.\n\nAnd a second one.');
  await page.goto(`${URL_}?title=${encodeURIComponent('An Article')}&text=${shared}&url=${encodeURIComponent('https://example.com/a')}`);
  await page.waitForTimeout(600);

  const text = await page.locator('#reader').innerText();
  check('the shared text is loaded', text.includes('A shared paragraph of prose'), text.slice(0, 120));
  check('the title comes with it', text.includes('An Article'));
  check('the source url comes with it', text.includes('https://example.com/a'));
  check('it is annotatable straight away', (await page.locator('.w').count()) > 0);
  eq('the query string is cleared so a refresh does not re-import',
     await page.evaluate(() => location.search), '');
  eq('no exceptions', page.errors, []);
  await ctx.close();
}

console.log('\nthe manifest and worker are wired up');
{
  const page = await newPage();
  eq('the manifest is linked',
     await page.getAttribute('link[rel=manifest]', 'href'), './manifest.json');

  const res = await page.request.get(`${URL_}manifest.json`);
  const mf = await res.json();
  eq('it registers as a share target', mf.share_target.method, 'GET');
  eq('sharing lands on the app itself', mf.share_target.action, './');
  eq('and carries the text', mf.share_target.params.text, 'text');
  check('it is installable (name, icons, display)',
    !!mf.name && mf.icons.length > 0 && mf.display === 'standalone');

  const sw = await (await page.request.get(`${URL_}sw.js`)).text();
  check('the worker is network-first for the page',
    /req\.mode === 'navigate'[\s\S]*fetch\(req\)[\s\S]*\.catch\(\(\) => caches\.match/.test(sw),
    'navigation handler should try the network before the cache');
  await page.close_();
}

/* ---------- done ---------- */

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('failing: ' + fails.join(', ')); process.exit(1); }
