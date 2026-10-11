package dev.desktop_widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** Hosts persisted transparent Flutter frames inside Android launcher RemoteViews. */
public final class DesktopWidgetProvider extends AppWidgetProvider {
    static final String PINNED = "dev.desktop_widgets.PINNED";
    static final String OPEN = "dev.desktop_widgets.OPEN";
    static final String TOKEN = "dev.desktop_widgets.TOKEN";

    /** Builds an explicit activity PendingIntent without a broadcast trampoline. */
    static PendingIntent clickIntent(Context context, String id) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) throw new IllegalStateException("The application has no launcher activity");
        intent.setAction(OPEN);
        // Unique categories distinguish PendingIntents without triggering Flutter deep links.
        intent.addCategory("dev.desktop_widgets.widget." + id);
        intent.putExtra(TOKEN, id);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Renders one persisted frame using the launcher's current size constraints. */
    static RemoteViews views(Context context, String id) throws Exception {
        WidgetStore store = new WidgetStore(context);
        JSONObject metadata = store.read(id);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.desktop_widget);
        Bitmap image = store.image(id);
        views.setImageViewBitmap(R.id.desktop_widget_image, image);
        views.setContentDescription(R.id.desktop_widget_image, metadata.getString("description"));
        views.setOnClickPendingIntent(R.id.desktop_widget_image, clickIntent(context, id));
        return views;
    }

    /** Shows an explicit persistent error instead of substituting another widget. */
    static void showError(Context context, int widgetId, Exception error) {
        Log.e("desktop_widgets", "Widget " + widgetId + " cannot be displayed", error);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.desktop_widget);
        views.setViewVisibility(R.id.desktop_widget_image, View.GONE);
        views.setViewVisibility(R.id.desktop_widget_error, View.VISIBLE);
        views.setTextViewText(R.id.desktop_widget_error, error.toString());
        AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views);
    }

    /** Reapplies published content after launcher recreation without claiming a data refresh. */
    static void update(Context context, int widgetId) {
        try {
            String id = new WidgetStore(context).binding(widgetId);
            AppWidgetManager.getInstance(context).updateAppWidget(widgetId, views(context, id));
        } catch (Exception error) {
            showError(context, widgetId, error);
        }
    }

    /** Completes the pending publication only after the launcher confirms a widget ID. */
    @Override public void onReceive(Context context, Intent intent) {
        if (!PINNED.equals(intent.getAction())) {
            super.onReceive(context, intent);
            return;
        }
        int widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            Log.e("desktop_widgets", "Pin confirmation omitted the widget ID");
            return;
        }
        try {
            String id = intent.getStringExtra(TOKEN);
            if (id == null) throw new IllegalArgumentException("Pin confirmation omitted the publication");
            new WidgetStore(context).bind(widgetId, id);
            update(context, widgetId);
        } catch (Exception error) {
            showError(context, widgetId, error);
        }
    }

    /** Restores persisted RemoteViews whenever the system requests presentation. */
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) update(context, widgetId);
    }

    /** Preserves aspect ratio when the launcher changes widget bounds. */
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
            int widgetId, Bundle options) {
        update(context, widgetId);
    }

    /** Releases stored instance bindings when the user removes a widget. */
    @Override public void onDeleted(Context context, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            try { new WidgetStore(context).unbind(widgetId); }
            catch (Exception error) { Log.e("desktop_widgets", "Unable to remove widget " + widgetId, error); }
        }
    }

    /** Rebinds OS-restored IDs to the same persisted publications. */
    @Override public void onRestored(Context context, int[] oldIds, int[] newIds) {
        WidgetStore store = new WidgetStore(context);
        for (int index = 0; index < oldIds.length; index++) {
            try {
                store.bind(newIds[index], store.binding(oldIds[index]));
                store.unbind(oldIds[index]);
                update(context, newIds[index]);
            } catch (Exception error) { showError(context, newIds[index], error); }
        }
    }
}
