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

/* An OpenRouter we control. The app talks to two endpoints with one shape
 * each, so the stub is small: `__replies` is what a given model answers,
 * `__slow` how long it takes about it, `__fail` an HTTP status to refuse with,
 * and `__asked` records what actually went over the wire. Anything that isn't
 * OpenRouter falls through to the real fetch, so a page that never connects a
 * model behaves exactly as it did before. */
const FAKE_OPENROUTER = () => {
  window.__asked = [];
  window.__replies = {};
  window.__slow = {};
  window.__fail = null;
  const CATALOGUE = [
    { id: 'stub/free-one:free', name: 'Free One', context_length: 128000,
      pricing: { prompt: '0', completion: '0' } },
    { id: 'stub/free-two:free', name: 'Free Two', context_length: 32000,
      pricing: { prompt: '0', completion: '0' } },
    { id: 'stub/paid-one', name: 'Paid One', context_length: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' } },
  ];
  const json = (body, status = 200) => new Response(JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } });
  const real = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (u.includes('openrouter.ai/api/v1/models')) return Promise.resolve(json({ data: CATALOGUE }));
    if (!u.includes('openrouter.ai/api/v1/chat/completions')) return real(url, init);

    const body = JSON.parse(init.body);
    window.__asked.push({
      model: body.model,
      prompt: body.messages[body.messages.length - 1].content,
      messages: body.messages,
      stream: !!body.stream,
      auth: init.headers.Authorization,
    });
    if (window.__fail) return Promise.resolve(json({ error: { message: 'refused' } }, window.__fail));
    const answer = window.__replies[body.model] ?? '';

    // A chat turn asks for SSE; a notes round waits for the whole thing.
    if (body.stream) {
      const enc = new TextEncoder();
      const words = answer.split(' ');
      const gap = window.__slow[body.model] || 0;
      return Promise.resolve(new Response(new ReadableStream({
        start(c) {
          let k = 0, stopped = false;
          const bail = () => {
            stopped = true;
            // a real abort errors the body stream rather than ending it
            try { c.error(new DOMException('aborted', 'AbortError')); } catch {}
          };
          if (init.signal) init.signal.addEventListener('abort', bail);
          const tick = () => {
            if (stopped) return;
            if (k >= words.length) { c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); return; }
            c.enqueue(enc.encode('data: ' + JSON.stringify(
              { choices: [{ delta: { content: (k ? ' ' : '') + words[k] } }] }) + '\n\n'));
            k++;
            setTimeout(tick, gap);
          };
          setTimeout(tick, gap);
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    }

    return new Promise(res => setTimeout(() => res(json({
      choices: [{ message: { content: answer }, finish_reason: 'stop' }],
    })), window.__slow[body.model] || 0));
  };
};

async function newPage({ confirm = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 1000 },
    acceptDownloads: true,
  });
  /* The web font is the one thing the page fetches from outside. A test has no
   * business waiting on the internet for it — and when the network stalls
   * rather than refusing, the page never finishes loading at all. */
  await ctx.route('https://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(FAKE_SPEECH);
  await ctx.addInitScript(FAKE_OPENROUTER);
  await ctx.addInitScript(`window.confirm = () => ${confirm};`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);   // nothing here takes seconds; a stall is a bug
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
/* Hand the app a key and a shortlist the way the settings card would, then
 * reload so it is picked up exactly as it is on a returning visit. */
async function connect(page, models, key = 'sk-or-v1-TESTKEY') {
  await page.evaluate(([m, k]) => localStorage.setItem(
    'meristem.openrouter.v1', JSON.stringify({ key: k, models: m })), [models, key]);
  await page.reload();
  await page.waitForTimeout(300);
}

/* The secondary controls live inside the sheet now, so reaching one means
 * raising the sheet first — the same as it is by hand. */
async function openSheet(page) {
  const up = await page.evaluate(() =>
    document.getElementById('sheet').classList.contains('open'));
  if (up) return;
  await page.click('#grab');
  await page.waitForTimeout(320);
}
async function bar(page, id) {
  await openSheet(page);
  await page.click('#' + id);
}

/* Type into the message box and send, the way the box is actually used. */
async function say(page, text, wait = 700) {
  await page.fill('#saytxt', text);
  await page.click('#saysend');
  await page.waitForTimeout(wait);
}

async function reply(page, body) {
  await bar(page, 'replybar'); await page.waitForTimeout(200);
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
  await openSheet(page); await page.waitForTimeout(400);

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
  await page.fill('#saytxt', formatted); await page.waitForTimeout(200);
  await page.locator('#toolong button').click(); await page.waitForTimeout(300);
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

  await openSheet(page); await page.waitForTimeout(300);
  await bar(page, 'scopebar'); await page.waitForTimeout(400);
  eq('narrowed to this page', await sheet(page), ['CHILD C']);
  eq('the button says so', await page.locator('#scopebar').textContent(), 'This page');

  const prompt = await page.locator('#preview').inputValue();
  check('and the prompt is single-page again', !/--- PAGE 1 \(/.test(prompt), prompt.slice(0, 160));

  await bar(page, 'scopebar'); await page.waitForTimeout(400);
  eq('and back again', await sheet(page), ['ROOT B', 'CHILD C']);
  await page.close_();
}

console.log('\na question about the page as a whole');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'an ordinary note');

  // What + Page used to be: type it, and it rides out with the marks.
  await page.fill('#saytxt', 'this page is too hedged'); await page.waitForTimeout(250);
  eq('the mark is riding along too',
     (await page.locator('#riding').textContent()).replace(/\s+/g, ' '),
     '1 note goes out with this — see them');

  const prompt = await page.locator('#preview').inputValue();
  check('both are numbered in the prompt',
    /\[1\][\s\S]*an ordinary note[\s\S]*\[2\][\s\S]*too hedged/.test(prompt),
    prompt.slice(-320));

  // carried out by hand, the question becomes a page so the reply has a home
  await page.locator('#saycopy').click(); await page.waitForTimeout(350);
  eq('the box empties into the thread', await page.locator('#saytxt').inputValue(), '');
  let s0 = await state(page);
  const asked = s0.nodes.find(n => n.mine);
  eq('as a question of my own', asked.text, 'this page is too hedged');

  await reply(page, '[[notes]]\n1 → about the words\n2 → the page is indeed hedged\n[[/notes]]');
  const s = await state(page);
  const root = s.nodes.find(n => !n.parents.length);
  eq('the question hangs off the page it was about', asked.parents, [root.id]);
  const answer = s.nodes.find(n => n.parents[0] === asked.id);
  eq('and its answer hangs off the question', answer.text, 'the page is indeed hedged');
  eq('while the mark is answered on its own words',
     s.nodes.find(n => n.note === 'an ordinary note').text, 'about the words');
  eq('no exceptions', page.errors, []);
  await page.close_();
}

console.log('\nstanding instructions are not questions');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a real note');

  await bar(page, 'alwaysnote'); await page.waitForTimeout(400);
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
  await openSheet(page); await page.waitForTimeout(300);

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
  await openSheet(page); await page.waitForTimeout(300);
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
  await bar(page, 'alwaysnote'); await page.waitForTimeout(400);
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
  await openSheet(page); await page.waitForTimeout(300);

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
  /* The web font is the one thing the page fetches from outside. A test has no
   * business waiting on the internet for it — and when the network stalls
   * rather than refusing, the page never finishes loading at all. */
  await ctx.route('https://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(FAKE_SPEECH);
  await ctx.addInitScript(FAKE_OPENROUTER);
  await ctx.addInitScript(`window.confirm = () => true;`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);   // nothing here takes seconds; a stall is a bug
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

/* ---------- comparing models ---------- */

async function pasteReply(page, body, source) {
  await bar(page, 'replybar'); await page.waitForTimeout(250);
  if (source != null && !(await page.locator('#srcrow').isHidden())) {
    await page.fill('#replysrc', source);
  }
  await page.fill('#replytxt', body);
  await page.click('#replysave'); await page.waitForTimeout(450);
}
const answersOn = (page, i) => page.$$eval(
  `.note:nth-of-type(${i}) .ans`,
  ns => ns.map(a => a.querySelector('.who').textContent + ': ' + a.querySelector('.what').textContent),
);

console.log('\ncomparing answers from several models');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'is this true?');
  await type(page, 30, 'needs a date');

  await openSheet(page); await page.waitForTimeout(250);
  await bar(page, 'comparebar'); await page.waitForTimeout(300);
  eq('the toggle reports itself', await page.locator('#comparebar').textContent(), 'Comparing');

  await pasteReply(page, '[[notes]]\n1 → Claude on one\n2 → Claude on two\n[[/notes]]', 'Claude');
  eq('a reply no longer spends the notes', await sheet(page), ['is this true?', 'needs a date']);
  eq('no page is created yet', await page.locator('.rnode').count(), 0);

  await pasteReply(page, '[[notes]]\n1 → GPT on one\n[[/notes]]', 'GPT-5');
  await pasteReply(page, '[[notes]]\n1 → Gemini on one\n[[/notes]]', 'Gemini');

  eq('three answers sit under the first note', await answersOn(page, 1),
     ['Claude: Claude on one', 'GPT-5: GPT on one', 'Gemini: Gemini on one']);
  eq('and one under the second', await answersOn(page, 2), ['Claude: Claude on two']);

  // keep the middle one
  await page.locator('.ans .keep').nth(1).scrollIntoViewIfNeeded();
  await page.locator('.ans .keep').nth(1).click(); await page.waitForTimeout(500);

  eq('the kept answer becomes a page', await page.locator('.rnode').count(), 1);
  const s = await state(page);
  const kept = s.nodes.find(n => n.parents.length);
  eq('tagged with who wrote it', kept.source, 'GPT-5');
  eq('and labelled with the note it answers', kept.note, 'is this true?');

  eq('the others stay for comparison', await answersOn(page, 1),
     ['Claude: Claude on one', 'Gemini: Gemini on one']);
  check('the note is still open', (await sheet(page)).includes('is this true?'));

  // discarding down to the last one, then keeping it, clears the note
  await page.locator('.ans .toss').first().click(); await page.waitForTimeout(300);
  await page.locator('.ans .keep').first().scrollIntoViewIfNeeded();
  await page.locator('.ans .keep').first().click(); await page.waitForTimeout(500);
  check('keeping the last answer clears the note',
    !(await sheet(page)).includes('is this true?'), JSON.stringify(await sheet(page)));

  eq('no exceptions', page.errors, []);
  await page.close_();
}

console.log('\ncompare mode leaves the ordinary flow alone');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a note');
  check('it is off by default',
    (await page.locator('#comparebar').textContent()) === 'Compare');
  await pasteReply(page, '[[notes]]\n1 → answered straight away\n[[/notes]]');
  eq('the note is spent as before', await sheet(page), []);
  eq('and becomes a page', await page.locator('.rnode').count(), 1);
  await page.close_();
}

console.log('\nthe model that wrote a page is shown and kept');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a note');
  await openSheet(page); await page.waitForTimeout(250);
  await bar(page, 'comparebar'); await page.waitForTimeout(300);
  await pasteReply(page, '[[notes]]\n1 → an answer\n[[/notes]]', 'Claude');
  await page.locator('.ans .keep').first().scrollIntoViewIfNeeded();
  await page.locator('.ans .keep').first().click(); await page.waitForTimeout(500);

  const meta = await page.locator('.rnode .rmeta').first().textContent();
  check('the reader credits the source', meta.includes('Claude'), meta);

  await page.reload(); await page.waitForTimeout(700);
  const after = await page.locator('.rnode .rmeta').first().textContent();
  check('and it survives a reload', after.includes('Claude'), after);
  await page.close_();
}

/* ---------- suggested notes ---------- */

console.log('\nasking a model which passages are worth interrogating');
{
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  });
  /* The web font is the one thing the page fetches from outside. A test has no
   * business waiting on the internet for it — and when the network stalls
   * rather than refusing, the page never finishes loading at all. */
  await ctx.route('https://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(FAKE_SPEECH);
  await ctx.addInitScript(FAKE_OPENROUTER);
  await ctx.addInitScript(`window.confirm = () => true;`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);   // nothing here takes seconds; a stall is a bug
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.split('\n')[0]));
  await page.goto(URL_); await page.waitForTimeout(200);
  page.close_ = () => ctx.close();

  await page.click('#sample'); await page.waitForTimeout(300);
  await bar(page, 'suggestbar'); await page.waitForTimeout(400);
  const prompt = await page.evaluate(() => navigator.clipboard.readText());

  check('it asks for an agenda, not answers',
    /mark the passages worth interrogating/.test(prompt), prompt.slice(0, 160));
  check('it carries the text', prompt.includes('The bottleneck'));
  check('it asks for verbatim quotes it can anchor',
    /\[\[suggest\]\]/.test(prompt) && /copied verbatim/.test(prompt));
  check('it warns off generic notes', /needs more evidence/.test(prompt));

  // the same paste box takes the reply back
  await pasteReply(page, `Here are the weak points.

[[suggest]]
"The bottleneck isn't model quality anymore" → Is this actually true?
"That assumption expired about eighteen months ago" → Expired according to what?
"a sentence that appears nowhere in this text at all" → cannot be placed
[[/suggest]]`);

  eq('the placeable ones arrive as notes', await sheet(page),
     ['Is this actually true?', 'Expired according to what?']);
  const toast = await page.locator('#toast').textContent();
  check('and the unplaceable one is reported, not silently dropped',
    /couldn't be placed/.test(toast), toast);

  // anchored to the right words, not the top of the page
  const quotes = await page.$$eval('.note .quote', ns => ns.map(n => n.textContent));
  check('anchored to the quoted passage',
    /The bottleneck isn't model quality anymore/.test(quotes[0]), quotes[0]);
  check('and the second to its own', /eighteen months ago/.test(quotes[1]), quotes[1]);

  check('they are marked as suggestions',
    (await page.locator('.note .fromai').count()) === 2);

  // a second pass must not duplicate the first
  await pasteReply(page, `[[suggest]]
"The bottleneck isn't model quality anymore" → the same passage again
[[/suggest]]`);
  eq('an overlapping suggestion is skipped', (await sheet(page)).length, 2);
  check('and says so', /already marked/.test(await page.locator('#toast').textContent()));

  eq('no exceptions', page.errors, []);
  await page.close_();
}

console.log('\na suggested note becomes yours once you edit it');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await pasteReply(page, `[[suggest]]
"The bottleneck isn't model quality anymore" → a suggestion
[[/suggest]]`);
  eq('it starts as a suggestion', await page.locator('.note .fromai').count(), 1);

  await openSheet(page); await page.waitForTimeout(250);
  await page.locator('.note .said').first().scrollIntoViewIfNeeded();
  await page.locator('.note .said').first().click(); await page.waitForTimeout(250);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('sharpened by me');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);

  eq('editing makes it yours', await page.locator('.note .fromai').count(), 0);
  eq('and keeps the text', await sheet(page), ['sharpened by me']);

  await page.reload(); await page.waitForTimeout(700);
  eq('which survives a reload', await page.locator('.note .fromai').count(), 0);
  await page.close_();
}

console.log('\nsuggestions survive punctuation drift');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  // curly apostrophe and a trailing clause the text doesn't have
  await pasteReply(page, `[[suggest]]
"The bottleneck isn’t model quality anymore, it’s the interface" → smart quotes
"Teams that shipped in 2023 assumed the hard part was something else entirely" → partial tail
[[/suggest]]`);
  const got = await sheet(page);
  check('a quote with different apostrophes still anchors',
    got.includes('smart quotes'), JSON.stringify(got));
  check('and one whose tail drifted falls back to the matching prefix',
    got.includes('partial tail'), JSON.stringify(got));
  await page.close_();
}

console.log('\na connected model answers without the paste box');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'WHY THIS');
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = '[[notes]]\n1 → BECAUSE OF THAT\n[[/notes]]';
  });
  await page.click('#saysend'); await page.waitForTimeout(800);

  const s = await state(page);
  const kid = s.nodes.find(n => n.parents.length);
  eq('the answer became a page', kid?.text, 'BECAUSE OF THAT');
  eq('the note it answered is spent', notesOn(s, 'n0'), []);

  const asked = await page.evaluate(() => window.__asked);
  eq('one model was asked', asked.length, 1);
  check('the prompt went out whole', asked[0].prompt.includes('WHY THIS'),
        asked[0].prompt.slice(0, 90));
  eq('with the key on the request', asked[0].auth, 'Bearer sk-or-v1-TESTKEY');
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\ntwo models answer side by side under one note');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free', 'stub/free-two:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'WHICH IS IT');
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = '[[notes]]\n1 → FIRST ANSWER\n[[/notes]]';
    window.__replies['stub/free-two:free'] = '[[notes]]\n1 → SECOND ANSWER\n[[/notes]]';
    // the second one finishes first, to prove the order comes from the list
    window.__slow = { 'stub/free-one:free': 250 };
  });
  await page.click('#saysend'); await page.waitForTimeout(1200);

  eq('both answers arrive',
     await page.$$eval('.ans .what', ns => ns.map(n => n.textContent)),
     ['FIRST ANSWER', 'SECOND ANSWER']);
  eq('each labelled with who wrote it',
     await page.$$eval('.ans .who', ns => ns.map(n => n.textContent)),
     ['free-one', 'free-two']);
  eq('the note stays while you weigh them', await sheet(page), ['WHICH IS IT']);
  eq('and Compare was never switched on for you',
     await page.evaluate(() => localStorage.getItem('meristem.compare.v1')), null);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\nthe key stays out of the thread');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a note');
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = '[[notes]]\n1 → an answer\n[[/notes]]';
  });
  await page.click('#saysend'); await page.waitForTimeout(800);

  const saved = await page.evaluate(() => localStorage.getItem('meristem.thread.v1'));
  check('the autosaved thread carries no key', !/sk-or/.test(saved), saved.slice(0, 120));
  const md = await page.evaluate(() => {
    // the same serialisation both Export buttons write
    return localStorage.getItem('meristem.thread.v1');
  });
  check('nor does the blob an export is built from', !/sk-or/.test(md), '');
  check('while the key itself is still where the app keeps it',
        /sk-or-v1-TESTKEY/.test(await page.evaluate(
          () => localStorage.getItem('meristem.openrouter.v1'))), '');
  await page.close_();
}

console.log('\nan answer that cannot be read is handed back, not dropped');
{
  const page = await newPage({ confirm: false });
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  // two questions, so an unnumbered reply genuinely can't be routed
  await type(page, 1, 'a question');
  await type(page, 30, 'another question');
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = 'I have opinions but no numbers.';
  });
  await page.click('#saysend'); await page.waitForTimeout(900);

  eq('the reply is sitting in the paste box',
     await page.locator('#replytxt').inputValue(), 'I have opinions but no numbers.');
  eq('and the notes it was for are untouched',
     await sheet(page), ['a question', 'another question']);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na refusal is said out loud and spends nothing');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a question');
  await page.evaluate(() => { window.__fail = 401; });
  await page.click('#saysend'); await page.waitForTimeout(800);

  const said = await page.locator('#toast').textContent();
  check('the reason names the key', /key/i.test(said), said);
  eq('the note is still waiting', await sheet(page), ['a question']);
  eq('no page was made', (await state(page)).nodes.length, 1);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\nSuggest asks directly once a model is connected');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] =
      '[[suggest]]\n"The fix most teams reach for is longer memory" → is it, though?\n[[/suggest]]';
  });
  await bar(page, 'suggestbar'); await page.waitForTimeout(900);

  eq('the agenda came back as a note', await sheet(page), ['is it, though?']);
  eq('it went over the wire rather than to the clipboard',
     (await page.evaluate(() => window.__asked)).length, 1);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\nwithout a key the copy path is untouched');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a note');

  check('the box is there anyway, to carry the round out by hand',
        await page.locator('#composer').isVisible(), '');
  eq('and the bar offers to connect one',
     await page.locator('#keybar').textContent(), 'Connect a model');
  await reply(page, '[[notes]]\n1 → pasted by hand\n[[/notes]]');
  const s = await state(page);
  eq('a pasted reply still becomes a page',
     s.nodes.find(n => n.parents.length)?.text, 'pasted by hand');
  eq('and OpenRouter was never called',
     (await page.evaluate(() => window.__asked)).length, 0);
  await page.close_();
}

console.log('\nchoosing models from the catalogue');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await bar(page, 'keybar'); await page.waitForTimeout(500);

  eq('free models are what it offers first',
     await page.$$eval('#mlist .id', ns => ns.map(n => n.textContent)),
     ['stub/free-one:free', 'stub/free-two:free']);

  await page.fill('#keytxt', 'sk-or-v1-TYPED');
  await page.locator('#mlist .mrow').first().click(); await page.waitForTimeout(200);
  await page.click('#keysave'); await page.waitForTimeout(300);

  eq('the bar now names the model',
     await page.locator('#keybar').textContent(), 'free-one');
  check('and the send arrow is there', await page.locator('#saysend').isVisible(), '');
  eq('the key and model are remembered',
     await page.evaluate(() => JSON.parse(localStorage.getItem('meristem.openrouter.v1'))),
     { key: 'sk-or-v1-TYPED', models: ['stub/free-one:free'] });

  await bar(page, 'keybar'); await page.waitForTimeout(300);
  await page.click('#keyforget'); await page.waitForTimeout(300);
  eq('forgetting it puts the copy path back',
     await page.locator('#keybar').textContent(), 'Connect a model');
  eq('and leaves nothing behind',
     await page.evaluate(() => localStorage.getItem('meristem.openrouter.v1')), null);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na message with nothing to annotate starts the thread');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  check('the box is there before any text is', await page.locator('#composer').isVisible(), '');
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = 'Because the reading half has no controls.';
  });
  await say(page, 'why is chat the wrong shape?');

  const s = await state(page);
  eq('two pages: what I said and what came back', s.nodes.length, 2);
  eq('the thread begins with my message', s.nodes[0].text, 'why is chat the wrong shape?');
  eq('marked as mine', s.nodes[0].mine, true);
  eq('the answer hangs off it', s.nodes[1].parents, [s.nodes[0].id]);
  eq('and is not mine', s.nodes[1].mine, false);
  eq('it was streamed', (await page.evaluate(() => window.__asked))[0].stream, true);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\nthe whole conversation goes out, not just the last line');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'First answer.'; });
  await say(page, 'first question');
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'Second answer.'; });
  await say(page, 'second question');

  eq('every turn so far, in order',
     (await page.evaluate(() => window.__asked))[1].messages, [
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'First answer.' },
    { role: 'user', content: 'second question' },
  ]);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na standing instruction is a system prompt');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await bar(page, 'alwaysnote'); await page.waitForTimeout(350);
  await page.fill('#typetxt', 'Answer in British English.');
  await page.click('#typesave'); await page.waitForTimeout(300);
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'Quite.'; });
  await say(page, 'go on then');

  const sent = (await page.evaluate(() => window.__asked))[0].messages;
  eq('it leads the conversation', sent[0],
     { role: 'system', content: 'Answer in British English.' });
  check('and the text I am reading goes in as material',
        sent[1].role === 'user' && sent[1].content.includes("text I'm working from"),
        JSON.stringify(sent[1]).slice(0, 140));
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na chat reply can be marked up the moment it lands');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = 'Memory is the wrong lever entirely.';
  });
  await say(page, 'what should I fix?');
  await type(page, 0, 'is it though');

  const s = await state(page);
  const answer = s.nodes.find(x => !x.mine && x.parents.length);
  eq('the note lands on the reply', notesOn(s, answer.id), ['is it though']);

  // answering that note carries on in the same thread
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = '[[notes]]\n1 → It is.\n[[/notes]]';
  });
  await page.click('#saysend'); await page.waitForTimeout(900);
  const after = await state(page);
  eq('the answer branches off the reply', after.nodes.length, 3);
  eq('hanging off the page the note was on',
     after.nodes[2].parents, [answer.id]);
  eq('and the note is spent', notesOn(after, answer.id), []);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\nwhat was said before sits above what is being read');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'An answer.'; });
  await say(page, 'a question');
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'Another answer.'; });
  await say(page, 'a follow-up');

  eq('three turns of scrollback above the live page',
     await page.$$eval('.turn .tt', ns => ns.map(n => n.textContent)),
     ['a question', 'An answer.', 'a follow-up']);
  eq('each labelled with who said it',
     await page.$$eval('.turn .tw', ns => ns.map(n => n.textContent)),
     ['You', 'free-one', 'You']);
  eq('and so is the page being read',
     await page.locator('.nowwho').textContent(), 'free-one');

  await page.locator('.turn').nth(1).click(); await page.waitForTimeout(450);
  eq('tapping an earlier turn makes it the page you can mark up',
     await page.$$eval('.reader > p', ns => ns.map(n => n.textContent.replace(/\s+/g, ' ').trim())),
     ['An answer.']);
  eq('with what came before above it and what came after below',
     await page.$$eval('.back .tt', ns => ns.map(n => n.textContent)),
     ['a question', 'a follow-up', 'Another answer.']);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na turn that comes to nothing leaves nothing behind');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'fine'; });
  await say(page, 'the first one works');

  await page.evaluate(() => { window.__fail = 429; });
  await say(page, 'this one will not');

  eq('the failed turn left no pages behind', (await state(page)).nodes.length, 2);
  eq('and my message is back in the box, not lost',
     await page.locator('#saytxt').inputValue(), 'this one will not');
  const said = await page.locator('#toast').textContent();
  check('with the reason on screen', /rate limited/i.test(said), said);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\nstopping keeps what had already arrived');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = 'one two three four five six seven eight nine ten';
    window.__slow['stub/free-one:free'] = 110;
  });
  await page.fill('#saytxt', 'take your time');
  await page.click('#saysend'); await page.waitForTimeout(500);
  eq('the button offers to stop',
     await page.locator('#saysend').getAttribute('aria-label'), 'Stop');
  await page.click('#saysend'); await page.waitForTimeout(700);

  const kid = (await state(page)).nodes.find(x => !x.mine && x.parents.length);
  check('the part that arrived is kept as a page',
        !!kid && kid.text.indexOf('one') === 0, JSON.stringify(kid && kid.text));
  eq('and the button goes back to sending',
     await page.locator('#saysend').getAttribute('aria-label'), 'Send');
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na conversation is an ordinary thread');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'An answer worth keeping.'; });
  await say(page, 'a question worth asking');

  await page.reload(); await page.waitForTimeout(700);
  const s = await state(page);
  eq('it comes back after a reload', s.nodes.length, 2);
  eq('still knowing which turn was mine', s.nodes[0].mine, true);
  eq('and the scrollback is drawn again',
     await page.$$eval('.turn .tt', ns => ns.map(n => n.textContent)),
     ['a question worth asking']);
  check('the turn markers travel with the thread',
        /"mine":true/.test(await page.evaluate(
          () => localStorage.getItem('meristem.thread.v1'))), '');
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\nwithout a key the box still works, by hand');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  check('the box is there', await page.locator('#composer').isVisible(), '');

  // typed, carried out, and answered by hand — the whole app with no key
  await page.fill('#saytxt', 'what is this arguing for?'); await page.waitForTimeout(250);
  await page.locator('#saycopy').click(); await page.waitForTimeout(400);
  const asked = (await state(page)).nodes.find(n => n.mine);
  eq('the question becomes a page waiting for an answer',
     asked && asked.text, 'what is this arguing for?');
  eq('and nothing went over the wire',
     (await page.evaluate(() => window.__asked)).length, 0);

  await reply(page, 'It argues the interface is the bottleneck.');
  eq('the pasted answer hangs off the question',
     (await state(page)).nodes.find(n => n.parents[0] === asked.id).text,
     'It argues the interface is the bottleneck.');
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\none round, two ways out, and the tree cannot tell');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a mark');
  await page.fill('#saytxt', 'and a question'); await page.waitForTimeout(250);

  // what Copy hands you says everything in its own text
  const portable = await page.locator('#preview').inputValue();
  check('the carried prompt inlines the text', /--- TEXT ---/.test(portable), portable.slice(0, 120));
  check('and numbers both questions',
    /\[1\][\s\S]*a mark[\s\S]*\[2\][\s\S]*and a question/.test(portable), portable.slice(-260));

  // what Send posts says the same, packaged as turns
  await page.evaluate(() => {
    window.__replies['stub/free-one:free'] = '[[notes]]\n1 → to the mark\n2 → to the question\n[[/notes]]';
  });
  await page.click('#saysend'); await page.waitForTimeout(1000);
  const sent = (await page.evaluate(() => window.__asked))[0].messages;
  eq('the round is the last thing said', sent[sent.length - 1].role, 'user');
  check('carrying the same two questions',
    /\[1\][\s\S]*a mark[\s\S]*\[2\][\s\S]*and a question/.test(sent[sent.length - 1].content), '');

  const s = await state(page);
  eq('the mark is answered on its own words',
     s.nodes.find(n => n.note === 'a mark').text, 'to the mark');
  const asked = s.nodes.find(n => n.mine);
  eq('the question became a page of mine', asked.text, 'and a question');
  eq('with its answer beneath it',
     s.nodes.find(n => n.parents[0] === asked.id).text, 'to the question');
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na single question needs no protocol');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'A plain answer.'; });
  await say(page, 'a first question');

  const first = (await page.evaluate(() => window.__asked))[0];
  eq('the prompt is the question, nothing else',
     first.messages, [{ role: 'user', content: 'a first question' }]);
  eq('and it streamed', first.stream, true);
  check('no block was asked for', !/\[\[notes\]\]/.test(first.messages[0].content), '');

  // a second turn arrives as turns, with the round as the last message
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'More.'; });
  await say(page, 'say more');
  eq('the conversation is real turns',
     (await page.evaluate(() => window.__asked))[1].messages.map(m => m.role),
     ['user', 'assistant', 'user']);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na hand-edited prompt is sent exactly as written');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  await page.click('#sample'); await page.waitForTimeout(300);
  await type(page, 1, 'a mark');
  await bar(page, 'peekbar'); await page.waitForTimeout(300);
  await page.fill('#preview', 'JUST THIS, NOTHING ELSE'); await page.waitForTimeout(250);
  await page.evaluate(() => { window.__replies['stub/free-one:free'] = 'ok'; });
  await page.click('#saysend'); await page.waitForTimeout(900);

  eq('what I wrote is the whole of it',
     (await page.evaluate(() => window.__asked))[0].messages,
     [{ role: 'user', content: 'JUST THIS, NOTHING ELSE' }]);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na long paste offers to be read rather than answered');
{
  const page = await newPage();
  await connect(page, ['stub/free-one:free']);
  const article = 'The bottleneck is the interface.\n\n' + 'A second paragraph that goes on. '.repeat(12);
  await page.fill('#saytxt', article); await page.waitForTimeout(300);
  check('the offer appears', await page.locator('#toolong').isVisible(), '');
  await page.locator('#toolong button').click(); await page.waitForTimeout(400);

  eq('it became the page to read', (await state(page)).nodes.length, 1);
  eq('and the box is clear again', await page.locator('#saytxt').inputValue(), '');
  check('with words to mark up', (await page.locator('.w').count()) > 20, '');
  eq('nothing went over the wire', (await page.evaluate(() => window.__asked)).length, 0);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

console.log('\na question carried out by hand is still pending when you come back');
{
  const page = await newPage();
  await page.click('#sample'); await page.waitForTimeout(300);
  await page.fill('#saytxt', 'what is the argument?'); await page.waitForTimeout(250);
  await page.locator('#saycopy').click(); await page.waitForTimeout(400);

  await page.reload(); await page.waitForTimeout(700);
  const prompt = await page.locator('#preview').inputValue();
  check('a reload finds it waiting', /what is the argument\?/.test(prompt), prompt.slice(0, 200));

  await reply(page, 'The interface, not the model.');
  eq('and the answer lands under it',
     (await state(page)).nodes.find(n => n.text === 'The interface, not the model.') !== undefined,
     true);
  eq('nothing threw', page.errors, []);
  await page.close_();
}

/* ---------- done ---------- */

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('failing: ' + fails.join(', ')); process.exit(1); }
