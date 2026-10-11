import 'dart:convert';
import 'dart:typed_data';
import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// A deliberately rasterized system-widget frame with one persistent click action.
class DesktopWidgetSnapshot {
  /// Keeps PNG pixels and an application-defined action independent of the host.
  const DesktopWidgetSnapshot({
    required this.png,
    required this.action,
    required this.actionArguments,
    required this.description,
  });
  final Uint8List png;
  final String action;
  final Map<String, Object?> actionArguments;
  final String description;

  /// Encodes a frame using Flutter's standard method codec.
  Map<String, Object?> toMap() => {
    'png': png,
    'action': action,
    'actionArguments': actionArguments,
    'description': description,
  };
}

/// Application-independent data supplied by a registered widget host.
class DesktopWidgetLaunch {
  /// Stores the opaque application payload and its owner identity.
  const DesktopWidgetLaunch({required this.ownerId, required this.payload});
  final String ownerId;
  final Map<String, Object?> payload;

  /// Sends an action through the registered host's owner transport.
  Future<T?> invokeOwner<T>(String method, [Object? arguments]) =>
      DesktopWidgetsPlatform.instance.invoke<T>(ownerId, method, arguments);
}

/// Common presentation contract implemented by registered desktop widget hosts.
abstract class DesktopWidgetsPlatform {
  /// Provides the registered native transport; browser hosts can install their own implementation.
  static DesktopWidgetsPlatform instance = MethodChannelDesktopWidgets();

  /// Registers a content renderer for hosts that publish system-widget frames.
  Future<void> setSnapshotRenderer(
    Future<DesktopWidgetSnapshot> Function(
      Map<String, Object?> payload,
      Size size,
    )?
    renderer,
  );

  /// Reexecutes the registered renderer for persisted system-widget publications.
  Future<void> refreshSnapshots();

  /// Decodes a host-owned launch without exposing engine details to applications.
  DesktopWidgetLaunch? parseLaunch(List<String> arguments);

  /// Creates an explicitly hidden widget surface and returns its host identity.
  Future<String> create(String arguments);

  /// Creates a widget with application data and owner action routing.
  Future<String> open(
    Map<String, Object?> payload,
    Future<Object?> Function(MethodCall call) onAction,
  );

  /// Installs application-lifetime actions, including system-widget cold starts.
  Future<void> setActionHandler(
    Future<Object?> Function(MethodCall call)? handler,
  );

  /// Sends an application message to a surface or owner identity.
  Future<T?> invoke<T>(String id, String method, Object? arguments);

  /// Installs a message receiver for the current widget surface.
  Future<void> setMessageHandler(
    Future<Object?> Function(MethodCall call)? handler,
  );

  /// Requires content-only transparent window presentation from this host.
  Future<void> requireSupport();

  /// Configures the current engine's host window with explicit widget ownership.
  Future<void> configure(Size size);

  /// Shows the configured widget surface.
  Future<void> show();

  /// Starts native window movement.
  Future<void> move();

  /// Resizes the widget content surface in logical pixels.
  Future<void> resize(Size size);

  /// Closes the widget's host surface and engine.
  Future<void> close();
}

/// Transports the shared contract to the implementation selected by Flutter registration.
class MethodChannelDesktopWidgets extends DesktopWidgetsPlatform {
  static const _channel = MethodChannel('desktop_widgets/window');
  static const _kind = 'desktop_widgets.window';

  /// Interactive desktop engines render their own content instead of publishing frames.
  @override
  Future<void> setSnapshotRenderer(
    Future<DesktopWidgetSnapshot> Function(
      Map<String, Object?> payload,
      Size size,
    )?
    renderer,
  ) async {}

  /// Interactive desktop engines own their refresh lifecycle inside the widget tree.
  @override
  Future<void> refreshSnapshots() async {}

  /// Decodes the desktop engine's explicit widget launch envelope.
  @override
  DesktopWidgetLaunch? parseLaunch(List<String> arguments) {
    if (arguments.length != 3 || arguments[0] != 'multi_window') return null;
    final encoded = jsonDecode(arguments[2]) as Map<String, Object?>;
    if (encoded['kind'] != _kind) return null;
    return DesktopWidgetLaunch(
      ownerId: encoded['ownerId'] as String,
      payload: (encoded['payload'] as Map).cast<String, Object?>(),
    );
  }

  /// Creates a hidden desktop engine only after host support is verified.
  @override
  Future<String> create(String arguments) async {
    await requireSupport();
    final controller = await WindowController.create(
      WindowConfiguration(hiddenAtLaunch: true, arguments: arguments),
    );
    return controller.windowId;
  }

  /// Associates a desktop child with its owner and opaque application payload.
  @override
  Future<String> open(
    Map<String, Object?> payload,
    Future<Object?> Function(MethodCall call) onAction,
  ) async {
    await requireSupport();
    final owner = await WindowController.fromCurrentEngine();
    await owner.setWindowMethodHandler((call) async {
      await owner.show();
      return onAction(call);
    });
    return create(
      jsonEncode({
        'kind': _kind,
        'ownerId': owner.windowId,
        'payload': payload,
      }),
    );
  }

  /// Desktop engines deliver owner actions through the handler supplied to open.
  @override
  Future<void> setActionHandler(
    Future<Object?> Function(MethodCall call)? handler,
  ) async {}

  /// Sends a message using the desktop engine transport.
  @override
  Future<T?> invoke<T>(String id, String method, Object? arguments) =>
      WindowController.fromWindowId(id).invokeMethod<T>(method, arguments);

  /// Registers the current desktop engine's message receiver.
  @override
  Future<void> setMessageHandler(
    Future<Object?> Function(MethodCall call)? handler,
  ) async {
    final current = await WindowController.fromCurrentEngine();
    await current.setWindowMethodHandler(handler);
  }

  /// Requires an installed host implementation without substituting another presentation.
  @override
  Future<void> requireSupport() =>
      _channel.invokeMethod<void>('requireSupport');

  /// Applies the host's transparent content-window configuration.
  @override
  Future<void> configure(Size size) async {
    final current = await WindowController.fromCurrentEngine();
    if (current.arguments.isEmpty ||
        parseLaunch(['multi_window', current.windowId, current.arguments]) ==
            null) {
      throw StateError(
        'Only a desktop widget engine can configure a widget surface',
      );
    }
    await _channel.invokeMethod<void>('configure', {
      'role': 'desktop_widgets.window',
      'width': size.width,
      'height': size.height,
    });
  }

  /// Reveals the prepared host window.
  @override
  Future<void> show() => _channel.invokeMethod<void>('show');

  /// Delegates interactive movement to the current host.
  @override
  Future<void> move() => _channel.invokeMethod<void>('move');

  /// Changes the content dimensions without changing window identity.
  @override
  Future<void> resize(Size size) => _channel.invokeMethod<void>('resize', {
    'width': size.width,
    'height': size.height,
  });

  /// Destroys the owned surface.
  @override
  Future<void> close() => _channel.invokeMethod<void>('close');
}
