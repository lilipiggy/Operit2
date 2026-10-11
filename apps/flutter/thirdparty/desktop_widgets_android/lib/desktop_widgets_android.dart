import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:desktop_widgets_platform_interface/desktop_widgets_platform_interface.dart';

/// Publishes Flutter snapshots as actual Android launcher widgets, not overlays.
class DesktopWidgetsAndroid extends DesktopWidgetsPlatform
    with WidgetsBindingObserver {
  static const _channel = MethodChannel('desktop_widgets/appwidget');
  int _actionRevision = 0;
  int _renderRevision = 0;
  Future<DesktopWidgetSnapshot> Function(
    Map<String, Object?> payload,
    Size size,
  )?
  _renderer;
  Timer? _refreshTimer;
  Future<void> _renderTail = Future<void>.value();
  Future<void>? _refreshing;

  /// Owns renderer registration and refresh scheduling within this host implementation.
  @override
  Future<void> setSnapshotRenderer(
    Future<DesktopWidgetSnapshot> Function(
      Map<String, Object?> payload,
      Size size,
    )?
    renderer,
  ) async {
    _renderRevision++;
    _refreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _renderer = renderer;
    if (renderer == null) return;
    WidgetsBinding.instance.addObserver(this);
    _refreshTimer = Timer.periodic(const Duration(minutes: 30), (_) {
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed)
        _scheduleRefresh();
    });
    await refreshSnapshots();
  }

  /// Refreshes published data when the application becomes active again.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _renderer != null)
      _scheduleRefresh();
  }

  /// Reports scheduled refresh errors instead of silently preserving stale content.
  void _scheduleRefresh() {
    unawaited(
      refreshSnapshots().catchError((Object error, StackTrace stack) {
        FlutterError.reportError(
          FlutterErrorDetails(
            exception: error,
            stack: stack,
            library: 'desktop_widgets',
          ),
        );
      }),
    );
  }

  /// Serializes content work while propagating each operation's own failure.
  Future<T> _enqueue<T>(Future<T> Function() operation) async {
    final previous = _renderTail;
    final finished = Completer<void>();
    _renderTail = finished.future;
    await previous;
    try {
      return await operation();
    } finally {
      finished.complete();
    }
  }

  /// Executes fresh content and rejects results whose renderer owner has changed.
  Future<DesktopWidgetSnapshot> _render(
    Map<String, Object?> payload,
    Size size,
  ) async {
    final renderer = _renderer;
    final revision = _renderRevision;
    if (renderer == null)
      throw StateError(
        'Register a system-widget content renderer before publication',
      );
    final frame = await renderer(payload, size);
    if (revision != _renderRevision)
      throw StateError('The widget renderer changed during rendering');
    return frame;
  }

  /// Reloads confirmed publications and reruns their content providers without a gallery.
  @override
  Future<void> refreshSnapshots() {
    final pending = _refreshing;
    if (pending != null) return pending;
    final future = _enqueue<void>(() async {
      final records = await _channel.invokeListMethod<Object?>('listSnapshots');
      if (records == null)
        throw StateError('The host omitted its widget publications');
      final failures = <String>[];
      for (final raw in records) {
        final record = (raw as Map).cast<String, Object?>();
        final id = record['id'] as String;
        try {
          final frame = await _render(
            (record['payload'] as Map).cast<String, Object?>(),
            Size(
              (record['width'] as num).toDouble(),
              (record['height'] as num).toDouble(),
            ),
          );
          await invoke<void>(id, 'updateSnapshot', frame.toMap());
        } catch (error) {
          failures.add('$id: $error');
          await _channel.invokeMethod<void>('renderFailed', {
            'id': id,
            'message': error.toString(),
          });
        }
      }
      if (failures.isNotEmpty) throw StateError(failures.join('\n'));
    });
    _refreshing = future;
    return future.whenComplete(() {
      _refreshing = null;
    });
  }

  /// Installs the implementation through Flutter's generated plugin registrant.
  static void registerWith() =>
      DesktopWidgetsPlatform.instance = DesktopWidgetsAndroid();

  /// Android launcher widgets never start an interactive Flutter window engine.
  @override
  DesktopWidgetLaunch? parseLaunch(List<String> arguments) => null;

  /// Requires a launcher supporting the explicit pin-widget confirmation flow.
  @override
  Future<void> requireSupport() =>
      _channel.invokeMethod<void>('requireSupport');

  /// Publishes a completed snapshot and asks the launcher for user confirmation.
  @override
  Future<String> open(
    Map<String, Object?> payload,
    Future<Object?> Function(MethodCall call) onAction,
  ) async {
    await requireSupport();
    final frame = await _enqueue(() => _render(payload, const Size(360, 240)));
    final id = await _channel.invokeMethod<String>('pin', {
      'payload': payload,
      'frame': frame.toMap(),
    });
    if (id == null)
      throw StateError('The launcher did not accept the pin request');
    return id;
  }

  /// Delivers persisted widget clicks only after an application handler is ready.
  @override
  Future<void> setActionHandler(
    Future<Object?> Function(MethodCall call)? handler,
  ) async {
    final revision = ++_actionRevision;
    await _channel.invokeMethod<void>('actionsReady', false);
    if (revision != _actionRevision) return;
    _channel.setMethodCallHandler(handler);
    if (handler != null)
      await _channel.invokeMethod<void>('actionsReady', true);
  }

  /// Publishes replacement pixels for all launcher instances of a returned identity.
  @override
  Future<T?> invoke<T>(String id, String method, Object? arguments) {
    if (method != 'updateSnapshot')
      throw UnsupportedError('System widgets accept updateSnapshot only');
    return _channel.invokeMethod<T>('updateSnapshot', {
      'id': id,
      'frame': arguments,
    });
  }

  /// Rejects engine creation because Android widgets are owned by the launcher.
  @override
  Future<String> create(String arguments) =>
      Future.error(UnsupportedError('Use open with a snapshot provider'));

  /// Rejects window configuration for a launcher-owned widget.
  @override
  Future<void> configure(Size size) =>
      Future.error(UnsupportedError('The launcher owns widget sizing'));

  /// Rejects showing windows because placement is confirmed by the launcher.
  @override
  Future<void> show() =>
      Future.error(UnsupportedError('The launcher owns widget visibility'));

  /// Rejects programmatic movement of launcher-owned widgets.
  @override
  Future<void> move() =>
      Future.error(UnsupportedError('Move the widget in the launcher'));

  /// Rejects programmatic resizing of launcher-owned widgets.
  @override
  Future<void> resize(Size size) =>
      Future.error(UnsupportedError('Resize the widget in the launcher'));

  /// Rejects removal without the launcher's user-controlled removal flow.
  @override
  Future<void> close() =>
      Future.error(UnsupportedError('Remove the widget in the launcher'));

  /// Rejects engine messaging because no Dart engine lives in RemoteViews.
  @override
  Future<void> setMessageHandler(
    Future<Object?> Function(MethodCall call)? handler,
  ) => Future.error(
    UnsupportedError(
      'Use application-lifetime action handling for system widgets',
    ),
  );
}
