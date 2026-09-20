@echo off
REM Builds WorldJam and installs it to the connected phone.
REM
REM Run this directly if the Claude session drops - it does not depend on
REM anything but the repo and a connected device. Gradle is incremental, so
REM re-running after an interruption resumes rather than starting over.

setlocal

set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"

cd /d "%~dp0"

echo.
echo === Device ===
"%ADB%" devices
echo.

echo === Building (first build is slow; later ones take ~2 min) ===
call android\gradlew.bat -p android :app:assembleDebug --console=plain > build.log 2>&1

if errorlevel 1 (
  echo.
  echo BUILD FAILED. Last errors:
  findstr /C:"What went wrong" /C:"Execution failed" /C:"error:" /C:"OutOfMemory" build.log
  echo.
  echo Full log: build.log
  exit /b 1
)

echo.
echo === Installing ===
for /r "android\app\build\outputs" %%f in (*.apk) do (
  echo Found: %%~nxf  ^(%%~zf bytes^)
  "%ADB%" install -r "%%f"
  goto :done
)

echo No APK produced - check build.log
exit /b 1

:done
echo.
echo Installed. Open "WorldJam" on the phone.
echo.
echo For live JS editing (no rebuild needed):
echo   npm start
endlocal
