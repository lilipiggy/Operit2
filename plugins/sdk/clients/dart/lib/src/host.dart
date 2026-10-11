import 'dart:async';
import 'dart:ffi';
import 'dart:isolate';
import 'dart:typed_data';
import 'package:ffi/ffi.dart';

/// Owns a worker isolate running the SDK's native platform carrier.
final class PluginSdkHost {
  /// Creates a connection over an SDK-owned worker command port.
  PluginSdkHost._(this._commands, this.messages);
  final SendPort _commands;
  final Stream<Uint8List> messages;

  /// Activates the installed Operit app through the packaged native SDK library.
  static Future<PluginSdkHost> connect(String libraryPath) async {
    final incoming = ReceivePort();
    final ready = Completer<SendPort>();
    final messages = StreamController<Uint8List>();
    incoming.listen((event) {
      if (event is SendPort) {
        ready.complete(event);
      } else if (event is Uint8List) {
        messages.add(event);
      } else {
        if (event is String) {
          final error = StateError(event);
          if (!ready.isCompleted) {
            ready.completeError(error);
          } else {
            messages.addError(error);
          }
        }
        incoming.close();
        messages.close();
      }
    });
    try {
      await Isolate.spawn(_runHost, (libraryPath, incoming.sendPort));
      return PluginSdkHost._(await ready.future, messages.stream);
    } catch (_) {
      incoming.close();
      unawaited(messages.close());
      rethrow;
    }
  }

  /// Queues an envelope in order on the native worker.
  void send(Uint8List bytes) => _commands.send(bytes);

  /// Ends the native session and terminates its worker.
  void close() => _commands.send(null);
}

/// Runs activation, blocking writes and envelope polling outside the caller's isolate.
void _runHost((String, SendPort) start) {
  final (path, output) = start;
  try {
    final lib = DynamicLibrary.open(path);
    final connect = lib.lookupFunction<Uint64 Function(), int Function()>(
      'operit_sdk_connect',
    );
    final send = lib
        .lookupFunction<
          Int32 Function(Uint64, Pointer<Uint8>, Size),
          int Function(int, Pointer<Uint8>, int)
        >('operit_sdk_send');
    final next = lib
        .lookupFunction<
          Int32 Function(
            Uint64,
            Uint32,
            Pointer<Pointer<Uint8>>,
            Pointer<Size>,
          ),
          int Function(int, int, Pointer<Pointer<Uint8>>, Pointer<Size>)
        >('operit_sdk_next');
    final free = lib
        .lookupFunction<
          Void Function(Pointer<Uint8>, Size),
          void Function(Pointer<Uint8>, int)
        >('operit_sdk_free');
    final close = lib.lookupFunction<Int32 Function(Uint64), int Function(int)>(
      'operit_sdk_close',
    );
    final error = lib
        .lookupFunction<Pointer<Utf8> Function(), Pointer<Utf8> Function()>(
          'operit_sdk_error',
        );
    final handle = connect();
    if (handle == 0) throw StateError(error().toDartString());
    final commands = ReceivePort();
    final bytesOut = calloc<Pointer<Uint8>>();
    final lengthOut = calloc<Size>();
    Timer? timer;
    var closed = false;

    /// Releases native resources and reports the final connection state.
    void finish([Object? failure]) {
      if (closed) return;
      closed = true;
      timer?.cancel();
      commands.close();
      final status = close(handle);
      final closeError = status < 0 ? error().toDartString() : null;
      calloc.free(bytesOut);
      calloc.free(lengthOut);
      output.send(failure?.toString() ?? closeError);
    }

    commands.listen((event) {
      if (event == null) {
        finish();
        return;
      }
      final bytes = event as Uint8List;
      final memory = calloc<Uint8>(bytes.length);
      try {
        memory.asTypedList(bytes.length).setAll(0, bytes);
        if (send(handle, memory, bytes.length) < 0) {
          finish(error().toDartString());
        }
      } finally {
        calloc.free(memory);
      }
    });
    timer = Timer.periodic(const Duration(milliseconds: 10), (_) {
      for (var count = 0; count < 64; count++) {
        final status = next(handle, 0, bytesOut, lengthOut);
        if (status == 0) return;
        if (status < 0) {
          finish(error().toDartString());
          return;
        }
        try {
          output.send(
            Uint8List.fromList(bytesOut.value.asTypedList(lengthOut.value)),
          );
        } finally {
          free(bytesOut.value, lengthOut.value);
        }
      }
    });
    output.send(commands.sendPort);
  } catch (error) {
    output.send(error.toString());
  }
}
