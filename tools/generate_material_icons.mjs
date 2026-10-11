import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Generates the complete icon index from the project's FVM Flutter SDK. */
function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = readFileSync(resolve(root, 'apps/flutter/app/.fvm/flutter_sdk/packages/flutter/lib/src/material/icons.dart'), 'utf8');
  const names = [...source.matchAll(/static const IconData\s+([A-Za-z0-9_]+)\s*=/g)].map(match => match[1]);
  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new Error('Expected unique static IconData declarations in Flutter Icons');
  }
  const keys = names.map(name => name.replace(/_(?=[0-9])|_+$/g, ''));
  if (new Set(keys).size !== keys.length) {
    throw new Error('Canonical Material icon names must remain distinct');
  }
  const output = [
    '// GENERATED CODE - DO NOT EDIT.',
    '// Source: FVM Flutter SDK packages/flutter/lib/src/material/icons.dart.',
    '// Regenerate: node tools/generate_material_icons.mjs',
    '// ignore_for_file: deprecated_member_use',
    '',
    "import 'package:flutter/material.dart';",
    '',
    '/// Complete index of the static Material icon constants in the Flutter SDK.',
    'const materialIconsByName = <String, IconData>{',
    ...names.map((name, index) => `  '${keys[index]}': Icons.${name},`),
    '};',
    '',
  ].join('\n');
  const target = resolve(root, 'apps/flutter/app/lib/ui/common/icons/material_icons.g.dart');
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== output) {
      throw new Error('Material icon index differs from the FVM SDK; regenerate it');
    }
  } else {
    writeFileSync(target, output);
  }
  console.log(`Validated ${names.length} Flutter Icons declarations.`);
}

main();
