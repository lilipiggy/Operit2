// ignore_for_file: file_names

import 'dart:ffi';

/// Preserves unsigned native pointer bits in Dart's signed 64-bit integer.
int decodeCoreFfiAddress(String value) {
  final address = BigInt.parse(value, radix: 10);
  final pointerBits = sizeOf<UintPtr>() * 8;
  if (address.isNegative || address.bitLength > pointerBits) {
    throw FormatException(
      'FFI address is outside the native pointer range',
      value,
    );
  }
  // Convert the bit pattern before toInt(), which otherwise clamps large values.
  return address.toSigned(64).toInt();
}
