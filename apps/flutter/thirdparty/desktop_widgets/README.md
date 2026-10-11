# desktop_widgets

A Flutter plugin for transparent, content-only desktop widget windows.
The package owns startup dispatch, window creation, and presentation; the embedding application owns
its widget tree, data, refresh policy, and navigation. There is no dependency on
Operit, Rust, a particular DSL, or an application state-management library.

## Current support

| Host | Status |
| --- | --- |
| Windows | Native transparent composition, no frame/title/taskbar item, move, resize, close |
| macOS | Native transparent desktop-window adapter added; device validation pending |
| Linux | GTK transparent-window adapter added; compositor/RGBA required, device validation pending |
| Android | Launcher AppWidget snapshot publication, pin confirmation, persisted instances and click delivery; device validation pending |
| iOS / OpenHarmony | System-widget adapters pending |
| Web | Browser presentation adapter pending |

An unavailable host does not silently open an ordinary application window.
Native transparency has not yet been visually verified on a built Windows runner.
The API is experimental; this is not a published release or a claim of being the
first implementation of this idea.

## Integration

Add the package, then register generated Flutter plugins in every secondary
engine using the `desktop_multi_window` window-created callback. This is the same
registration needed by other plugins used inside secondary engines. Window style
or composition code does not belong in the application's runner.

The package follows Flutter's federated plugin structure, like `webview_all`:

```
desktop_widgets                     public API and widget-engine bootstrap
desktop_widgets_platform_interface  launch, messaging, and presentation contract
desktop_widgets_windows             automatically registered Windows host
desktop_widgets_macos               automatically registered macOS host
desktop_widgets_linux               automatically registered GTK host
desktop_widgets_android             automatically registered launcher AppWidget host
```

`default_package` registration selects the host. The application does not check
operating systems or add widget cases to its own window dispatcher.

Register content once in the application's entrypoint after common initialization:

```dart
await DesktopWidgets.run(
  arguments: arguments,
  application: startNormalApplication,
  widgetBuilder: (launch) => MyWidgetApp(payload: launch.payload),
);
```

Create a window from the owner:

```dart
await DesktopWidgets.setActionHandler(handleWidgetAction);
await DesktopWidgetWindow.open(
  payload: {'city': 'Shanghai'},
);
```

The method-channel host uses `desktop_multi_window` internally for engine creation.
Launch decoding, surface creation, and owner messaging are overridable platform
operations, not assumptions in the public facade or the application. Additional
hosts must implement their actual presentation semantics; mobile system widgets
and browser surfaces are not interchangeable with desktop engine windows.
The bootstrap
recognizes the explicit widget launch envelope, configures the hidden surface,
invokes your builder, and shows the window after the first frame. Applications do
not read widget engine arguments, create widget engines, or configure host windows.

Use a transparent `MaterialApp.color` and `Material(type: MaterialType.transparency)`.
Do not add an opaque Scaffold, application header, card, or padding around the
content unless the widget design itself calls for it. The host retains content
alpha; it does not use a color key or fade the entire window.

Connect long-press to `DesktopWidgetWindow.move()`. A contextual menu can invoke
`resize(Size(...))` or `close()` without adding permanent controls. The returned
window identity supports `invoke`, and the child installs a `setMessageHandler`
for application-defined refresh or content messages.

Windows surfaces are non-taskbar tool windows initially placed below ordinary
application windows. They are not Explorer `WorkerW` children, do not patch the
desktop shell, and are not Windows Widgets-board cards. Their lifetime follows
the embedding application. Auto-start, persistent placement, and restarting after
Explorer/application termination are not implemented yet.

Linux requires an active compositor and an RGBA visual on the engine window.
The adapter clears both GTK and Flutter backgrounds, hides decorations, and
supports pointer-driven movement, resize, and close. A window created with an
opaque visual is rejected; changing that visual after engine startup is unsafe.
`desktop_multi_window` currently controls engine-window creation, so Linux
desktop environments that create its windows without RGBA are not yet supported.
GTK's below/taskbar/pager hints are compositor requests: Wayland does not provide
the same desktop-layer guarantees as X11. This is not a Wayland layer-shell host.
Native GTK behavior has not been tested on a Linux machine in this change.

## Android launcher widgets

Android uses `AppWidgetProvider` and `RemoteViews`, never a Flutter overlay or a
`SYSTEM_ALERT_WINDOW` permission. Its rendering mode is explicitly a PNG snapshot
with one widget-wide action, because a launcher cannot embed a Flutter view.
Register an application-lifetime content provider before publishing. It loads fresh
data and uses the same Flutter content builder used by other presentation hosts:

```dart
await DesktopWidgets.setSnapshotRenderer(renderCurrentWidgetContent);
await DesktopWidgetWindow.open(
  payload: {'contentId': 'clock'},
);
```

`DesktopWidgetRasterizer.render` captures a fresh Flutter subtree without requiring
a visible gallery preview. Desktop window hosts render their content directly.
Android's launcher
confirms placement (Android 8+ with pin support); the returned ID identifies the
publication request, not a confirmed placement. Register
`DesktopWidgets.setActionHandler` after the application's navigation is ready to
handle both warm and cold-start clicks. Remove that handler when its owner closes.
Frames and bindings persist in application-private storage. The launcher picker
can select previously published frames through the plugin's configuration activity.
Moving, resizing, and removing instances are controlled by the launcher.

Publish new content explicitly with
`window.invoke('updateSnapshot', updatedSnapshot.toMap())`; all instances of that
publication are updated. `DesktopWidgets.refreshSnapshots()` reloads all confirmed
publications through the registered content provider. The Android adapter performs
this refresh at registration, on resume, and every 30 minutes while resumed. Renders
are serialized; unregistering the provider invalidates pending results. Render
failures display an explicit error on the affected launcher instances.
The application's provider uses the same `ToolPkgDesktopWidgetFrame.load` and
`buildContent` as previews and desktop windows: there is no separate DSL renderer.
This adapter does **not** start a background runtime after the application exits;
launcher recreation only reapplies persisted pixels in that state.
Do not use this version for live clocks or other continuously updating data.
Raster snapshots have one click target, not interactive TextFields or per-control
actions. They contain at most 262144 pixels; animations and outstanding image loads
are the content provider's responsibility. No native Android build/device validation
has been performed for this implementation.

## Development

The Dart layer contains no operating-system checks. Native adapters implement the
`desktop_widgets/window` channel. The public operations validate sizes and preserve
explicit host errors. Widget content and business routing remain outside the
plugin. The current implementation reuses `desktop_multi_window`; it does not
claim to replace its engine manager.

This package currently follows the repository's AGPL-3.0 license. A different
standalone distribution license must be selected by the copyright owner.
