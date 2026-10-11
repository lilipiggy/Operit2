import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit2/core/host/AppToastController.dart';
import 'package:operit2/ui/common/AppToastHost.dart';

/// Verifies application-owned toast presentation and dismissal.
void main() {
  testWidgets('shows host toast inside the application window', (tester) async {
    final controller = AppToastController.instance;
    await tester.pumpWidget(
      MaterialApp(
        home: AppToastHost(child: const ColoredBox(color: Colors.white)),
      ),
    );

    controller.show('Frontend toast');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 220));

    expect(find.text('Frontend toast'), findsOneWidget);
    expect(find.byIcon(Icons.close), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 220));

    expect(find.text('Frontend toast'), findsNothing);
  });
}
