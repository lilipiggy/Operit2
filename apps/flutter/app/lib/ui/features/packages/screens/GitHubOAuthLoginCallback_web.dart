// ignore_for_file: file_names, deprecated_member_use, avoid_web_libraries_in_flutter

import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;

const String _githubOAuthCompletionStorageKey =
    'operit.github.oauth.completion.v1';

/// Relays a web callback tab to the original Operit tab through same-origin storage.
void consumeGitHubOAuthWebCallbackAtStartup() {
  final uri = Uri.base;
  final transactionId = uri.queryParameters['transactionId']?.trim();
  final status = uri.queryParameters['status']?.trim();
  if (transactionId == null ||
      transactionId.isEmpty ||
      !_isTerminalStatus(status)) {
    return;
  }
  final payload = jsonEncode(<String, String>{
    'completionUrl': uri.toString(),
    'nonce': DateTime.now().microsecondsSinceEpoch.toString(),
  });
  html.window.localStorage.remove(_githubOAuthCompletionStorageKey);
  html.window.localStorage[_githubOAuthCompletionStorageKey] = payload;
}

/// Owns the same-origin callback relay used by an external web login.
class GitHubOAuthLoginCallback {
  GitHubOAuthLoginCallback._({required this.redirectUri}) {
    _storageSubscription = html.window.onStorage.listen(_handleStorageEvent);
  }

  /// Creates a callback on the current web app origin.
  static Future<GitHubOAuthLoginCallback> create(
    Uri requestedRedirectUri,
  ) async {
    if (requestedRedirectUri.scheme != 'https' ||
        requestedRedirectUri.host.isEmpty ||
        requestedRedirectUri.path.isEmpty) {
      throw StateError('GitHub OAuth callback template is invalid');
    }
    final currentUri = Uri.base;
    final scheme = currentUri.scheme.toLowerCase();
    if ((scheme != 'http' && scheme != 'https') || currentUri.host.isEmpty) {
      throw StateError('GitHub external login requires an HTTP web origin');
    }
    return GitHubOAuthLoginCallback._(
      redirectUri: Uri(
        scheme: scheme,
        host: currentUri.host,
        port: currentUri.port == 0 ? null : currentUri.port,
        path: currentUri.path.isEmpty ? '/' : currentUri.path,
      ),
    );
  }

  /// The same-origin page to which the broker redirects after GitHub login.
  final Uri redirectUri;
  final Completer<Uri?> _completion = Completer<Uri?>();
  late final StreamSubscription<html.StorageEvent> _storageSubscription;
  bool _closed = false;

  /// Completes when the callback tab publishes its URL.
  Future<Uri?> get completion => _completion.future;

  /// Stops listening for a callback and resolves the login as cancelled.
  Future<void> close() async {
    if (_closed) {
      return;
    }
    _closed = true;
    await _storageSubscription.cancel();
    if (!_completion.isCompleted) {
      _completion.complete(null);
    }
  }

  /// Accepts only a callback for the origin and path registered for this login.
  void _handleStorageEvent(html.StorageEvent event) {
    if (_closed || event.key != _githubOAuthCompletionStorageKey) {
      return;
    }
    final rawPayload = event.newValue;
    if (rawPayload == null || rawPayload.isEmpty) {
      return;
    }
    try {
      final decoded = jsonDecode(rawPayload);
      if (decoded is! Map) {
        return;
      }
      final rawCompletionUrl = decoded['completionUrl'];
      if (rawCompletionUrl is! String) {
        return;
      }
      final completionUri = Uri.tryParse(rawCompletionUrl);
      if (completionUri == null ||
          !_matchesCallbackDestination(completionUri, redirectUri)) {
        return;
      }
      if (!_completion.isCompleted) {
        _completion.complete(completionUri);
      }
      unawaited(close());
    } on Object {
      // Ignore storage events written by an unrelated page or old app version.
    }
  }
}

bool _matchesCallbackDestination(Uri received, Uri registered) {
  return received.scheme == registered.scheme &&
      received.host == registered.host &&
      received.port == registered.port &&
      received.path == registered.path &&
      received.queryParameters['transactionId']?.trim().isNotEmpty == true &&
      _isTerminalStatus(received.queryParameters['status']);
}

bool _isTerminalStatus(String? status) {
  return status == 'complete' || status == 'denied' || status == 'error';
}
