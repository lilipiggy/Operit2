#include "include/desktop_widgets_windows/desktop_widgets_plugin.h"
#include <flutter/plugin_registrar_windows.h>

#include <dwmapi.h>
#include <flutter/method_channel.h>
#include <flutter/standard_method_codec.h>
#include <windows.h>

#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>


namespace {
using Value = flutter::EncodableValue;
using Map = flutter::EncodableMap;

/// Owns a channel whose HWND belongs exclusively to one Flutter engine.
struct WidgetWindow {
  HWND window;
  HWND view;
  bool configured = false;
  std::unique_ptr<flutter::MethodChannel<Value>> channel;
};

/// Converts an explicit logical dimension to physical pixels at the window DPI.
int Dimension(const Map& arguments, const char* key, HWND window) {
  const auto entry = arguments.find(Value(key));
  if (entry == arguments.end()) throw std::invalid_argument("Missing window dimension");
  double number;
  if (const auto double_value = std::get_if<double>(&entry->second)) {
    number = *double_value;
  } else if (const auto integer_value = std::get_if<int32_t>(&entry->second)) {
    number = static_cast<double>(*integer_value);
  } else {
    throw std::invalid_argument("Window dimensions must be numeric");
  }
  if (!std::isfinite(number) || number < 120 || number > 2048) {
    throw std::invalid_argument("Window dimensions must be between 120 and 2048 logical pixels");
  }
  return static_cast<int>(std::lround(number * GetDpiForWindow(window) / 96.0));
}

/// Changes a window style while distinguishing a valid zero result from an error.
void SetStyle(HWND window, int index, LONG_PTR value) {
  SetLastError(ERROR_SUCCESS);
  const auto previous = SetWindowLongPtr(window, index, value);
  if (previous == 0 && GetLastError() != ERROR_SUCCESS) {
    throw std::runtime_error("Unable to configure desktop widget window style");
  }
}

/// Enables alpha composition without color-keying or reducing content opacity.
void EnableTransparency(HWND window) {
  BOOL composition_enabled = FALSE;
  if (FAILED(DwmIsCompositionEnabled(&composition_enabled)) || !composition_enabled) {
    throw std::runtime_error("Desktop composition is required for transparent widgets");
  }
  HRGN region = CreateRectRgn(0, 0, -1, -1);
  if (region == nullptr) throw std::runtime_error("Unable to allocate desktop alpha region");
  DWM_BLURBEHIND blur{};
  blur.dwFlags = DWM_BB_ENABLE | DWM_BB_BLURREGION;
  blur.fEnable = TRUE;
  blur.hRgnBlur = region;
  const auto result = DwmEnableBlurBehindWindow(window, &blur);
  DeleteObject(region);
  if (FAILED(result)) throw std::runtime_error("Unable to enable transparent desktop composition");
  const DWMNCRENDERINGPOLICY policy = DWMNCRP_DISABLED;
  if (FAILED(DwmSetWindowAttribute(window, DWMWA_NCRENDERING_POLICY, &policy, sizeof(policy)))) {
    throw std::runtime_error("Unable to remove the desktop widget window frame");
  }
}

/// Converts the hidden child-engine window into a frameless desktop content surface.
void Configure(WidgetWindow& owner, const Map& arguments) {
  const auto role = arguments.find(Value("role"));
  if (role == arguments.end() || !std::holds_alternative<std::string>(role->second) ||
      std::get<std::string>(role->second) != "desktop_widgets.window") {
    throw std::invalid_argument("The window must explicitly declare its desktop widget role");
  }
  const int width = Dimension(arguments, "width", owner.window);
  const int height = Dimension(arguments, "height", owner.window);
  EnableTransparency(owner.window);
  const LONG_PTR style = GetWindowLongPtr(owner.window, GWL_STYLE);
  SetStyle(owner.window, GWL_STYLE,
           (style & ~static_cast<LONG_PTR>(WS_OVERLAPPEDWINDOW)) | WS_POPUP);
  const LONG_PTR extended = GetWindowLongPtr(owner.window, GWL_EXSTYLE);
  SetStyle(owner.window, GWL_EXSTYLE,
           (extended & ~static_cast<LONG_PTR>(WS_EX_APPWINDOW)) | WS_EX_TOOLWINDOW);
  if (!SetWindowPos(owner.window, HWND_BOTTOM, 0, 0, width, height,
                    SWP_NOMOVE | SWP_NOACTIVATE | SWP_FRAMECHANGED)) {
    throw std::runtime_error("Unable to position desktop widget");
  }
  if (!MoveWindow(owner.view, 0, 0, width, height, TRUE)) {
    throw std::runtime_error("Unable to size desktop widget content");
  }
  owner.configured = true;
}
}  // namespace

/// Installs host operations and releases their messenger references with the engine.
class DesktopWidgetsPlugin : public flutter::Plugin {
 public:
  /// Creates the host-owned plugin and its per-engine method channel.
  explicit DesktopWidgetsPlugin(flutter::PluginRegistrarWindows* registrar) {
  auto owner = std::make_shared<WidgetWindow>();
  owner->view = registrar->GetView()->GetNativeWindow();
  owner->window = GetAncestor(owner->view, GA_ROOT);
  owner->channel = std::make_unique<flutter::MethodChannel<Value>>(
      registrar->messenger(), "desktop_widgets/window",
      &flutter::StandardMethodCodec::GetInstance());
  const std::weak_ptr<WidgetWindow> weak_owner = owner;
  owner->channel->SetMethodCallHandler(
      [weak_owner](const flutter::MethodCall<Value>& call,
                   std::unique_ptr<flutter::MethodResult<Value>> result) {
        auto current = weak_owner.lock();
        if (!current || !IsWindow(current->window)) {
          result->Error("WIDGET_WINDOW_CLOSED", "The desktop widget window is closed");
          return;
        }
        try {
          const auto& method = call.method_name();
          if (method == "requireSupport") {
            BOOL enabled = FALSE;
            if (FAILED(DwmIsCompositionEnabled(&enabled)) || !enabled) {
              throw std::runtime_error("Transparent desktop composition is unavailable");
            }
            result->Success();
            return;
          }
          if (method == "configure" || method == "resize") {
            const auto* arguments = call.arguments() == nullptr
                ? nullptr : std::get_if<Map>(call.arguments());
            if (arguments == nullptr) throw std::invalid_argument("Expected window dimensions");
            if (method == "configure") {
              Configure(*current, *arguments);
            } else {
              if (!current->configured) throw std::runtime_error("Widget window is not configured");
              if (!SetWindowPos(current->window, nullptr, 0, 0,
                                Dimension(*arguments, "width", current->window),
                                Dimension(*arguments, "height", current->window),
                                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE)) {
                throw std::runtime_error("Unable to resize desktop widget");
              }
            }
            result->Success();
            return;
          }
          if (!current->configured) throw std::runtime_error("Widget window is not configured");
          if (method == "show") {
            ShowWindow(current->window, SW_SHOWNOACTIVATE);
            if (!SetWindowPos(current->window, HWND_BOTTOM, 0, 0, 0, 0,
                              SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)) {
              throw std::runtime_error("Unable to show desktop widget at desktop level");
            }
            result->Success();
          } else if (method == "move") {
            ReleaseCapture();
            result->Success();
            PostMessage(current->window, WM_SYSCOMMAND, SC_MOVE | HTCAPTION, 0);
          } else if (method == "close") {
            // The reply must be sent before WM_CLOSE destroys the child engine.
            result->Success();
            PostMessage(current->window, WM_CLOSE, 0, 0);
          } else {
            result->NotImplemented();
          }
        } catch (const std::exception& error) {
          result->Error("DESKTOP_WIDGET_WINDOW_ERROR", error.what());
        }
      });
  owner_ = std::move(owner);
  }

  /// Releases ownership while engine teardown clears its detached messenger.
  ~DesktopWidgetsPlugin() override = default;

 private:
  std::shared_ptr<WidgetWindow> owner_;
};

/// Registers one independent widget-window host for each Flutter engine.
void DesktopWidgetsPluginRegisterWithRegistrar(FlutterDesktopPluginRegistrarRef registrar) {
  auto* windows_registrar = flutter::PluginRegistrarManager::GetInstance()
      ->GetRegistrar<flutter::PluginRegistrarWindows>(registrar);
  windows_registrar->AddPlugin(std::make_unique<DesktopWidgetsPlugin>(windows_registrar));
}
