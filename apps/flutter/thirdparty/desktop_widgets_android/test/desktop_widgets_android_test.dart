import 'dart:async';
import 'package:desktop_widgets_android/desktop_widgets_android.dart';
import 'package:desktop_widgets_platform_interface/desktop_widgets_platform_interface.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Checks that Android uses AppWidget publication, not a desktop engine or overlay.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('desktop_widgets/appwidget');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final calls = <MethodCall>[];
  late DesktopWidgetsAndroid host;
  final frame = DesktopWidgetSnapshot(
    png: Uint8List.fromList([137, 80, 78, 71]),
    action: 'open',
    actionArguments: const {'route': 'clock'},
    description: 'Clock',
  );

  setUp(() {
    calls.clear();
    host = DesktopWidgetsAndroid();
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      if (call.method == 'listSnapshots') return <Object?>[];
      return call.method == 'pin' ? 'publication-1' : null;
    });
  });

  tearDown(() async {
    await host.setSnapshotRenderer(null);
    channel.setMethodCallHandler(null);
    messenger.setMockMethodCallHandler(channel, null);
  });

  test('pin sends a completed frame and an opaque payload', () async {
    await host.setSnapshotRenderer((payload, size) async {
      expect(payload, {'instance': 'one'});
      expect(size, const Size(360, 240));
      return frame;
    });
    calls.clear();
    final id = await host.open({'instance': 'one'}, (_) async => null);
    expect(id, 'publication-1');
    expect(calls.map((call) => call.method), ['requireSupport', 'pin']);
    expect(calls.last.arguments, {
      'payload': {'instance': 'one'},
      'frame': frame.toMap(),
    });
    expect(host.parseLaunch(['multi_window', 'one', '{}']), isNull);
  });

  test('missing renderer is an error and never opens a window', () async {
    await expectLater(host.open({}, (_) async => null), throwsStateError);
    expect(calls.map((call) => call.method), ['requireSupport']);
  });

  test('unsupported launcher never evaluates the snapshot provider', () async {
    var captured = false;
    await host.setSnapshotRenderer((payload, size) async {
      captured = true;
      return frame;
    });
    messenger.setMockMethodCallHandler(
      channel,
      (_) async => throw PlatformException(code: 'UNSUPPORTED'),
    );
    await expectLater(
      host.open({}, (_) async => null),
      throwsA(isA<PlatformException>()),
    );
    expect(captured, isFalse);
  });

  test(
    'registration refreshes persisted payloads without a visible preview',
    () async {
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        if (call.method == 'listSnapshots')
          return [
            {
              'id': 'saved',
              'payload': {'instance': 'restored'},
              'width': 240,
              'height': 120,
            },
          ];
        return null;
      });
      await host.setSnapshotRenderer((payload, size) async {
        expect(payload, {'instance': 'restored'});
        expect(size, const Size(240, 120));
        return frame;
      });
      expect(calls.map((call) => call.method), [
        'listSnapshots',
        'updateSnapshot',
      ]);
      expect(calls.last.arguments, {'id': 'saved', 'frame': frame.toMap()});
    },
  );

  test(
    'a failed DSL render exposes an error and does not publish old pixels',
    () async {
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        if (call.method == 'listSnapshots')
          return [
            {'id': 'saved', 'payload': {}, 'width': 240, 'height': 120},
          ];
        return null;
      });
      await expectLater(
        host.setSnapshotRenderer(
          (payload, size) async => throw StateError('Package disabled'),
        ),
        throwsStateError,
      );
      expect(calls.map((call) => call.method), [
        'listSnapshots',
        'renderFailed',
      ]);
    },
  );

  test('removing renderer ownership prevents late publication', () async {
    final pending = Completer<DesktopWidgetSnapshot>();
    await host.setSnapshotRenderer((payload, size) => pending.future);
    final publication = host.open({}, (_) async => null);
    final rejected = expectLater(publication, throwsStateError);
    await Future<void>.delayed(Duration.zero);
    await host.setSnapshotRenderer(null);
    pending.complete(frame);
    await rejected;
    expect(calls.any((call) => call.method == 'pin'), isFalse);
  });

  test(
    'cold-start delivery waits for the application-lifetime action handler',
    () async {
      MethodCall? received;
      await host.setActionHandler((call) async {
        received = call;
        return 'accepted';
      });
      expect(calls.map((call) => call.arguments), [false, true]);
      const codec = StandardMethodCodec();
      ByteData? reply;
      await messenger.handlePlatformMessage(
        'desktop_widgets/appwidget',
        codec.encodeMethodCall(const MethodCall('open', {'route': 'clock'})),
        (data) {
          reply = data;
        },
      );
      expect(received!.method, 'open');
      expect(received!.arguments, {'route': 'clock'});
      expect(codec.decodeEnvelope(reply!), 'accepted');
      await host.setActionHandler(null);
      expect(calls.last.arguments, false);
    },
  );

  test('update targets a persisted publication identity', () async {
    await host.invoke<void>('publication-1', 'updateSnapshot', frame.toMap());
    expect(calls.single.method, 'updateSnapshot');
    expect(calls.single.arguments, {
      'id': 'publication-1',
      'frame': frame.toMap(),
    });
  });

  test('launcher ownership is explicit for window-only operations', () async {
    await expectLater(host.create('{}'), throwsUnsupportedError);
    await expectLater(
      host.configure(const Size(360, 240)),
      throwsUnsupportedError,
    );
    await expectLater(host.show(), throwsUnsupportedError);
    await expectLater(host.move(), throwsUnsupportedError);
    await expectLater(
      host.resize(const Size(360, 240)),
      throwsUnsupportedError,
    );
    await expectLater(host.close(), throwsUnsupportedError);
    expect(calls, isEmpty);
  });
}
