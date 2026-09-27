# WorldJam — Music Engine, Genres & Practice: What Changed

**Status:** everything below runs on the iQOO 15 dev build.
**Nothing is committed yet.**

---

## 1. The AI music layer: why every description sounded the same

The complaint: typing "phonk", "mass beat" or "Indian music" gave nearly the
same backing music every time.

**Root causes (the model was not the main problem):**

| # | Cause | Where |
|---|---|---|
| 1 | **The user's words never reached the music model.** They went to Gemma, but the audio prompt was built only from one of six fixed styles. | `sessionStore.ts`, `texture.ts` |
| 2 | **Anything outside six styles became "chill".** Phonk and Indian were silently collapsed. | `schema.ts` |
| 3 | **Gemma copied its example.** The prompt template hard-coded `"warm mellow chord pad"`, and the small model echoed it back. | `gemma.ts` |
| 4 | **Same prompt meant same seed and same cache**, so different descriptions produced the literally identical audio file. | `sessionStore.ts` |
| 5 | The generator was a kick-and-bass finetune, which pulled every genre toward kick-bass. | `TextureGenerator.kt` |

**Fixes:**

- **New genre library, `src/audio/genres.ts`**: 17 genres, each naming its
  signature instruments, tempo range, and whether drums are part of the genre.
  - Phonk: 808, Memphis cowbell · 130–150 BPM
  - Mass beat / dappankuthu / teen maar: thappu, parai, nadaswaram
  - Bhangra: dhol, tumbi
  - Bollywood pop: strings, tabla, harmonium
  - Carnatic: veena, mridangam
  - Indian classical: sitar, tabla, tanpura, bansuri
  - Trap, hip hop, lofi, pop, EDM, afrobeats, reggaeton, jazz, rock, cinematic, chill
- **Your typed words are now the first part of the music prompt**, followed by
  the genre's instruments and a description of your recorded objects (for
  example "bright metallic short percussive hits"). Text that matches no genre
  is sent exactly as typed.
- **The validator keeps the genre.** Phonk maps to the nearest synth style for
  chords, but stays "phonk" in the prompt and runs at phonk tempo.
- **Gemma is told to return the genre**, and its example uses placeholders
  that the validator rejects if they are echoed back.
- **Every Generate press gets a fresh seed**, so a stale cached file is never
  handed back.
- **Drum policy:** drum-led genres (phonk, mass beat, bhangra, trap, EDM) keep
  generated drums under your objects. Everything else gets "no drums", so your
  objects stay the beat.

---

## 2. The new music model: Stable Audio 3 Small-Music

| | Before (Stable Audio Open Small) | Now (Stable Audio 3 Small-Music) |
|---|---|---|
| Type | 0.3B, general / kick-bass finetune | 0.5B **music-specific** model |
| Max per generation | 11 s | **45 s** |
| Speed on the iQOO 15 | 11 s of audio in 19 s | **30 s of audio in 15–44 s** |
| Genre range | Narrow | Broad |

**How it got onto the phone:**

- No Android build existed, so `sa3-generate` was cross-compiled from
  `betweentwomidnights/sa3.cpp` with NDK 26 (arm64, dotprod + fp16, static).
  It ships as `jniLibs/arm64-v8a/libsa3gen.so`.
- Models (~756 MB) live in app storage `files/sa3/`, with a backup at
  `/data/local/tmp/sa3/`:
  - `stable-audio-3-small-music-dit-0.5B-v1.0-Q5_K_M.gguf` (360 MB)
  - `stable-audio-3-small-music-same-s-v1.0-Q5_K_M.gguf` (82 MB)
  - `stable-audio-3-small-music-conditioner-v1.0-F32.gguf` (1 MB)
  - `t5gemma-b-b-ul2-encoder-0.3B-v1.0-Q8_0.gguf` (299 MB)
  - `t5gemma-b-b-ul2-v1.0-vocab.gguf` (14 MB)
- **Engine order:** SA3 first, falling back to Stable Audio Open Small, chosen
  by which files are present (`TextureGenerator.kt`).
- The UI shows the engine actually in use (`textureEngine()` bridge).

**Models tried and rejected (measured on the phone):**

- **SAO 1.0 (1.1B):** ran more than 20 minutes without finishing one clip.
- **Kickbass finetune:** followed the key well, but biased every genre toward
  kick-bass.
- **Foundation-1:** ideal, but there is no GGUF conversion anywhere.

**Samples measured on device, all 30 s:**

| Genre | Brightness | Rhythm density |
|---|---|---|
| Mass beat | brightest | busiest (9.3 hits/s) |
| Indian classical | mid | sparsest (1.3 hits/s) |
| Lofi | darkest | 4.0 hits/s |
| Phonk / Bollywood / Pop | varied | varied |

---

## 3. Full songs

- **`src/audio/song.ts`**: a two-minute arc (intro → verse → chorus → verse →
  build → chorus → outro, 48 bars), with EDM and cinematic variants.
- **`src/audio/songBed.ts`**: lays one generated bed per section on bar lines,
  with crossfaded seams.
- **Per-section prompts:** the intro is "sparse and distant", the chorus is
  "full and bright", and every section names the key and tempo.
- **Chord rotation:** a chorus enters the progression at a different point
  from the verse (`harmony.ts`).
- **"Make it a Song" button** in Studio, with a progress bar.

---

## 4. UI changes

| Feature | Where |
|---|---|
| **Genre chips**: tap once to generate (Mass beat, Indian classical, Bollywood, Bhangra, Carnatic, Hip hop, Pop, Phonk, Trap, Lofi, EDM, Afrobeats, Jazz, Cinematic) | Studio → "Pick a genre or describe your beat" |
| The genre and the exact music prompt are shown after generating | Studio prompt card |
| **"Made on this phone"**: 6 sample tracks, tap to play | Home |
| **AI Guide**: floating **?** button with per-screen tips and questions answered by Gemma on the phone | Every screen |
| **Compact capture panel**: smaller record button, pushed lower | Capture |
| Engine labels name the real model | Studio card, Profile |

---

## 5. Practice games (AR removed)

The AR whack-a-mole and foot-tracking games were removed. The Play tab is now
**Practice**:

| Game | Skill | How it works |
|---|---|---|
| **Rhythm Trainer** | Timing | Tap on the click; shows ms early/late, accuracy, streak. Tempo rises by 6 BPM when you're accurate. |
| **Echo** | Memory · groove | Hear a pattern of your sounds, tap it back; one more hit each round |
| **Ear Trainer** | Listening | One of your sounds plays; pick which object. More choices as you level up. |
| **Tiles** | Reaction | The falling-tiles game, now plain screen-tap (no camera) |

---

## 6. Files

**New:**
- `src/audio/genres.ts` · `src/audio/song.ts` · `src/audio/songBed.ts`
- `src/game/practice.ts`
- `src/screens/PracticeScreen.tsx`
- `src/components/SampleGallery.tsx` · `src/components/GuideButton.tsx`
- `assets/samples/*.wav` (6 clips, 1.3 MB each)
- `modules/worldjam-audio/android/src/main/jniLibs/arm64-v8a/libsa3gen.so`
- Tests: `genres.test.ts` · `practice.test.ts` · `song.test.ts` · `songBed.test.ts`

**Changed:**
- AI: `gemma.ts` · `schema.ts`
- Audio: `texture.ts` · `arrangement.ts` · `harmony.ts` · `synth.ts` · `engine.ts`
- State: `sessionStore.ts` · `types/index.ts`
- Native: `TextureGenerator.kt` · `WorldJamAudioModule.kt` · `modules/worldjam-audio/src/index.ts`
- UI: `App.tsx` · `JamScreen.tsx` · `HomeScreen.tsx` · `CaptureScreen.tsx` ·
  `PlayScreen.tsx` · `ProfileScreen.tsx` · `GemmaCard.tsx` · `BottomNav.tsx`

**Removed:** `WhackScreen.tsx` · `moleEngine.ts` · `moleEngine.test.ts`

---

## 7. Verification

- TypeScript: clean.
- Tests: the new suites pass (genres + practice: 55; song + songBed + texture:
  93). The full-suite run is still pending.
- On device: genre chips, sample gallery, Practice hub, AI Guide button, and
  the SA3 engine label are all confirmed by screenshots.
- **Not yet verified end to end:** tapping a genre chip or "Make it a Song" and
  hearing SA3 audio generated from inside the app. The model was tested by
  hand on the phone, and the app detects it.

## 8. Known notes

- Reloading the app clears captured sounds (they are held in memory), so the
  games lock until you capture again.
- SA3 models in `files/sa3/` are wiped by an app reinstall or data clear.
  Restore them from `/data/local/tmp/sa3/`.
