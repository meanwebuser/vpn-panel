package com.example.vpntestagent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

/** Keeps CPU and Wi-Fi awake while USB powers the dedicated benchmark phone. */
public final class BenchmarkDeviceService extends Service {
    private static final String TAG = "VpnBenchmarkKeeper";
    private static final String CHANNEL_ID = "vpn-benchmark-device-keeper";
    private static final int NOTIFICATION_ID = 12081;

    private PowerManager.WakeLock cpuWakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean receiverRegistered;

    private final BroadcastReceiver powerReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            refreshLocks();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotification();
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        cpuWakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vpn-panel:benchmark-usb");
        cpuWakeLock.setReferenceCounted(false);
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "vpn-panel:benchmark-wifi");
        wifiLock.setReferenceCounted(false);
        IntentFilter powerChanges = new IntentFilter();
        powerChanges.addAction(Intent.ACTION_POWER_CONNECTED);
        powerChanges.addAction(Intent.ACTION_POWER_DISCONNECTED);
        registerReceiver(powerReceiver, powerChanges, Context.RECEIVER_NOT_EXPORTED);
        receiverRegistered = true;
        refreshLocks();
    }

    private void createNotification() {
        NotificationManager notifications = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "VPN benchmark device", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps the dedicated benchmark phone reachable while USB powered");
        notifications.createNotificationChannel(channel);
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("VPN benchmark device")
                .setContentText("USB wake and Wi-Fi control channel are active")
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setOngoing(true)
                .build();
        startForeground(NOTIFICATION_ID, notification);
    }

    private void refreshLocks() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int plugged = battery == null ? 0 : battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        boolean usbPowered = (plugged & BatteryManager.BATTERY_PLUGGED_USB) != 0;
        if (usbPowered) {
            if (!cpuWakeLock.isHeld()) cpuWakeLock.acquire();
            if (!wifiLock.isHeld()) wifiLock.acquire();
        } else {
            releaseLocks();
        }
        Log.i(TAG, "USB powered=" + usbPowered + ", CPU lock=" + cpuWakeLock.isHeld() + ", Wi-Fi lock=" + wifiLock.isHeld());
    }

    private void releaseLocks() {
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) cpuWakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        refreshLocks();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        if (receiverRegistered) unregisterReceiver(powerReceiver);
        receiverRegistered = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
