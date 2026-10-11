// ignore_for_file: file_names

/// Browser builds cannot bind the fixed Codex loopback callback port.
class CodexLoginCallbackListener {
  static Future<CodexLoginCallbackListener> bind() {
    throw UnsupportedError(
      'ChatGPT Codex browser sign-in requires the desktop or mobile app.',
    );
  }

  Future<CodexLoginCallback?> get completion =>
      Future<CodexLoginCallback?>.value(null);

  Future<void> close() async {}
}

class CodexLoginCallback {
  const CodexLoginCallback({required this.code, required this.state});

  final String code;
  final String state;
}
