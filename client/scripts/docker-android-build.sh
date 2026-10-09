#!/bin/sh
# Builds the native Kotlin Android client inside its Docker builder.
set -eu
sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
offline=${ANDROID_BUILD_OFFLINE:-auto}
case "$offline" in auto|0|1) ;; *) echo 'ANDROID_BUILD_OFFLINE must be auto, 0 or 1.' >&2; exit 1 ;; esac
cache=${ANDROID_DOWNLOAD_CACHE:-/cache/downloads}
temporary=${TMPDIR:-/tmp}
mkdir -p "$cache" "$temporary"
if [ "$offline" = 1 ]; then
  python3 scripts/prepare-expressions.py --cache "$cache" --offline
else
  python3 scripts/prepare-expressions.py --cache "$cache"
fi
if [ ! -x "$sdkmanager" ]; then
  if [ "$offline" = 1 ]; then echo 'Android SDK is not cached. Run one build with ANDROID_BUILD_OFFLINE=0.' >&2; exit 1; fi
  cli_version=${ANDROID_CLI_VERSION:-13114758}
  bundle="$cache/commandlinetools-linux-${cli_version}.zip"
  mkdir -p "$ANDROID_HOME/cmdline-tools" "$temporary/android-cmdline"
  if [ ! -s "$bundle" ] || ! unzip -tq "$bundle" >/dev/null 2>&1; then
    curl --retry 3 --connect-timeout 20 -fL "https://dl.google.com/android/repository/commandlinetools-linux-${cli_version}_latest.zip" -o "$bundle.part"
    unzip -tq "$bundle.part" >/dev/null
    mv "$bundle.part" "$bundle"
  fi
  unzip -qo "$bundle" -d "$temporary/android-cmdline"
  mv "$temporary/android-cmdline/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
if [ ! -s "$ANDROID_HOME/platforms/android-36/android.jar" ] || [ ! -x "$ANDROID_HOME/build-tools/36.0.0/aapt2" ] || [ ! -x "$ANDROID_HOME/platform-tools/adb" ] || [ ! -s "$ANDROID_HOME/licenses/android-sdk-license" ]; then
  if [ "$offline" = 1 ]; then echo 'Required SDK packages are not cached. Run one build with ANDROID_BUILD_OFFLINE=0.' >&2; exit 1; fi
  yes | "$sdkmanager" --licenses >/dev/null
  "$sdkmanager" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
else
  echo 'Android SDK: using local repository; no SDK Manager network request.'
fi
if [ "$offline" = 0 ]; then
  echo 'Android dependencies: online mode; existing SDK and Gradle caches are retained.'
  gradle --no-daemon --stacktrace :app:testDebugUnitTest :app:assembleDebug
else
  echo "Android dependencies: trying offline build (ANDROID_BUILD_OFFLINE=$offline)."
  log="$temporary/volna-offline-build.log"
  if gradle --offline --no-daemon --stacktrace :app:testDebugUnitTest :app:assembleDebug >"$log" 2>&1; then
    cat "$log"
    echo 'Android dependencies: local repository; build completed offline.'
  else
    # Offline plugin resolution may report UnknownPluginException without saying "offline".
    if [ "$offline" = auto ] && grep -Eiq 'offline mode|No cached version|No cached resource|not available for offline|org\.gradle\.api\.plugins\.UnknownPluginException|could not resolve plugin artifact|Plugin \[.*\] was not found in any of the following sources' "$log"; then
      echo 'Some dependencies are new. Downloading missing packages into the local repository.'
      echo 'Retrying once online, including Gradle plugin resolution; cached packages are retained.'
      gradle --no-daemon --stacktrace :app:testDebugUnitTest :app:assembleDebug
    else
      cat "$log" >&2
      if [ "$offline" = 1 ]; then echo 'Strict offline mode: no online retry. Populate the cache with ANDROID_BUILD_OFFLINE=0.' >&2; fi
      exit 1
    fi
  fi
fi
apk=app/build/outputs/apk/debug/app-debug.apk
# Check the compiled, merged manifest before exporting an APK for publication.
permissions=$("$ANDROID_HOME/build-tools/36.0.0/aapt2" dump permissions "$apk")
for permission in android.permission.INTERNET android.permission.ACCESS_NETWORK_STATE android.permission.USE_FULL_SCREEN_INTENT; do
  if ! printf '%s\n' "$permissions" | grep -Fq "uses-permission: name='$permission'"; then
    echo "Android APK is missing required permission: $permission. Publication stopped." >&2
    exit 1
  fi
done
echo 'Verified Android network permissions in compiled APK.'
python3 scripts/check-apk-version.py "$ANDROID_HOME/build-tools/36.0.0/aapt2" "$apk" app/build.gradle.kts
unzip -l "$apk" | grep -Fq 'assets/emoji/NotoColorEmoji.ttf' || { echo 'APK is missing bundled emoji graphics.' >&2; exit 1; }
unzip -l "$apk" | grep -Fq 'assets/emoji/catalog.json' || { echo 'APK is missing the emoji catalog.' >&2; exit 1; }
install -D -m 0644 "$apk" "${ANDROID_OUTPUT_DIR:-/out}/Volna-debug.apk"
