#pragma once

#include <oboe/Oboe.h>
#include <array>
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace worldjam {

constexpr int kSampleRate = 48000;
constexpr int kChannelCount = 2;
constexpr int kMaxVoices = 32;
constexpr int kMaxSlots = 16;

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
    size_t position{0};
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
};

class WorldJamEngine : public oboe::AudioStreamDataCallback,
                       public oboe::AudioStreamErrorCallback {
public:
    static WorldJamEngine& instance();

    bool start();
    void stop();

    // --- sample management (called off the audio thread) ---
    bool loadSampleFromPCM(int slot, const float* pcm, size_t frames, float gain);
    void clearSlot(int slot);

    // --- performance ---
    /** Fire a sample immediately. Returns the engine frame it was scheduled at. */
    int64_t trigger(int slot, float gain, float pan);
    /** Schedule a sample at an absolute engine frame (used by the beat grid). */
    void triggerAt(int slot, float gain, float pan, int64_t frame);
    void stopAllVoices();

    // --- recording ---
    bool startRecording();
    /** Stops capture and hands back the recorded mono buffer. */
    std::vector<float> stopRecording();
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

    std::atomic<bool> mMetronomeOn{false};
    std::atomic<double> mMetronomeBpm{90.0};
    int64_t mMetronomePhase{0};

    int mStreamSampleRate{kSampleRate};
    int mBurstFrames{0};
};

} // namespace worldjam
