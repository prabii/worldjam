# Getting WorldJam onto your phone

Written for: you, right after the reboot.

---

## Why Expo Go's QR scanner will not work

Expo Go cannot load WorldJam's custom native code — the Oboe audio engine
(`libworldjam_audio.so`) or llama.rn. Scanning a QR into Expo Go gives you an
app that launches and then reports "native audio module not loaded", with no
sound at all.

This is the HLD's own conclusion (§6): *"Expo Go will NOT work: it cannot host
the native audio module or ARCore."*

You need a **dev build** — a real APK compiled here and installed once. After
that, JS changes hot-reload over Wi-Fi with no cable, which is the convenience
the QR scanner was offering anyway.

---

## Step 1 — Confirm the reboot took

```bash
# Should list D:\pagefile.sys at 16384 MB
powershell "Get-CimInstance Win32_PageFileUsage | Select Name, AllocatedBaseSize"
```

If D: is missing, the page file did not activate and the build will crash the
JVM again with *"The paging file is too small for this operation to
complete."* The setting is already in the registry; it only needs a boot.

---

## Step 2 — Pair the phone over Wi-Fi

Phone and PC must be on the same network. The PC is at **192.168.31.114**.

On the phone (Android 11+):

1. Settings → About phone → tap **Build number** 7 times
2. Settings → System → Developer options → **Wireless debugging** → ON
3. Tap **"Pair device with pairing code"**
4. Note the **IP:port** and the **6-digit code**

Then, on the PC:

```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"

# Use the pairing port and code from the phone's dialog
"$ADB" pair 192.168.31.xxx:PORT
# (it prompts for the 6-digit code)

# Then connect using the OTHER port shown on the main
# Wireless debugging screen - it differs from the pairing port
"$ADB" connect 192.168.31.xxx:PORT

"$ADB" devices    # should list the device
```

The pairing port and the connect port are different numbers. This trips
everyone up once.

---

## Step 3 — Build and install

```bash
cd /d/World_jam

# local.properties is wiped by prebuild --clean; recreate if missing.
# The escaping matters: Java properties treat backslash as an escape.
powershell -c "\$sdk = \"\$env:LOCALAPPDATA\Android\Sdk\" -replace '\\\\','\\\\\\\\' -replace ':','\\:'; \"sdk.dir=\$sdk\" | Out-File -FilePath android\local.properties -Encoding ascii -NoNewline"

# Close Chrome / Edge / extra VS Code windows first - this machine has 7.4 GB.
JAVA_HOME="C:\\Program Files\\Android\\Android Studio\\jbr" \
ANDROID_HOME="C:\\Users\\codep\\AppData\\Local\\Android\\Sdk" \
npx expo run:android --device
```

First build takes a while. Subsequent JS changes hot-reload.

---

## Step 4 — The go/no-go check

Open the app and look at the **latency badge**, top right.

| Reading | Meaning |
|---|---|
| **Green, under 50 ms** | The project is viable. Proceed. |
| **Amber/red** | Stop and fix this before anything else (HLD §0) |
| **"no native audio"** | The native module did not load — you are in Expo Go, or the build did not include it |

Tap the badge to re-measure. Then tap a captured object: the sound must feel
instantaneous. If there is perceptible lag, no amount of AI makes up for it.

---

## Step 5 — The model (optional)

**The app works fully without this.** The rule-based arranger is built, tested
and always available; the model only upgrades the arrangements.

The weights are **not** in the APK — at ~3 GB that exceeds distribution limits,
and Gemma's license governs redistribution. The app reads the file from the
phone's storage instead, exactly as AI Edge Gallery does.

### First, find out what you already have

```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
"$ADB" shell find /sdcard /data/local/tmp -iname "*.gguf" -o -iname "*.task" 2>/dev/null
```

- **`.gguf`** → works with this build. Note the path.
- **`.task`** → MediaPipe's format. **llama.cpp cannot read it.** You need the
  GGUF build separately. The app detects this and says so rather than failing
  cryptically.

### If you need the GGUF

1. Accept the Gemma license (needs your HuggingFace account — I cannot do this
   for you)
2. Download `gemma-4-E2B-it-qat-q4_0.gguf` — the repo the Qualcomm page names
3. Push it:

```bash
"$ADB" shell mkdir -p /data/local/tmp/llama
"$ADB" push gemma-4-E2B-it-qat-q4_0.gguf /data/local/tmp/llama/
```

That path is searched first, so the app picks it up on next launch. Watch the
status line under "Turn it into music" — it reports searching, loading, ready,
or absent.

### On expected speed

The Qualcomm figures (1,808 tok/s prefill, 35 tok/s decode) are for a
**Snapdragon X2 Elite laptop NPU**, not a phone, and llama.cpp on the iQOO's
CPU will be considerably slower. This is why the arrangement prompt is compact,
capped at 320 tokens, and backed by a 4-second timeout that falls through to
the rule-based arranger. A slow model degrades the demo's polish, never its
function.

---

## If the build fails

| Symptom | Cause |
|---|---|
| "paging file is too small" / JVM crash | Reboot did not take, or too much else is running |
| "filename, directory name, or volume label syntax is incorrect" | `local.properties` escaping — see Step 3 |
| Compose Compiler requires Kotlin 1.9.25 | The `withKotlinPin` plugin did not apply; re-run `expo prebuild` |
| `adb devices` empty | Pairing expired — Wireless debugging re-pairs after a network change |
