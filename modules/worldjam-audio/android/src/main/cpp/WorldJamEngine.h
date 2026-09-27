#pragma once

#include <oboe/Oboe.h>
#include <array>
#include <atomic>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace worldjam {

constexpr int kSampleRate = 48000;
constexpr int kChannelCount = 2;
// V2: up to 64 soundboard pads plus the reserved accompaniment slots.
constexpr int kMaxVoices = 64;
constexpr int kMaxSlots = 80;

/**
 * A captured real-world sound. Immutable once loaded: the audio callback reads
 * it without locking, so the sample data must never be mutated in place while
 * a voice may be referencing it.
 */
struct Sample {
    std::vector<float> data;   // mono, normalized to peak 0.9
    std::atomic<bool> ready{false};
    float gain{1.0f};
};

/**
 * One playing instance of a Sample. Voices are pre-allocated and recycled;
 * nothing is allocated on the audio thread.
 */
struct Voice {
    std::atomic<bool> active{false};
    int slot{-1};
    double position{0}; // fractional, so a voice can play pitched
    float rate{1.0f};   // 1 = as recorded; 2 = an octave up
    bool loop{false};   // restart at the end until stopped
    float gain{1.0f};
    float pan{0.5f};       // 0 = hard left, 1 = hard right
    int64_t startFrame{0}; // engine frame at which playback begins
};

/**
 * Lock-free trigger request posted from the UI/JNI thread and consumed by the
 * audio callback. A ring buffer keeps the audio thread free of mutexes.
 */
struct TriggerRequest {
    int slot;
    float gain;
    float pan;
    int64_t atFrame; // -1 means "as soon as possible"
    float rate;
    bool loop;
};

/** What a record-to-file take produced. */
struct RecordingInfo {
    bool ok{false};
    int64_t frames{0};
    int sampleRate{0};
    float peak{0.0f};
    float rms{0.0f};
};

class WorldJamEngine : public oboe::AudioStreamDataCallback,
                       public oboe::AudioStreamErrorCallback {
public:
    static WorldJamEngine& instance();

    bool start();
    void stop();

    // --- sample management (called off the audio thread) ---
    bool loadSampleFromPCM(int slot, const float* pcm, size_t frames, float gain);
    /** Reads a WAV (PCM16/24/32 or float32, any rate/channels) straight into a slot, trimmed to [startSec, endSec). */
    bool loadSampleFromWav(int slot, const std::string& path, float gain, double startSec, double endSec);
    void clearSlot(int slot);

    // --- performance ---
    /** Fire a sample immediately. Returns the engine frame it was scheduled at. */
    int64_t trigger(int slot, float gain, float pan, float rate = 1.0f, bool loop = false);
    /** Schedule a sample at an absolute engine frame (used by the beat grid). */
    void triggerAt(int slot, float gain, float pan, int64_t frame, float rate = 1.0f, bool loop = false);
    void stopAllVoices();
    /** Silences every voice playing a slot (looping pads). */
    void stopSlot(int slot);

    // --- recording ---
    bool startRecording();
    /** Stops capture and hands back the recorded mono buffer. */
    std::vector<float> stopRecording();
    /** Streams the microphone straight to a PCM16 mono WAV, so long takes never sit in memory. */
    bool startRecordingToFile(const std::string& path);
    RecordingInfo stopRecordingToFile();
    /** Recent input peak 0..1 while recording, for a live level meter. */
    float inputLevel() const { return mInputLevel.load(std::memory_order_relaxed); }
    bool isRecording() const { return mRecording.load(std::memory_order_acquire); }

    // --- transport / clock ---
    int64_t currentFrame() const { return mFrameCounter.load(std::memory_order_acquire); }
    double latencyMillis() const { return mLatencyMillis.load(std::memory_order_relaxed); }
    int actualSampleRate() const { return mStreamSampleRate; }
    int actualBufferFrames() const { return mBurstFrames; }

    void setMasterGain(float g) { mMasterGain.store(g, std::memory_order_relaxed); }
    void setMetronome(bool on, double bpm);

    // oboe callbacks
    oboe::DataCallbackResult onAudioReady(oboe::AudioStream* stream, void* audioData,
                                          int32_t numFrames) override;
    void onErrorAfterClose(oboe::AudioStream* stream, oboe::Result error) override;

private:
    WorldJamEngine() = default;
    ~WorldJamEngine();

    bool openPlaybackStream();
    bool openRecordStream();
    void closeRecordStream();
    void recordLoop();
    void drainTriggerQueue(int64_t blockStartFrame, int32_t numFrames);
    int findFreeVoice();
    void renderMetronome(float* out, int32_t numFrames, int64_t blockStartFrame);

    std::shared_ptr<oboe::AudioStream> mPlayStream;
    std::shared_ptr<oboe::AudioStream> mRecordStream;

    std::array<std::shared_ptr<Sample>, kMaxSlots> mSlots;
    std::mutex mSlotMutex; // guards slot *assignment* only, never taken on audio thread

    std::array<Voice, kMaxVoices> mVoices;

    // single-producer / single-consumer trigger ring
    static constexpr int kTriggerRingSize = 128;
    std::array<TriggerRequest, kTriggerRingSize> mTriggerRing;
    std::atomic<uint32_t> mTriggerWrite{0};
    std::atomic<uint32_t> mTriggerRead{0};

    std::atomic<int64_t> mFrameCounter{0};
    std::atomic<double> mLatencyMillis{0.0};
    std::atomic<float> mMasterGain{1.0f};

    std::atomic<bool> mRecording{false};
    std::vector<float> mRecordBuffer;
    std::mutex mRecordMutex;
    std::thread mRecordThread;
    FILE* mRecordFile{nullptr};
    int64_t mRecordFrames{0};
    double mRecordSumSq{0.0};
    float mRecordPeak{0.0f};
    std::atomic<float> mInputLevel{0.0f};

    std::atomic<bool> mMetronomeOn{false};
    std::atomic<double> mMetronomeBpm{90.0};

    int mStreamSampleRate{kSampleRate};
    int mBurstFrames{0};
};

} // namespace worldjam
