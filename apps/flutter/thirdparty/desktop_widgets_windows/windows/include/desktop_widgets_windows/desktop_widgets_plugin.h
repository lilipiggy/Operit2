#ifndef FLUTTER_PLUGIN_DESKTOP_WIDGETS_PLUGIN_H_
#define FLUTTER_PLUGIN_DESKTOP_WIDGETS_PLUGIN_H_
#include <flutter_plugin_registrar.h>

#ifdef FLUTTER_PLUGIN_IMPL
#define DESKTOP_WIDGETS_EXPORT __declspec(dllexport)
#else
#define DESKTOP_WIDGETS_EXPORT __declspec(dllimport)
#endif

#if defined(__cplusplus)
extern "C" {
#endif
/// Registers the transparent widget surface host for a Flutter engine.
DESKTOP_WIDGETS_EXPORT void DesktopWidgetsPluginRegisterWithRegistrar(
    FlutterDesktopPluginRegistrarRef registrar);
#if defined(__cplusplus)
}
#endif
#endif
