package com.qamanager.mobile;

import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * QA Tester native helpers.
 *  - getBuildInfo: phone model / Android build + installed Glasses Core and Glasses Companion versions.
 *  - recognizeText: on-device OCR (ML Kit, bundled model - no network) for the Companion "About" screenshot.
 * Source of truth is tracked in git at native/android/DeviceBuildsPlugin.java (android/ is gitignored).
 */
@CapacitorPlugin(name = "DeviceBuilds")
public class DeviceBuildsPlugin extends Plugin {
    static final String GLASSES_CORE = "com.google.android.glasses.core";
    static final String GLASSES_COMPANION = "com.google.android.glasses.companion";
    /** Longest side fed to OCR; phone screenshots (<= ~3200px) are not downscaled. */
    static final int MAX_OCR_DIMENSION = 3200;

    @PluginMethod
    public void getBuildInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("manufacturer", Build.MANUFACTURER);
        r.put("model", Build.MODEL);
        r.put("androidVersion", Build.VERSION.RELEASE);
        r.put("sdkInt", Build.VERSION.SDK_INT);
        r.put("buildId", Build.ID);
        r.put("buildDisplay", Build.DISPLAY);
        r.put("fingerprint", Build.FINGERPRINT);
        JSObject core = packageVersion(GLASSES_CORE);
        JSObject companion = packageVersion(GLASSES_COMPANION);
        if (core != null) r.put("glassesCore", core);
        if (companion != null) r.put("glassesCompanion", companion);
        call.resolve(r);
    }

    private JSObject packageVersion(String packageName) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(packageName, 0);
            JSObject o = new JSObject();
            o.put("packageName", packageName);
            o.put("versionName", pi.versionName);
            long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            o.put("versionCode", String.valueOf(code));
            return o;
        } catch (Exception e) {
            return null; // not installed (or not visible)
        }
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String data = call.getString("base64");
        if (data == null || data.isEmpty()) {
            call.reject("No image provided");
            return;
        }
        int comma = data.indexOf(',');
        if (data.startsWith("data:") && comma > 0) data = data.substring(comma + 1);
        Bitmap decoded;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            // Read size first, then downsample big photos (screenshots stay full-res for OCR accuracy)
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            int sample = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / sample > MAX_OCR_DIMENSION) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        } catch (OutOfMemoryError e) {
            call.reject("That image is too large - use a screenshot of the About screen");
            return;
        } catch (Exception e) {
            call.reject("Could not read the image");
            return;
        }
        final Bitmap bitmap = decoded;
        if (bitmap == null) {
            call.reject("Could not read the image");
            return;
        }
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener(text -> {
                JSArray lines = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        JSObject l = new JSObject();
                        l.put("text", line.getText());
                        Rect box = line.getBoundingBox();
                        l.put("top", box != null ? box.top : 0);
                        l.put("left", box != null ? box.left : 0);
                        l.put("height", box != null ? box.height() : 0);
                        lines.put(l);
                    }
                }
                JSObject r = new JSObject();
                r.put("text", text.getText());
                r.put("lines", lines);
                r.put("width", bitmap.getWidth());
                r.put("height", bitmap.getHeight());
                call.resolve(r);
                recognizer.close();
                bitmap.recycle();
            })
            .addOnFailureListener(e -> {
                call.reject("Text recognition failed: " + e.getMessage());
                recognizer.close();
                bitmap.recycle();
            });
    }
}
