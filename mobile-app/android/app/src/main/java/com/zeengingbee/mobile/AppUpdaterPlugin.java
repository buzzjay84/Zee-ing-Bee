package com.zeengingbee.mobile;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads the new APK from the GitHub release and opens Android's installer on it.
 * Android always asks the person to confirm installing a sideloaded app; that one tap
 * (plus, the first time, allowing "install unknown apps") can't be skipped.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://github.com/")) {
            call.reject("Not a GitHub release download");
            return;
        }
        new Thread(() -> {
            try {
                File apk = new File(getContext().getCacheDir(), "update.apk");
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                if (connection.getResponseCode() != 200) throw new Exception("Download failed (" + connection.getResponseCode() + ")");
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[1 << 16];
                    for (int read; (read = in.read(buffer)) > 0;) out.write(buffer, 0, read);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage());
            }
        }).start();
    }
}
