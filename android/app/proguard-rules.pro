# Keep the model classes used for JSON (hand-written serialisation, no reflection) — nothing special needed.
-keepattributes SourceFile,LineNumberTable
# Tink (used by androidx.security-crypto) references JSR-305 annotations that are not on the Android classpath.
-dontwarn javax.annotation.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn org.checkerframework.**

# Production logging policy: verbose/debug/info logs are stripped from release builds; warnings and errors stay.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
