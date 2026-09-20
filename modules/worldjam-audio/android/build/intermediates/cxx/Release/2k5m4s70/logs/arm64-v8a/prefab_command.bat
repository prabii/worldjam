@echo off
"C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java" ^
  --class-path ^
  "C:\\Users\\codep\\.gradle\\caches\\modules-2\\files-2.1\\com.google.prefab\\cli\\2.1.0\\aa32fec809c44fa531f01dcfb739b5b3304d3050\\cli-2.1.0-all.jar" ^
  com.google.prefab.cli.AppKt ^
  --build-system ^
  cmake ^
  --platform ^
  android ^
  --abi ^
  arm64-v8a ^
  --os-version ^
  26 ^
  --stl ^
  c++_shared ^
  --ndk-version ^
  26 ^
  --output ^
  "C:\\Users\\codep\\AppData\\Local\\Temp\\agp-prefab-staging15958529501607345416\\staged-cli-output" ^
  "C:\\Users\\codep\\.gradle\\caches\\8.10.2\\transforms\\623f9e3f29b20e2d76e330ee188bb967\\transformed\\oboe-1.9.0\\prefab"
