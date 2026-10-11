import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:desktop_widgets_platform_interface/desktop_widgets_platform_interface.dart';

/// Captures a mounted, explicitly ready content surface for system-widget publication.
class DesktopWidgetSnapshotController {
  final _key = GlobalKey();
  bool ready = false;

  /// Produces bounded PNG pixels without capturing surrounding application chrome.
  Future<DesktopWidgetSnapshot> capture({
    required String action,
    required Map<String, Object?> actionArguments,
    required String description,
  }) async {
    if (!ready) throw StateError('Widget content has not finished rendering');
    await WidgetsBinding.instance.endOfFrame;
    final context = _key.currentContext;
    if (context == null || !ready)
      throw StateError('Widget content is no longer available');
    final boundary = context.findRenderObject()! as RenderRepaintBoundary;
    final size = boundary.size;
    if (size.isEmpty ||
        size.width > 1024 ||
        size.height > 1024 ||
        size.width.ceil() * size.height.ceil() > 262144) {
      throw StateError(
        'Widget snapshots must be between 1 and 1024 logical pixels',
      );
    }
    final image = await boundary.toImage(pixelRatio: 1);
    try {
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) throw StateError('Unable to encode the widget image');
      return DesktopWidgetSnapshot(
        png: bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes),
        action: action,
        actionArguments: actionArguments,
        description: description,
      );
    } finally {
      image.dispose();
    }
  }
}

/// Marks only reusable widget content as a capturable transparent surface.
class DesktopWidgetSnapshotSurface extends StatelessWidget {
  /// Associates a capture controller with the application-owned Flutter content.
  const DesktopWidgetSnapshotSurface({
    super.key,
    required this.controller,
    required this.child,
  });
  final DesktopWidgetSnapshotController controller;
  final Widget child;

  /// Isolates content pixels from gallery cards, labels, and add buttons.
  @override
  Widget build(BuildContext context) =>
      RepaintBoundary(key: controller._key, child: child);
}
