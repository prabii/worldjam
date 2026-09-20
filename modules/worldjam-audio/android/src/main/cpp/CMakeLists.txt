cmake_minimum_required(VERSION 3.22.1)
project(worldjam_audio)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# -O3 matters here: the mix loop runs on every audio callback.
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -fno-omit-frame-pointer")

find_package(oboe REQUIRED CONFIG)

add_library(worldjam_audio SHARED
    WorldJamEngine.cpp
    worldjam-jni.cpp
)

target_link_libraries(worldjam_audio
    oboe::oboe
    android
    log
)
