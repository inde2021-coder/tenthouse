package in.radhakrishna.tenthouse;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.PermissionRequest;
import android.webkit.JavascriptInterface;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.content.pm.PackageManager;
import android.Manifest;
import java.util.Locale;
import java.util.ArrayList;
import android.webkit.ValueCallback;
import android.content.Intent;
import android.net.Uri;
import android.content.SharedPreferences;
import android.widget.Toast;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.os.Environment;
import android.database.Cursor;
import android.os.Build;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.BufferedReader;
import java.io.InputStreamReader;

public class MainActivity extends Activity {
  private WebView web;
  private ValueCallback<Uri[]> fileCallback;
  private static final int FILE_CHOOSER = 7001;
  private long pendingDownloadId = -1;
  private BroadcastReceiver downloadReceiver;
  private boolean receiverRegistered = false;
  private static final int SPEECH_REQUEST = 7002;
  private static final int AUDIO_PERMISSION_REQUEST = 7003;
  private TextToSpeech tts;
  private boolean speechPending = false;
  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    web = new WebView(this); setContentView(web);
    tts = new TextToSpeech(this, status -> { if(status == TextToSpeech.SUCCESS) tts.setLanguage(new Locale("hi", "IN")); });
    web.addJavascriptInterface(new AndroidVoiceBridge(), "AndroidBridge");
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(true); settings.setAllowContentAccess(true); settings.setMediaPlaybackRequiresUserGesture(true);
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(PermissionRequest request) {
        runOnUiThread(() -> {
          boolean allowed = false;
          for (String resource : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) allowed = true;
          if (allowed) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); else request.deny();
        });
      }
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        Intent intent = params.createIntent();
        try { startActivityForResult(intent, FILE_CHOOSER); } catch (Exception e) { fileCallback = null; Toast.makeText(MainActivity.this, "File picker उपलब्ध नहीं", Toast.LENGTH_SHORT).show(); return false; }
        return true;
      }
    });
    registerDownloadReceiver();
    String url = BuildConfig.HOSTED_APP_URL;
    if (url.startsWith("https://") && !url.contains("YOUR-HOSTING-DOMAIN")) web.loadUrl(url);
    else web.loadUrl("file:///android_asset/index.html");
    checkForApkUpdate();
  }

  // Checks a hosted version.json. Web content updates by loading the hosted site;
  // this check is specifically for a new native APK package.
  private void checkForApkUpdate() {
    new Thread(() -> {
      HttpURLConnection conn = null;
      try {
        String base = BuildConfig.HOSTED_APP_URL;
        if (!base.startsWith("https://") || base.contains("YOUR-HOSTING-DOMAIN")) return;
        int slash = base.lastIndexOf('/');
        String manifestUrl = (slash > 8 ? base.substring(0, slash + 1) : base + "/") + "version.json";
        conn = (HttpURLConnection) new URL(manifestUrl).openConnection();
        conn.setConnectTimeout(6000); conn.setReadTimeout(6000); conn.setRequestMethod("GET");
        if (conn.getResponseCode() != 200) return;
        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
        StringBuilder body = new StringBuilder(); String line;
        while ((line = reader.readLine()) != null) body.append(line);
        reader.close();
        JSONObject info = new JSONObject(body.toString());
        int latestCode = info.optInt("versionCode", 1);
        String latestName = info.optString("versionName", "New version");
        String apkUrl = info.optString("apkUrl", "");
        String notes = info.optString("releaseNotes", "Bug fixes and improvements");
        if (latestCode > BuildConfig.VERSION_CODE && apkUrl.startsWith("https://")) {
          runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
            .setTitle("अपडेट उपलब्ध है: " + latestName)
            .setMessage(notes + "\n\nनई APK डाउनलोड करके इंस्टॉल करें?")
            .setNegativeButton("बाद में", (d, w) -> d.dismiss())
            .setPositiveButton("Update Now", (d, w) -> downloadApk(apkUrl, latestName))
            .setCancelable(true).show());
        }
      } catch (Exception ignored) { /* Update check should never block app startup. */ }
      finally { if (conn != null) conn.disconnect(); }
    }).start();
  }

  private void downloadApk(String apkUrl, String versionName) {
    try {
      if (!apkUrl.startsWith("https://")) throw new IllegalArgumentException("केवल HTTPS APK URL स्वीकार है");
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
      request.setTitle("RK Tent House ERP अपडेट " + versionName);
      request.setDescription("नई APK डाउनलोड हो रही है");
      request.setMimeType("application/vnd.android.package-archive");
      request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
      request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "rk-tent-house-update.apk");
      DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
      pendingDownloadId = manager.enqueue(request);
      Toast.makeText(this, "APK डाउनलोड शुरू हुई। डाउनलोड पूरा होने पर इंस्टॉल करें।", Toast.LENGTH_LONG).show();
    } catch (Exception e) {
      Toast.makeText(this, "अपडेट डाउनलोड नहीं हो पाया: " + e.getMessage(), Toast.LENGTH_LONG).show();
    }
  }

  private void registerDownloadReceiver() {
    downloadReceiver = new BroadcastReceiver() {
      @Override public void onReceive(Context context, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
        if (id != pendingDownloadId) return;
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        try {
          Uri apkUri = manager.getUriForDownloadedFile(id);
          if (apkUri == null) throw new Exception("डाउनलोड फाइल नहीं मिली");
          Intent install = new Intent(Intent.ACTION_VIEW);
          install.setDataAndType(apkUri, "application/vnd.android.package-archive");
          install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
          startActivity(install); // Android will ask the user to confirm installation.
        } catch (Exception e) {
          Toast.makeText(MainActivity.this, "इंस्टॉल शुरू नहीं हुआ। डाउनलोड नोटिफिकेशन से APK खोलें।", Toast.LENGTH_LONG).show();
        }
      }
    };
    IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    else registerReceiver(downloadReceiver, filter);
    receiverRegistered = true;
  }

  @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == SPEECH_REQUEST) {
      String result = "";
      if (resultCode == RESULT_OK && data != null) {
        ArrayList<String> matches = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (matches != null && !matches.isEmpty()) result = matches.get(0);
      }
      final String spoken = result;
      if (web != null) web.post(() -> web.evaluateJavascript("window.onNativeSpeechResult(" + JSONObject.quote(spoken) + ")", null));
      return;
    }
    if (requestCode == FILE_CHOOSER && fileCallback != null) {
      Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
      fileCallback.onReceiveValue(results); fileCallback = null;
    }
  }
  private class AndroidVoiceBridge {
    @JavascriptInterface public void startSpeechRecognition() {
      runOnUiThread(() -> {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
          speechPending = true;
          requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
          return;
        }
        launchSpeechRecognizer();
      });
    }
    @JavascriptInterface public void speak(String text) {
      if (text == null || text.trim().isEmpty()) return;
      runOnUiThread(() -> { if (tts != null) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "rk-assistant"); });
    }
  }
  private void launchSpeechRecognizer() {
    try {
      Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
      intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "hi-IN");
      intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Radhe Krishn Assistant को अपना निर्देश बोलें");
      startActivityForResult(intent, SPEECH_REQUEST);
    } catch (Exception e) {
      if (web != null) web.evaluateJavascript("window.onNativeSpeechResult('')", null);
      Toast.makeText(this, "इस डिवाइस में Voice Recognition सेवा उपलब्ध नहीं है", Toast.LENGTH_LONG).show();
    }
  }
  @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == AUDIO_PERMISSION_REQUEST) {
      boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
      if (granted && speechPending) launchSpeechRecognizer();
      else if (web != null) web.evaluateJavascript("window.onNativeSpeechResult('')", null);
      speechPending = false;
    }
  }
  @Override protected void onDestroy() {
    if (tts != null) { tts.stop(); tts.shutdown(); }
    if (receiverRegistered && downloadReceiver != null) {
      try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
    }
    super.onDestroy();
  }
  @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
