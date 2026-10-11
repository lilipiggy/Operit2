// ignore_for_file: file_names

import 'package:flutter/material.dart';
import 'package:desktop_widgets/desktop_widgets.dart';

import '../../../../core/proxy/generated/CoreProxyClients.g.dart';
import '../../../../core/proxy/generated/CoreProxyModels.g.dart' as core_proxy;
import '../../../../l10n/generated/app_localizations.dart';
import 'ToolPkgUiLauncherScreen.dart';

/// Shows a package's registered widget render routes through the shared Flutter host.
class ToolPkgDesktopWidgetsScreen extends StatefulWidget {
  /// Creates the widget gallery for one enabled package.
  const ToolPkgDesktopWidgetsScreen({
    super.key,
    required this.clients,
    required this.plugin,
  });

  final GeneratedCoreProxyClients clients;
  final core_proxy.ToolPkgContainerRuntime plugin;

  /// Creates localized registration loading state.
  @override
  State<ToolPkgDesktopWidgetsScreen> createState() =>
      _ToolPkgDesktopWidgetsScreenState();
}

class _ToolPkgDesktopWidgetsScreenState
    extends State<ToolPkgDesktopWidgetsScreen> {
  Future<List<core_proxy.ToolPkgDesktopWidget>>? _widgets;
  String? _language;

  /// Creates a desktop content window and displays explicit host errors to the user.
  Future<void> _addToDesktop(core_proxy.ToolPkgDesktopWidget definition) async {
    try {
      await DesktopWidgetWindow.open(
        payload: {
          'instanceId': 'desktop:${DateTime.now().microsecondsSinceEpoch}',
          'definition': definition.toJson(),
          'locale': Localizations.localeOf(context).languageCode,
        },
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  /// Loads only registrations exposed by currently enabled packages.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final language = Localizations.localeOf(context).languageCode;
    if (language != _language) {
      _language = language;
      _widgets = widget.clients.application
          .packageManager()
          .getToolPkgDesktopWidgets(useEnglish: language == 'en')
          .then(
            (values) => values
                .where(
                  (item) =>
                      item.containerPackageName == widget.plugin.packageName,
                )
                .toList(),
          );
    }
  }

  /// Opens the registration's application route rather than its widget render route.
  Future<void> _openRoute(String packageName, String routeId) async {
    if (packageName != widget.plugin.packageName) {
      throw StateError('Widget route belongs to another package: $packageName');
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ToolPkgUiLauncherScreen(
          clients: widget.clients,
          plugin: widget.plugin,
          initialRouteId: routeId,
        ),
      ),
    );
  }

  /// Displays independently refreshable widget instances in responsive cards.
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          AppLocalizations.of(
            context,
          )!.desktopWidgetsCount(widget.plugin.desktopWidgets.length),
        ),
      ),
      body: FutureBuilder<List<core_proxy.ToolPkgDesktopWidget>>(
        future: _widgets,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(child: Text(snapshot.error.toString()));
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final definitions = snapshot.data!;
          return GridView.builder(
            padding: const EdgeInsets.all(16),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 480,
              mainAxisExtent: 320,
              mainAxisSpacing: 16,
              crossAxisSpacing: 16,
            ),
            itemCount: definitions.length,
            itemBuilder: (context, index) {
              final definition = definitions[index];
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        definition.title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: () => _addToDesktop(definition),
                          icon: const Icon(Icons.add_to_home_screen),
                          label: Text(
                            _language == 'en' ? 'Add to desktop' : '添加到桌面',
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: ToolPkgDesktopWidgetView(
                          key: ValueKey(definition.widgetId),
                          clients: widget.clients,
                          definition: definition,
                          instanceId:
                              'preview:${definition.containerPackageName}:${definition.widgetId}',
                          onOpenRoute: _openRoute,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
