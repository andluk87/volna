FROM gradle:8.14.3-jdk21
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates python3 && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_USER_HOME=/root/.android GRADLE_USER_HOME=/root/.gradle
ENV PATH=$PATH:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools
WORKDIR /app
COPY android-native/ ./
COPY client/scripts/docker-android-build.sh ./scripts/docker-android-build.sh
ARG ANDROID_API_URL
ENV ANDROID_API_URL=$ANDROID_API_URL
RUN test -n "$ANDROID_API_URL" && echo "$ANDROID_API_URL" | grep -Eq '^https://[^[:space:]]+$'
CMD ["sh", "scripts/docker-android-build.sh"]
