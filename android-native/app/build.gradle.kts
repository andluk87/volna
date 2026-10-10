plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val apiUrl = (project.findProperty("volnaApiUrl") as String?)
    ?: System.getenv("ANDROID_API_URL")
    ?: ""
require(apiUrl.startsWith("https://")) { "Set ANDROID_API_URL to your Volna HTTPS base URL" }
val safeApiUrl = apiUrl.trimEnd('/')
val volnaVersionCode = 12_024
val volnaVersionName = "0.12.24"
val volnaWebRtcVersion = "150.7871.01"

android {
    namespace = "dev.volna.messenger"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "dev.volna.messenger"
        minSdk = 26
        targetSdk = 36
        versionCode = volnaVersionCode
        versionName = volnaVersionName
        buildConfigField("String", "API_BASE_URL", "\"$safeApiUrl\"")
        buildConfigField("long", "VOLNA_VERSION_CODE", "${volnaVersionCode}L")
        buildConfigField("String", "WEBRTC_VERSION", "\"$volnaWebRtcVersion\"")
    }

    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-savedstate:2.9.1")
    implementation("com.google.android.gms:play-services-auth-api-phone:18.2.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.googlecode.libphonenumber:libphonenumber:8.13.55")
    implementation("io.github.webrtc-sdk:android:$volnaWebRtcVersion")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-gif:2.7.0")
    implementation("io.coil-kt:coil-video:2.7.0")
    implementation("dev.chrisbanes.haze:haze:1.5.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("org.json:json:20250517")
}
