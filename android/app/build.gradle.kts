import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ./gradlew -Pscreenshots :app:recordPaparazziDebug renders the screens in src/screenshotTest to
// app/src/test/snapshots. It is a review aid, not a device test: layoutlib is not a phone.
val screenshots = project.hasProperty("screenshots")
if (screenshots) apply(plugin = "app.cash.paparazzi")

// Release signing: set ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
// (environment or android/keystore.properties). Without them the release APK is signed with the debug key so it
// still installs for testing, and the build prints a warning.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signing(key: String): String? = System.getenv(key) ?: keystoreProps.getProperty(key)
val releaseKeystore = signing("ANDROID_KEYSTORE_PATH")

// Development-only cleartext allowlist for debug builds: a comma-separated list of hosts (e.g. a laptop's LAN IP
// 192.168.1.20) the debug app may call over plain http://. Read from `omega.devHttpHosts` in android/local.properties
// (not committed) or GATEWAY_DEV_HTTP_HOSTS in the environment. Release builds never get it: HTTPS stays mandatory.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val devHttpHosts: String = (System.getenv("GATEWAY_DEV_HTTP_HOSTS") ?: localProps.getProperty("omega.devHttpHosts") ?: "").trim()

android {
    namespace = "zw.co.omega.gateway"
    compileSdk = 35

    defaultConfig {
        applicationId = "zw.co.omega.gateway"
        minSdk = 24          // Android 7.0: old phones are the point of this app
        targetSdk = 35
        versionCode = 9
        versionName = "1.8.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Default server pre-filled on the activation screen; the user can change it.
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"${System.getenv("GATEWAY_DEFAULT_SERVER_URL") ?: "https://omega-security-gamma.vercel.app"}\"")
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = signing("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signing("ANDROID_KEY_ALIAS")
                keyPassword = signing("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "DEV_HTTP_HOSTS", "\"${devHttpHosts.replace("\"", "")}\"")
            if (devHttpHosts.isNotEmpty()) logger.lifecycle("Debug build: plain http allowed for development hosts [$devHttpHosts]")
        }
        release {
            buildConfigField("String", "DEV_HTTP_HOSTS", "\"\"") // never any cleartext host in release
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (releaseKeystore != null) signingConfigs.getByName("release") else {
                logger.warn("WARNING: no release keystore configured (ANDROID_KEYSTORE_PATH); signing the release APK with the debug key.")
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true; viewBinding = true }
    sourceSets["main"].java.srcDirs("src/main/kotlin")
    sourceSets["test"].java.srcDirs(listOfNotNull("src/test/kotlin", if (screenshots) "src/screenshotTest/kotlin" else null))
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // real org.json for JVM unit tests (the Android SDK stub throws)
}
