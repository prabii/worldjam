#include "WorldJamEngine.h"

#include <android/log.h>
#include <algorithm>
#include <cmath>
#include <cstring>

#define LOG_TAG "WorldJamEngine"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace worldjam {

WorldJamEngine& WorldJamEngine::instance() {
    static WorldJamEngine engine;
    return engine;
}

WorldJamEngine::~WorldJamEngine() { stop(); }

// ---------------------------------------------------------------------------
// Stream setup
// ---------------------------------------------------------------------------

bool WorldJamEngine::openPlaybackStream() {
    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Output)
        // PowerSaving would let the system batch callbacks; we need the opposite.
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Exclusive)
        ->setFormat(oboe::AudioFormat::Float)
        ->setChannelCount(kChannelCount)
        // Deliberately NOT calling setSampleRate(): forcing 48000 when the
        // device prefers something else inserts a resampler and pushes the
        // stream into shared mode. Measured on a MediaTek MT6878, forcing the
        // rate produced burst=770 (~16 ms) and exclusive=0.
        ->setUsage(oboe::Usage::Game)
        ->setDataCallback(this)
        ->setErrorCallback(this);

    oboe::Result result = builder.openStream(mPlayStream);

    // Exclusive mode is not always grantable. Rather than silently accepting
    // whatever we get, retry explicitly in shared mode so the fallback is
    // visible in the log and intentional in the code.
    if (result != oboe::Result::OK) {
        LOGE("Exclusive stream failed (%s), retrying shared",
             oboe::convertToText(result));
        builder.setSharingMode(oboe::SharingMode::Shared);
        result = builder.openStream(mPlayStream);
    }

    if (result != oboe::Result::OK) {
        LOGE("Failed to open playback stream: %s", oboe::convertToText(result));
        return false;
    }

    mStreamSampleRate = mPlayStream->getSampleRate();
    mBurstFrames = mPlayStream->getFramesPerBurst();

    // Start at one burst - the tightest the device will accept - and let
    // Oboe grow it only if underruns actually occur. Two bursts was costing
    // ~32 ms on a device with a 770-frame burst, which alone blows the budget.
    auto bufResult = mPlayStream->setBufferSizeInFrames(mBurstFrames);
    if (!bufResult) {
        mPlayStream->setBufferSizeInFrames(mBurstFrames * 2);
    }

    result = mPlayStream->requestStart();
    if (result != oboe::Result::OK) {
        LOGE("Failed to start playback stream: %s", oboe::convertToText(result));
        return false;
    }

    auto lat = mPlayStream->calculateLatencyMillis();
    LOGI("Playback stream open: rate=%d burst=%d buffer=%d exclusive=%d latency=%.1fms",
         mStreamSampleRate, mBurstFrames, mPlayStream->getBufferSizeInFrames(),
         mPlayStream->getSharingMode() == oboe::SharingMode::Exclusive,
         lat ? lat.value() : -1.0);
    return true;
}

bool WorldJamEngine::openRecordStream() {
    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Input)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Exclusive)
        ->setFormat(oboe::AudioFormat::Float)
        ->setChannelCount(1)
        ->setSampleRate(mStreamSampleRate)
        // Unprocessed avoids the AGC/NS chain mangling the transient of a tap,
        // which is exactly the part that carries the object's identity.
        ->setInputPreset(oboe::InputPreset::Unprocessed);

    oboe::Result result = builder.openStream(mRecordStream);
    if (result != oboe::Result::OK) {
        LOGE("Unprocessed input failed (%s), retrying with VoiceRecognition",
             oboe::convertToText(result));
        builder.setInputPreset(oboe::InputPreset::VoiceRecognition);
        result = builder.openStream(mRecordStream);
    }
    if (result != oboe::Result::OK) {
        LOGE("Failed to open record stream: %s", oboe::convertToText(result));
        return false;
    }

    result = mRecordStream->requestStart();
    if (result != oboe::Result::OK) {
        LOGE("Failed to start record stream: %s", oboe::convertToText(result));
        mRecordStream->close();
        mRecordStream.reset();
        return false;
    }
    return true;
}

void WorldJamEngine::closeRecordStream() {
    if (mRecordStream) {
        mRecordStream->requestStop();
        mRecordStream->close();
        mRecordStream.reset();
    }
}

bool WorldJamEngine::start() {
    if (mPlayStream) return true;
    for (auto& v : mVoices) v.active.store(false, std::memory_order_release);
    return openPlaybackStream();
}

void WorldJamEngine::stop() {
    closeRecordStream();
    if (mPlayStream) {
        mPlayStream->requestStop();
        mPlayStream->close();
        mPlayStream.reset();
    }
}

// ---------------------------------------------------------------------------
// Sample management
// ---------------------------------------------------------------------------

bool WorldJamEngine::loadSampleFromPCM(int slot, const float* pcm, size_t frames, float gain) {
    if (slot < 0 || slot >= kMaxSlots || frames == 0) return false;

    auto sample = std::make_shared<Sample>();
    sample->data.assign(pcm, pcm + frames);
    sample->gain = gain;

    // Normalize to a consistent perceived level so a quiet tap and a loud one
    // sit together in the mix.
    float peak = 0.0f;
    for (float v : sample->data) peak = std::max(peak, std::fabs(v));
    if (peak > 1e-6f) {
        const float scale = 0.9f / peak;
        for (float& v : sample->data) v *= scale;
    }

    // Short fades stop clicks at the edges of a hard-trimmed capture.
    const size_t fade = std::min<size_t>(192, sample->data.size() / 4);
    for (size_t i = 0; i < fade; ++i) {
        const float f = static_cast<float>(i) / static_cast<float>(fade);
        sample->data[i] *= f;
        sample->data[sample->data.size() - 1 - i] *= f;
    }

    sample->ready.store(true, std::memory_order_release);

    {
        std::lock_guard<std::mutex> lock(mSlotMutex);
        mSlots[slot] = sample; // old sample stays alive until its voices release it
    }
    return true;
}

void WorldJamEngine::clearSlot(int slot) {
    if (slot < 0 || slot >= kMaxSlots) return;
    for (auto& v : mVoices) {
        if (v.slot == slot) v.active.store(false, std::memory_order_release);
    }
    std::lock_guard<std::mutex> lock(mSlotMutex);
    mSlots[slot].reset();
}

// ---------------------------------------------------------------------------
// Triggering
// ---------------------------------------------------------------------------

int64_t WorldJamEngine::trigger(int slot, float gain, float pan, float rate, bool loop) {
    const int64_t now = currentFrame();
    triggerAt(slot, gain, pan, -1, rate, loop);
    return now;
}

void WorldJamEngine::triggerAt(int slot, float gain, float pan, int64_t frame, float rate, bool loop) {
    if (slot < 0 || slot >= kMaxSlots) return;

    const uint32_t w = mTriggerWrite.load(std::memory_order_relaxed);
    const uint32_t r = mTriggerRead.load(std::memory_order_acquire);
    if (w - r >= kTriggerRingSize) {
        LOGE("Trigger ring full, dropping slot %d", slot);
        return;
    }

    const float safeRate = (rate > 0.05f && rate < 8.0f) ? rate : 1.0f;
    mTriggerRing[w % kTriggerRingSize] = TriggerRequest{slot, gain, pan, frame, safeRate, loop};
    mTriggerWrite.store(w + 1, std::memory_order_release);
}

void WorldJamEngine::stopAllVoices() {
    for (auto& v : mVoices) v.active.store(false, std::memory_order_release);
}

void WorldJamEngine::stopSlot(int slot) {
    for (auto& v : mVoices) {
        if (v.slot == slot) v.active.store(false, std::memory_order_release);
    }
}

int WorldJamEngine::findFreeVoice() {
    for (int i = 0; i < kMaxVoices; ++i) {
        if (!mVoices[i].active.load(std::memory_order_acquire)) return i;
    }
    // All busy: steal the voice that has played longest, which is the least
    // likely to still be audible.
    int oldest = 0;
    double furthest = 0;
    for (int i = 0; i < kMaxVoices; ++i) {
        if (mVoices[i].position > furthest) {
            furthest = mVoices[i].position;
            oldest = i;
        }
    }
    return oldest;
}

void WorldJamEngine::drainTriggerQueue(int64_t blockStartFrame, int32_t numFrames) {
    const uint32_t w = mTriggerWrite.load(std::memory_order_acquire);
    uint32_t r = mTriggerRead.load(std::memory_order_relaxed);

    while (r != w) {
        const TriggerRequest& req = mTriggerRing[r % kTriggerRingSize];

        // A scheduled hit beyond this block stays queued until its block comes.
        if (req.atFrame >= 0 && req.atFrame >= blockStartFrame + numFrames) break;

        const int vi = findFreeVoice();
        Voice& v = mVoices[vi];
        v.slot = req.slot;
        v.gain = req.gain;
        v.pan = req.pan;
        v.rate = req.rate;
        v.loop = req.loop;
        v.position = 0;
        // Late scheduled hits fire at the block start rather than being dropped.
        v.startFrame = (req.atFrame < 0) ? blockStartFrame
                                         : std::max(req.atFrame, blockStartFrame);
        v.active.store(true, std::memory_order_release);

        ++r;
    }
    mTriggerRead.store(r, std::memory_order_release);
}

// ---------------------------------------------------------------------------
// Audio callback — real-time thread. No allocation, no locks, no logging.
// ---------------------------------------------------------------------------

oboe::DataCallbackResult WorldJamEngine::onAudioReady(oboe::AudioStream* stream,
                                                      void* audioData, int32_t numFrames) {
    auto* out = static_cast<float*>(audioData);
    std::memset(out, 0, sizeof(float) * numFrames * kChannelCount);

    const int64_t blockStart = mFrameCounter.load(std::memory_order_relaxed);

    drainTriggerQueue(blockStart, numFrames);

    const float master = mMasterGain.load(std::memory_order_relaxed);

    for (auto& v : mVoices) {
        if (!v.active.load(std::memory_order_acquire)) continue;

        // Copying the shared_ptr here would allocate/refcount on the audio
        // thread; the raw pointer is safe because slots are only replaced,
        // never freed, while a voice holds them within one callback.
        Sample* sample = mSlots[v.slot].get();
        if (sample == nullptr || !sample->ready.load(std::memory_order_acquire)) {
            v.active.store(false, std::memory_order_release);
            continue;
        }

        const size_t total = sample->data.size();
        const float* data = sample->data.data();
        // Last index that still has a right neighbour for interpolation.
        const double end = static_cast<double>(total) - 1.0;
        const float gain = v.gain * sample->gain * master;
        const float gl = gain * std::sqrt(1.0f - v.pan);
        const float gr = gain * std::sqrt(v.pan);

        const int32_t offset = static_cast<int32_t>(
            std::max<int64_t>(0, v.startFrame - blockStart));

        for (int32_t i = offset; i < numFrames; ++i) {
            if (v.position >= end) {
                if (v.loop && end > 1.0) {
                    v.position -= end;
                } else {
                    v.active.store(false, std::memory_order_release);
                    break;
                }
            }
            const size_t i0 = static_cast<size_t>(v.position);
            const float frac = static_cast<float>(v.position - static_cast<double>(i0));
            const float s = data[i0] + (data[i0 + 1] - data[i0]) * frac;
            v.position += v.rate;
            out[i * 2] += s * gl;
            out[i * 2 + 1] += s * gr;
        }
    }

    if (mMetronomeOn.load(std::memory_order_relaxed)) {
        renderMetronome(out, numFrames, blockStart);
    }

    // Soft clip rather than hard-wrapping when many objects stack up.
    for (int32_t i = 0; i < numFrames * kChannelCount; ++i) {
        out[i] = std::tanh(out[i]);
    }

    mFrameCounter.store(blockStart + numFrames, std::memory_order_release);

    // Report round-trip latency so the UI can prove the <50 ms budget.
    auto latency = stream->calculateLatencyMillis();
    if (latency) {
        mLatencyMillis.store(latency.value(), std::memory_order_relaxed);
    }

    return oboe::DataCallbackResult::Continue;
}

void WorldJamEngine::renderMetronome(float* out, int32_t numFrames, int64_t blockStartFrame) {
    const double bpm = mMetronomeBpm.load(std::memory_order_relaxed);
    const int64_t framesPerBeat =
        static_cast<int64_t>((60.0 / bpm) * mStreamSampleRate);
    if (framesPerBeat <= 0) return;

    for (int32_t i = 0; i < numFrames; ++i) {
        const int64_t f = blockStartFrame + i;
        const int64_t intoBeat = f % framesPerBeat;
        if (intoBeat < 900) {
            const float env = 1.0f - static_cast<float>(intoBeat) / 900.0f;
            const bool downbeat = ((f / framesPerBeat) % 4) == 0;
            const float freq = downbeat ? 1600.0f : 1000.0f;
            const float s = 0.12f * env *
                std::sin(2.0f * 3.14159265f * freq * intoBeat / mStreamSampleRate);
            out[i * 2] += s;
            out[i * 2 + 1] += s;
        }
    }
}

void WorldJamEngine::setMetronome(bool on, double bpm) {
    mMetronomeBpm.store(bpm, std::memory_order_relaxed);
    mMetronomeOn.store(on, std::memory_order_relaxed);
}

void WorldJamEngine::onErrorAfterClose(oboe::AudioStream* /*stream*/, oboe::Result error) {
    // Disconnects happen when headphones are plugged in mid-session; rebuild
    // the stream so a demo never dies on a cable.
    LOGE("Stream error after close: %s — reopening", oboe::convertToText(error));
    mPlayStream.reset();
    openPlaybackStream();
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

bool WorldJamEngine::startRecording() {
    if (mRecording.load(std::memory_order_acquire)) return true;
    if (!openRecordStream()) return false;

    {
        std::lock_guard<std::mutex> lock(mRecordMutex);
        mRecordBuffer.clear();
        mRecordBuffer.reserve(static_cast<size_t>(mStreamSampleRate) * 10);
    }
    mRecording.store(true, std::memory_order_release);

    // A dedicated reader thread is required: the input ring buffer is only a
    // few bursts deep, so draining it once at stop() would lose everything but
    // the last few milliseconds.
    mRecordThread = std::thread(&WorldJamEngine::recordLoop, this);
    return true;
}

void WorldJamEngine::recordLoop() {
    constexpr int kChunk = 256;
    float chunk[kChunk];

    while (mRecording.load(std::memory_order_acquire)) {
        if (!mRecordStream) break;
        // Blocking read with a short timeout keeps this thread off the CPU
        // between bursts without risking an overrun.
        auto res = mRecordStream->read(chunk, kChunk, 100 * 1000000L /* 100ms */);
        if (!res) {
            if (res.error() == oboe::Result::ErrorTimeout) continue;
            LOGE("Record read failed: %s", oboe::convertToText(res.error()));
            break;
        }
        const int got = res.value();
        if (got > 0) {
            float peak = 0.0f;
            for (int i = 0; i < got; ++i) peak = std::max(peak, std::fabs(chunk[i]));
            // Fast attack, slow release: a meter the eye can follow.
            mInputLevel.store(std::max(peak, mInputLevel.load(std::memory_order_relaxed) * 0.85f),
                              std::memory_order_relaxed);
            std::lock_guard<std::mutex> lock(mRecordMutex);
            if (mRecordFile != nullptr) {
                int16_t pcm[kChunk];
                for (int i = 0; i < got; ++i) {
                    const float x = std::max(-1.0f, std::min(1.0f, chunk[i]));
                    pcm[i] = static_cast<int16_t>(std::lrint(x * 32767.0f));
                    mRecordSumSq += static_cast<double>(x) * x;
                }
                mRecordPeak = std::max(mRecordPeak, peak);
                std::fwrite(pcm, sizeof(int16_t), static_cast<size_t>(got), mRecordFile);
                mRecordFrames += got;
            } else {
                mRecordBuffer.insert(mRecordBuffer.end(), chunk, chunk + got);
            }
        }
    }
}

std::vector<float> WorldJamEngine::stopRecording() {
    if (!mRecording.load(std::memory_order_acquire)) return {};

    mRecording.store(false, std::memory_order_release);
    if (mRecordThread.joinable()) mRecordThread.join();
    closeRecordStream();

    std::lock_guard<std::mutex> lock(mRecordMutex);
    std::vector<float> out = std::move(mRecordBuffer);
    mRecordBuffer.clear();
    return out;
}

// ---------------------------------------------------------------------------
// V2: record straight to a WAV file
// ---------------------------------------------------------------------------

namespace {

void writeWavHeader(FILE* f, int sampleRate, int channels, uint32_t dataBytes) {
    auto u32 = [f](uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto u16 = [f](uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f);
    u32(36 + dataBytes);
    std::fwrite("WAVEfmt ", 1, 8, f);
    u32(16);
    u16(1); // PCM
    u16(static_cast<uint16_t>(channels));
    u32(static_cast<uint32_t>(sampleRate));
    u32(static_cast<uint32_t>(sampleRate * channels * 2));
    u16(static_cast<uint16_t>(channels * 2));
    u16(16);
    std::fwrite("data", 1, 4, f);
    u32(dataBytes);
}

} // namespace

bool WorldJamEngine::startRecordingToFile(const std::string& path) {
    if (mRecording.load(std::memory_order_acquire)) return false;
    FILE* f = std::fopen(path.c_str(), "wb");
    if (f == nullptr) {
        LOGE("Cannot open %s for recording", path.c_str());
        return false;
    }
    // Placeholder header; sizes are patched in stopRecordingToFile().
    writeWavHeader(f, mStreamSampleRate, 1, 0);
    {
        std::lock_guard<std::mutex> lock(mRecordMutex);
        mRecordFile = f;
        mRecordFrames = 0;
        mRecordSumSq = 0.0;
        mRecordPeak = 0.0f;
    }
    if (!startRecording()) {
        std::lock_guard<std::mutex> lock(mRecordMutex);
        std::fclose(mRecordFile);
        mRecordFile = nullptr;
        return false;
    }
    return true;
}

RecordingInfo WorldJamEngine::stopRecordingToFile() {
    RecordingInfo info;
    if (!mRecording.load(std::memory_order_acquire)) return info;
    mRecording.store(false, std::memory_order_release);
    if (mRecordThread.joinable()) mRecordThread.join();
    closeRecordStream();
    mInputLevel.store(0.0f, std::memory_order_relaxed);

    std::lock_guard<std::mutex> lock(mRecordMutex);
    if (mRecordFile == nullptr) return info;
    const auto dataBytes = static_cast<uint32_t>(mRecordFrames * 2);
    std::fseek(mRecordFile, 0, SEEK_SET);
    writeWavHeader(mRecordFile, mStreamSampleRate, 1, dataBytes);
    std::fclose(mRecordFile);
    mRecordFile = nullptr;

    info.ok = mRecordFrames > 0;
    info.frames = mRecordFrames;
    info.sampleRate = mStreamSampleRate;
    info.peak = mRecordPeak;
    info.rms = mRecordFrames > 0 ? static_cast<float>(std::sqrt(mRecordSumSq / static_cast<double>(mRecordFrames))) : 0.0f;
    return info;
}

// ---------------------------------------------------------------------------
// V2: load a slot straight from a WAV file (no PCM through the JS bridge)
// ---------------------------------------------------------------------------

bool WorldJamEngine::loadSampleFromWav(int slot, const std::string& path, float gain,
                                       double startSec, double endSec) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) return false;
    std::fseek(f, 0, SEEK_END);
    const long size = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (size < 44) {
        std::fclose(f);
        return false;
    }
    std::vector<uint8_t> bytes(static_cast<size_t>(size));
    const size_t read = std::fread(bytes.data(), 1, bytes.size(), f);
    std::fclose(f);
    if (read != bytes.size() || std::memcmp(bytes.data(), "RIFF", 4) != 0 || std::memcmp(bytes.data() + 8, "WAVE", 4) != 0) {
        return false;
    }

    auto rd16 = [&](size_t o) { return static_cast<uint16_t>(bytes[o] | (bytes[o + 1] << 8)); };
    auto rd32 = [&](size_t o) {
        return static_cast<uint32_t>(bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (static_cast<uint32_t>(bytes[o + 3]) << 24));
    };

    int format = 1, channels = 1, rate = kSampleRate, bits = 16;
    size_t pos = 12, dataStart = 0, dataLen = 0;
    while (pos + 8 <= bytes.size()) {
        const uint32_t chunk = rd32(pos + 4);
        const size_t body = pos + 8;
        if (std::memcmp(bytes.data() + pos, "fmt ", 4) == 0 && body + 16 <= bytes.size()) {
            format = rd16(body);
            channels = std::max(1, static_cast<int>(rd16(body + 2)));
            rate = static_cast<int>(rd32(body + 4));
            bits = rd16(body + 14);
            if (format == 0xFFFE && chunk >= 26) format = rd16(body + 24); // WAVE_FORMAT_EXTENSIBLE
        } else if (std::memcmp(bytes.data() + pos, "data", 4) == 0) {
            dataStart = body;
            dataLen = std::min<size_t>(chunk, bytes.size() - body);
            break;
        }
        pos = body + chunk + (chunk & 1u);
    }
    const int bytesPer = bits / 8;
    if (dataLen == 0 || bytesPer == 0 || rate <= 0) return false;
    const size_t frames = dataLen / static_cast<size_t>(bytesPer * channels);

    // Decode + downmix to mono.
    std::vector<float> mono(frames);
    for (size_t i = 0; i < frames; ++i) {
        float sum = 0.0f;
        for (int c = 0; c < channels; ++c) {
            const size_t o = dataStart + (i * channels + c) * bytesPer;
            float x = 0.0f;
            if (format == 3 && bits == 32) {
                uint32_t u = rd32(o);
                std::memcpy(&x, &u, 4);
            } else if (bits == 16) {
                x = static_cast<int16_t>(rd16(o)) / 32768.0f;
            } else if (bits == 24) {
                int32_t v = static_cast<int32_t>((bytes[o] << 8) | (bytes[o + 1] << 16) | (bytes[o + 2] << 24)) >> 8;
                x = v / 8388608.0f;
            } else if (bits == 32) {
                x = static_cast<int32_t>(rd32(o)) / 2147483648.0f;
            } else {
                return false;
            }
            sum += x;
        }
        mono[i] = sum / static_cast<float>(channels);
    }

    // Trim.
    const size_t from = std::min(frames, static_cast<size_t>(std::max(0.0, startSec) * rate));
    size_t to = frames;
    if (endSec > 0.0) to = std::min(frames, static_cast<size_t>(endSec * rate));
    if (to <= from) return false;

    // Resample to the stream rate (linear is plenty for one-shot pads).
    const double ratio = static_cast<double>(rate) / mStreamSampleRate;
    const size_t outFrames = static_cast<size_t>((to - from) / ratio);
    if (outFrames == 0) return false;
    std::vector<float> out(outFrames);
    for (size_t i = 0; i < outFrames; ++i) {
        const double x = from + i * ratio;
        const size_t i0 = std::min(static_cast<size_t>(x), to - 1);
        const size_t i1 = std::min(i0 + 1, to - 1);
        const float t = static_cast<float>(x - static_cast<double>(i0));
        out[i] = mono[i0] + (mono[i1] - mono[i0]) * t;
    }
    return loadSampleFromPCM(slot, out.data(), out.size(), gain);
}

} // namespace worldjam
