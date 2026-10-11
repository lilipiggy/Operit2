import 'dart:convert';
import 'dart:ffi';

import 'package:flutter_test/flutter_test.dart';
import 'package:operit2/core/bridge/FfiCoreAddress.dart';

/// Verifies unsigned host addresses retain every bit through JSON and Dart FFI.
void main() {
  test(
    'preserves the tagged session address from the device log',
    () {
      final descriptor =
          jsonDecode('{"session":"12970367399774696800"}')
              as Map<String, dynamic>;
      final address = decodeCoreFfiAddress(descriptor['session'] as String);
      expect(address, -5476376673934854816);
      final pointer = Pointer<Void>.fromAddress(address);
      expect(
        BigInt.from(pointer.address).toUnsigned(64).toRadixString(16),
        'b400006e1de0b560',
      );
    },
    skip: sizeOf<UintPtr>() != 8,
  );

  test('preserves unsigned 64-bit boundary addresses', () {
    const addresses = {
      '0': 0,
      '4294967295': 4294967295,
      '9007199254740993': 9007199254740993,
      '9223372036854775807': 9223372036854775807,
      '9223372036854775808': -9223372036854775808,
      '18446744073709551615': -1,
    };
    for (final entry in addresses.entries) {
      final pointer = Pointer<Void>.fromAddress(
        decodeCoreFfiAddress(entry.key),
      );
      expect(pointer.address, entry.value, reason: entry.key);
      expect(BigInt.from(pointer.address).toUnsigned(64).toString(), entry.key);
    }
  }, skip: sizeOf<UintPtr>() != 8);

  test('rejects addresses outside the native unsigned pointer range', () {
    final limit = BigInt.one << (sizeOf<UintPtr>() * 8);
    for (final value in [
      '-1',
      limit.toString(),
      (limit + BigInt.one).toString(),
    ]) {
      expect(() => decodeCoreFfiAddress(value), throwsFormatException);
    }
  });

  test('rejects malformed decimal addresses', () {
    for (final value in ['', '1.5', '1e10', '0xb400006e1de0b560', 'address']) {
      expect(() => decodeCoreFfiAddress(value), throwsFormatException);
    }
  });
}
