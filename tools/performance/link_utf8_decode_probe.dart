// Measures the UTF-8 range used by the Link reader, independently of transport
// and page rendering. Run with `dart compile exe` so timings use native AOT.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

String decodeCopy(Uint8List bytes, int start, int end) =>
    utf8.decode(bytes.sublist(start, end));

String decodeRange(Uint8List bytes, int start, int end) =>
    const Utf8Decoder().convert(bytes, start, end);

Map<String, Object> distribution(List<double> values) {
  final sorted = [...values]..sort();
  double percentile(double value) => sorted[(value * sorted.length).ceil() - 1];
  return {
    'n': sorted.length,
    'p50': percentile(.5),
    'p95': percentile(.95),
    'min': sorted.first,
    'max': sorted.last,
  };
}

void main(List<String> arguments) {
  const payloadBytes = 36541305;
  const strings = 20;
  const repetitions = 16;
  final bytes = Uint8List(payloadBytes + strings * 5);
  final ranges = <(int, int)>[];
  var offset = 0;
  for (var index = 0; index < strings; index++) {
    final length =
        payloadBytes ~/ strings + (index < payloadBytes % strings ? 1 : 0);
    bytes.fillRange(offset, offset + 5, 0xff); // Never consume the wire header.
    offset += 5;
    bytes.fillRange(offset, offset + length, 65 + index % 26);
    ranges.add((offset, offset + length));
    offset += length;
  }
  final samples = <String, List<double>>{'copy': [], 'range': []};
  var checkedCharacters = 0;
  for (var iteration = 0; iteration <= repetitions; iteration++) {
    final order = iteration.isEven ? ['copy', 'range'] : ['range', 'copy'];
    for (final method in order) {
      final decode = method == 'copy' ? decodeCopy : decodeRange;
      final watch = Stopwatch()..start();
      var characters = 0;
      for (var index = 0; index < ranges.length; index++) {
        final (start, end) = ranges[index];
        final decoded = decode(bytes, start, end);
        if (decoded.length != end - start ||
            decoded.codeUnitAt(0) != 65 + index % 26 ||
            decoded.codeUnitAt(decoded.length - 1) != 65 + index % 26) {
          throw StateError('UTF-8 output differs for $method');
        }
        characters += decoded.length;
      }
      watch.stop();
      if (characters != payloadBytes)
        throw StateError('Missing decoded characters');
      checkedCharacters += characters;
      if (iteration > 0) samples[method]!.add(watch.elapsedMicroseconds / 1000);
    }
  }
  final pairedRatios = List<double>.generate(
    repetitions,
    (index) => samples['range']![index] / samples['copy']![index],
  );
  final report = {
    'scope':
        'Synthetic ASCII UTF-8 kernel in native AOT; excludes transport, typed '
        'models, JS, Flutter frames and WebView. No page-performance claim.',
    'payloadBytes': payloadBytes,
    'strings': strings,
    'repetitions': repetitions,
    'firstPairExcluded': true,
    'order': 'Alternates copy/range in each pair',
    'durationsMs': samples.map(
      (key, values) => MapEntry(key, distribution(values)),
    ),
    'pairedRangeOverCopy': distribution(pairedRatios),
    'samplesMs': samples,
    'checkedCharacters': checkedCharacters,
  };
  final json = const JsonEncoder.withIndent('  ').convert(report);
  stdout.writeln(json);
  if (arguments.isNotEmpty) File(arguments.single).writeAsStringSync('$json\n');
}
