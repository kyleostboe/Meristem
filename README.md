# Meristem

**Talk in the text.**

Live: https://kyleostboe.github.io/Meristem/

Most of the time you spend in a chat product goes to reading, not writing — and
every control in the product acts on the message you are composing. Nothing acts
on the message you are reading. Meristem puts the interaction on the read
surface: you mark up the text itself, and the conversation branches out of your
marks.

## How it works

1. **Paste some prose** into the reader.
2. **Annotate it in place.** Tap a word to type a note. Press and hold to speak
   one — a live caption shows the transcript — and drag while holding to cover a
   whole phrase. Having pointed at a word you can widen the anchor to its
   sentence or paragraph in one tap, in the card or later from the sheet.
3. **Keep marking up as you move around.** The notes sheet is one running
   basket across the whole thread, not a per-page list — open a reply, annotate
   that too, and the earlier notes are still there. Notes are numbered straight
   through, and the number beside a word is the number the AI will answer.
4. **Copy the prompt, once.** Every page carrying a note goes in whole, labelled
   with how it came about, followed by all your notes with their anchor quotes
   and a mode instruction (rewrite, respond, push back, options, check). The
   sheet shows roughly how long the prompt runs before you paste it anywhere.
5. **Paste the reply back.** Each numbered answer becomes its own page, hanging
   off the words that prompted it — on whichever page that was. A single reply
   can grow branches in several places at once.
6. **Keep going.** Open any reply and annotate *that*. Depth is unbounded, and a
   note can span several pages at once, so branches can rejoin.

### Notes that aren't about particular words

Not everything you want to say is about a specific phrase, so two kinds of note
carry no anchor:

- **`+ Page`** — a note about the page as a whole. *"This reply is too hedged."*
  It is still a question: it takes a number like any other note, and its answer
  comes back as a new page.
- **`+ Always`** — a standing instruction. *"Answer in British English."* Not a
  question, so it takes no number and no reply consumes it. It shapes every
  answer and persists until you delete it.

Both are made from the sheet — tap to type, hold to speak.

### Asking for different things at once

Each note can carry its own intent, so one round can ask for a rewrite here and
an argument there. Tap the small label under a note to change it; untagged notes
follow the mode set for the sheet.

`All pages` in the sheet narrows to `This page` when you want to work on one
text in isolation.

The **map** (`Tree`) shows the whole thread in 3D — drag to orbit, pinch or
scroll to zoom, tap to centre, double-tap to read a page in full. **Read all**
flattens the same thing into a document.

`Export` writes either a **thread file** (`.json`, to reload later or move to
another device) or a **readable document** (`.md`, the whole thread as text).
Threads import by paste or drag-and-drop.

## Sharing text into it

Installed from Android Chrome, Meristem appears in the system share sheet — send
an article to it from a browser or reader and it opens ready to annotate.

iOS has no Web Share Target, so the share sheet route isn't available there. A
Shortcut that opens `https://…/?text=[Shared Input]` reaches exactly the same
code path, and the app still installs to the home screen.

## Running it

There is no build step and there are no runtime dependencies. `index.html` is
the entire application — `manifest.json`, `sw.js` and the icons only add
installability and offline use, and the page works completely without them. Open
it directly, or serve the directory:

```sh
npm start          # serves on :8080
```

It works from `file://` too, which matters when a browser blocks microphone
access to an embedded preview.

## Deploying

Copy the directory to any static host. `index.html` is self-contained apart from
the web font, so GitHub Pages, Cloudflare Pages, R2, S3 and plain nginx all work
the same way, with nothing to configure. Installability and the share target
need HTTPS, which all of those provide.

The service worker is **network-first for the page**, so a deploy always lands
immediately rather than leaving people on a cached build.

## Tests

```sh
npm install
npm test
```

The suite drives the real page in a real browser. Every test covers a bug that
actually shipped — see `test/regression.mjs`.

## Browser support

Voice notes need the Web Speech API (Chrome, Edge, Safari). Everywhere else,
holding a word opens a typing box instead and the rest of the app is unchanged;
your keyboard's own dictation key still works in that box.

Your text never leaves the browser. There is no server and no account. Threads
are autosaved to `localStorage`, and moving one between devices means exporting
it.
