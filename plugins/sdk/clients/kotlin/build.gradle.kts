plugins {
    kotlin("jvm") version "2.0.21"
}

repositories { mavenCentral() }

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.2")
    implementation("org.msgpack:jackson-dataformat-msgpack:0.9.8")
}
