#ifndef DESKTOP_WIDGETS_LINUX_PLUGIN_H_
#define DESKTOP_WIDGETS_LINUX_PLUGIN_H_
#include <flutter_linux/flutter_linux.h>
G_BEGIN_DECLS
#ifdef FLUTTER_PLUGIN_IMPL
#define DESKTOP_WIDGETS_EXPORT __attribute__((visibility("default")))
#else
#define DESKTOP_WIDGETS_EXPORT
#endif
/// Registers the widget host on the supplied engine, never a global window.
DESKTOP_WIDGETS_EXPORT void desktop_widgets_linux_plugin_register_with_registrar(
    FlPluginRegistrar* registrar);
G_END_DECLS
#endif
