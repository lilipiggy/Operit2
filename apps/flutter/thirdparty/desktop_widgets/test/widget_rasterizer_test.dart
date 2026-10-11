import 'dart:ui' as ui;
import 'package:desktop_widgets/desktop_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Verifies that ordinary Flutter content can be published without a preview renderer.
void main() {
  testWidgets(
    'captures a fresh subtree and removes its temporary presentation',
    (tester) async {
      late BuildContext source;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              source = context;
              return const Scaffold(body: Text('Application'));
            },
          ),
        ),
      );
      final capture = DesktopWidgetRasterizer.render(
        context: source,
        size: const Size(32, 24),
        child: const ColoredBox(
          key: ValueKey('captured-content'),
          color: Color(0xffff0000),
        ),
      );
      await tester.pump();
      await tester.runAsync(() async {
        final png = await capture;
        final codec = await ui.instantiateImageCodec(png);
        final frame = await codec.getNextFrame();
        expect(frame.image.width, 32);
        expect(frame.image.height, 24);
        final pixels = await frame.image.toByteData();
        expect(pixels!.getUint8(0), 255);
        expect(pixels.getUint8(3), 255);
        frame.image.dispose();
        codec.dispose();
      });
      await tester.pump();
      expect(find.text('Application'), findsOneWidget);
      expect(find.byKey(const ValueKey('captured-content')), findsNothing);
    },
  );
}
