package dev.desktop_widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/** Lets the launcher's widget picker select content previously published by the application. */
public final class DesktopWidgetConfigureActivity extends Activity {
    /** Starts cancelled and completes only after an explicit valid content selection. */
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        int widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        try {
            if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) throw new IllegalArgumentException("Missing launcher widget ID");
            android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId);
            if (info == null || !info.provider.equals(new ComponentName(this, DesktopWidgetProvider.class))) {
                throw new IllegalArgumentException("The widget ID does not belong to this provider");
            }
            WidgetStore store = new WidgetStore(this);
            List<String> ids = store.publications();
            if (ids.isEmpty()) {
                showMessage("Publish widget content from the application first.");
                return;
            }
            List<String> labels = new ArrayList<>();
            for (String id : ids) labels.add(store.read(id).getString("description"));
            ListView list = new ListView(this);
            list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, labels));
            list.setOnItemClickListener((parent, view, position, rowId) -> {
                try {
                    store.bind(widgetId, ids.get(position));
                    AppWidgetManager.getInstance(this).updateAppWidget(widgetId, DesktopWidgetProvider.views(this, ids.get(position)));
                    setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
                    finish();
                } catch (Exception error) { showMessage(error.toString()); }
            });
            setContentView(list);
        } catch (Exception error) { showMessage(error.toString()); }
    }

    /** Shows an explicit configuration error without completing the add operation. */
    private void showMessage(String message) {
        TextView text = new TextView(this);
        text.setText(message);
        text.setPadding(24, 24, 24, 24);
        setContentView(text);
    }
}
