// ignore_for_file: file_names

part of '../ToolPkgUiLauncherScreen.dart';

/// Reports actual painted bounds, including changes caused by ancestor scrolling.
class _PositionReportingBox extends SingleChildRenderObjectWidget {
  /// Creates a geometry observer without changing child layout constraints.
  const _PositionReportingBox({required super.child, required this.onPosition});

  final ValueChanged<Rect> onPosition;

  /// Creates the geometry-aware render proxy.
  @override
  RenderObject createRenderObject(BuildContext context) =>
      _PositionReportingRenderBox(onPosition);

  /// Refreshes the callback when plugin action identifiers change.
  @override
  void updateRenderObject(
    BuildContext context,
    _PositionReportingRenderBox renderObject,
  ) {
    renderObject.onPosition = onPosition;
  }
}

class _PositionReportingRenderBox extends RenderProxyBox {
  /// Stores the callback for distinct painted geometry snapshots.
  _PositionReportingRenderBox(this.onPosition);

  ValueChanged<Rect> onPosition;
  Rect? _lastBounds;

  /// Reports bounds after painting so callbacks cannot mutate the layout in progress.
  @override
  void paint(PaintingContext context, Offset offset) {
    super.paint(context, offset);
    final bounds = localToGlobal(Offset.zero) & size;
    if (bounds == _lastBounds) return;
    _lastBounds = bounds;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (attached) onPosition(bounds);
    });
  }
}

class _SizeReportingBox extends StatefulWidget {
  /// Creates the size reporting box instance.
  const _SizeReportingBox({required this.child, required this.onSizeChanged});

  final Widget child;
  final ValueChanged<Size> onSizeChanged;

  /// Creates persistent state for this DSL widget.
  @override
  State<_SizeReportingBox> createState() => _SizeReportingBoxState();
}

class _SizeReportingBoxState extends State<_SizeReportingBox> {
  Size? _lastSize;

  /// Initializes resources owned by this DSL widget.
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reportSize());
  }

  /// Synchronizes widget state with the latest DSL node.
  @override
  void didUpdateWidget(covariant _SizeReportingBox oldWidget) {
    super.didUpdateWidget(oldWidget);
    WidgetsBinding.instance.addPostFrameCallback((_) => _reportSize());
  }

  /// Resolves report size for the Compose DSL renderer.
  void _reportSize() {
    if (!mounted) {
      return;
    }
    final size = context.size;
    if (size == null || size == _lastSize) {
      return;
    }
    _lastSize = size;
    widget.onSizeChanged(size);
  }

  /// Builds the widget for the current DSL state.
  @override
  Widget build(BuildContext context) => widget.child;
}
