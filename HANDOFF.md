# WorldJam — Session Handoff

**Project:** WorldJam — record the real sound of physical objects, let an
on-device LLM arrange them into music.
**Team:** PRXFR · **Event:** iQOO City Battles 2026
**Repo:** https://github.com/prabii/worldjam (private)
**Last updated:** 2026-09-26

---

## 1. What this app is

Point the phone at any object, hold to record its real sound, and the app
turns your captures into a structured track. Gemma 4 runs entirely on the
device and decides the arrangement.

The load-bearing constraint: **the app ships with zero audio.** Every sound in
a WorldJam track is one the user recorded. Anything that undermines that —
synthetic drum layers, denoising the playback copy — is a bug, not a feature.

Measured tap-to-sound latency: **24.8 ms** (below the ~50 ms threshold where a
tap stops feeling like an instrument).

---

## 2. Current state

- **48 commits**, working tree clean, pushed to `origin/master`
- **389 tests passing**, 17 suites
- Runs on device: capture, playback, arrangement, sung-melody analysis,
  lyrics, export, session saving, full four-step flow
- **Live object detection is DISABLED** — see §6

### Devices

Two iQOO 15 units, both Android 16 / arm64-v8a / 15.6 GB RAM:

| Serial | App | Gemma 3.35 GB |
|---|---|---|
| `10BFAT1SZZ000XP` | installed | installed |
| `10BFAX15TT0010U` | installed | installed |

Gemma lives at `files/gemma-4-E2B_q4_0-it.gguf` inside the app's private
storage. Scoped storage on Android 13+ blocks reads from shared dirs, so it
*must* go there — `/sdcard/Download` will not work.

---

## 3. Getting running

```bash
# 1. Metro
cd D:\World_jam
npx expo start --dev-client --port 8081

# 2. Reverse tunnel (required — venue Wi-Fi blocks mDNS discovery)
adb reverse tcp:8081 tcp:8081

# 3. Launch, then on the phone tap
#    "Recently opened → WorldJam · http://localhost:8081"
adb shell monkey -p com.prxfr.worldjam -c android.intent.category.LAUNCHER 1
```

**The dev-launcher's auto-discovery never finds the server on this network.**
It must be selected manually on the phone. Automating that text field over adb
failed repeatedly — the field loses focus on every interaction. A human tap
takes two seconds; don't burn time scripting it.

### Installing Gemma on a fresh device

`run-as` cannot read `/sdcard`, and the app's `files/` dir does not exist until
the app has run once. So:

```bash
adb push gemma-4-E2B_q4_0-it.gguf /data/local/tmp/g.gguf   # ~5 min
adb shell "run-as com.prxfr.worldjam mkdir -p files"
adb shell "run-as com.prxfr.worldjam sh -c 'cp /data/local/tmp/g.gguf files/gemma-4-E2B_q4_0-it.gguf'"
adb shell "rm -f /data/local/tmp/g.gguf"                   # frees 3.35 GB
```

Verify the byte count is exactly **3,349,516,256**. A truncated copy fails
silently at load time. This happened once when free space ran out mid-copy.

---

## 4. Architecture

```
mic/camera → transient gate → feature extraction → Gemma plan → arrangement → Oboe out
```

| Layer | Where | What |
|---|---|---|
| Native audio | `modules/worldjam-audio/.../cpp/` | 651 lines C++/JNI. Oboe, lock-free SPSC trigger queue, 8-voice mixer |
| Signal analysis | `src/dsp/` | FFT centroid, RMS decay, YIN pitch, Krumhansl-Schmuckler key |
| Melody refinement | `src/dsp/melody.ts` | Clean → snap to scale → infer tempo → quantise → centre octave |
| On-device model | `src/ai/` | llama.rn, 6 threads, 128-token JSON plan, schema-validated |
| Arrangement | `src/audio/arrangement.ts` | Sections, per-role densities, velocity curve, fills |
| State | `src/state/sessionStore.ts` | Zustand |

**Two invariants that shape everything:**

1. **The real-time thread is sacred.** The audio callback never allocates,
   locks, logs or crosses the JS bridge. The scheduler pushes events 120 ms
   ahead so a GC pause cannot drop a beat.
2. **The model is never in the interaction loop.** Inference runs on a button
   press, not per tap. Slow, missing or malformed output degrades to
   `fallbackArranger.ts` in microseconds, and the UI states which arranger
   produced the result.

### Navigation

```
scan (1) → studio (2,3) → track (4)
```

`object` is a detour off scan for one sound's settings and returns to studio.
`create` is the guided alternative. `jams` and `profile` are the other tabs.

---

## 5. Bugs fixed this session — do not regress these

Each of these was found on device and cost real time. The reasons matter more
than the diffs.

**Playback was a denoised copy, not the recording.** `cleanCapture` ran before
playback as well as analysis. Spectral subtraction at 1.5× over-subtraction
strips the quiet partials that make a cup sound like a cup, so captures played
back thin and metallic. The signal now splits: playback gets the raw gated hit
(bit-identical inside the window), analysis gets the denoised copy.

**Captures were 0.1 s clips.** `findTransientWindow` closed 80 ms after the
peak using the same threshold that found the onset — but a struck cup rings far
below that for a second or more, and the ring is most of what identifies the
object. Now uses a much lower tail gate, needs 180 ms of continuous quiet, and
never returns less than 250 ms.

**Every bar was identical.** `planToLoopEvents` repeated the arranger's one-bar
pattern at flat `velocity: 1` — structurally incapable of sounding like a song.
`arrangement.ts` now renders across a form.

**Synthetic drums over real recordings.** Every style added a `perc`
accompaniment layer, which is what made tracks sound pre-recorded. The user's
objects *are* the percussion. `perc` is removed from all styles and dropped by
the schema if a model requests it.

**Buttons responded late.** `LiveWaveform` ran 44 loops animating `height`,
which cannot use the native driver — dozens of bridge writes per frame,
continuously. Now 22 bars animating `scaleY` on the UI thread.

**Tapping a recorded object opened its detail screen** instead of playing it.
Tap now plays; long-press opens details.

**COCO labels were shifted.** The list used the 91-entry "paper" ordering while
EfficientDet-Lite emits the 80-entry contiguous one, so a phone was reported as
a laptop. Indices are now pinned literally in `detector.test.ts` — a shifted
list throws nothing and only shows as wrong names on a device.

**Welcome screen drew the artwork's text twice.** The splash PNG is a complete
screen design; the app was re-creating its kickers and blurb on top. Also: an
invisible tap target positioned by percentage cannot work when the artwork is
0.563 aspect and the device is 0.452 — `cover` crops by a device-dependent
amount. Controls are real components now.

---

## 6. Known issues / deliberate limitations

**Live object detection is off.** `DETECTION_ENABLED = false` in
`src/components/DetectorCamera.tsx:39`.

It *worked* — EfficientDet-Lite read a laptop at 0.54 confidence and drew the
callout. But the frame processor leaked CameraX buffers: inference is slower
than the frame rate, so the throttle returned early while still holding a
borrowed frame. The six-image pool exhausted within six frames and killed the
camera, the GL surface and the screen. That was the white-screen crash.

To re-enable: fix the buffer lifetime so every path falls through to the end of
the frame processor, then watch logcat for
`maxImages (6) has already been acquired`.

The product does not depend on it — captured audio decides an object's musical
role, and the user names it.

**Gemma timed out at 25 s on the previous test phone.** That device had ~2 GB
free RAM against a 3.35 GB model and was swapping. The iQOO 15s have 15.6 GB,
so this should not recur, **but it has not been verified end-to-end on the new
hardware yet.** The status line under the Generate button reports
`Gemma plan in Xms` or `Rule-based plan` — check which you get.

**Qwen3-1.7B is a supported fallback.** `promptFormatterFor()` picks the chat
template from the filename, so dropping a different GGUF in works without a
code change. Qwen needs ChatML plus `/no_think`, which is handled.

---

## 7. Environment gotchas

- **Git Bash mangles adb paths.** `/sdcard/x.png` becomes
  `C:/Program Files/Git/sdcard/x.png`. Use `//sdcard/x.png` for `adb pull`, and
  quote the whole command for `adb shell "screencap -p /sdcard/x.png"`.
- **`gh` CLI is wired as the github.com credential helper** under a *different*
  account (`saijagruthimulpuri`), which silently overrode the correct token and
  caused a 403. Override per-call:
  `git -c credential.https://github.com.helper= push ...`
- **The dev laptop has 7.4 GB RAM and runs hot.** Steam, `pcsuite`, WhatsApp
  desktop and 15 Chrome processes were the main offenders. `vivoesService` and
  `vivoSyncService` are Windows *services* and respawn when killed as
  processes; stopping them needs admin.
- **Metro cold start takes 30–60 s** and logs nothing past "Starting Metro
  Bundler" until it is ready. It is not hung. Poll
  `curl -s http://localhost:8081/status`.
- **Metro caches the file map at startup.** New asset directories added after
  Metro started produce `Unable to resolve module` 500s. Restart with `--clear`.

---

## 8. Deliverables

**Pitch deck:** `docs/WorldJam-Deck.pdf` — 15 slides, 3.61 MB, 1920×1080,
fonts embedded. Rebuild with `python docs/build_deck.py` then:

```bash
chrome --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="D:\World_jam\docs\WorldJam-Deck.pdf" \
  --virtual-time-budget=30000 "file:///D:/World_jam/docs/WorldJam-Deck.html"
```

Two Chrome print quirks are encoded in that script: a `px` value in `@page` is
read as points (declare inches), and Chrome does not block on a Google Fonts
`<link>` before printing (name locally available faces).

Deck contents: cover, problem, idea, four-step flow, **accessibility**,
on-device proof, latency, architecture, engineering decisions, what makes it
music, product surface, **AR Tiles roadmap**, rubric mapping, close.

**Live deck (editable):** https://claude.ai/artifact/GxnfTchkyVg6qg6PCYwh6H
Private — share from the page's Share menu before sending the link.

**Screenshots:** `docs/screens/` (real device), `docs/deck/` (design renders).

---

## 9. Positioning — accessibility is the lead

This is the framing the deck leads with, and it should stay the lead:

> Music has no boundaries. Neither should the instrument.

For a blind user WorldJam is not a music app with accessibility bolted on — it
is a way to **hear the room**. The phone names what is nearby, confirms every
capture aloud, and pans each object to where it actually sits, so the mix is a
map of the surroundings. A jam needs no sight, no reading and no shared
language.

Implemented: spoken guidance (`src/audio/guidance.ts`, `speech.ts`), spatial
panning (`src/audio/spatial.ts`), screen-reader labels and roles on every
control including gesture-adjustable knobs and faders.

**Roadmap — AR Tiles:** the generated track becomes a playable chart. Tiles
rise through the room timed to the user's own recording, including an
audio-only mode announced by spatial sound. The AR anchoring, spatial mixer and
low-latency scheduler this needs are already in the build.

---

## 10. Suggested next steps

1. **Verify Gemma end-to-end on the iQOO 15.** Record two objects, hit
   Generate, confirm the status line says `Gemma plan in Xms` and not
   `Rule-based plan`. This is the single most important unverified claim.
2. **Listen to a generated arrangement.** 389 tests prove it varies, accents
   and stays in range. They cannot tell you whether it sounds good.
3. **Open `docs/WorldJam-Deck.pdf` once.** Structure, dimensions, fonts and
   images were verified by inspecting the PDF, but the pages were never
   rendered to images — the two dense architecture slides are the likeliest to
   have a layout problem.
4. Optionally re-enable detection (§6) if there is time and appetite.
