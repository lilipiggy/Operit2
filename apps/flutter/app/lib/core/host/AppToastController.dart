// ignore_for_file: file_names

import 'package:flutter/foundation.dart';

/// Identifies one application-owned transient toast message.
class AppToastMessage {
  /// Creates one sequenced toast message.
  const AppToastMessage({required this.id, required this.text});

  final int id;
  final String text;
}

/// Owns process-wide toast state presented inside the Flutter application.
class AppToastController {
  /// Creates the process-wide application toast controller.
  AppToastController._();

  static final AppToastController instance = AppToastController._();

  final ValueNotifier<AppToastMessage?> _message =
      ValueNotifier<AppToastMessage?>(null);
  int _nextId = 0;

  /// Exposes the active toast without allowing external mutation.
  ValueListenable<AppToastMessage?> get message => _message;

  /// Publishes a new application-owned toast.
  void show(String text) {
    final normalized = text.trim();
    if (normalized.isEmpty) {
      throw ArgumentError.value(text, 'text', 'toast text must not be empty');
    }
    _message.value = AppToastMessage(id: ++_nextId, text: normalized);
  }

  /// Dismisses the toast only when it still matches the requested message.
  void dismiss(int id) {
    if (_message.value?.id == id) {
      _message.value = null;
    }
  }
}
