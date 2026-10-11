// ignore_for_file: file_names

import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

import '../proxy/generated/CoreProxyClients.g.dart';

/// Transfers development packages through the authenticated VM service.
class PluginHotReload {
  static final revision = ValueNotifier<int>(0);
  static bool _registered = false;

  /// Registers a debug-only endpoint using the runtime storage host.
  static void register(GeneratedCoreProxyClients clients) {
    if (!kDebugMode || _registered) return;
    _registered = true;
    final uploads = <String, StringBuffer>{};
    developer.registerExtension('ext.operit.reloadPlugins', (
      method,
      args,
    ) async {
      try {
        final action = args['action'];
        final name = args['name'];
        switch (action) {
          case 'begin':
            uploads.clear();
          case 'chunk':
            if (name == null ||
                !RegExp(r'^[a-zA-Z0-9_.-]+\.(js|toolpkg)$').hasMatch(name)) {
              throw ArgumentError('Invalid package file name');
            }
            uploads.putIfAbsent(name, StringBuffer.new).write(args['content']!);
          case 'commit':
            if (uploads.isEmpty) throw StateError('No packages uploaded');
            final manager = clients.application.packageManager();
            final root = await clients.repositoryRuntimeStorageRepository
                .externalPackagesDirPath();
            for (final entry in uploads.entries) {
              await clients.repositoryRuntimeStorageRepository.writeBase64(
                path: '$root/${entry.key}',
                base64Content: entry.value.toString(),
              );
            }
            await manager.loadAvailablePackages();
            uploads.clear();
            revision.value += 1;
          default:
            throw ArgumentError('Unknown hot reload action');
        }
        return developer.ServiceExtensionResponse.result(
          jsonEncode({'ok': true}),
        );
      } catch (error) {
        uploads.clear();
        return developer.ServiceExtensionResponse.error(
          developer.ServiceExtensionResponse.extensionError,
          error.toString(),
        );
      }
    });
  }
}
