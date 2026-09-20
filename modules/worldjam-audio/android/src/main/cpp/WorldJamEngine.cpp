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
        ->setSampleRate(kSampleRate)
        ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
        ->setUsage(oboe::Usage::Game)
        ->setDataCallback(this)
        ->setErrorCallback(this);

    oboe::Result result = builder.openStream(mPlayStream);
    if (result != oboe::Result::OK) {
        LOGE("Failed to open playback stream: %s", oboe::convertToText(result));
        return false;
    }

    mStreamSampleRate = mPlayStream->getSampleRate();
    mBurstFrames = mPlayStream->getFramesPerBurst();

    // Two bursts is the standard low-latency compromise: enough slack to avoid
    // glitching, small enough to stay well inside the 50 ms budget.
    mPlayStream->setBufferSizeInFrames(mBurstFrames * 2);

    result = mPlayStream->requestStart();
    if (result != oboe::Result::OK) {
        LOGE("Failed to start playback stream: %s", oboe::convertToText(result));
        return false;
    }

    LOGI("Playback stream open: rate=%d burst=%d buffer=%d exclusive=%d",
         mStreamSampleRate, mBurstFrames, mPlayStream->getBufferSizeInFrames(),
         mPlayStream->getSharingMode() == oboe::SharingMode::Exclusive);
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

int64_t WorldJamEngine::trigger(int slot, float gain, float pan) {
    const int64_t now = currentFrame();
    triggerAt(slot, gain, pan, -1);
    return now;
}

void WorldJamEngine::triggerAt(int slot, float gain, float pan, int64_t frame) {
    if (slot < 0 || slot >= kMaxSlots) return;

    const uint32_t w = mTriggerWrite.load(std::memory_order_relaxed);
    const uint32_t r = mTriggerRead.load(std::memory_order_acquire);
    if (w - r >= kTriggerRingSize) {
        LOGE("Trigger ring full, dropping slot %d", slot);
        return;
    }

    mTriggerRing[w % kTriggerRingSize] = TriggerRequest{slot, gain, pan, frame};
    mTriggerWrite.store(w + 1, std::memory_order_release);
}

void WorldJamEngine::stopAllVoices() {
    for (auto& v : mVoices) v.active.store(false, std::memory_order_release);
}

int WorldJamEngine::findFreeVoice() {
    for (int i = 0; i < kMaxVoices; ++i) {
        if (!mVoices[i].active.load(std::memory_order_acquire)) return i;
    }
    // All busy: steal the voice that has played longest, which is the least
    // likely to still be audible.
    int oldest = 0;
    size_t furthest = 0;
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
        const float gain = v.gain * sample->gain * master;
        const float gl = gain * std::sqrt(1.0f - v.pan);
        const float gr = gain * std::sqrt(v.pan);

        const int32_t offset = static_cast<int32_t>(
            std::max<int64_t>(0, v.startFrame - blockStart));

        for (int32_t i = offset; i < numFrames; ++i) {
            if (v.position >= total) {
                v.active.store(false, std::memory_order_release);
                break;
            }
            const float s = sample->data[v.position++];
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
            std::lock_guard<std::mutex> lock(mRecordMutex);
            mRecordBuffer.insert(mRecordBuffer.end(), chunk, chunk + got);
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

} // namespace worldjam
