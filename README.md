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
   whole phrase. Every note is anchored to the exact words that prompted it.
3. **Copy the prompt.** Your notes are assembled into a structured prompt with
   the source text, each note quoted against its anchor, and a mode instruction
   (rewrite, respond, push back, options, check).
4. **Paste the reply back.** Each numbered answer becomes its own page, hanging
   off the words that prompted it.
5. **Keep going.** Open any reply and annotate *that*. Depth is unbounded, and a
   note can span several pages at once, so branches can rejoin.

The **map** (`Tree`) shows the whole thread in 3D — drag to orbit, pinch or
scroll to zoom, tap to centre, double-tap to read a page in full. **Read all**
flattens the same thing into a document.

Threads export to JSON and import by paste or drag-and-drop.

## Running it

There is no build step and there are no runtime dependencies. `index.html` is
the entire application — open it directly, or serve the directory:

```sh
npm start          # serves on :8080
```

It works from `file://` too, which matters when a browser blocks microphone
access to an embedded preview.

## Deploying

Copy `index.html` to any static host. It is fully self-contained apart from the
web font, so GitHub Pages, Cloudflare Pages, R2, S3 and plain nginx all work the
same way, with nothing to configure.

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
