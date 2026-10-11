// ignore_for_file: file_names

part of '../ToolPkgUiLauncherScreen.dart';

/// Measures regular Box children before laying out match-parent overlays.
class _ComposeBox extends MultiChildRenderObjectWidget {
  /// Creates a Box that honors per-child alignment and drawing order.
  const _ComposeBox({
    required this.nodes,
    required this.alignment,
    required super.children,
  });

  final List<_ComposeDslNode> nodes;
  final Alignment alignment;

  /// Creates the Compose-aware stacking layout.
  @override
  RenderObject createRenderObject(BuildContext context) =>
      _ComposeBoxRenderObject(nodes, alignment);

  /// Updates layout metadata without changing keyed child identity.
  @override
  void updateRenderObject(
    BuildContext context,
    _ComposeBoxRenderObject renderObject,
  ) {
    renderObject.nodes = nodes;
    renderObject.alignment = alignment;
    renderObject.markNeedsLayout();
  }
}

class _ComposeBoxParentData extends ContainerBoxParentData<RenderBox> {}

class _ComposeBoxRenderObject extends RenderBox
    with
        ContainerRenderObjectMixin<RenderBox, _ComposeBoxParentData>,
        RenderBoxContainerDefaultsMixin<RenderBox, _ComposeBoxParentData> {
  /// Stores child layout and drawing metadata supplied by the renderer.
  _ComposeBoxRenderObject(this.nodes, this.alignment);

  List<_ComposeDslNode> nodes;
  Alignment alignment;

  /// Allocates stacking offsets and sibling links for each child.
  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _ComposeBoxParentData) {
      child.parentData = _ComposeBoxParentData();
    }
  }

  /// Identifies overlays that must not contribute to the parent's measured size.
  bool _matchesParent(int index) =>
      nodes[index].props['matchParentSize'] == true ||
      _hasModifierOp(nodes[index].props['modifier'], 'matchparentsize');

  /// Computes parent size from ordinary children using the incoming constraints.
  @override
  Size computeDryLayout(BoxConstraints constraints) {
    var measured = constraints.smallest;
    var child = firstChild;
    var index = 0;
    while (child != null) {
      if (!_matchesParent(index)) {
        final childSize = child.getDryLayout(constraints.loosen());
        measured = Size(
          math.max(measured.width, childSize.width),
          math.max(measured.height, childSize.height),
        );
      }
      child = childAfter(child);
      index++;
    }
    return constraints.constrain(measured);
  }

  /// Measures content first, then lays out overlays and resolves child offsets.
  @override
  void performLayout() {
    var measured = constraints.smallest;
    var child = firstChild;
    var index = 0;
    while (child != null) {
      if (!_matchesParent(index)) {
        child.layout(constraints.loosen(), parentUsesSize: true);
        measured = Size(
          math.max(measured.width, child.size.width),
          math.max(measured.height, child.size.height),
        );
      }
      child = childAfter(child);
      index++;
    }
    size = constraints.constrain(measured);
    child = firstChild;
    index = 0;
    while (child != null) {
      if (_matchesParent(index)) {
        child.layout(BoxConstraints.tight(size), parentUsesSize: true);
      }
      final props = nodes[index].props;
      final args =
          _modifierOpByToken(props['modifier'], 'align')?['args']
              as List<Object?>?;
      final rawAlign = props['align'] ?? args?.firstOrNull;
      final childAlignment = rawAlign == null
          ? alignment
          : _alignment(rawAlign);
      final data = child.parentData! as _ComposeBoxParentData;
      data.offset = childAlignment.alongOffset(
        Offset(size.width - child.size.width, size.height - child.size.height),
      );
      child = childAfter(child);
      index++;
    }
  }

  /// Sorts paint order stably without changing layout or plugin child identity.
  List<RenderBox> _paintOrder() {
    final entries = <({RenderBox child, double z, int index})>[];
    var child = firstChild;
    var index = 0;
    while (child != null) {
      final props = nodes[index].props;
      final args =
          _modifierOpByToken(props['modifier'], 'zindex')?['args']
              as List<Object?>?;
      entries.add((
        child: child,
        z: _number(props['zIndex'] ?? args?.firstOrNull) ?? 0,
        index: index,
      ));
      child = childAfter(child);
      index++;
    }
    entries.sort((a, b) {
      final order = a.z.compareTo(b.z);
      return order == 0 ? a.index.compareTo(b.index) : order;
    });
    return entries.map((entry) => entry.child).toList(growable: false);
  }

  /// Paints higher z-index children above lower z-index siblings.
  @override
  void paint(PaintingContext context, Offset offset) {
    for (final child in _paintOrder()) {
      context.paintChild(
        child,
        offset + (child.parentData! as _ComposeBoxParentData).offset,
      );
    }
  }

  /// Gives the visually foremost child the first opportunity to handle input.
  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) {
    for (final child in _paintOrder().reversed) {
      final hit = result.addWithPaintOffset(
        offset: (child.parentData! as _ComposeBoxParentData).offset,
        position: position,
        hitTest: (result, transformed) =>
            child.hitTest(result, position: transformed),
      );
      if (hit) return true;
    }
    return false;
  }
}
