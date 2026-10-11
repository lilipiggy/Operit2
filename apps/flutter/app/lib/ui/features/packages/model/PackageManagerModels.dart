// ignore_for_file: file_names

import '../../../../core/proxy/generated/CoreProxyModels.g.dart' as core_proxy;

class PackageManagerSnapshot {
  const PackageManagerSnapshot({
    required this.availablePackages,
    required this.enabledPackageNames,
    required this.pluginContainers,
    required this.pluginContainerOrder,
    required this.enabledPluginContainerNames,
    required this.bundledExternalCandidates,
    required this.pluginLoadIssues,
  });

  factory PackageManagerSnapshot.empty() {
    return const PackageManagerSnapshot(
      availablePackages: <String, core_proxy.ToolPackage>{},
      enabledPackageNames: <String>{},
      pluginContainers: <core_proxy.ToolPkgContainerRuntime>[],
      pluginContainerOrder: <String>[],
      enabledPluginContainerNames: <String>{},
      bundledExternalCandidates: <core_proxy.BundledExternalPackageCandidate>[],
      pluginLoadIssues: <core_proxy.ToolPkgLoadIssue>[],
    );
  }

  final Map<String, core_proxy.ToolPackage> availablePackages;
  final Set<String> enabledPackageNames;
  final List<core_proxy.ToolPkgContainerRuntime> pluginContainers;
  final List<String> pluginContainerOrder;
  final Set<String> enabledPluginContainerNames;
  final List<core_proxy.BundledExternalPackageCandidate>
  bundledExternalCandidates;
  final List<core_proxy.ToolPkgLoadIssue> pluginLoadIssues;

  bool get isEmpty =>
      availablePackages.isEmpty &&
      pluginContainers.isEmpty &&
      bundledExternalCandidates.isEmpty &&
      pluginLoadIssues.isEmpty;

  PackageManagerSnapshot copyWith({
    Set<String>? enabledPackageNames,
    Set<String>? enabledPluginContainerNames,
    List<String>? pluginContainerOrder,
    List<core_proxy.ToolPkgLoadIssue>? pluginLoadIssues,
  }) {
    return PackageManagerSnapshot(
      availablePackages: availablePackages,
      enabledPackageNames: enabledPackageNames ?? this.enabledPackageNames,
      pluginContainers: pluginContainers,
      pluginContainerOrder: pluginContainerOrder ?? this.pluginContainerOrder,
      enabledPluginContainerNames:
          enabledPluginContainerNames ?? this.enabledPluginContainerNames,
      bundledExternalCandidates: bundledExternalCandidates,
      pluginLoadIssues: pluginLoadIssues ?? this.pluginLoadIssues,
    );
  }
}
