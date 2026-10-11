package operit.plugin.sdk

import android.content.Context

/** Owns the process-level Android binding used by the packaged native SDK. */
private object AndroidSdkBinding {
    private var client: OperitPluginSdkAndroidHost? = null

    /** Registers the Android application context exactly once for the SDK process. */
    @Synchronized
    fun install(context: Context) {
        if (client != null) return
        val created = OperitPluginSdkAndroidHost(context.applicationContext)
        OperitPluginSdkHost.installAndroidClient(created)
        client = created
    }
}

/** Connects from an Android application through the empty Activity and Binder service. */
suspend fun OperitPluginSdkClient.Companion.connect(context: Context): OperitPluginSdkClient {
    AndroidSdkBinding.install(context)
    return connect()
}
