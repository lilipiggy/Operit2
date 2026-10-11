// ignore_for_file: file_names

import 'dart:io';

import '../proxy/generated/CoreProxyModels.g.dart' as generated;

class RuntimeDeviceInfoProvider {
  const RuntimeDeviceInfoProvider._();

  static Future<generated.LinkDeviceInfo> current() async {
    return generated.LinkDeviceInfo(
      platform: Platform.operatingSystem,
      model: Platform.localHostname,
      // The core mints and stamps the local pairing generation itself; hosts
      // never supply it.
      pairingIncarnation: null,
    );
  }
}
