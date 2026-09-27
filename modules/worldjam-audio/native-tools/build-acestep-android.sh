#!/bin/bash
# Rebuilds jniLibs/arm64-v8a/libacesynth.so (ACE-Step 1.5 via acestep.cpp).
# Upstream: https://github.com/ServeurpersoCom/acestep.cpp @ b7ba6d9 (MIT),
# plus acestep-threads.patch (ACE_THREADS env override; phones have no SMT).
# Static ggml + static libc++: the binary needs only libc/libm/libdl.
set -euo pipefail
SRC=${1:?usage: build-acestep-android.sh <acestep.cpp checkout>}
NDK=${ANDROID_NDK:-$(ls -d /c/Android/sdk/ndk/* | tail -1)}
CM=${CMAKE_BIN:-/c/Android/sdk/cmake/3.22.1/bin}
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$SRC"
git apply --check "$HERE/acestep-threads.patch" 2>/dev/null && git apply "$HERE/acestep-threads.patch" || true
mkdir -p build-android && cd build-android
"$CM/cmake" .. -G Ninja -DCMAKE_MAKE_PROGRAM="$CM/ninja" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 -DANDROID_STL=c++_static \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_BACKEND_DL=OFF \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm -DGGML_LLAMAFILE=ON
"$CM/ninja" -j4 ace-synth
"$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip" -o "$HERE/../android/src/main/jniLibs/arm64-v8a/libacesynth.so" ace-synth
echo "libacesynth.so rebuilt"
