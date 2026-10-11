// ignore_for_file: file_names

import 'dart:async';

/// Broadcasts ToolPkg catalog mutations so navigation surfaces can reload
/// the sidebar entries and routes exposed by enabled packages.
class ToolPkgCatalogChangeBus {
  const ToolPkgCatalogChangeBus._();

  static final StreamController<void> _changes =
      StreamController<void>.broadcast();

  /// Notifies listeners that the package or plugin catalog changed.
  static void notifyCatalogChanged() {
    _changes.add(null);
  }

  /// Subscribes a listener to catalog change events.
  static StreamSubscription<void> listen(void Function() listener) {
    return _changes.stream.listen((_) => listener());
  }
}
