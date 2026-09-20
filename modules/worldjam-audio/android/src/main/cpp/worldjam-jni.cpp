#include <jni.h>
#include <vector>

#include "WorldJamEngine.h"

using worldjam::WorldJamEngine;

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeStart(JNIEnv*, jobject) {
    return WorldJamEngine::instance().start() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeStop(JNIEnv*, jobject) {
    WorldJamEngine::instance().stop();
}

JNIEXPORT jlong JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeTrigger(JNIEnv*, jobject, jint slot,
                                                          jfloat gain, jfloat pan) {
    return static_cast<jlong>(WorldJamEngine::instance().trigger(slot, gain, pan));
}

JNIEXPORT void JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeTriggerAt(JNIEnv*, jobject, jint slot,
                                                            jfloat gain, jfloat pan,
                                                            jlong frame) {
    WorldJamEngine::instance().triggerAt(slot, gain, pan, static_cast<int64_t>(frame));
}

JNIEXPORT void JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeStopAllVoices(JNIEnv*, jobject) {
    WorldJamEngine::instance().stopAllVoices();
}

JNIEXPORT jboolean JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeLoadSample(JNIEnv* env, jobject, jint slot,
                                                             jfloatArray pcm, jfloat gain) {
    const jsize len = env->GetArrayLength(pcm);
    if (len <= 0) return JNI_FALSE;

    jfloat* data = env->GetFloatArrayElements(pcm, nullptr);
    const bool ok = WorldJamEngine::instance().loadSampleFromPCM(
        slot, reinterpret_cast<const float*>(data), static_cast<size_t>(len), gain);
    env->ReleaseFloatArrayElements(pcm, data, JNI_ABORT);
    return ok ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeClearSlot(JNIEnv*, jobject, jint slot) {
    WorldJamEngine::instance().clearSlot(slot);
}

JNIEXPORT jboolean JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeStartRecording(JNIEnv*, jobject) {
    return WorldJamEngine::instance().startRecording() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jfloatArray JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeStopRecording(JNIEnv* env, jobject) {
    std::vector<float> buf = WorldJamEngine::instance().stopRecording();
    jfloatArray out = env->NewFloatArray(static_cast<jsize>(buf.size()));
    if (out != nullptr && !buf.empty()) {
        env->SetFloatArrayRegion(out, 0, static_cast<jsize>(buf.size()), buf.data());
    }
    return out;
}

JNIEXPORT jlong JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeCurrentFrame(JNIEnv*, jobject) {
    return static_cast<jlong>(WorldJamEngine::instance().currentFrame());
}

JNIEXPORT jdouble JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeLatencyMillis(JNIEnv*, jobject) {
    return WorldJamEngine::instance().latencyMillis();
}

JNIEXPORT jint JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeSampleRate(JNIEnv*, jobject) {
    return WorldJamEngine::instance().actualSampleRate();
}

JNIEXPORT jint JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeBufferFrames(JNIEnv*, jobject) {
    return WorldJamEngine::instance().actualBufferFrames();
}

JNIEXPORT void JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeSetMasterGain(JNIEnv*, jobject, jfloat g) {
    WorldJamEngine::instance().setMasterGain(g);
}

JNIEXPORT void JNICALL
Java_com_worldjam_audio_WorldJamAudioModule_nativeSetMetronome(JNIEnv*, jobject, jboolean on,
                                                               jdouble bpm) {
    WorldJamEngine::instance().setMetronome(on == JNI_TRUE, bpm);
}

} // extern "C"
