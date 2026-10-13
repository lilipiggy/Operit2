import 'dart:async';
import 'dart:typed_data';
import 'package:operit2/data/preferences/UserPreferencesManager.dart';
import 'package:operit2/ui/theme/OperitTheme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit2/core/bridge/OperitRuntimeBridge.dart';
import 'package:operit2/core/link/CoreLinkCodec.dart';
import 'package:operit2/core/link/CoreLinkProtocol.dart';
import 'package:operit2/core/proxy/generated/CoreProxyClients.g.dart';
import 'package:operit2/core/proxy/generated/CoreProxyModels.g.dart'
    as core_proxy;
import 'package:operit2/ui/features/packages/screens/PackageManagerScreen.dart';
import 'package:operit2/ui/features/packages/dialogs/PackageEnvironmentVariablesDialog.dart';
import 'package:operit2/ui/main/navigation/ToolPkgCatalogChangeBus.dart';
import 'package:operit2/ui/common/components/RetainedPage.dart';
import 'package:operit2/ui/common/contributions/ChatSidebarTabHost.dart';

/// Verifies installation notifications update an already mounted package list.
void main() {
  for (final selection in <String>[
    chatSidebarTabIdentity('demo_toolpkg', 'sidebar-demo'),
    chatSidebarTabIdentity('another_toolpkg', 'sidebar-demo'),
    UserPreferencesManager.CHAT_SIDEBAR_WORKSPACE_TAB,
  ]) {
    testWidgets(
      'disabling a plugin updates only its selected tab: $selection',
      (tester) async {
        final bridge = _CatalogBridge()
          ..installed = true
          ..enabled = true;
        bridge.preferences['chat_sidebar_tab_v1'] = selection;
        final selectionsAtNotification = <String?>[];
        final subscription = ToolPkgCatalogChangeBus.listen(() {
          selectionsAtNotification.add(
            bridge.preferences['chat_sidebar_tab_v1'],
          );
        });
        addTearDown(subscription.cancel);
        await tester.pumpWidget(_manager(bridge));
        await tester.pumpAndSettle();
        expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);
        await tester.tap(find.byType(Switch));
        await tester.pumpAndSettle();
        final expected =
            selection == chatSidebarTabIdentity('demo_toolpkg', 'sidebar-demo')
            ? UserPreferencesManager.CHAT_SIDEBAR_WORKSPACE_TAB
            : selection;
        expect(bridge.enabled, isFalse);
        expect(bridge.preferences['chat_sidebar_tab_v1'], expected);
        expect(selectionsAtNotification, [expected]);
        expect(
          bridge.mutations,
          expected != selection ? ['disable', 'selection'] : ['disable'],
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('failed plugin disable keeps the current sidebar selection', (
    tester,
  ) async {
    final bridge = _CatalogBridge()
      ..installed = true
      ..enabled = true
      ..disableError = StateError('Disable rejected');
    final selection = chatSidebarTabIdentity('demo_toolpkg', 'sidebar-demo');
    bridge.preferences['chat_sidebar_tab_v1'] = selection;
    var notifications = 0;
    final subscription = ToolPkgCatalogChangeBus.listen(() => notifications++);
    addTearDown(subscription.cancel);
    await tester.pumpWidget(_manager(bridge));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(bridge.enabled, isTrue);
    expect(bridge.preferences['chat_sidebar_tab_v1'], selection);
    expect(bridge.mutations, isEmpty);
    expect(notifications, 0);
    expect(find.textContaining('Disable rejected'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('catalog change refreshes list without reopening or rescanning', (
    tester,
  ) async {
    final bridge = _CatalogBridge();
    await tester.pumpWidget(
      OperitTheme(
        initialThemePreferenceSnapshot:
            UserPreferencesManager.defaultThemePreferenceSnapshot,
        initialThemeIsReady: false,
        unconfiguredChildEnabled: true,
        hostInteractionHostsEnabled: false,
        child: PackageManagerScreen(clients: GeneratedCoreProxyClients(bridge)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Demo ToolPkg'), findsNothing);
    final state = tester.state(find.byType(PackageManagerScreen));
    bridge.installed = true;
    ToolPkgCatalogChangeBus.notifyCatalogChanged();
    await tester.pumpAndSettle();
    expect(find.text('Demo ToolPkg'), findsOneWidget);
    expect(tester.state(find.byType(PackageManagerScreen)), same(state));
    expect(bridge.scans, 1);
    bridge.installed = false;
    ToolPkgCatalogChangeBus.notifyCatalogChanged();
    await tester.pumpAndSettle();
    expect(find.text('Demo ToolPkg'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    ToolPkgCatalogChangeBus.notifyCatalogChanged();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('cached manager stops catalog work and refreshes on activation', (
    tester,
  ) async {
    final bridge = _CatalogBridge();
    final active = ValueNotifier<bool>(true);
    addTearDown(active.dispose);
    await tester.pumpWidget(
      OperitTheme(
        initialThemePreferenceSnapshot:
            UserPreferencesManager.defaultThemePreferenceSnapshot,
        initialThemeIsReady: false,
        unconfiguredChildEnabled: true,
        hostInteractionHostsEnabled: false,
        child: ValueListenableBuilder<bool>(
          valueListenable: active,
          child: PackageManagerScreen(
            clients: GeneratedCoreProxyClients(bridge),
          ),
          builder: (context, visible, child) =>
              RetainedPage(active: visible, child: child!),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final state = tester.state(find.byType(PackageManagerScreen));
    expect(bridge.watchers, 1);
    active.value = false;
    await tester.pumpAndSettle();
    expect(bridge.watchers, 0);
    final reads = bridge.catalogReads;
    bridge.installed = true;
    for (var i = 0; i < 4; i += 1) {
      ToolPkgCatalogChangeBus.notifyCatalogChanged();
      await tester.pump(const Duration(milliseconds: 400));
    }
    expect(bridge.catalogReads, reads);
    expect(
      tester.state(find.byType(PackageManagerScreen, skipOffstage: false)),
      same(state),
    );
    active.value = true;
    await tester.pumpAndSettle();
    expect(bridge.watchers, 1);
    expect(bridge.catalogReads, greaterThan(reads));
    expect(find.text('Demo ToolPkg'), findsOneWidget);
    expect(tester.state(find.byType(PackageManagerScreen)), same(state));
    await tester.pumpWidget(const SizedBox.shrink());
    expect(bridge.watchers, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('package manager action opens the runtime environment editor', (
    tester,
  ) async {
    final bridge = _CatalogBridge();
    await tester.pumpWidget(
      OperitTheme(
        initialThemePreferenceSnapshot:
            UserPreferencesManager.defaultThemePreferenceSnapshot,
        initialThemeIsReady: false,
        unconfiguredChildEnabled: true,
        hostInteractionHostsEnabled: false,
        child: PackageManagerScreen(clients: GeneratedCoreProxyClients(bridge)),
      ),
    );
    await tester.pumpAndSettle();
    final action = find.ancestor(
      of: find.byIcon(Icons.settings_outlined),
      matching: find.byType(FloatingActionButton),
    );
    expect(action, findsOneWidget);
    await tester.tap(action);
    await tester.pumpAndSettle();
    expect(find.byType(PackageEnvironmentVariablesDialog), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(PackageEnvironmentVariablesDialog),
        matching: find.byType(TextField),
      ),
      findsNothing,
    );
    expect(bridge.environmentCatalogReads, 1);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
}

/// Mounts the production package controls with the supplied runtime bridge.
Widget _manager(_CatalogBridge bridge) => OperitTheme(
  initialThemePreferenceSnapshot:
      UserPreferencesManager.defaultThemePreferenceSnapshot,
  initialThemeIsReady: false,
  unconfiguredChildEnabled: true,
  hostInteractionHostsEnabled: false,
  child: PackageManagerScreen(clients: GeneratedCoreProxyClients(bridge)),
);

class _CatalogBridge extends OperitRuntimeBridge {
  /// Rejects push operations outside this catalog fixture.
  @override
  Future<CorePushSink> push(CorePushRequest request) =>
      throw UnimplementedError();

  /// Rejects snapshot watches outside this catalog fixture.
  @override
  Future<CoreEvent> watchSnapshot(CoreWatchRequest request) =>
      throw UnimplementedError();

  /// Exposes the catalog revision stream with observable listener ownership.
  @override
  Stream<CoreEvent> watchStream(CoreWatchRequest request) {
    if (request.propertyName != 'extensionCatalogRevisionFlow') {
      throw StateError('Unexpected catalog watch: ${request.propertyName}');
    }
    return Stream<CoreEvent>.multi((controller) {
      watchers += 1;
      controller.onCancel = () => watchers -= 1;
    });
  }

  bool installed = false;
  bool enabled = false;
  Object? disableError;
  final preferences = <String, String>{};
  final mutations = <String>[];
  int scans = 0;
  int watchers = 0;
  int catalogReads = 0;
  int environmentCatalogReads = 0;

  /// Encodes catalog responses with the native bridge envelope.
  @override
  Future<Uint8List> callBytes(CoreCallRequest request) async =>
      encodeCoreLink(<Object?>[0, await call(request)]);

  /// Returns the catalog state available at the time of each request.
  @override
  Future<Object?> call(CoreCallRequest request) async {
    switch (request.methodName) {
      case 'loadAvailablePackages':
        scans++;
        return null;
      case 'getAvailablePackages':
        environmentCatalogReads++;
        return <String, Object?>{};
      case 'getExtensionScopes':
        return installed
            ? <String, Object?>{'demo_toolpkg': 'device'}
            : <String, Object?>{};
      case 'getExecutableAvailablePackages':
        return <String, Object?>{};
      case 'getToolPkgContainerRuntimes':
        catalogReads += 1;
        return installed ? [_pluginRuntime().toJson()] : [];
      case 'getEnabledPackageNames':
        return installed && enabled ? ['demo_toolpkg'] : [];
      case 'disableToolPkgContainer':
        expect((request.args as Map)['containerPackageName'], 'demo_toolpkg');
        if (disableError case final Object error) throw error;
        enabled = false;
        mutations.add('disable');
        return 'Disabled';
      case 'getPreferences':
        expect(
          (request.args as Map)['fileName'],
          'user_preferences.preferences.json',
        );
        return Map<String, String>.of(preferences);
      case 'setPreferences':
        expect(
          (request.args as Map)['fileName'],
          'user_preferences.preferences.json',
        );
        preferences.addAll(
          ((request.args as Map)['values'] as Map).cast<String, String>(),
        );
        mutations.add('selection');
        return null;
      case 'getToolPkgContainerOrder':
      case 'getBundledExternalPackageCandidates':
      case 'getBundledExternalToolPkgContainerRuntimes':
      case 'getToolPkgLoadIssues':
        return [];
    }
    throw StateError('Unexpected catalog call: ${request.methodName}');
  }
}

/// Creates an installed plugin fixture for catalog refresh assertions.
core_proxy.ToolPkgContainerRuntime _pluginRuntime() {
  return const core_proxy.ToolPkgContainerRuntime(
    chatLifecycleHooks: [],
    packageName: 'demo_toolpkg',
    displayName: core_proxy.LocalizedText(
      values: <String, String>{'default': 'Demo ToolPkg'},
    ),
    description: core_proxy.LocalizedText(
      values: <String, String>{'default': 'DSL test package'},
    ),
    version: '1.0.0',
    apiVersion: '2.0.0',
    publicApi: null,
    publicApis: <core_proxy.ToolPkgRegisteredFunctionHook>[],
    requires: <core_proxy.ToolPkgManifestRequirement>[],
    dependencyIssues: <core_proxy.ToolPkgDependencyIssue>[],
    manifestExtensions: <String, Object?>{},
    author: <String>['Operit'],
    mainEntry: 'dist/main.js',
    sourceType: core_proxy.ToolPkgSourceType.externalValue,
    sourcePath: 'test',
    subpackages: <core_proxy.ToolPkgSubpackageRuntime>[],
    resources: <core_proxy.ToolPkgResourceRuntime>[],
    wasmModules: <core_proxy.ToolPkgWasmModuleRuntime>[],
    workflowTemplates: <core_proxy.ToolPkgWorkflowTemplateRuntime>[],
    workspaceTemplates: <core_proxy.ToolPkgWorkspaceTemplateRuntime>[],
    uiModules: <core_proxy.ToolPkgUiModuleRuntime>[
      core_proxy.ToolPkgUiModuleRuntime(
        id: 'main',
        runtime: 'compose_dsl',
        screenExport: null,
        screen: 'ui/main.js',
        title: core_proxy.LocalizedText(
          values: <String, String>{'default': 'Main route'},
        ),
        keepAlive: true,
      ),
    ],
    uiRoutes: <core_proxy.ToolPkgUiRouteRuntime>[
      core_proxy.ToolPkgUiRouteRuntime(
        id: 'main',
        routeId: 'main',
        runtime: 'compose_dsl',
        screenExport: null,
        screen: 'ui/main.js',
        title: core_proxy.LocalizedText(
          values: <String, String>{'default': 'Main route'},
        ),
        keepAlive: true,
      ),
    ],
    chatComposerSlots: <core_proxy.ToolPkgChatComposerSlotRuntime>[],
    navigationEntries: <core_proxy.ToolPkgNavigationEntryRuntime>[
      core_proxy.ToolPkgNavigationEntryRuntime(
        id: 'sidebar-demo',
        routeId: 'main',
        params: null,
        surface: 'chat_sidebar_tabs',
        title: core_proxy.LocalizedText(
          values: <String, String>{'default': 'Demo sidebar'},
        ),
        action: null,
        icon: null,
        order: 0,
      ),
    ],
    desktopWidgets: <core_proxy.ToolPkgDesktopWidgetRuntime>[],
    appLifecycleHooks: <core_proxy.ToolPkgAppLifecycleHookRuntime>[],
    messageProcessingPlugins: <core_proxy.ToolPkgFunctionHookRuntime>[],
    xmlRenderPlugins: <core_proxy.ToolPkgTagFunctionHookRuntime>[],
    inputMenuTogglePlugins: <core_proxy.ToolPkgFunctionHookRuntime>[],
    chatInputHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    chatViewHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    chatMessageHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    chatMessageMenuItems: <core_proxy.ToolPkgChatMessageMenuItemRuntime>[],
    chatRuntimeHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    hostEventHooks: <core_proxy.ToolPkgHostEventHookRuntime>[],
    toolLifecycleHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    promptInputHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    promptHistoryHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    promptEstimateHistoryHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    systemPromptComposeHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    toolPromptComposeHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    promptFinalizeHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    promptEstimateFinalizeHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    summaryGenerateHooks: <core_proxy.ToolPkgFunctionHookRuntime>[],
    coreCommands: <core_proxy.ToolPkgCoreCommandRuntime>[],
    aiProviders: <core_proxy.ToolPkgAiProviderRuntime>[],
    manifestExtensionHandlers:
        <core_proxy.ToolPkgRegisteredManifestExtension>[],
    logoResource: null,
    marketOrigin: null,
  );
}
