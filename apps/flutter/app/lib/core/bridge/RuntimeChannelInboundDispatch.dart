// ignore_for_file: file_names
import 'package:flutter/services.dart';
import '../runtime/RuntimeChannelInboundGateway.dart';

/// Installs platform lifecycle notifications independently of the Core data transport.
void installRuntimeChannelInboundDispatch() {
  const channel = MethodChannel('operit/runtime');
  channel.setMethodCallHandler((call) async {
    switch (call.method) {
      case 'notificationActivation':
        await RuntimeChannelInboundGateway.dispatchNotificationActivation(
          call.arguments,
        );
        return null;
      default:
        throw MissingPluginException(
          'Unknown runtime host event: ${call.method}',
        );
    }
  });
}
