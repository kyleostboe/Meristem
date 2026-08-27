# Meristem

**Talk in the text.**

Live: https://kyleostboe.github.io/Meristem/

Most of the time you spend in a chat product goes to reading, not writing — and
every control in the product acts on the message you are composing. Nothing acts
on the message you are reading. Meristem puts the interaction on the read
surface: you mark up the text itself, and the conversation branches out of your
marks.

Give it an [OpenRouter](https://openrouter.ai/keys) key and it is also an
ordinary chat client — a message box, streamed answers, the lot. The difference
is what you can do with an answer once it arrives.

## How it works

1. **Put something in the box.** Paste some prose and it offers to open itself
   as a page to read; type a question and it becomes the first thing you asked.
2. **Annotate it in place.** Tap a word to type a note. Press and hold to speak
   one — a live caption shows the transcript — and drag while holding to cover a
   whole phrase. Having pointed at a word you can widen the anchor to its
   sentence or paragraph in one tap, in the card or later from the sheet.
3. **Keep marking up as you move around.** The notes sheet is one running
   basket across the whole thread, not a per-page list — open a reply, annotate
   that too, and the earlier notes are still there. Notes are numbered straight
   through, and the number beside a word is the number the AI will answer.
4. **Send it, or carry it.** The box has two icons: `⧉` copies the whole prompt
   for any chat window you like, `↑` posts it to your model. Both send the same
   round — every page carrying a note goes in whole, labelled with how it came
   about, followed by your notes with their anchor quotes and a mode
   instruction (rewrite, respond, push back, options, check).
5. **The reply lands on what prompted it.** A note's answer becomes a page
   hanging off the words it answers; a question's answer hangs off the question.
   One reply can grow branches in several places at once. A reply you carried by
   hand goes back in through `Paste reply`.
6. **Keep going.** Open any reply and annotate *that*. Depth is unbounded, and a
   note can span several pages at once, so branches can rejoin.

### Saying something that isn't about particular words

Type it in the box. *"This reply is too hedged."* It takes a number like any
other question and goes out with your marks, and its answer comes back as a
page under it.

The one thing that isn't a question is **`+ Always`** — a standing instruction.
*"Answer in British English."* It takes no number and no reply consumes it; it
shapes every answer and persists until you delete it. Made from the sheet — tap
to type, hold to speak.

### Asking for different things at once

Each note can carry its own intent, so one round can ask for a rewrite here and
an argument there. Tap the small label under a note to change it; untagged notes
follow the mode set for the sheet.

### Comparing models

The prompt is portable text, so the same one can go to several models. Turn on
`Compare` and a pasted reply attaches its answers to your notes instead of
spending them — each tagged with who wrote it, sitting side by side under the
note they answer. `Keep` promotes one to a page; the rest stay while you weigh
them. Keep two and you get two branches off the same words.

With `Compare` off, a reply goes straight to pages as before.

### Starting from a blank document

`Suggest` asks a model which passages are worth interrogating and returns them
as ordinary unanswered notes, anchored to the words they quote and marked
*suggested*. They are proposals: delete the generic ones, sharpen the rest, add
your own, and only then ask for answers. Editing one makes it yours.

Both directions go through the same `Paste reply` box — a `[[suggest]]` block
becomes notes, a `[[notes]]` block becomes answers.

`All pages` in the sheet narrows to `This page` when you want to work on one
text in isolation.

The **map** (`Tree`) shows the whole thread in 3D — drag to orbit, pinch or
scroll to zoom, tap to centre, double-tap to read a page in full. **Read all**
flattens the same thing into a document.

`Export` writes either a **thread file** (`.json`, to reload later or move to
another device) or a **readable document** (`.md`, the whole thread as text).
Threads import by paste or drag-and-drop.

## One basket, two ways out

There is one box, under every page and on the blank screen, and it has two
icons. Neither is a mode.

Everything waiting for an answer goes out together: the marks you have left,
and whatever is in the box. **The box is not a second channel** — what you type
is a question about the page you are on, it just hasn't been asked yet. Mark two
phrases, type a question, and all three go in one round, coming back as three
branches.

- **`↑` sends it** to your model. The reply comes back and lands.
- **`⧉` copies it** for any chat window you like. Paste the reply into
  `Paste reply` when you have it.

The tree cannot tell afterwards which one you used, which is the point. **The
whole app works with no API key** — including talking to it. And when a free
model rate-limits you mid-conversation, carrying the next round out by hand is
not a dead end, it is the other icon.

A question you asked and never got an answer to stays pending, so a prompt you
copied out on Tuesday is still waiting on Thursday. That is also what makes a
failed send resumable rather than lost.

### What comes back, and where it goes

A note on words is an annotation, so its answer hangs off those words. A
question is something you said, so it becomes a page of its own with the answer
beneath it — which is why your questions show up in the map and can be marked up
like anything else.

One question needs no protocol: there is only one place its answer can go, so it
is asked plainly and **streams as it is written**. Several come back numbered so
each can be routed, which means waiting for the whole reply.

Talk until a reply says something worth interrogating, then hold a word in it and
you are back in the app's real work, branching off the phrase that caught you.
Chat isn't a second mode bolted alongside annotation; it is the way into it.

### The prompt

`Prompt`, in the sheet, is not a preview — it is the outgoing text, and you can
edit it. Send normally packages the conversation as real `user`/`assistant`
turns with that text as the last message; the copied version says the same
thing with the conversation written into it, because a prompt travelling alone
has to carry its own context. Edit it by hand and it is sent exactly as
written: if you wrote it, it isn't the app's to repackage.

`Context: path / page / all` decides how much of the thread goes either way, and
a `+ Always` standing instruction rides along as the system prompt.

### Small things that matter

- **Hold `↑`** to speak instead of typing. The transcript lands in the box so
  you can read it before it goes.
- **Stop** ends a long answer and keeps whatever had arrived — it is a page like
  any other, so mark it up or carry straight on.
- A round that fails leaves nothing behind and hands your text back to the box.
- Enter sends on a keyboard; on a phone Enter is a new line and the button sends.
- Paste something long on a blank screen and it offers to open itself as a page
  to read instead of being answered.

## Connecting a model

Carrying the prompt to another window and the reply back is four gestures a
round, and by the fourth round it is most of what using the app feels like.
Give Meristem an [OpenRouter](https://openrouter.ai/keys) key — the free tier
needs no card — and `Ask` does the round trip itself: the same prompt goes out,
and the answers come back beside the same notes.

`Connect a model` (in the sheet, or on the blank screen) takes the key and a
shortlist. The model list is fetched from OpenRouter rather than baked in,
because which models are free moves week to week; it filters to the free ones
by default, and any id you paste in works whether or not the list knows about
it yet.

Pick more than one and `↑` sends to all of them at once. Their answers cannot
all become pages off the same note, so they arrive side by side under it — the
same shape `Compare` produces — and you `Keep` the one you want. `Suggest` uses
the first model in the list, and so does a round started from the map.

The key only decides whether `↑` works. `⧉` and `Paste reply` need nothing and
work with any model anywhere, which is the point: the API is a second route, not
a replacement. Nothing is sent anywhere until you press one of the two.

**About the key.** It is held in this browser's `localStorage`, under its own
key, and is never written into a thread file or a Markdown export — you can
share a thread without sharing the key. It travels only to OpenRouter. There is
no server here to keep it on and no way to encrypt it that a page in the same
origin could not undo, so treat it as a key you are willing to revoke, and use
a free or limited one. `Forget key` removes it. Because the browser needs an
origin to present, `↑` needs the page served over http(s); opened from
`file://` it says so, and `⧉` still works.

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

There is no server and no account. Threads are autosaved to `localStorage`, and
moving one between devices means exporting it. Your text leaves the browser only
when you send it somewhere: onto the clipboard when you press `⧉`, or to
OpenRouter when you press `↑`.
