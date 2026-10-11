package operit.plugin.sdk

/** Calls the SDK-owned host dispatcher shared with Rust, Dart, and Node clients. */
internal object OperitPluginSdkHost {
    init { System.loadLibrary("operit_plugin_sdk") }
    /** Activates Operit and opens the platform carrier. */
    @JvmStatic external fun connect(): Long
    /** Sends an unframed MessagePack envelope. */
    @JvmStatic external fun send(handle: Long, bytes: ByteArray)
    /** Receives an envelope or returns null when the bounded wait expires. */
    @JvmStatic external fun next(handle: Long): ByteArray?
    /** Closes the platform session. */
    @JvmStatic external fun close(handle: Long)
    /** Registers the packaged Android activation client. */
    @JvmStatic external fun installAndroidClient(client: Any)
}
