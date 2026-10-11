package operit.plugin.sdk.flutter

import io.flutter.embedding.engine.plugins.FlutterPlugin
import operit.plugin.sdk.OperitPluginSdkHost
import operit.plugin.sdk.OperitPluginSdkAndroidHost

/** Registers the Android Context for the same native SDK library used by Dart FFI. */
class OperitPluginSdkFlutterPlugin : FlutterPlugin {
    private var client: OperitPluginSdkAndroidHost? = null

    /** Supplies Android activation to the Rust host before Dart opens a session. */
    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        val created = OperitPluginSdkAndroidHost(binding.applicationContext)
        OperitPluginSdkHost.installAndroidClient(created)
        client = created
    }

    /** Releases the process binding when this Flutter engine detaches. */
    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        client?.close()
        client = null
    }
}
