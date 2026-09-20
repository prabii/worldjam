# WorldJam

**Real objects. Real sounds. AI-arranged music in AR.**

Capture the actual sound of things around you — a cup, a table, your keys — and
play them as an instrument. A local model arranges *when* they play. Nothing is
generated in the cloud, and the object's sound stays real: a cup never becomes a
generic drum sample.

Implementation of `WorldJam_HLD_v2.docx` (Team PRXFR, iQOO City Battles 2026).

---

## The one number that matters

HLD v2 §0 is unambiguous: **tap → sound must be under ~50 ms**, or the whole
experience reads as broken. Everything in this architecture follows from that.

- The audio path is **native C++** (Oboe/AAudio). JS never touches real-time audio.
- A tap crosses one JSI hop into a **lock-free ring buffer**; the audio thread does the rest.
- The audio callback **never allocates, locks, or logs**.
- The measured latency is on screen at all times — see [`LatencyBadge`](src/components/LatencyBadge.tsx).

If that badge is not green on the device, fix it before building anything else.

---

## Quick start

```bash
npm install
npx expo prebuild --platform android   # generates ./android
npx expo run:android                   # dev build — NOT Expo Go
```

**Expo Go will not work.** It cannot host the custom native module. You need a
dev build. The app degrades gracefully if the native module is missing (it tells
you so in a banner rather than crashing), but nothing will make sound.

Requirements: Node 20+, JDK 17+, Android SDK 35, NDK 26.1, CMake 3.22.1.

```bash
npm test          # 113 tests: DSP, quantize, plan validation, transport, render
npm run typecheck
```

---

## Architecture

```
  Camera + Mic + Touch
          ↓
  Capture real sound  +  Voice (pitch/timing)
          ↓
  DSP: FFT / onset / energy / tempo          ← src/dsp/
          ↓
  Gemma 4 (local) → arrangement JSON          ← src/ai/
          ↓           (validated, repaired, or replaced by rules)
  Native Audio Engine → captured samples on the beat grid
          ↓            + procedural accompaniment
        MUSIC
```

| Layer | Where | Responsibility |
|---|---|---|
| React Native | [`src/screens/`](src/screens/), [`src/components/`](src/components/) | Screens, camera shell, pads, transport |
| Native C++ | [`modules/worldjam-audio/android/src/main/cpp/`](modules/worldjam-audio/android/src/main/cpp/) | Capture, trigger, mix — the <50 ms path |
| DSP | [`src/dsp/`](src/dsp/) | FFT, features, onsets, YIN pitch, quantize |
| AI | [`src/ai/`](src/ai/) | Prompt, strict validation, rule-based fallback |
| Synth | [`src/audio/synth.ts`](src/audio/synth.ts) | Procedural bass/chords/pad/arp/guitar |
| Transport | [`src/audio/transport.ts`](src/audio/transport.ts) | Look-ahead scheduler on the beat grid |

### Two design rules worth knowing before you edit anything

**1. The AI plans; it never generates audio.**
Gemma outputs a JSON arrangement. [`validatePlan`](src/ai/schema.ts) then repairs
it — folding a 240 BPM response to 120, dropping objects the model invented,
clamping beats into the bar. If the response is unusable, or slow, or the model
isn't loaded at all, [`buildFallbackPlan`](src/ai/fallbackArranger.ts) produces a
musical pattern instantly. **The interaction loop never waits on the model.**

**2. The transport schedules ahead, it doesn't play on time.**
A JS timer drifts and stalls under GC, so it is never trusted to fire on a beat.
It runs coarsely (25 ms) and pushes events into the engine's *future* schedule
(120 ms look-ahead). The audio thread fires each one sample-accurately. Timer
jitter becomes irrelevant.

---

## Build tiers

Per HLD v2 §2 — build strictly in this order; each tier stands without the ones
above it.

**Tier 1 — Core** (this alone is a winning demo)

| | Feature | Status |
|---|---|---|
| C1 | Capture real object sound | ✅ trim, normalize, fade, feature-extract |
| C2 | Re-trigger in <50 ms | ✅ native Oboe path + on-screen measurement |
| C3 | Hum → melody | ✅ YIN pitch, note segmentation, key detection |
| C4 | Loop + layer | ✅ arm/record/overdub, look-ahead scheduler |
| — | Session export | ✅ offline WAV mixdown (HLD §5 Session Renderer) |

**Tier 2 — The AI Bandmate** (what makes it win)

| | Feature | Status |
|---|---|---|
| A1 | Auto-quantize | ✅ with a visible before/after timing score |
| A2 | AI harmony / accompaniment | ✅ plan → procedural bass/chords/pad/arp/guitar |
| A3 | Voice genre-morph | ✅ 6 styles, instant local restyle then model refine |
| A4 | Rhythm guide | ✅ "Table → Cup → Cup → Bottle" with live beat cursor |

**Tier 3 — Spectacle** (demo only if rock-solid)

| | Feature | Status |
|---|---|---|
| S1 | AR instrument placement | ⬜ camera shell in place; anchors not built |
| S2 | Two-phone jam | ⬜ not started (LAN tempo-sync, not shared anchors) |
| S3 | Spatial AR audio | 🟡 stereo panning by screen position; not head-tracked |

AR is architected as a **removable layer** exactly as the HLD demands — the whole
core loop runs with zero AR and zero internet.

---

## Plugging in the model

No on-device runtime is bundled, because which one works must be validated on the
actual iQOO 15. The contract is one interface:

```ts
import { registerGemmaRuntime } from '@/ai/gemma';

registerGemmaRuntime({
  name: 'mediapipe-gemma-e2b',
  isReady: () => true,
  generate: async (prompt, maxTokens) => /* → raw model text */,
});
```

Everything downstream — extraction, validation, repair, fallback, timeout — already
works and is tested against malformed output. Candidates: MediaPipe LLM Inference,
llama.rn, ExecuTorch.

---

## Demo script

1. Point at a table: cup, table, bottle, keys.
2. Hold **Hold & hit**, strike each object. Each appears as a pad marked `REAL`.
3. Hum a melody — voice becomes the lead, and sets the key.
4. **Arrange with Gemma** → JSON plan → rhythm guide appears.
5. **ARM**, play along sloppily, disarm. Note the timing score (e.g. 64%).
6. **Tighten timing** → 97%. This is the "sounds produced" moment.
7. Tap **Jazz** — same captured sounds, new feel.
8. Close: *"We did not bring instruments into the room. We turned the room into the instrument."*

Every beat of that works offline with no AR.

---

## Known gaps

- **No on-device model is wired up** — the runtime interface is there and tested, the backend is not chosen. The rule-based arranger covers this completely in the meantime.
- **Tier 3 (AR anchors, multiplayer) is not built** — deliberately, per the HLD's own ordering.
- **Latency is unverified on real hardware.** The C++ compiles to an arm64 `.so` and the measurement harness is live, but no phone has run it. That is the HLD's go/no-go and it is still open.
- **The full APK has not been assembled on this machine.** `libworldjam_audio.so` builds; assembling the whole app repeatedly exhausted RAM (7.4 GB machine). See [docs/PRE_EVENT.md](docs/PRE_EVENT.md).
