import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit2/ui/features/packages/market/MarketBrowseList.dart';

/// Verifies market grids remain lazy and preserve grouping during updates.
void main() {
  for (final grouped in <bool>[false, true]) {
    testWidgets('scrolling reuses visible market cards (grouped: $grouped)', (
      tester,
    ) async {
      final builds = List<int>.filled(1000, 0);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: _marketList(
              items: List<int>.generate(builds.length, (index) => index),
              grouped: grouped,
              itemBuilder: (index) {
                builds[index]++;
                return Text('Entry $index');
              },
            ),
          ),
        ),
      );
      final position = tester
          .state<ScrollableState>(find.byType(Scrollable))
          .position;
      final initial = builds[2];
      expect(initial, greaterThan(0));
      expect(builds.where((count) => count > 0).length, lessThan(30));
      for (var step = 1; step <= 10; step++) {
        position.jumpTo(step * 5);
        await tester.pump();
      }
      expect(builds[2], initial);
      expect(builds.where((count) => count > 0).length, lessThan(30));
    });
  }

  testWidgets('one market card can repaint without repainting its neighbor', (
    tester,
  ) async {
    final repaint = ChangeNotifier();
    addTearDown(repaint.dispose);
    final paints = <int>[0, 0];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: _marketList(
            items: const <int>[0, 1],
            itemBuilder: (index) => CustomPaint(
              painter: _CardPainter(
                onPaint: () => paints[index]++,
                repaint: index == 0 ? repaint : null,
              ),
            ),
          ),
        ),
      ),
    );
    final initial = List<int>.of(paints);
    repaint.notifyListeners();
    await tester.pump();
    expect(paints[0], greaterThan(initial[0]));
    expect(paints[1], initial[1]);
  });

  testWidgets('date groups reflow across one, two and three columns', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1500, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final width = ValueNotifier<double>(800);
    addTearDown(width.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ValueListenableBuilder<double>(
            valueListenable: width,
            builder: (context, value, child) => Align(
              alignment: Alignment.topLeft,
              child: SizedBox(width: value, child: child),
            ),
            child: _marketList(items: List<int>.generate(6, (index) => index)),
          ),
        ),
      ),
    );
    expect(
      tester.getTopLeft(find.text('Entry 0')).dy,
      tester.getTopLeft(find.text('Entry 1')).dy,
    );
    expect(
      tester.getTopLeft(find.text('Entry 2')).dy,
      greaterThan(tester.getTopLeft(find.text('Entry 1')).dy),
    );
    expect(find.text('2026-09-17'), findsOneWidget);
    expect(find.text('2026-09-16'), findsOneWidget);

    width.value = 1400;
    await tester.pump();
    expect(
      tester.getTopLeft(find.text('Entry 0')).dy,
      tester.getTopLeft(find.text('Entry 2')).dy,
    );
    expect(
      tester.getTopLeft(find.text('Entry 3')).dy,
      greaterThan(tester.getTopLeft(find.text('2026-09-16')).dy),
    );

    width.value = 400;
    await tester.pump();
    expect(
      tester.getTopLeft(find.text('Entry 1')).dy,
      greaterThan(tester.getTopLeft(find.text('Entry 0')).dy),
    );
    expect(find.text('Entry 5'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'appending and filtering entries updates rows at the same width',
    (tester) async {
      final entries = ValueNotifier<List<int>>(const <int>[0, 1]);
      addTearDown(entries.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ValueListenableBuilder<List<int>>(
              valueListenable: entries,
              builder: (context, items, child) => _marketList(items: items),
            ),
          ),
        ),
      );
      entries.value = const <int>[0, 1, 2, 3];
      await tester.pump();
      expect(find.text('Entry 3'), findsOneWidget);
      expect(find.text('2026-09-16'), findsOneWidget);

      entries.value = const <int>[3];
      await tester.pump();
      expect(find.text('Entry 0'), findsNothing);
      expect(find.text('2026-09-17'), findsNothing);
      expect(find.text('Entry 3'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('scrolling near the end still requests the next page', (
    tester,
  ) async {
    var requests = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: _marketList(
            items: List<int>.generate(40, (index) => index),
            hasMore: true,
            onLoadMore: () => requests++,
          ),
        ),
      ),
    );
    final position = tester
        .state<ScrollableState>(find.byType(Scrollable))
        .position;
    expect(requests, 0);
    position.jumpTo(position.maxScrollExtent);
    await tester.pump();
    expect(requests, greaterThan(0));
  });
}

/// Creates a real market list with inexpensive observable card contents.
Widget _marketList({
  required List<int> items,
  bool grouped = true,
  Widget Function(int) itemBuilder = _entryLabel,
  bool hasMore = false,
  VoidCallback onLoadMore = _ignoreLoadMore,
}) => MarketBrowseList<int>(
  isLoading: false,
  isLoadingMore: false,
  hasMore: hasMore,
  isEmpty: items.isEmpty,
  emptyTitle: 'Empty market',
  onRefresh: () async {},
  onLoadMore: onLoadMore,
  items: items,
  groupByUpdatedDate: grouped,
  updatedAt: (index) =>
      index < 3 ? '2026-09-17T12:00:00Z' : '2026-09-16T12:00:00Z',
  itemBuilder: itemBuilder,
);

/// Labels a test entry independently of its position in the grid.
Widget _entryLabel(int index) => Text('Entry $index');

/// Leaves pagination disabled for tests that only exercise rendering.
void _ignoreLoadMore() {}

class _CardPainter extends CustomPainter {
  /// Records paint work caused by a card-local animation.
  _CardPainter({required this.onPaint, super.repaint});

  final VoidCallback onPaint;

  /// Draws a visible card while counting paints.
  @override
  void paint(Canvas canvas, Size size) {
    onPaint();
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.blue);
  }

  /// Repaints when a new test painter is installed.
  @override
  bool shouldRepaint(covariant _CardPainter oldDelegate) => true;
}
