// Top-level build file for the Security Gateway Android app.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    // Screenshots of the real layouts rendered on the JVM, for reviewing the UI without a phone.
    // Only applied with -Pscreenshots (see app/build.gradle.kts); never part of a normal build.
    id("app.cash.paparazzi") version "1.3.5" apply false
}
