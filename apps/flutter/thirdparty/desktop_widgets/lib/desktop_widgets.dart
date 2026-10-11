library;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:desktop_widgets_platform_interface/desktop_widgets_platform_interface.dart';
export 'package:desktop_widgets_platform_interface/desktop_widgets_platform_interface.dart';
export 'src/snapshot_surface.dart';
export 'src/widget_rasterizer.dart';

/// Owns launch dispatch so applications never select widget platform or engine paths.
class DesktopWidgets {
  /// Prevents construction of the bootstrap facade.
  const DesktopWidgets._();
  static Future<Object?> Function(MethodCall call)? _actionHandler;

  /// Delivers owner messages through the application-lifetime callback registered once.
  static Future<Object?> dispatchAction(MethodCall call) async {
    final handler = _actionHandler;
    if (handler == null)
      throw StateError('No widget action handler is registered');
    return handler(call);
  }

  /// Supplies system-widget content without selecting a platform in application code.
  static Future<void> setSnapshotRenderer(
    Future<DesktopWidgetSnapshot> Function(
      Map<String, Object?> payload,
      Size size,
    )?
    renderer,
  ) => DesktopWidgetsPlatform.instance.setSnapshotRenderer(renderer);

  /// Requests fresh content for persisted system widgets.
  static Future<void> refreshSnapshots() =>
      DesktopWidgetsPlatform.instance.refreshSnapshots();

  /// Registers application-lifetime actions without inspecting the active platform.
  static Future<void> setActionHandler(
    Future<Object?> Function(MethodCall call)? handler,
  ) async {
    _actionHandler = handler;
    await DesktopWidgetsPlatform.instance.setActionHandler(
      handler == null ? null : dispatchAction,
    );
  }

  /// Starts either the supplied application or the plugin-owned widget lifecycle.
  static Future<void> run({
    required List<String> arguments,
    required Future<void> Function() application,
    required Widget Function(DesktopWidgetLaunch launch) widgetBuilder,
  }) async {
    final launch = parseLaunch(arguments);
    if (launch == null) {
      await application();
      return;
    }
    await DesktopWidgetWindow.configure();
    runApp(widgetBuilder(launch));
    await WidgetsBinding.instance.endOfFrame;
    await DesktopWidgetWindow.show();
  }

  /// Recognizes only this plugin's explicit secondary-engine launch envelope.
  static DesktopWidgetLaunch? parseLaunch(List<String> arguments) =>
      DesktopWidgetsPlatform.instance.parseLaunch(arguments);
}

/// Public identity for a content-only desktop widget window.
class DesktopWidgetWindow {
  /// Wraps an engine window identifier without exposing platform window handles.
  const DesktopWidgetWindow._(this.id);

  final String id;

  /// Checks the installed host's ability to compose transparent desktop content.
  static Future<void> requireSupport() =>
      DesktopWidgetsPlatform.instance.requireSupport();

  /// Creates a hidden engine; its entrypoint must prepare and show the widget surface.
  static Future<DesktopWidgetWindow> create({required String arguments}) async {
    return DesktopWidgetWindow._(
      await DesktopWidgetsPlatform.instance.create(arguments),
    );
  }

  /// Opens a widget with opaque application data and routes actions to the owner.
  static Future<DesktopWidgetWindow> open({
    required Map<String, Object?> payload,
  }) async {
    return DesktopWidgetWindow._(
      await DesktopWidgetsPlatform.instance.open(
        payload,
        DesktopWidgets.dispatchAction,
      ),
    );
  }

  /// Marks and prepares the current secondary engine as a transparent widget window.
  static Future<void> configure({Size size = const Size(360, 240)}) async {
    _validateSize(size);
    await DesktopWidgetsPlatform.instance.configure(size);
  }

  /// Reveals the configured engine after the application has painted its transparent root.
  static Future<void> show() => DesktopWidgetsPlatform.instance.show();

  /// Starts native pointer-driven movement without a permanent title bar.
  static Future<void> move() => DesktopWidgetsPlatform.instance.move();

  /// Resizes only the current widget window in logical pixels.
  static Future<void> resize(Size size) async {
    _validateSize(size);
    await DesktopWidgetsPlatform.instance.resize(size);
  }

  /// Closes the current widget window and destroys its owned engine.
  static Future<void> close() => DesktopWidgetsPlatform.instance.close();

  /// Sends an application-defined message to this widget's Dart engine.
  Future<T?> invoke<T>(String method, [Object? arguments]) =>
      DesktopWidgetsPlatform.instance.invoke<T>(id, method, arguments);

  /// Installs application-defined refresh or content messages for the current engine.
  static Future<void> setMessageHandler(
    Future<Object?> Function(MethodCall call)? handler,
  ) => DesktopWidgetsPlatform.instance.setMessageHandler(handler);

  /// Rejects non-finite or unusable surface dimensions before reaching native code.
  static void _validateSize(Size size) {
    if (!size.width.isFinite ||
        !size.height.isFinite ||
        size.width < 120 ||
        size.height < 120 ||
        size.width > 2048 ||
        size.height > 2048) {
      throw ArgumentError.value(
        size,
        'size',
        'Dimensions must be between 120 and 2048 logical pixels',
      );
    }
  }
}
