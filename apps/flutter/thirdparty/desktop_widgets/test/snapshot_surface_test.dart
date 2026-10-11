import 'dart:ui' as ui;
import 'package:desktop_widgets/desktop_widgets.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Verifies that publication captures widget content and requires explicit readiness.
void main() {
  testWidgets('rejects loading and unmounted content', (tester) async {
    final controller = DesktopWidgetSnapshotController();
    await expectLater(
      controller.capture(
        action: 'open',
        actionArguments: {},
        description: 'Clock',
      ),
      throwsStateError,
    );
    controller.ready = true;
    final pending = controller.capture(
      action: 'open',
      actionArguments: {},
      description: 'Clock',
    );
    final rejected = expectLater(pending, throwsStateError);
    await tester.pump();
    await rejected;
  });

  testWidgets('captures only transparent content pixels', (tester) async {
    final controller = DesktopWidgetSnapshotController()..ready = true;
    await tester.pumpWidget(
      Center(
        child: SizedBox(
          width: 32,
          height: 24,
          child: DesktopWidgetSnapshotSurface(
            controller: controller,
            child: const ColoredBox(color: Color(0x00000000)),
          ),
        ),
      ),
    );
    final pending = controller.capture(
      action: 'open',
      actionArguments: {'route': 'clock'},
      description: 'Clock',
    );
    await tester.pump();
    await tester.runAsync(() async {
      final frame = await pending;
      expect(frame.actionArguments, {'route': 'clock'});
      final codec = await ui.instantiateImageCodec(frame.png);
      final decoded = await codec.getNextFrame();
      expect(decoded.image.width, 32);
      expect(decoded.image.height, 24);
      final rgba = await decoded.image.toByteData();
      expect(rgba!.getUint8(3), 0);
      decoded.image.dispose();
      codec.dispose();
    });
  });
}
