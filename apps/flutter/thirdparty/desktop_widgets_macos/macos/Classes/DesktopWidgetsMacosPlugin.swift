import Cocoa
import FlutterMacOS

/// Presents plugin content through a transparent, undecorated macOS desktop window.
public final class DesktopWidgetsMacosPlugin: NSObject, FlutterPlugin {
    private weak var view: NSView?
    private var configured = false

    /// Retains only the engine's view, never another application's window.
    private init(view: NSView?) {
        self.view = view
        super.init()
    }

    /// Registers the same transport contract used by every desktop host implementation.
    public static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(name: "desktop_widgets/window", binaryMessenger: registrar.messenger)
        registrar.addMethodCallDelegate(DesktopWidgetsMacosPlugin(view: registrar.view), channel: channel)
    }

    /// Decodes validated logical content dimensions.
    private func size(_ arguments: Any?) throws -> NSSize {
        guard let values = arguments as? [String: Any],
              let width = values["width"] as? NSNumber,
              let height = values["height"] as? NSNumber,
              width.doubleValue.isFinite, height.doubleValue.isFinite,
              (120...2048).contains(width.doubleValue),
              (120...2048).contains(height.doubleValue) else {
            throw NSError(domain: "desktop_widgets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid widget dimensions"])
        }
        return NSSize(width: width.doubleValue, height: height.doubleValue)
    }

    /// Executes only operations on the window associated with this engine.
    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        guard let window = view?.window else {
            result(FlutterError(code: "WIDGET_WINDOW_CLOSED", message: "The widget engine has no window", details: nil))
            return
        }
        do {
            switch call.method {
            case "requireSupport":
                result(nil)
            case "configure":
                guard let arguments = call.arguments as? [String: Any],
                      arguments["role"] as? String == "desktop_widgets.window" else {
                    result(FlutterError(code: "INVALID_ROLE", message: "An explicit widget role is required", details: nil))
                    return
                }
                let contentSize = try size(call.arguments)
                window.styleMask = [.borderless]
                window.isOpaque = false
                window.backgroundColor = .clear
                window.hasShadow = false
                window.titleVisibility = .hidden
                window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
                window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
                view?.wantsLayer = true
                view?.layer?.backgroundColor = NSColor.clear.cgColor
                window.setContentSize(contentSize)
                configured = true
                result(nil)
            case "show", "move", "resize", "close":
                guard configured else {
                    result(FlutterError(code: "NOT_CONFIGURED", message: "Configure the widget first", details: nil))
                    return
                }
                switch call.method {
                case "show": window.orderFrontRegardless(); result(nil)
                case "resize": window.setContentSize(try size(call.arguments)); result(nil)
                case "move":
                    guard let event = NSApp.currentEvent else {
                        result(FlutterError(code: "NO_POINTER_EVENT", message: "Moving a widget requires a pointer event", details: nil))
                        return
                    }
                    result(nil)
                    window.performDrag(with: event)
                case "close":
                    result(nil)
                    DispatchQueue.main.async { window.close() }
                default: break
                }
            default: result(FlutterMethodNotImplemented)
            }
        } catch {
            result(FlutterError(code: "DESKTOP_WIDGET_WINDOW_ERROR", message: error.localizedDescription, details: nil))
        }
    }
}
