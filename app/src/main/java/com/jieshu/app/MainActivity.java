package com.jieshu.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {

    private static final String PREFS_NAME = "jieshu_store";
    private static final String PREFS_KEY = "data";
    private static final String CHANNEL_ID = "jieshu_ai";

    private WebView webView;
    // 以下四个量都以 CSS px（dip）为单位，直接写进 WebView 的 CSS 变量。
    private float keyboardHeight = 0f;
    private float safeTop = 0f;
    private float safeBottom = 0f;
    private float safeLeft = 0f;
    private float safeRight = 0f;
    private ValueCallback<Uri[]> fileChooserCallback;
    private String pendingExportContent = null;
    private String pendingExportBase64 = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#08070D"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                applySafeInsetsToWebView();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = filePathCallback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, 7102);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    return false;
                }
            }
        });
        webView.addJavascriptInterface(new StorageBridge(this), "AndroidStore");
        webView.addJavascriptInterface(new AIBridge(), "AndroidAI");
        webView.addJavascriptInterface(new BackupBridge(), "AndroidBackup");
        webView.addJavascriptInterface(new ChatBridge(), "AndroidChat");
        webView.addJavascriptInterface(new ThemeBridge(), "AndroidTheme");
        webView.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                int top = 0;
                int bottom = 0;
                int left = 0;
                int right = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.graphics.Insets bars = insets.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    top = bars.top;
                    bottom = bars.bottom;
                    left = bars.left;
                    right = bars.right;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                    left = insets.getSystemWindowInsetLeft();
                    right = insets.getSystemWindowInsetRight();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                            && insets.getDisplayCutout() != null) {
                        top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                        bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                        left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
                        right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
                    }
                }
                int imeBottom = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    imeBottom = insets.getInsets(WindowInsets.Type.ime()).bottom;
                }
                updateSafeInsets(top, bottom, left, right);
                updateKeyboardHeight(imeBottom);
                return insets;
            }
        });

        setContentView(webView);
        webView.requestApplyInsets();
        webView.loadUrl("file:///android_asset/index.html");

    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7101);
        }
    }

    private void updateSafeInsets(int top, int bottom, int left, int right) {
        // WindowInsets 给出的是物理像素，而 WebView 里的 CSS 变量按 CSS px（dip）
        // 解释。必须按屏幕密度换算，否则在 2x/3x 屏上安全区会放大 2~3 倍，
        // 整个界面会被推到屏幕中间。
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        safeTop = clampInset(top / density, 96f);
        safeBottom = clampInset(bottom / density, 96f);
        safeLeft = clampInset(left / density, 64f);
        safeRight = clampInset(right / density, 64f);
        applySafeInsetsToWebView();
    }

    private static float clampInset(float value, float max) {
        if (Float.isNaN(value) || value < 0f) {
            return 0f;
        }
        return Math.min(value, max);
    }

    private void updateKeyboardHeight(int imeBottom) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        float height = clampInset(imeBottom / density, 480f);
        if (Math.abs(height - keyboardHeight) < 0.5f) return;
        keyboardHeight = height;
        applyKeyboardHeightToWebView();
    }

    private void applyKeyboardHeightToWebView() {
        if (webView == null) return;
        String javascript = String.format(Locale.US,
                "(function(){try{if(window.onKeyboardHeight){window.onKeyboardHeight(%.2f);}}catch(e){}})()",
                keyboardHeight);
        webView.evaluateJavascript(javascript, null);
    }

    private void applySafeInsetsToWebView() {
        if (webView == null) return;
        String javascript = String.format(Locale.US,
                "(function(){try{if(window.setNativeSafeInsets){window.setNativeSafeInsets(%.2f,%.2f,%.2f,%.2f);}}catch(e){}})()",
                safeTop, safeBottom, safeLeft, safeRight);
        webView.evaluateJavascript(javascript, null);
        applyKeyboardHeightToWebView();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.appBack?window.appBack():false}catch(e){return false}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) {
                            MainActivity.super.onBackPressed();
                        }
                    }
                });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == 7102) {
            if (fileChooserCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                fileChooserCallback.onReceiveValue(results);
                fileChooserCallback = null;
            }
            return;
        }
        if (requestCode == 7201) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                if (pendingExportBase64 != null) {
                    ok = writeBase64ToUri(data.getData(), pendingExportBase64);
                } else if (pendingExportContent != null) {
                    ok = writeTextToUri(data.getData(), pendingExportContent);
                }
            }
            pendingExportContent = null;
            pendingExportBase64 = null;
            final boolean saved = ok;
            webView.post(new Runnable() {
                @Override
                public void run() {
                    if (webView == null) return;
                    webView.evaluateJavascript(
                            "window.onBackupSaved && window.onBackupSaved(" + saved + ");", null);
                }
            });
            return;
        }
        if (requestCode == 7202) {
            final String text = (resultCode == RESULT_OK && data != null && data.getData() != null)
                    ? readTextFromUri(data.getData())
                    : null;
            webView.post(new Runnable() {
                @Override
                public void run() {
                    if (webView == null) return;
                    String payload = text == null ? "''" : jsString(text);
                    webView.evaluateJavascript(
                            "window.onBackupPicked && window.onBackupPicked(" + payload + ");", null);
                }
            });
            return;
        }
        if (requestCode == 7203 || requestCode == 7204) {
            final String kind = requestCode == 7203 ? "image" : "file";
            final String payload = (resultCode == RESULT_OK && data != null && data.getData() != null)
                    ? buildChatAttachment(kind, data.getData())
                    : "";
            webView.post(new Runnable() {
                @Override
                public void run() {
                    if (webView == null) return;
                    String arg = (payload == null || payload.isEmpty()) ? "''" : jsString(payload);
                    webView.evaluateJavascript(
                            "window.onChatAttachmentPicked && window.onChatAttachmentPicked(" + arg + ");", null);
                }
            });
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidStore");
            webView.removeJavascriptInterface("AndroidAI");
            webView.removeJavascriptInterface("AndroidBackup");
            webView.removeJavascriptInterface("AndroidChat");
            webView.removeJavascriptInterface("AndroidTheme");
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    public class ThemeBridge {

        @JavascriptInterface
        public boolean pinShortcut(String name, String iconBase64) {
            if (Build.VERSION.SDK_INT < 26) {
                return false;
            }
            final ShortcutManager manager = getSystemService(ShortcutManager.class);
            if (manager == null || !manager.isRequestPinShortcutSupported()) {
                return false;
            }
            String label = name == null ? "" : name.trim();
            if (label.isEmpty()) {
                label = getString(R.string.app_name);
            }
            Bitmap bitmap = null;
            if (iconBase64 != null && !iconBase64.isEmpty()) {
                try {
                    String base64 = iconBase64;
                    int comma = base64.indexOf(',');
                    if (comma >= 0) {
                        base64 = base64.substring(comma + 1);
                    }
                    byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                    Bitmap source = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (source != null) {
                        bitmap = roundIcon(source);
                    }
                } catch (Throwable ignored) {
                    bitmap = null;
                }
            }
            Icon icon = bitmap != null
                    ? Icon.createWithBitmap(bitmap)
                    : Icon.createWithResource(MainActivity.this, R.mipmap.ic_launcher);
            Intent launch = new Intent(MainActivity.this, MainActivity.class);
            launch.setAction(Intent.ACTION_MAIN);
            launch.addCategory(Intent.CATEGORY_LAUNCHER);
            String shortcutId = "jieshu-" + Integer.toHexString((label + (iconBase64 == null ? "" : iconBase64.length())).hashCode());
            ShortcutInfo shortcut = new ShortcutInfo.Builder(MainActivity.this, shortcutId)
                    .setShortLabel(label.length() > 12 ? label.substring(0, 12) : label)
                    .setLongLabel(label)
                    .setIcon(icon)
                    .setIntent(launch)
                    .build();
            try {
                return manager.requestPinShortcut(shortcut, null);
            } catch (Throwable error) {
                return false;
            }
        }

        private Bitmap roundIcon(Bitmap source) {
            int size = 192;
            Bitmap square = Bitmap.createScaledBitmap(source, size, size, true);
            Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(output);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setFilterBitmap(true);
            RectF rect = new RectF(0f, 0f, size, size);
            canvas.drawRoundRect(rect, size * 0.24f, size * 0.24f, paint);
            paint.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN));
            canvas.drawBitmap(square, 0f, 0f, paint);
            return output;
        }
    }

    public class AIBridge {

        private final ConcurrentHashMap<String, HttpURLConnection> activeConnections =
                new ConcurrentHashMap<>();

        @JavascriptInterface
        public void cancel(String requestId) {
            if (requestId == null) return;
            HttpURLConnection connection = activeConnections.remove(requestId);
            if (connection != null) {
                connection.disconnect();
            }
        }

        @JavascriptInterface
        public void requestNotifyPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    ensureNotificationPermission();
                }
            });
        }

        @JavascriptInterface
        public void notifyDone(String title, String body) {
            showNotification(title, body);
        }

        @JavascriptInterface
        public void request(final String url, final String apiKey, final String body, final String requestId) {
            if (url == null || requestId == null) {
                return;
            }
            new Thread(new Runnable() {
                @Override
                public void run() {
                    execute("POST", url, apiKey, body, requestId);
                }
            }, "jieshu-ai").start();
        }

        @JavascriptInterface
        public void get(final String url, final String apiKey, final String requestId) {
            if (url == null || requestId == null) {
                return;
            }
            new Thread(new Runnable() {
                @Override
                public void run() {
                    execute("GET", url, apiKey, null, requestId);
                }
            }, "jieshu-models").start();
        }

        private void execute(String method, String url, String apiKey, String body, String requestId) {
            int status = 0;
            String responseText = "";
            HttpURLConnection connection = null;
            try {
                URL target = new URL(url);
                String protocol = target.getProtocol();
                if (!"http".equalsIgnoreCase(protocol) && !"https".equalsIgnoreCase(protocol)) {
                    throw new IllegalArgumentException("Only http/https endpoints are supported");
                }

                connection = (HttpURLConnection) target.openConnection();
                activeConnections.put(requestId, connection);
                connection.setRequestMethod(method);
                connection.setConnectTimeout("GET".equals(method) ? 10000 : 20000);
                connection.setReadTimeout("GET".equals(method) ? 20000 : 90000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "JieShu/1.3");
                if (apiKey != null && apiKey.length() > 0) {
                    connection.setRequestProperty("Authorization", "Bearer " + apiKey);
                }

                if ("POST".equals(method)) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    byte[] payload = (body == null ? "{}" : body).getBytes("UTF-8");
                    connection.setFixedLengthStreamingMode(payload.length);
                    OutputStream output = connection.getOutputStream();
                    output.write(payload);
                    output.flush();
                    output.close();
                }

                status = connection.getResponseCode();
                InputStream input = status >= 200 && status < 300
                        ? connection.getInputStream()
                        : connection.getErrorStream();
                responseText = input != null ? readAll(input) : "HTTP " + status;
            } catch (Exception error) {
                status = 0;
                responseText = error.getMessage();
                if (responseText == null || responseText.length() == 0) {
                    responseText = error.getClass().getSimpleName();
                }
            } finally {
                activeConnections.remove(requestId);
                if (connection != null) {
                    connection.disconnect();
                }
            }
            deliver(requestId, status, responseText);
        }

        private String readAll(InputStream input) throws Exception {
            if (input == null) {
                return "";
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(input, "UTF-8"));
            StringBuilder builder = new StringBuilder();
            char[] buffer = new char[4096];
            int count;
            while ((count = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, count);
            }
            reader.close();
            return builder.toString();
        }

        private void deliver(final String requestId, final int status, String text) {
            final String safeText = text == null ? "" : text;
            final String javascript = "window.onAIResponse("
                    + JSONObject.quote(requestId)
                    + ","
                    + status
                    + ","
                    + JSONObject.quote(safeText)
                    + ");";
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (webView != null) {
                        webView.evaluateJavascript(javascript, null);
                    }
                }
            });
        }
    }

    private static String jsString(String value) {
        try {
            String quoted = JSONObject.quote(value);
            quoted = quoted.replace(String.valueOf((char) 0x2028), "\\u2028");
            quoted = quoted.replace(String.valueOf((char) 0x2029), "\\u2029");
            return quoted;
        } catch (Exception error) {
            return "''";
        }
    }

    private boolean writeTextToUri(Uri uri, String text) {
        OutputStream out = null;
        try {
            out = getContentResolver().openOutputStream(uri, "wt");
            if (out == null) return false;
            out.write(text.getBytes("UTF-8"));
            out.flush();
            return true;
        } catch (Exception error) {
            return false;
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private boolean writeBase64ToUri(Uri uri, String base64) {
        OutputStream out = null;
        try {
            byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            out = getContentResolver().openOutputStream(uri, "wt");
            if (out == null) return false;
            out.write(bytes);
            out.flush();
            return true;
        } catch (Exception error) {
            return false;
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private String readTextFromUri(Uri uri) {
        InputStream in = null;
        try {
            in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            StringBuilder builder = new StringBuilder();
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, read);
            }
            return builder.toString();
        } catch (Exception error) {
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private String buildChatAttachment(String kind, Uri uri) {
        String name = queryDisplayName(uri);
        if ("image".equals(kind)) {
            try {
                InputStream probe = getContentResolver().openInputStream(uri);
                if (probe == null) return "{\"error\":\"读不到这张图片\"}";
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeStream(probe, null, bounds);
                probe.close();
                int scale = 1;
                int longest = Math.max(bounds.outWidth, bounds.outHeight);
                while (longest / scale > 1280) {
                    scale *= 2;
                }
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = scale;
                InputStream stream = getContentResolver().openInputStream(uri);
                Bitmap bitmap = BitmapFactory.decodeStream(stream, null, options);
                if (stream != null) stream.close();
                if (bitmap == null) return "{\"error\":\"这张图片解不开\"}";
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 82, buffer);
                bitmap.recycle();
                String base64 = android.util.Base64.encodeToString(
                        buffer.toByteArray(), android.util.Base64.NO_WRAP);
                JSONObject result = new JSONObject();
                result.put("kind", "image");
                result.put("name", name);
                result.put("mime", "image/jpeg");
                result.put("data", "data:image/jpeg;base64," + base64);
                return result.toString();
            } catch (Exception error) {
                return "{\"error\":\"这张图片读不出来\"}";
            }
        }
        String text = readTextFromUri(uri);
        if (text == null) return "{\"error\":\"这个文件读不出来\"}";
        if (text.length() > 48000) {
            text = text.substring(0, 48000) + "\n…（文件过长，只读取了前 48000 字）";
        }
        try {
            JSONObject result = new JSONObject();
            result.put("kind", "file");
            result.put("name", name);
            result.put("mime", "text/plain");
            result.put("text", text);
            return result.toString();
        } catch (Exception error) {
            return "{\"error\":\"这个文件读不出来\"}";
        }
    }

    private String queryDisplayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) return name.trim();
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                try {
                    cursor.close();
                } catch (Exception ignored) {
                }
            }
        }
        String fallback = uri.getLastPathSegment();
        return (fallback == null || fallback.trim().isEmpty()) ? "file" : fallback;
    }

    public class ChatBridge {

        @JavascriptInterface
        public void pick(final String kind) {
            final boolean image = "image".equals(kind);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    if (image) {
                        intent.setType("image/*");
                    } else {
                        intent.setType("*/*");
                        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                                "text/plain", "text/markdown", "text/csv", "application/json"
                        });
                    }
                    try {
                        startActivityForResult(intent, image ? 7203 : 7204);
                    } catch (Exception error) {
                        if (webView != null) {
                            webView.evaluateJavascript(
                                    "window.onChatAttachmentPicked && window.onChatAttachmentPicked('{\"error\":\"没有可用的文件选择器\"}');",
                                    null);
                        }
                    }
                }
            });
        }
    }

    public class BackupBridge {
        @JavascriptInterface
        public void save(final String content, final String fileName) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    String name = (fileName == null || fileName.trim().isEmpty())
                            ? "jieshu-backup.json"
                            : fileName.trim();
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    pendingExportContent = content == null ? "" : content;
                    try {
                        startActivityForResult(intent, 7201);
                    } catch (Exception error) {
                        pendingExportContent = null;
                        if (webView != null) {
                            webView.evaluateJavascript(
                                    "window.onBackupSaved && window.onBackupSaved(false);", null);
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void saveBase64(final String base64, final String fileName, final String mime) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    String type = (mime == null || mime.trim().isEmpty())
                            ? "application/octet-stream"
                            : mime.trim();
                    intent.setType(type);
                    String name = (fileName == null || fileName.trim().isEmpty())
                            ? "jieshu-export"
                            : fileName.trim();
                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    pendingExportBase64 = base64 == null ? "" : base64;
                    pendingExportContent = null;
                    try {
                        startActivityForResult(intent, 7201);
                    } catch (Exception error) {
                        pendingExportBase64 = null;
                        if (webView != null) {
                            webView.evaluateJavascript(
                                    "window.onBackupSaved && window.onBackupSaved(false);", null);
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void pick() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                            "application/json", "text/plain", "application/octet-stream"
                    });
                    try {
                        startActivityForResult(intent, 7202);
                    } catch (Exception error) {
                        if (webView != null) {
                            webView.evaluateJavascript(
                                    "window.onBackupPicked && window.onBackupPicked('');", null);
                        }
                    }
                }
            });
        }
    }

    private void showNotification(String title, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "AI 生成通知",
                    NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("AI 世界观生成完成后通知");
            manager.createNotificationChannel(channel);
        }
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title == null ? "界书" : title)
                .setContentText(body == null ? "AI 生成已完成" : body)
                .setStyle(new Notification.BigTextStyle().bigText(
                        body == null ? "AI 生成已完成" : body))
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setPriority(Notification.PRIORITY_DEFAULT);
            builder.setDefaults(Notification.DEFAULT_ALL);
        }
        manager.notify((int) (System.currentTimeMillis() % 100000), builder.build());
    }

    public static class StorageBridge {
        private final SharedPreferences preferences;

        public StorageBridge(Context context) {
            preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        }

        @JavascriptInterface
        public String load() {
            return preferences.getString(PREFS_KEY, "");
        }

        @JavascriptInterface
        public void save(String json) {
            if (json == null || json.length() == 0) {
                return;
            }
            preferences.edit().putString(PREFS_KEY, json).commit();
        }
    }
}
