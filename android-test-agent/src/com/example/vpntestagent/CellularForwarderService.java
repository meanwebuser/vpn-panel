package com.example.vpntestagent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** TCP bridge whose remote sockets are created by Android's cellular Network. */
public final class CellularForwarderService extends Service {
    private static final String TAG = "VpnCellularBridge";
    private static final String CHANNEL_ID = "vpn-test-cellular-bridge";
    private static final int NOTIFICATION_ID = 12080;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private ServerSocket serverSocket;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager notifications = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "VPN test cellular bridge", NotificationManager.IMPORTANCE_LOW));
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("VPN 4G benchmark")
                .setContentText("Cellular test bridge is active")
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .build();
        startForeground(NOTIFICATION_ID, notification);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        stopForwarder();
        String remoteHost = intent.getStringExtra("remoteHost");
        int remotePort = intent.getIntExtra("remotePort", 0);
        int listenPort = intent.getIntExtra("listenPort", 0);
        if (remoteHost == null || remoteHost.isEmpty() || remotePort < 1 || listenPort < 1) {
            writeStatus("error", listenPort, "invalid forwarder arguments", null);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network cellular = validatedCellularNetwork(manager);
        if (cellular == null) {
            writeStatus("error", listenPort, "validated cellular network is unavailable", null);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        executor.execute(() -> serve(cellular, remoteHost, remotePort, listenPort, startId));
        return START_NOT_STICKY;
    }

    private void serve(Network network, String remoteHost, int remotePort, int listenPort, int startId) {
        ServerSocket listener = null;
        try {
            listener = new ServerSocket();
            // Xray and the instrumentation use an explicit IPv4 loopback dial;
            // InetAddress.getLoopbackAddress() may otherwise select ::1.
            listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), listenPort));
            synchronized (this) {
                serverSocket = listener;
            }
            writeStatus("ready", listenPort, remoteHost + ":" + remotePort, network);
            while (!listener.isClosed()) {
                Socket inbound = listener.accept();
                executor.execute(() -> bridge(network, remoteHost, remotePort, inbound));
            }
        } catch (IOException error) {
            if (listener == null || !listener.isClosed()) {
                Log.e(TAG, "cellular bridge stopped", error);
                writeStatus("error", listenPort, error.toString(), network);
            }
        } finally {
            close(listener);
            synchronized (this) {
                if (serverSocket == listener) serverSocket = null;
            }
            stopSelf(startId);
        }
    }

    private void bridge(Network network, String remoteHost, int remotePort, Socket inbound) {
        try {
            Socket outbound = network.getSocketFactory().createSocket();
            outbound.connect(new InetSocketAddress(remoteHost, remotePort), 10000);
            executor.execute(() -> copy(inbound, outbound));
            executor.execute(() -> copy(outbound, inbound));
        } catch (IOException error) {
            Log.e(TAG, "cannot open cellular socket to " + remoteHost + ":" + remotePort, error);
            close(inbound);
        }
    }

    private void copy(Socket source, Socket destination) {
        try {
            InputStream input = source.getInputStream();
            OutputStream output = destination.getOutputStream();
            byte[] buffer = new byte[32768];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
                output.flush();
            }
        } catch (IOException ignored) {
            // Closing either half terminates the paired relay task as well.
        } finally {
            close(source);
            close(destination);
        }
    }

    private Network validatedCellularNetwork(ConnectivityManager manager) {
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null
                    && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return network;
        }
        return null;
    }

    private synchronized void stopForwarder() {
        close(serverSocket);
        serverSocket = null;
    }

    private void writeStatus(String state, int listenPort, String detail, Network network) {
        try {
            JSONObject status = new JSONObject()
                    .put("state", state)
                    .put("listenPort", listenPort)
                    .put("detail", detail);
            if (network != null) status.put("networkHandle", network.getNetworkHandle());
            File file = new File(getExternalFilesDir(null), "forwarder-status.json");
            try (FileOutputStream stream = new FileOutputStream(file)) {
                stream.write(status.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception error) {
            Log.e(TAG, "cannot write forwarder status", error);
        }
    }

    private static void close(ServerSocket socket) {
        if (socket == null) return;
        try { socket.close(); } catch (IOException ignored) { }
    }

    private static void close(Socket socket) {
        if (socket == null) return;
        try { socket.close(); } catch (IOException ignored) { }
    }

    @Override
    public void onDestroy() {
        stopForwarder();
        executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
