import 'package:desktop_widgets/desktop_widgets.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Verifies public window lifecycle contracts at the plugin transport boundary.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const host = MethodChannel('desktop_widgets/window');
  const windows = MethodChannel('mixin.one/desktop_multi_window');
  final calls = <MethodCall>[];
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  setUp(() {
    calls.clear();
    messenger.setMockMethodCallHandler(host, (call) async {
      calls.add(call);
      return null;
    });
    messenger.setMockMethodCallHandler(windows, (call) async {
      calls.add(call);
      switch (call.method) {
        case 'createWindow':
          return 'widget-1';
        case 'getWindowDefinition':
          return {
            'windowId': 'widget-1',
            'windowArgument':
                '{"kind":"desktop_widgets.window","ownerId":"main","payload":{}}',
          };
        default:
          throw StateError('Unexpected window call: ${call.method}');
      }
    });
  });

  tearDown(() async {
    await DesktopWidgets.setActionHandler(null);
    DesktopWidgetsPlatform.instance = MethodChannelDesktopWidgets();
    messenger.setMockMethodCallHandler(host, null);
    messenger.setMockMethodCallHandler(windows, null);
  });

  test(
    'opening content uses the single application-lifetime action registration',
    () async {
      DesktopWidgetsPlatform.instance = _ActionWidgetHost();
      MethodCall? received;
      await DesktopWidgets.setActionHandler((call) async {
        received = call;
        return null;
      });
      final window = await DesktopWidgetWindow.open(
        payload: {'route': 'clock'},
      );
      expect(window.id, 'host-widget');
      expect(received!.method, 'open');
      expect(received!.arguments, {'route': 'clock'});
      await DesktopWidgets.setActionHandler(null);
      await expectLater(
        DesktopWidgets.dispatchAction(const MethodCall('open')),
        throwsStateError,
      );
    },
  );

  test(
    'registered host owns creation launch parsing and owner messages',
    () async {
      DesktopWidgetsPlatform.instance = _TestWidgetHost();
      final launch = DesktopWidgets.parseLaunch(['host-widget'])!;
      expect(launch.payload, {'host': 'test'});
      final window = await DesktopWidgetWindow.create(arguments: 'content');
      expect(window.id, 'surface:content');
      expect(await launch.invokeOwner<String>('refresh'), 'owner:refresh');
      expect(calls, isEmpty);
    },
  );

  test('an unrelated child engine cannot become a widget', () async {
    messenger.setMockMethodCallHandler(
      windows,
      (call) async => {
        'windowId': 'chat-1',
        'windowArgument': '{"kind":"detached_chat"}',
      },
    );
    await expectLater(DesktopWidgetWindow.configure(), throwsStateError);
    expect(calls, isEmpty);
  });

  test('creates a hidden engine and preserves application arguments', () async {
    final window = await DesktopWidgetWindow.create(
      arguments: '{"kind":"clock"}',
    );
    expect(window.id, 'widget-1');
    expect(calls.map((call) => call.method), [
      'requireSupport',
      'createWindow',
    ]);
    expect(calls.last.arguments, containsPair('hiddenAtLaunch', true));
    expect(calls.last.arguments, containsPair('arguments', '{"kind":"clock"}'));
  });

  test(
    'plugin recognizes its own launch without application platform routing',
    () {
      final launch = DesktopWidgets.parseLaunch([
        'multi_window',
        'widget-1',
        '{"kind":"desktop_widgets.window","ownerId":"main","payload":{"city":"Shanghai"}}',
      ]);
      expect(launch!.ownerId, 'main');
      expect(launch.payload, {'city': 'Shanghai'});
      expect(DesktopWidgets.parseLaunch([]), isNull);
      expect(
        DesktopWidgets.parseLaunch([
          'multi_window',
          'chat-1',
          '{"kind":"detached_chat"}',
        ]),
        isNull,
      );
    },
  );

  test('host failure does not create an ordinary window', () async {
    messenger.setMockMethodCallHandler(host, (call) async {
      throw PlatformException(
        code: 'UNSUPPORTED',
        message: 'Transparent surfaces unavailable',
      );
    });
    await expectLater(
      DesktopWidgetWindow.create(arguments: '{}'),
      throwsA(isA<PlatformException>()),
    );
    expect(calls, isEmpty);
  });

  test('main window cannot be converted into a widget', () async {
    messenger.setMockMethodCallHandler(
      windows,
      (call) async => {'windowId': 'main', 'windowArgument': ''},
    );
    await expectLater(DesktopWidgetWindow.configure(), throwsStateError);
    expect(calls, isEmpty);
  });

  test('invalid dimensions fail before invoking the host', () async {
    for (final size in [
      const Size(0, 240),
      const Size(360, double.infinity),
      const Size(4096, 240),
    ]) {
      await expectLater(DesktopWidgetWindow.resize(size), throwsArgumentError);
    }
    expect(calls, isEmpty);
  });

  test(
    'configure declares role and lifecycle calls target the current host',
    () async {
      await DesktopWidgetWindow.configure(size: const Size(480, 320));
      expect(calls.last.arguments, {
        'role': 'desktop_widgets.window',
        'width': 480.0,
        'height': 320.0,
      });
      await DesktopWidgetWindow.show();
      await DesktopWidgetWindow.move();
      await DesktopWidgetWindow.resize(const Size(600, 400));
      await DesktopWidgetWindow.close();
      expect(calls.map((call) => call.method), [
        'getWindowDefinition',
        'configure',
        'show',
        'move',
        'resize',
        'close',
      ]);
    },
  );
}

/// Exercises host substitution without creating a desktop engine.
class _TestWidgetHost extends MethodChannelDesktopWidgets {
  /// Recognizes an independent host launch format.
  @override
  DesktopWidgetLaunch? parseLaunch(List<String> arguments) =>
      const DesktopWidgetLaunch(ownerId: 'owner', payload: {'host': 'test'});

  /// Creates a host identity without native window messages.
  @override
  Future<String> create(String arguments) async => 'surface:$arguments';

  /// Sends owner messages through the selected host transport.
  @override
  Future<T?> invoke<T>(String id, String method, Object? arguments) async =>
      '$id:$method' as T;
}

/// Exercises platform-owned action delivery without an application launcher wrapper.
class _ActionWidgetHost extends MethodChannelDesktopWidgets {
  /// Delivers the host action through the callback supplied by the public facade.
  @override
  Future<String> open(
    Map<String, Object?> payload,
    Future<Object?> Function(MethodCall call) onAction,
  ) async {
    await onAction(MethodCall('open', payload));
    return 'host-widget';
  }
}
