// ignore_for_file: file_names

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:operit2/core/proxy/generated/CoreProxyModels.g.dart'
    as core_proxy;
import 'package:operit2/ui/features/settings/model/ProviderLogo.dart';

void main() {
  test('every remote provider type has a bundled logo asset', () {
    const fallbackTypeIds = <String>{'LOCAL_MODEL', 'OTHER'};
    for (final type in core_proxy.ApiProviderType.values) {
      if (fallbackTypeIds.contains(type.value)) {
        continue;
      }
      expect(
        providerLogoAssets[type.value],
        isNotNull,
        reason: 'Missing logo asset for ${type.value}',
      );
    }
  });

  test('catalog logo assets exist on disk', () {
    for (final asset in providerLogoAssets.values) {
      expect(
        File(asset).existsSync(),
        isTrue,
        reason: 'Missing bundled logo file for $asset',
      );
    }
  });
}
