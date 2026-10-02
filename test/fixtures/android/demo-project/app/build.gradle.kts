plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.acme.notes"
    defaultConfig {
        applicationId = "com.acme.notes"
    }
    buildFeatures { viewBinding = true; compose = true }
}
