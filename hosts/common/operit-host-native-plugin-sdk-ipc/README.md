# Plugin SDK platform IPC

The common crate provides Link framing, pipe-session ownership and the in-process
test carrier. Activation and transport registration belong to platform hosts.

| Host | Activation | Session transport |
| --- | --- | --- |
| Android | `PluginSdkActivationActivity`, then a bound `PluginSdkService` | IBinder transfers two anonymous pipe descriptors |
| Linux | session D-Bus activation of `org.operit.PluginSdk` | `Open` transfers two anonymous pipe descriptors |
| Windows | registered `operit2://plugin-sdk` protocol | Windows named pipe |

Operit must be installed and its local storage/identity configured. Windows and
Linux register activation for their current executable when the app starts.
Moving an installed bundle requires launching it once at the new location.
The SDK never asks callers to start a socket listener. Pipes carry the existing
four-byte big-endian length followed by the Link frame (maximum 32 MiB).

The public clients in `plugins/sdk` own platform selection and activation.
Kotlin Android uses `OperitPluginSdkClient.connect(context)`; the Flutter SDK
registers its Android context through its Android plugin. Android activation
requires a visible integrating app. Activation reports unconfigured storage and
Core startup errors to the caller. See `plugins/sdk/README.md` for native SDK
packaging and the Rust, Kotlin, Dart and TypeScript entry points.

Linux integration check (inside a disposable session bus):

```sh
RUSTFLAGS=-Awarnings dbus-run-session -- cargo test --manifest-path hosts/linux/Cargo.toml --lib plugin_sdk_ipc::tests::dbus_pipe_session_lifecycle
```

Apple's existing Unix carrier is isolated in `hosts/apple/src/plugin_sdk_ipc.rs`;
Apple process activation has not been implemented by this change.
