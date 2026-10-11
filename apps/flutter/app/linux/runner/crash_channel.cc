#include "crash_channel.h"

namespace {

/// Presents a crash report for the requesting engine.
void present_crash_screen(FlMethodCall* method_call) {
  FlValue* arguments = fl_method_call_get_args(method_call);
  if (arguments == nullptr || fl_value_get_type(arguments) != FL_VALUE_TYPE_MAP) {
    fl_method_call_respond_error(method_call, "INVALID_ARGS",
                                 "present requires crash details", nullptr,
                                 nullptr);
    return;
  }
  FlValue* details = fl_value_lookup_string(arguments, "details");
  if (details == nullptr || fl_value_get_type(details) != FL_VALUE_TYPE_STRING) {
    fl_method_call_respond_error(method_call, "INVALID_ARGS",
                                 "present requires crash details", nullptr,
                                 nullptr);
    return;
  }
  GtkWidget* dialog = gtk_message_dialog_new(
      nullptr, GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_CLOSE,
      "Operit2 has stopped");
  gtk_message_dialog_format_secondary_text(
      GTK_MESSAGE_DIALOG(dialog), "%s", fl_value_get_string(details));
  gtk_dialog_run(GTK_DIALOG(dialog));
  gtk_widget_destroy(dialog);
  fl_method_call_respond_success(method_call, nullptr, nullptr);
}

/// Dispatches crash presentation requests on the view-owned channel.
void crash_method_call_cb(FlMethodChannel*, FlMethodCall* method_call,
                          gpointer) {
  if (g_strcmp0(fl_method_call_get_name(method_call), "present") != 0) {
    fl_method_call_respond_not_implemented(method_call, nullptr);
    return;
  }
  present_crash_screen(method_call);
}

}  // namespace

/// Disconnects a crash channel when its Flutter view is released.
static void release_operit_crash_channel(gpointer data) {
  auto* channel = FL_METHOD_CHANNEL(data);
  fl_method_channel_set_method_call_handler(channel, nullptr, nullptr, nullptr);
  g_object_unref(channel);
}

/// Attaches a separate crash channel to each Flutter engine.
void register_operit_crash_channel(FlView* view) {
  FlBinaryMessenger* messenger = fl_engine_get_binary_messenger(fl_view_get_engine(view));
  g_autoptr(FlStandardMethodCodec) codec = fl_standard_method_codec_new();
  FlMethodChannel* channel = fl_method_channel_new(
      messenger, "operit/crash", FL_METHOD_CODEC(codec));
  fl_method_channel_set_method_call_handler(channel,
                                             crash_method_call_cb, nullptr,
                                             nullptr);
  g_object_set_data_full(G_OBJECT(view), "operit-crash-channel", channel,
                        release_operit_crash_channel);
}
