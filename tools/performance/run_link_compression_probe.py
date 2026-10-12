#!/usr/bin/env python3
"""Benchmark captured Link payloads with native AOT and the production Dart reader."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def markdown(report):
    lines = ['# Link 真实负载压缩诊断', '', report['scope'], '',
             '这是独立 AOT 探针，不能替代真实页面端到端比较；所有耗时单位为 ms。', '']
    for row in report['payloads']:
        timing = row['timingsMs']
        lines += [f"## {Path(row['path']).name}", '',
                  '| 路径 | 字节数 | 压缩 p50 | 解压 p50 | 含解析合计 p50 | 同轮耗时比 p50 |',
                  '| --- | ---: | ---: | ---: | ---: | ---: |']
        choices = [
            ('raw', '原始复制', None, None, 'raw-copy-parse-ms'),
            ('lz4', 'LZ4 + Dart 解压', 'lz4-compress-ms', 'lz4-dart-decompress-ms', 'lz4-dart-roundtrip-parse-ms'),
            ('lz4', 'LZ4 + 原生解压替代', 'lz4-compress-ms', 'lz4-native-decompress-ms', 'lz4-native-roundtrip-parse-ms'),
            ('zstd1', 'Zstd level 1 + 原生解压替代', 'zstd1-compress-ms', 'zstd1-native-decompress-ms', 'zstd1-native-roundtrip-parse-ms'),
        ]
        for codec, label, compress, decompress, total in choices:
            c = f"{timing[compress]['p50']:.3f}" if compress else '—'
            d = f"{timing[decompress]['p50']:.3f}" if decompress else '—'
            ratio = row['pairedRatioToRaw'].get(total, {'p50': 1})['p50']
            lines.append(f"| {label} | {row['bytes'][codec]:,} | {c} | {d} | {timing[total]['p50']:.3f} | {ratio:.3f} |")
        breakdown = row.get('payloadBreakdown', {})
        lines += ['', f"Map key UTF-8 bytes: {breakdown.get('mapKeyUtf8Bytes', '—')}", '',
                  '| 字符串所在字段 | 数量 | UTF-8 字节数 |', '| --- | ---: | ---: |']
        for item in breakdown.get('stringValuesByField', [])[:8]:
            lines.append(f"| {item['field']} | {item['count']} | {item['utf8Bytes']:,} |")
        lines.append('')
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('payloads', nargs='+', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dart', default=os.environ.get('DART', shutil.which('dart') or '/Users/ylvira/fvm/versions/3.41.9/bin/dart'))
    parser.add_argument('--lz4-library', type=Path, default=Path('/opt/homebrew/lib/liblz4.dylib'))
    parser.add_argument('--zstd-library', type=Path, default=Path('/opt/homebrew/lib/libzstd.dylib'))
    args = parser.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    build = output.parent / 'compression-probe-build'
    build.mkdir(exist_ok=True)
    codec = ROOT / 'apps/flutter/app/lib/core/link/CoreLinkCodec.dart'
    source = codec.read_text()
    # The native codec only depends on Flutter for optional diagnostic logging.
    # Remove that import in the isolated probe; the production reader is copied
    # verbatim. The profiler stays disabled throughout this AOT measurement.
    diagnostic_import = "import 'package:flutter/foundation.dart';"
    if source.count(diagnostic_import) != 1:
        raise ValueError('Expected one platform logging import')
    source = source.replace(diagnostic_import, '')
    source += '\nvoid debugPrintSynchronously(String? message, {int? wrapWidth}) {}\n'
    (build / codec.name).write_text(source)
    protocol = codec.with_name('CoreLinkProtocol.dart')
    shutil.copyfile(protocol, build / protocol.name)
    probe = ROOT / 'tools/performance/link_compression_probe.dart'
    probe_source = probe.read_text().replace(
        "'../../apps/flutter/app/lib/core/link/CoreLinkCodec.dart'", "'CoreLinkCodec.dart'")
    (build / probe.name).write_text(probe_source)
    dart = args.dart
    for library in (args.lz4_library, args.zstd_library):
        if not library.is_file():
            parser.error(f'Missing compression library: {library}; specify its path explicitly')
    executable = build / 'probe'
    subprocess.run([dart, 'compile', 'exe',
                    '--packages=' + str(ROOT / 'apps/flutter/app/.dart_tool/package_config.json'),
                    str(build / probe.name), '-o', str(executable)], check=True)
    subprocess.run([str(executable), str(output), *[str(p.resolve()) for p in args.payloads]], check=True,
                   env={**os.environ, 'OPERIT_LZ4_LIBRARY': str(args.lz4_library.resolve()),
                        'OPERIT_ZSTD_LIBRARY': str(args.zstd_library.resolve())})
    report = json.loads(output.read_text())
    report['productionCodecSha256'] = hashlib.sha256(codec.read_bytes()).hexdigest()
    report['productionProtocolSha256'] = hashlib.sha256(protocol.read_bytes()).hexdigest()
    report['probePlatformAdaptation'] = 'Only the optional Flutter logging import is removed; codec logic is unchanged.'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    output.with_suffix('.md').write_text(markdown(report))


if __name__ == '__main__':
    main()
