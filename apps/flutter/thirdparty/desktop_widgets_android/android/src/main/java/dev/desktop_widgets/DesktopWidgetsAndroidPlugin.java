package dev.desktop_widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.embedding.engine.plugins.activity.ActivityAware;
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;
import io.flutter.plugin.common.PluginRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** Owns pinning and click delivery without application-specific activities or platform checks. */
public final class DesktopWidgetsAndroidPlugin implements FlutterPlugin, ActivityAware,
        MethodChannel.MethodCallHandler, PluginRegistry.NewIntentListener {
    private Context context;
    private MethodChannel channel;
    private ActivityPluginBinding binding;
    private boolean actionsReady;
    private boolean delivering;
    private final ArrayList<Intent> pendingActions = new ArrayList<>();

    /** Registers the plugin's system-widget channel for this engine. */
    @Override public void onAttachedToEngine(FlutterPluginBinding binding) {
        context = binding.getApplicationContext();
        channel = new MethodChannel(binding.getBinaryMessenger(), "desktop_widgets/appwidget");
        channel.setMethodCallHandler(this);
    }

    /** Releases messenger callbacks without removing persisted launcher widgets. */
    @Override public void onDetachedFromEngine(FlutterPluginBinding binding) {
        channel.setMethodCallHandler(null);
        actionsReady = false;
        channel = null;
        context = null;
    }

    /** Requires the Android pin API and an attached foreground activity. */
    private AppWidgetManager requireSupport() {
        if (Build.VERSION.SDK_INT < 26) throw new UnsupportedOperationException("Pinning requires Android 8 or newer");
        if (binding == null) throw new IllegalStateException("Widget pinning requires an attached activity");
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (!manager.isRequestPinAppWidgetSupported()) throw new UnsupportedOperationException("This launcher does not support widget pinning");
        return manager;
    }

    /** Reads an explicit map from the standard codec without guessing payload shapes. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        if (!(value instanceof Map)) throw new IllegalArgumentException("Expected a map");
        return (Map<String, Object>) value;
    }

    /** Stores a publication before asking the launcher to confirm its placement. */
    private String pin(Map<String, Object> args) throws Exception {
        AppWidgetManager manager = requireSupport();
        WidgetStore store = new WidgetStore(context);
        String id = store.create(map(args.get("payload")), map(args.get("frame")));
        Intent callback = new Intent(context, DesktopWidgetProvider.class)
            .setAction(DesktopWidgetProvider.PINNED)
            .setData(new Uri.Builder().scheme("desktop-widget-pin").authority(context.getPackageName()).appendPath(id).build())
            .putExtra(DesktopWidgetProvider.TOKEN, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        PendingIntent confirmed = PendingIntent.getBroadcast(context, 0, callback, flags);
        Bundle extras = new Bundle();
        extras.putParcelable(AppWidgetManager.EXTRA_APPWIDGET_PREVIEW, DesktopWidgetProvider.views(context, id));
        if (!manager.requestPinAppWidget(new ComponentName(context, DesktopWidgetProvider.class), extras, confirmed)) {
            confirmed.cancel();
            store.discard(id);
            throw new IllegalStateException("The launcher rejected the widget pin request");
        }
        return id;
    }

    /** Implements native publication and action readiness on one plugin-owned channel. */
    @Override public void onMethodCall(MethodCall call, MethodChannel.Result result) {
        try {
            switch (call.method) {
                case "requireSupport": requireSupport(); result.success(null); break;
                case "pin": result.success(pin(map(call.arguments))); break;
                case "listSnapshots": {
                    WidgetStore store = new WidgetStore(context);
                    ArrayList<Object> publications = new ArrayList<>();
                    for (String id : store.publications()) {
                        if (store.instances(id).isEmpty()) continue;
                        JSONObject record = store.read(id);
                        Map<String, Object> item = new HashMap<>();
                        item.put("id", id);
                        item.put("payload", codecValue(record.getJSONObject("payload")));
                        android.graphics.Bitmap image = store.image(id);
                        item.put("width", image.getWidth());
                        item.put("height", image.getHeight());
                        image.recycle();
                        publications.add(item);
                    }
                    result.success(publications);
                    break;
                }
                case "renderFailed": {
                    Map<String, Object> args = map(call.arguments);
                    WidgetStore store = new WidgetStore(context);
                    for (int widgetId : store.instances((String) args.get("id"))) {
                        DesktopWidgetProvider.showError(context, widgetId,
                            new IllegalStateException((String) args.get("message")));
                    }
                    result.success(null);
                    break;
                }
                case "updateSnapshot": {
                    Map<String, Object> args = map(call.arguments);
                    String id = (String) args.get("id");
                    WidgetStore store = new WidgetStore(context);
                    store.update(id, map(args.get("frame")));
                    for (int widgetId : store.instances(id)) {
                        AppWidgetManager.getInstance(context).updateAppWidget(widgetId, DesktopWidgetProvider.views(context, id));
                    }
                    result.success(null);
                    break;
                }
                case "actionsReady":
                    if (!(call.arguments instanceof Boolean)) throw new IllegalArgumentException("Expected action readiness");
                    actionsReady = (Boolean) call.arguments;
                    result.success(null);
                    deliverPending();
                    break;
                default: result.notImplemented();
            }
        } catch (Exception error) {
            result.error("DESKTOP_WIDGET_ERROR", error.toString(), null);
        }
    }

    /** Converts persisted JSON to values accepted by Flutter's standard codec. */
    private Object codecValue(Object value) throws Exception {
        if (value == JSONObject.NULL) return null;
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            Map<String, Object> output = new HashMap<>();
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                output.put(key, codecValue(object.get(key)));
            }
            return output;
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            ArrayList<Object> output = new ArrayList<>();
            for (int index = 0; index < array.length(); index++) output.add(codecValue(array.get(index)));
            return output;
        }
        return value;
    }

    /** Delivers one click at a time and acknowledges it only after Dart succeeds. */
    private void deliverPending() {
        if (!actionsReady || delivering || channel == null || pendingActions.isEmpty()) return;
        final Intent intent = pendingActions.get(0);
        try {
            String id = intent.getStringExtra(DesktopWidgetProvider.TOKEN);
            if (id == null) throw new IllegalArgumentException("Widget click omitted its identity");
            JSONObject metadata = new WidgetStore(context).read(id);
            delivering = true;
            channel.invokeMethod(metadata.getString("action"), codecValue(metadata.getJSONObject("actionArguments")),
                new MethodChannel.Result() {
                    /** Acknowledges delivery and consumes the launch intent exactly once. */
                    @Override public void success(Object value) {
                        intent.removeExtra(DesktopWidgetProvider.TOKEN);
                        pendingActions.remove(intent);
                        delivering = false;
                        deliverPending();
                    }
                    /** Keeps failed actions pending and exposes the application error in native logs. */
                    @Override public void error(String code, String message, Object details) {
                        delivering = false;
                        Log.e("desktop_widgets", "Widget action failed: " + code + ": " + message);
                    }
                    /** Reports a missing application action handler without changing the destination. */
                    @Override public void notImplemented() {
                        delivering = false;
                        Log.e("desktop_widgets", "Widget action has no application handler");
                    }
                });
        } catch (Exception error) {
            delivering = false;
            Log.e("desktop_widgets", "Cannot deliver widget action", error);
        }
    }

    /** Captures only explicit widget clicks and lets other plugins handle unrelated intents. */
    @Override public boolean onNewIntent(Intent intent) {
        if (!DesktopWidgetProvider.OPEN.equals(intent.getAction()) || !intent.hasExtra(DesktopWidgetProvider.TOKEN)) return false;
        if (binding != null) binding.getActivity().setIntent(intent);
        if (!pendingActions.contains(intent)) pendingActions.add(intent);
        deliverPending();
        return true;
    }

    /** Observes warm launches and queues the initial cold-start action. */
    @Override public void onAttachedToActivity(ActivityPluginBinding binding) {
        this.binding = binding;
        binding.addOnNewIntentListener(this);
        onNewIntent(binding.getActivity().getIntent());
    }

    /** Disconnects activity listeners while retaining unacknowledged clicks. */
    @Override public void onDetachedFromActivityForConfigChanges() {
        detachActivity();
    }

    /** Reattaches the same plugin after activity recreation. */
    @Override public void onReattachedToActivityForConfigChanges(ActivityPluginBinding binding) {
        onAttachedToActivity(binding);
    }

    /** Stops observing a destroyed activity without removing launcher widgets. */
    @Override public void onDetachedFromActivity() {
        detachActivity();
    }

    /** Removes the activity listener before releasing its binding. */
    private void detachActivity() {
        if (binding != null) binding.removeOnNewIntentListener(this);
        binding = null;
    }
}
