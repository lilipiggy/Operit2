import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:operit2/ui/main/layout/SidebarDockController.dart';
import 'package:operit2/ui/main/layout/SidebarDockPreferences.dart';
import 'package:operit2/ui/main/navigation/AppNavigationModels.dart';

void main() {
  test('moves dockable plugin entries between sidebar zones', () {
    final controller = SidebarDockController();
    final pluginRoute = const RouteSpec(
      routeId: 'plugin.route',
      runtime: RouteRuntime.toolPkgComposeDsl,
      ownerPackageName: 'plugin',
      toolPkgUiModuleId: 'module',
    );
    final actionRoute = const RouteSpec(
      routeId: 'action.route',
      runtime: RouteRuntime.native,
    );
    final dockable = const NavigationEntrySpec(
      entryId: 'plugin.entry',
      routeId: 'plugin.route',
      surface: NavigationSurface.mainSidebarPlugins,
      title: 'Plugin',
      icon: Icons.extension_outlined,
      kind: NavigationEntryKind.plugin,
    );
    final actionOnly = const NavigationEntrySpec(
      entryId: 'action.entry',
      routeId: 'action.route',
      surface: NavigationSurface.mainSidebarPlugins,
      title: 'Action',
      icon: Icons.bolt_outlined,
      action: NavigationEntryActionSpec(functionName: 'run'),
      kind: NavigationEntryKind.plugin,
    );

    controller.synchronize(
      pluginEntries: <NavigationEntrySpec>[dockable, actionOnly],
      routesById: <String, RouteSpec>{
        pluginRoute.routeId: pluginRoute,
        actionRoute.routeId: actionRoute,
      },
    );

    expect(controller.primaryEntries.map((entry) => entry.entryId), <String>[
      'plugin.entry',
      'action.entry',
    ]);
    expect(
      controller.canMove('plugin.entry', SidebarDockLocation.secondary),
      isTrue,
    );
    expect(
      controller.canMove('action.entry', SidebarDockLocation.secondary),
      isFalse,
    );

    controller.move(
      'plugin.entry',
      location: SidebarDockLocation.secondary,
      insertionIndex: 0,
    );

    expect(controller.primaryEntries.map((entry) => entry.entryId), <String>[
      'action.entry',
    ]);
    expect(
      controller.secondaryViews.map((view) => view.entry.entryId),
      <String>['plugin.entry'],
    );
    expect(controller.selectedSecondaryViewId, 'plugin.entry');

    controller.dispose();
  });

  test('round-trips the persisted sidebar layout schema', () {
    const layout = SidebarDockLayout(
      primaryEntryIds: <String>['one'],
      secondaryEntryIds: <String>['two'],
      selectedSecondaryViewId: 'two',
    );

    expect(
      SidebarDockLayout.fromJson(layout.toJson()).primaryEntryIds,
      <String>['one'],
    );
    expect(
      SidebarDockLayout.fromJson(layout.toJson()).secondaryEntryIds,
      <String>['two'],
    );
    expect(
      SidebarDockLayout.fromJson(layout.toJson()).selectedSecondaryViewId,
      'two',
    );
    expect(
      () => SidebarDockLayout.fromJson(<String, Object?>{
        'version': 1,
        'primaryEntryIds': <String>['same'],
        'secondaryEntryIds': <String>['same'],
        'selectedSecondaryViewId': 'same',
      }),
      throwsFormatException,
    );
  });
}
