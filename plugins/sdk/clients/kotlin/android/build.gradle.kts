plugins {
    id("com.android.library") version "8.13.1"
    kotlin("android") version "2.2.20"
}
repositories { google(); mavenCentral() }
android {
    namespace = "operit.plugin.sdk"
    compileSdk = 36
    defaultConfig { minSdk = 24; consumerProguardFiles("../consumer-rules.pro") }
    sourceSets["main"].java.srcDirs("../src/main/kotlin", "../src/android/kotlin")
    sourceSets["main"].manifest.srcFile("../../dart/android/src/main/AndroidManifest.xml")
    sourceSets["main"].jniLibs.srcDirs("../src/android/jniLibs")
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.3")
    implementation("org.msgpack:jackson-dataformat-msgpack:0.9.9")
}
