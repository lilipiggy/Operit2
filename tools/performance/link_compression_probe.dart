// Native AOT compression probe over captured production MessagePack payloads.
// Transfer is modelled as one byte-buffer copy; this is not an app benchmark.
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:ffi/ffi.dart';

import '../../apps/flutter/app/lib/core/link/CoreLinkCodec.dart';

typedef _CompressNative =
    Int32 Function(Pointer<Uint8>, Pointer<Uint8>, Int32, Int32);
typedef _Compress = int Function(Pointer<Uint8>, Pointer<Uint8>, int, int);
typedef _BoundNative = Int32 Function(Int32);
typedef _Bound = int Function(int);
typedef _ZBoundNative = Size Function(Size);
typedef _ZBound = int Function(int);
typedef _ZCompressNative =
    Size Function(Pointer<Uint8>, Size, Pointer<Uint8>, Size, Int32);
typedef _ZCompress =
    int Function(Pointer<Uint8>, int, Pointer<Uint8>, int, int);
typedef _ZDecompressNative =
    Size Function(Pointer<Uint8>, Size, Pointer<Uint8>, Size);
typedef _ZDecompress = int Function(Pointer<Uint8>, int, Pointer<Uint8>, int);

/// Decodes the standard LZ4 block format with strict input/output bounds.
/// Bulk-copy nonoverlapping matches; expand short repeating matches by doubling.
Uint8List decodeLz4Block(Uint8List source, int decodedLength) {
  final output = Uint8List(decodedLength);
  var input = 0, written = 0;
  int length(int base) {
    var result = base;
    if (base == 15) {
      int extra;
      do {
        if (input >= source.length)
          throw const FormatException('Truncated LZ4 length');
        extra = source[input++];
        result += extra;
      } while (extra == 255);
    }
    return result;
  }

  while (input < source.length) {
    final token = source[input++];
    final literals = length(token >> 4);
    if (input + literals > source.length ||
        written + literals > output.length) {
      throw const FormatException('Invalid LZ4 literals');
    }
    output.setRange(written, written + literals, source, input);
    input += literals;
    written += literals;
    if (input == source.length) break;
    if (input + 2 > source.length)
      throw const FormatException('Truncated LZ4 offset');
    final offset = source[input] | source[input + 1] << 8;
    input += 2;
    var match = length(token & 15) + 4;
    if (offset == 0 || offset > written || written + match > output.length) {
      throw const FormatException('Invalid LZ4 match');
    }
    var available = offset;
    final start = written - offset;
    while (match > 0) {
      final count = math.min(available, match);
      output.setRange(written, written + count, output, start);
      written += count;
      match -= count;
      available += count;
    }
  }
  if (written != output.length)
    throw const FormatException('LZ4 output length mismatch');
  return output;
}

Map<String, double> stats(List<double> values) {
  final sorted = [...values]..sort();
  double percentile(double p) {
    final position = (sorted.length - 1) * p;
    final low = position.floor(), high = position.ceil();
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
  }

  return {'p50': percentile(.5), 'p95': percentile(.95)};
}

void validate(Uint8List actual, Uint8List expected) {
  if (actual.length != expected.length) throw StateError('Length mismatch');
  for (var i = 0; i < actual.length; i++) {
    if (actual[i] != expected[i]) throw StateError('Content mismatch at $i');
  }
}

/// Checks overlapping matches, extension lengths and literal-only blocks
/// against the official native compressor before trusting probe measurements.
void validateLz4Decoder(_Compress compress, _Bound bound) {
  final random = math.Random(20261012);
  for (final size in [0, 1, 12, 16, 255, 256, 4096, 65536, 1800000]) {
    for (final period in [1, 7, 255, 0]) {
      final bytes = Uint8List.fromList(
        List.generate(
          size,
          (i) => period == 0 ? random.nextInt(256) : i % period,
        ),
      );
      final source = calloc<Uint8>(math.max(1, size));
      final destination = calloc<Uint8>(bound(size));
      try {
        source.asTypedList(size).setAll(0, bytes);
        final count = compress(source, destination, size, bound(size));
        if (count <= 0) throw StateError('Validation compression failed');
        validate(decodeLz4Block(destination.asTypedList(count), size), bytes);
      } finally {
        calloc.free(source);
        calloc.free(destination);
      }
    }
  }
  for (final bad in [
    <int>[0x10],
    [0, 0, 0],
    [0, 1, 0],
    [0xf0, 255],
    [0x10, 42, 1],
  ]) {
    var rejected = false;
    try {
      decodeLz4Block(Uint8List.fromList(bad), 8);
    } on FormatException {
      rejected = true;
    }
    if (!rejected) throw StateError('Malformed LZ4 block was accepted');
  }
}

Map<String, Object> describePayload(Uint8List bytes) {
  final byField = <String, (int, int)>{};
  var keyBytes = 0;
  void visit(Object? value, String field) {
    if (value is String) {
      final previous = byField[field] ?? (0, 0);
      byField[field] = (
        previous.$1 + 1,
        previous.$2 + utf8.encode(value).length,
      );
    } else if (value is Map) {
      for (final entry in value.entries) {
        if (entry.key is String)
          keyBytes += utf8.encode(entry.key as String).length;
        visit(entry.value, entry.key.toString());
      }
    } else if (value is List && value is! Uint8List) {
      for (final item in value) visit(item, field);
    }
  }

  visit(decodeCoreLink<Object?>(bytes), '<root>');
  final fields = byField.entries.toList()
    ..sort((a, b) => b.value.$2.compareTo(a.value.$2));
  return {
    'mapKeyUtf8Bytes': keyBytes,
    'stringValuesByField': [
      for (final entry in fields)
        {
          'field': entry.key,
          'count': entry.value.$1,
          'utf8Bytes': entry.value.$2,
        },
    ],
  };
}

void main(List<String> args) {
  if (args.length < 2)
    throw ArgumentError('Usage: probe output.json payload.msgpack ...');
  final lz4 = DynamicLibrary.open(
    Platform.environment['OPERIT_LZ4_LIBRARY'] ??
        '/opt/homebrew/lib/liblz4.dylib',
  );
  final zstd = DynamicLibrary.open(
    Platform.environment['OPERIT_ZSTD_LIBRARY'] ??
        '/opt/homebrew/lib/libzstd.dylib',
  );
  final compress = lz4.lookupFunction<_CompressNative, _Compress>(
    'LZ4_compress_default',
  );
  final decompress = lz4.lookupFunction<_CompressNative, _Compress>(
    'LZ4_decompress_safe',
  );
  final bound = lz4.lookupFunction<_BoundNative, _Bound>('LZ4_compressBound');
  final zbound = zstd.lookupFunction<_ZBoundNative, _ZBound>(
    'ZSTD_compressBound',
  );
  final zcompress = zstd.lookupFunction<_ZCompressNative, _ZCompress>(
    'ZSTD_compress',
  );
  final zdecompress = zstd.lookupFunction<_ZDecompressNative, _ZDecompress>(
    'ZSTD_decompress',
  );
  validateLz4Decoder(compress, bound);
  final reports = <Object>[];
  for (final file in args.skip(1)) {
    final bytes = File(file).readAsBytesSync();
    final source = calloc<Uint8>(bytes.length);
    final capacity = math.max(bound(bytes.length), zbound(bytes.length));
    final encoded = calloc<Uint8>(capacity);
    final decoded = calloc<Uint8>(bytes.length);
    try {
      source.asTypedList(bytes.length).setAll(0, bytes);
      final encodedLength = compress(source, encoded, bytes.length, capacity);
      if (encodedLength <= 0) throw StateError('LZ4 encode failed');
      final lz4Bytes = Uint8List.fromList(encoded.asTypedList(encodedLength));
      validate(decodeLz4Block(lz4Bytes, bytes.length), bytes);
      final zstdLength = zcompress(encoded, capacity, source, bytes.length, 1);
      if (zstdLength > capacity) throw StateError('Zstd encode failed');
      final zstdBytes = Uint8List.fromList(encoded.asTypedList(zstdLength));
      final nativeLz4 = calloc<Uint8>(lz4Bytes.length);
      final nativeZstd = calloc<Uint8>(zstdBytes.length);
      nativeLz4.asTypedList(lz4Bytes.length).setAll(0, lz4Bytes);
      nativeZstd.asTypedList(zstdBytes.length).setAll(0, zstdBytes);
      try {
        final results = <String, List<double>>{};
        final sizes = <String, int>{
          'raw': bytes.length,
          'lz4': encodedLength,
          'zstd1': zstdLength,
        };
        Object? observed;
        final operations = <String, void Function()>{
          'raw-copy-ms': () {
            observed = Uint8List.fromList(source.asTypedList(bytes.length));
          },
          'lz4-compress-ms': () {
            compress(source, encoded, bytes.length, capacity);
          },
          'lz4-dart-decompress-ms': () {
            decodeLz4Block(lz4Bytes, bytes.length);
          },
          'lz4-native-decompress-ms': () {
            final length = decompress(
              nativeLz4,
              decoded,
              encodedLength,
              bytes.length,
            );
            if (length != bytes.length)
              throw StateError('LZ4 native decode failed');
          },
          'zstd1-compress-ms': () {
            final length = zcompress(
              encoded,
              capacity,
              source,
              bytes.length,
              1,
            );
            if (length > capacity) throw StateError('Zstd encode failed');
          },
          'zstd1-native-decompress-ms': () {
            final length = zdecompress(
              decoded,
              bytes.length,
              nativeZstd,
              zstdLength,
            );
            if (length != bytes.length)
              throw StateError('Zstd native decode failed');
          },
          'raw-copy-parse-ms': () {
            observed = decodeCoreLink<Object?>(
              Uint8List.fromList(source.asTypedList(bytes.length)),
            );
          },
          'lz4-dart-roundtrip-parse-ms': () {
            final length = compress(source, encoded, bytes.length, capacity);
            final wire = Uint8List.fromList(encoded.asTypedList(length));
            observed = decodeCoreLink<Object?>(
              decodeLz4Block(wire, bytes.length),
            );
          },
          'lz4-native-roundtrip-parse-ms': () {
            final length = compress(source, encoded, bytes.length, capacity);
            // A native decompressor still has to materialize the full Dart buffer.
            final result = decompress(encoded, decoded, length, bytes.length);
            if (result != bytes.length)
              throw StateError('LZ4 native decode failed');
            observed = decodeCoreLink<Object?>(
              Uint8List.fromList(decoded.asTypedList(result)),
            );
          },
          'zstd1-native-roundtrip-parse-ms': () {
            final length = zcompress(
              encoded,
              capacity,
              source,
              bytes.length,
              1,
            );
            if (length > capacity) throw StateError('Zstd encode failed');
            sizes['zstd1'] = length;
            final result = zdecompress(decoded, bytes.length, encoded, length);
            if (result != bytes.length) throw StateError('Zstd decode failed');
            observed = decodeCoreLink<Object?>(
              Uint8List.fromList(decoded.asTypedList(result)),
            );
          },
        };
        final pairs = <String, List<double>>{};
        final keys = operations.keys.toList();
        for (var sample = 0; sample < 24; sample++) {
          final times = <String, double>{};
          final order = sample.isEven ? keys : keys.reversed.toList();
          for (final key in order) {
            final watch = Stopwatch()..start();
            final batch = bytes.length < 4096 ? 1000 : 1;
            for (var call = 0; call < batch; call++) operations[key]!();
            watch.stop();
            times[key] = watch.elapsedTicks / watch.frequency * 1000 / batch;
            if (sample >= 4)
              results.putIfAbsent(key, () => []).add(times[key]!);
          }
          if (sample >= 4) {
            for (final key in keys.where((key) => key.contains('roundtrip'))) {
              pairs
                  .putIfAbsent(key, () => [])
                  .add(times[key]! / times['raw-copy-parse-ms']!);
            }
          }
        }
        // Validate the last native codec output independently of the measured loop.
        validate(decoded.asTypedList(bytes.length), bytes);
        reports.add({
          'path': file,
          'observedValueType': observed.runtimeType.toString(),
          'payloadBreakdown': describePayload(bytes),
          'bytes': sizes,
          'compressedRatio': {
            for (final item in sizes.entries)
              if (item.key != 'raw') item.key: item.value / bytes.length,
          },
          'timingsMs': {
            for (final item in results.entries) item.key: stats(item.value),
          },
          'pairedRatioToRaw': {
            for (final item in pairs.entries) item.key: stats(item.value),
          },
        });
      } finally {
        calloc.free(nativeLz4);
        calloc.free(nativeZstd);
      }
    } finally {
      calloc.free(source);
      calloc.free(encoded);
      calloc.free(decoded);
    }
  }
  final report = {
    'scope':
        'Captured real production payloads; standalone native AOT probe. '
        'One byte-copy transfer model and generic parse; excludes Rust MessagePack serialization, '
        'FFI scheduling, typed DSL decoding and Flutter rendering. Native decoding is a lower-bound alternative, '
        'not a deployed receiver. 24 alternating rounds, first four warmups excluded.',
    'payloads': reports,
  };
  File(args.first).writeAsStringSync(
    '${const JsonEncoder.withIndent('  ').convert(report)}\n',
  );
  stdout.writeln(const JsonEncoder.withIndent('  ').convert(report));
}
