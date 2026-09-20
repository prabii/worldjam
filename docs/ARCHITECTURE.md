# WorldJam — implementation notes

Written for: engineers picking up this codebase mid-hackathon.

This covers the decisions that are not obvious from reading the code, and the
places where the obvious implementation is wrong.

---

## 1. Why the audio engine looks the way it does

### The audio callback is a hostile environment

`WorldJamEngine::onAudioReady` runs on a real-time thread with a hard deadline —
at 48 kHz with a 96-frame burst, it has **2 ms** to fill the buffer. Miss it and
the user hears a click. So inside that function there is:

- no `malloc` / `new` / `std::vector::push_back`
- no `std::mutex::lock`
- no `__android_log_print`
- no `shared_ptr` copy (the atomic refcount is a shared cache line)

Every one of those can block for an unbounded time. This is why voices are a
fixed `std::array`, why the trigger queue is a ring buffer, and why the callback
reads `mSlots[i].get()` as a raw pointer rather than copying the `shared_ptr`.

**If you add a feature to the callback, it must obey all of the above.**

### The trigger ring

A tap arrives on the JS/UI thread. It cannot touch voice state directly — that
would race the audio thread. Instead it writes one `TriggerRequest` into a
single-producer/single-consumer ring and bumps an atomic index. The audio thread
drains it at the top of each block.

```
JS thread:    write slot → mTriggerWrite.store(w+1, release)
Audio thread: mTriggerWrite.load(acquire) → drain → mTriggerRead.store(r, release)
```

The acquire/release pairing is what makes the written struct visible to the
audio thread. Relaxed ordering here would be a real (if rare) bug.

### Why `InputPreset::Unprocessed`

Android's default input chain applies AGC, noise suppression and echo
cancellation. Those are tuned for voice calls and they **destroy the attack
transient** of a tap — which is precisely the part that makes a cup sound like a
cup rather than a generic click. `Unprocessed` bypasses them. Not every device
supports it, so the code falls back to `VoiceRecognition`.

### Why recording needs its own thread

The input stream's buffer is only a few bursts deep. Reading it once, at
`stopRecording()`, would capture the last ~20 ms and lose everything else. So
`recordLoop()` drains it continuously on a dedicated thread. This was a real bug
in the first draft of this file.

---

## 2. Why the transport schedules ahead

The naive design is `setInterval(() => playNote(), beatDuration)`. It does not
work. JS timers drift, and a GC pause at the wrong moment drops a beat audibly.

Instead:

- The timer runs at a **fixed coarse rate** (25 ms) and is never trusted for timing.
- Each tick asks: *what falls in the next 120 ms?* and schedules it by **absolute
  frame number** via `triggerAt`.
- The audio thread fires each event when its frame arrives — sample-accurate.

The only requirement is that the timer wakes up more often than the look-ahead
window. A late tick catches up because events carry absolute frames; nothing is
dropped.

`LOOKAHEAD_SEC` is the tradeoff: larger is safer against jitter, but delays how
quickly a tempo or pattern change takes effect.

---

## 3. Why the AI layer distrusts the model

Small on-device models return malformed output regularly. Not occasionally —
regularly. The layering reflects that:

```
raw text → extractJson → validatePlan → [plan | null] → fallback if null
                ↑              ↑
        balanced-brace   repair, don't reject
        scan, not regex
```

**`extractJson`** does a brace-depth scan that tracks string state, because
models wrap JSON in prose and code fences, and `{"note":"a } brace"}` breaks any
regex approach.

**`validatePlan` repairs rather than rejects.** A model returning `bpm: 240` for
"fast" understood the request perfectly and expressed it badly — folding it to
120 keeps the intent. A model inventing `"drum kit"` when no such object was
captured cannot be repaired, so that entry is dropped. Every repair is recorded
and surfaced in the UI.

**The fallback is not a placeholder.** `buildFallbackPlan` is the deterministic
floor: it runs when the model is absent, slow, or wrong, and it is what makes
the first tap musical before any model call happens. It is deterministic on
purpose — a rehearsed demo must repeat exactly.

**The timeout is a product requirement, not defensive coding.** `PLAN_TIMEOUT_MS`
is 4 s; past that the user is watching a spinner, which is worse than a
rule-based pattern.

---

## 4. DSP notes

### Why YIN rather than plain autocorrelation

Raw autocorrelation octave-errors constantly on hummed input — it reports a
fifth or an octave below the real pitch because those lags also correlate well.
YIN's cumulative mean normalisation suppresses exactly that failure. The
parabolic interpolation step then gets sub-bin accuracy, which matters because a
whole-bin error at 100 Hz is most of a semitone.

### Why features are extracted after the onset

`extractFeatures` finds the peak first and analyses the frame *after* it. The
pre-onset region is room noise; including it drags the spectral centroid toward
whatever the room is doing, not what the object sounds like.

### The role heuristic is deliberately crude

`inferRole` maps brightness/decay to kick/snare/hat/perc. It is a handful of
thresholds and it will sometimes be wrong. That is fine and intended: HLD v2 §2
says object recognition is cosmetic, and a wrong role still produces a playable
pattern. Do not spend hours here.

### Quantize has a tolerance guard

Naive snapping moves *every* hit to the nearest line, including a deliberate
flam or swung note, and can shove a dragging hit across a beat boundary onto the
wrong beat. So hits further than `tolerance × step` from any line are treated as
intentional and left alone, and `strength < 1` interpolates rather than
replaces, preserving human push-and-pull.

`timingAccuracy` exists to make the improvement **visible** — "64% → 97%" is
evidence a judge can read, where "sounds tighter" is arguable.

---

## 5. Slot allocation

The engine has 16 sample slots. The top 5 are reserved:

| Slot | Use |
|---|---|
| 15 | Vocal take |
| 14 | Bass |
| 13 | Chords / pad |
| 12 | Arp |
| 11 | Guitar |
| 0–10 | Captured objects |

Accompaniment is rendered as **one long sample per layer**, triggered once at the
top of the loop, rather than as per-note events. This keeps per-beat scheduling
cost at zero and means the accompaniment costs the same as a single object hit.
It also means changing tempo requires re-rendering those layers — see
`applyPlan`.

---

## 6. Things that are wrong or missing

- **Latency is unverified on hardware.** The harness works; no phone has run it.
  This is the HLD's go/no-go and it is still open.
- **`Voice::slot` is read on the audio thread without synchronisation** in
  `clearSlot`. In practice the write happens before the voice deactivates, but
  it is not formally race-free. Worth tightening if you see odd behaviour when
  deleting objects during playback.
- **Accompaniment re-render is synchronous** and happens on the JS thread inside
  `applyPlan`. For 4 bars it is a few milliseconds; for 8 bars at high sample
  rates it may hitch. Move it off-thread if it becomes visible.
- **No session export.** HLD §5 lists a Session Renderer; not built.
- **Stereo panning is not spatial audio.** Objects pan by screen position. Real
  head-tracked spatialisation (S3) depends on AR anchors that do not exist yet.
