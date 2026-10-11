// ignore_for_file: file_names

import 'package:flutter/material.dart';

import 'material_icons.g.dart';

class MaterialIconNameResolver {
  /// Prevents instances of this stateless name resolver.
  const MaterialIconNameResolver._();

  /// Resolves an SDK icon name and rejects unknown names explicitly.
  static IconData resolve(String iconName) {
    final icon = resolveOrNull(iconName);
    if (icon == null) {
      throw ArgumentError.value(iconName, 'iconName', 'Unknown Material icon');
    }
    return icon;
  }

  /// Accepts Flutter snake_case and plugin PascalCase or camelCase names.
  static IconData? resolveOrNull(String? iconName) {
    if (iconName == null) return null;
    final key = iconName
        .trim()
        .replaceAllMapped(
          RegExp(r'([A-Z])([A-Z][a-z])'),
          (m) => '${m[1]}_${m[2]}',
        )
        .replaceAllMapped(
          RegExp(r'([a-z0-9])([A-Z])'),
          (m) => '${m[1]}_${m[2]}',
        )
        .toLowerCase()
        .replaceAll(RegExp(r'_(?=[0-9])|_+$'), '');
    return materialIconsByName[key];
  }

  /// Preserves the explicit default requested by existing navigation callers.
  static IconData resolveOrDefault(String? iconName, IconData defaultIcon) {
    return resolveOrNull(iconName) ?? defaultIcon;
  }
}
