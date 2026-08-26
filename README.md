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

1. **Paste some prose** into the reader.
2. **Annotate it in place.** Tap a word to type a note. Press and hold to speak
   one — a live caption shows the transcript — and drag while holding to cover a
   whole phrase. Having pointed at a word you can widen the anchor to its
   sentence or paragraph in one tap, in the card or later from the sheet.
3. **Keep marking up as you move around.** The notes sheet is one running
   basket across the whole thread, not a per-page list — open a reply, annotate
   that too, and the earlier notes are still there. Notes are numbered straight
   through, and the number beside a word is the number the AI will answer.
4. **Send the prompt.** Every page carrying a note goes in whole, labelled with
   how it came about, followed by all your notes with their anchor quotes and a
   mode instruction (rewrite, respond, push back, options, check). With a model
   connected, `Ask` sends it and the answers come straight back. Without one,
   `Copy prompt` puts the same text on the clipboard for any chat window you
   like — the sheet shows roughly how long it runs before you paste it.
5. **The reply lands on the words that prompted it.** Each numbered answer
   becomes its own page, hanging off its note — on whichever page that was. A
   single reply can grow branches in several places at once. A reply you
   carried by hand goes back in through `Paste reply`.
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

## Just talking

With a model connected there is a message box at the bottom of the screen. Type
a question, press send, and the answer streams in. No text to paste first, no
words to mark up — it is a chat, and on an empty screen it is the only thing
there.

What makes it worth using is where the answer lands. Your message becomes a
page and the answer becomes its child, so a conversation is an ordinary branch
of the same tree everything else lives in: it shows up in the map, in `Read
all`, in an export — and **any reply can be marked up the moment it arrives**.
Hold a word in the answer you just got and you are back in the app's real work,
branching off the phrase that caught you. Chat is not a second mode bolted
alongside annotation; it is the way into it. Talk until something is worth
interrogating, then interrogate it.

The page you are reading is the live one, with everything said before it above
it and everything after it below, as a scrollback. Tap any turn to move onto it
— then *it* becomes the page you can annotate, with the rest of the
conversation rearranged around it. The whole conversation goes out each turn,
not just your last line, and a `+ Always` standing instruction rides along as
the system prompt.

Small things that matter:

- **Hold `Send`** to speak the message instead of typing it. The transcript
  lands in the box so you can read it before it goes.
- **`Stop`** ends a long answer and keeps whatever had arrived — it is a page
  like any other, so you can mark it up or just carry on from there.
- A turn that fails leaves nothing behind, and hands your message back to the
  box rather than making you retype it.
- Enter sends on a keyboard; on a phone Enter is a new line and the button
  sends.

`Ask` and the message box are the two ways to ask, and they do different jobs:
`Ask` answers the notes in the sheet, the box says something new. Both land in
the same thread.

## Connecting a model

Carrying the prompt to another window and the reply back is four gestures a
round, and by the fourth round it is most of what using the app feels like.
Give Meristem an [OpenRouter](https://openrouter.ai/keys) key — the free tier
needs no card — and `Ask` does the round trip itself: the same prompt goes out,
and the answers come back beside the same notes.

`Connect a model` (in the sheet, or on the paste screen) takes the key and a
shortlist. The model list is fetched from OpenRouter rather than baked in,
because which models are free moves week to week; it filters to the free ones
by default, and any id you paste in works whether or not the list knows about
it yet.

Pick more than one and `Ask` sends to all of them at once. Their answers cannot
all become pages off the same note, so they arrive side by side under it — the
same shape `Compare` produces — and you `Keep` the one you want. `Suggest` uses
the first model in the list, and so does a round started from the map.

Everything else is unchanged. `Copy prompt` and `Paste reply` are still there
and still work with any model anywhere, which is the point: the API is a second
route, not a replacement. Nothing is sent anywhere until you press `Ask`.

**About the key.** It is held in this browser's `localStorage`, under its own
key, and is never written into a thread file or a Markdown export — you can
share a thread without sharing the key. It travels only to OpenRouter. There is
no server here to keep it on and no way to encrypt it that a page in the same
origin could not undo, so treat it as a key you are willing to revoke, and use
a free or limited one. `Forget key` removes it. Because the browser needs an
origin to present, `Ask` needs the page served over http(s); opened from
`file://` it says so, and the copy path still works.

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
when you send it somewhere: onto the clipboard when you press `Copy prompt`, or
to OpenRouter when you press `Ask` or send a message.
