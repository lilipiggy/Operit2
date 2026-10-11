// ignore_for_file: file_names

class WorkspaceCharacterUsage {
  /// Creates one character-card usage record for a workspace overview.
  const WorkspaceCharacterUsage({
    required this.name,
    required this.avatarUri,
    required this.conversationCount,
  });

  final String name;
  final String? avatarUri;
  final int conversationCount;
}

class WorkspaceMountedFolder {
  /// Creates one mounted folder record for a workspace overview.
  const WorkspaceMountedFolder({
    required this.name,
    required this.path,
    required this.relativePath,
  });

  final String name;
  final String path;
  final String relativePath;
}

class WorkspaceOverviewUsage {
  /// Creates the aggregated usage snapshot for a workspace overview.
  const WorkspaceOverviewUsage({
    required this.workspaceName,
    required this.conversationCount,
    required this.characterUsages,
    required this.mountedFolders,
    required this.mountedFoldersLoading,
    required this.mountedFoldersError,
  });

  static const WorkspaceOverviewUsage empty = WorkspaceOverviewUsage(
    workspaceName: null,
    conversationCount: 0,
    characterUsages: <WorkspaceCharacterUsage>[],
    mountedFolders: <WorkspaceMountedFolder>[],
    mountedFoldersLoading: false,
    mountedFoldersError: null,
  );

  final String? workspaceName;
  final int conversationCount;
  final List<WorkspaceCharacterUsage> characterUsages;
  final List<WorkspaceMountedFolder> mountedFolders;
  final bool mountedFoldersLoading;
  final String? mountedFoldersError;
}
