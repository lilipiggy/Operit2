package dev.desktop_widgets;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import org.json.JSONObject;
import org.json.JSONException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Persists published frames and launcher bindings independently of the Flutter process. */
final class WidgetStore {
    private final Context context;
    private final SharedPreferences preferences;

    /** Opens the plugin's private, non-exported store. */
    WidgetStore(Context context) {
        this.context = context.getApplicationContext();
        preferences = context.getSharedPreferences("desktop_widgets", Context.MODE_PRIVATE);
    }

    /** Validates a token before using it as a private file name. */
    private String token(String id) {
        if (!UUID.fromString(id).toString().equals(id)) throw new IllegalArgumentException("Invalid widget identity");
        return id;
    }

    /** Locates a published image without accepting arbitrary file paths. */
    private AtomicFile imageFile(String id) {
        File directory = new File(context.getFilesDir(), "desktop_widgets");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot create widget storage");
        return new AtomicFile(new File(directory, token(id) + ".png"));
    }

    /** Creates an independent pending publication before launcher confirmation. */
    String create(Map<String, Object> payload, Map<String, Object> frame) throws Exception {
        String id = UUID.randomUUID().toString();
        JSONObject metadata = new JSONObject();
        metadata.put("payload", new JSONObject(payload));
        metadata.put("createdAt", System.currentTimeMillis());
        writeFrame(id, metadata, frame);
        return id;
    }

    /** Validates pixels and stores a single image plus its explicit click action. */
    private void writeFrame(String id, JSONObject metadata, Map<String, Object> frame) throws Exception {
        Object raw = frame.get("png");
        if (!(raw instanceof byte[])) throw new IllegalArgumentException("A PNG byte array is required");
        byte[] png = (byte[]) raw;
        if (png.length < 8 || png.length > 2 * 1024 * 1024 ||
            png[0] != (byte) 137 || png[1] != 80 || png[2] != 78 || png[3] != 71 ||
            png[4] != 13 || png[5] != 10 || png[6] != 26 || png[7] != 10) {
            throw new IllegalArgumentException("Invalid or oversized PNG");
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(png, 0, png.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
            (long) bounds.outWidth * bounds.outHeight > 262144) {
            throw new IllegalArgumentException("Widget images must contain at most 262144 pixels");
        }
        Object action = frame.get("action");
        Object description = frame.get("description");
        Object actionArguments = frame.get("actionArguments");
        if (!(action instanceof String) || ((String) action).isEmpty() ||
            !(description instanceof String) || !(actionArguments instanceof Map)) {
            throw new IllegalArgumentException("Snapshot action, arguments, and description are required");
        }
        metadata.put("action", action);
        metadata.put("width", bounds.outWidth);
        metadata.put("height", bounds.outHeight);
        metadata.put("description", description);
        metadata.put("actionArguments", new JSONObject((Map<?, ?>) actionArguments));
        AtomicFile file = imageFile(id);
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(png);
            file.finishWrite(stream);
        } catch (IOException error) {
            file.failWrite(stream);
            throw error;
        }
        if (!preferences.edit().putString("record:" + id, metadata.toString()).commit()) {
            throw new IOException("Unable to persist widget metadata");
        }
    }

    /** Replaces a published image while preserving instance payload and identity. */
    void update(String id, Map<String, Object> frame) throws Exception {
        writeFrame(id, read(id), frame);
    }

    /** Loads required metadata and surfaces missing or corrupt publications. */
    JSONObject read(String id) throws JSONException {
        String value = preferences.getString("record:" + token(id), null);
        if (value == null) throw new IllegalStateException("Widget publication is missing");
        return new JSONObject(value);
    }

    /** Decodes the bounded persisted frame for RemoteViews. */
    Bitmap image(String id) throws IOException {
        byte[] png = imageFile(id).readFully();
        Bitmap image = BitmapFactory.decodeByteArray(png, 0, png.length);
        if (image == null) throw new IOException("Cannot decode the published widget image");
        return image;
    }

    /** Records the launcher-assigned ID only after pinning or configuration succeeds. */
    void bind(int widgetId, String id) throws Exception {
        read(id);
        if (!preferences.edit().putString("widget:" + widgetId, id).commit()) {
            throw new IOException("Cannot save the launcher widget binding");
        }
    }

    /** Looks up a required launcher binding. */
    String binding(int widgetId) {
        String id = preferences.getString("widget:" + widgetId, null);
        if (id == null) throw new IllegalStateException("Choose widget content in the application");
        return id;
    }

    /** Lists explicitly published content for launcher configuration. */
    List<String> publications() {
        List<String> ids = new ArrayList<>();
        for (String key : preferences.getAll().keySet()) {
            if (key.startsWith("record:")) ids.add(key.substring(7));
        }
        return ids;
    }

    /** Returns all launcher instances bound to a publication. */
    List<Integer> instances(String id) {
        List<Integer> ids = new ArrayList<>();
        for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
            if (entry.getKey().startsWith("widget:") && id.equals(entry.getValue())) {
                ids.add(Integer.parseInt(entry.getKey().substring(7)));
            }
        }
        return ids;
    }

    /** Removes an explicit publication that the launcher refused to pin. */
    void discard(String id) throws IOException {
        if (!preferences.edit().remove("record:" + token(id)).commit()) throw new IOException("Cannot delete widget metadata");
        imageFile(id).delete();
    }

    /** Releases a removed instance and deletes pixels when no binding remains. */
    void unbind(int widgetId) throws Exception {
        String id = binding(widgetId);
        if (!preferences.edit().remove("widget:" + widgetId).commit()) throw new IOException("Cannot remove widget binding");
        if (instances(id).isEmpty()) discard(id);
    }
}
