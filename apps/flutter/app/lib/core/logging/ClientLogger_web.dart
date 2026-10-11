// ignore_for_file: file_names

import 'dart:convert';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

import 'ClientLogLevel.dart';

const String _logStorageKey = 'operit2.client.log';
bool _initialized = false;

Future<void> initialize() async {
  _initialized = true;
}

/// Keeps browser logging on the existing localStorage sink.
void attachPersistentStorage() {}

/// Returns whether the browser logger has been initialized.
bool isInitialized() => _initialized;

/// Returns whether this backend already mirrors writes to a live console.
bool writesToConsole() => true;

Future<String> logFilePath() async {
  return 'localStorage:$_logStorageKey';
}

Future<String> readText() async {
  return web.window.localStorage.getItem(_logStorageKey) ?? '';
}

String? lastWriteError() => null;

Future<void> clear() async {
  web.window.localStorage.removeItem(_logStorageKey);
}

void write(
  ClientLogLevel level,
  String message, {
  bool writeToConsole = true,
  Object? error,
  StackTrace? stackTrace,
}) {
  final buffer = StringBuffer(message);
  if (error != null) {
    buffer
      ..write(' error=')
      ..write(error);
  }
  if (stackTrace != null) {
    buffer
      ..write('\n')
      ..write(stackTrace);
  }
  final text = buffer.toString();
  if (writeToConsole) {
    switch (level) {
      case ClientLogLevel.error:
      case ClientLogLevel.assert_:
        web.console.error(text.toJS);
      case ClientLogLevel.warn:
        web.console.warn(text.toJS);
      case ClientLogLevel.verbose:
      case ClientLogLevel.debug:
      case ClientLogLevel.info:
        web.console.log(text.toJS);
    }
  }
  final current = web.window.localStorage.getItem(_logStorageKey) ?? '';
  final next = current.isEmpty ? text : '$current\n$text';
  web.window.localStorage.setItem(_logStorageKey, _trimUtf8(next, 256 * 1024));
}

String _trimUtf8(String value, int maxBytes) {
  var bytes = utf8.encode(value);
  if (bytes.length <= maxBytes) {
    return value;
  }
  bytes = bytes.sublist(bytes.length - maxBytes);
  return utf8.decode(bytes, allowMalformed: true);
}
