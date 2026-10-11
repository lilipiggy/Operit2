# Operit Plugin SDK

This client is generated from the canonical Core proxy scan. Its public object
clients send existing `call`, `watch`, and `push` Link requests through the
built-in framed IPC connection. Application code supplies values and invokes
the generated methods; it does not implement a Plugin SDK transport.

Run the package-manager example with:

```shell
dart run example/package_manager.dart
```

The example reads loading progress, package metadata, and a package logo. The
tool invocation section is commented until a real package and tool name are
selected by the integrating application.

Connect using `OperitPluginSdkClient.connect()` and call `sdk.close()` when done.
The package activates Operit using its built-in native host. Android's Flutter
plugin supplies the application context automatically. Desktop applications
bundle `native/liboperit_plugin_sdk.so` in their native library search path;
custom deployments can pass `nativeLibraryPath` to `connect`. Build and stage
this artifact with `plugins/sdk/build_native.py` as described in the SDK root
README. No socket address or user-supplied transport is required.
