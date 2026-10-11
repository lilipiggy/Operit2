import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Paints fresh content outside the visible overlay without depending on a gallery preview.
class DesktopWidgetRasterizer {
  /// Prevents construction of the stateless render utility.
  const DesktopWidgetRasterizer._();

  /// Captures a bounded content tree with the application's real view, theme, and locale.
  static Future<Uint8List> render({
    required BuildContext context,
    required Widget child,
    required Size size,
  }) async {
    if (!size.width.isFinite ||
        !size.height.isFinite ||
        size.width < 1 ||
        size.height < 1 ||
        size.width.ceil() * size.height.ceil() > 262144) {
      throw ArgumentError.value(
        size,
        'size',
        'Widget frames must contain at most 262144 pixels',
      );
    }
    final overlay = Overlay.of(context, rootOverlay: true);
    final key = GlobalKey();
    final content = InheritedTheme.captureAll(
      context,
      MediaQuery(
        data: MediaQuery.of(context).copyWith(size: size, devicePixelRatio: 1),
        child: Localizations.override(context: context, child: child),
      ),
    );
    final entry = OverlayEntry(
      builder: (_) => Positioned(
        left: -size.width - 1,
        top: 0,
        width: size.width,
        height: size.height,
        child: IgnorePointer(
          child: ExcludeSemantics(
            child: ExcludeFocus(
              child: RepaintBoundary(key: key, child: content),
            ),
          ),
        ),
      ),
    );
    overlay.insert(entry);
    try {
      await WidgetsBinding.instance.endOfFrame;
      if (!context.mounted || key.currentContext == null) {
        throw StateError('The widget render host was removed');
      }
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 1);
      try {
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        if (png == null) throw StateError('Unable to encode widget content');
        return png.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes);
      } finally {
        image.dispose();
      }
    } finally {
      entry.remove();
      entry.dispose();
    }
  }
}
