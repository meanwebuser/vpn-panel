package com.example.vpntestagent;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.http.HttpEngine;
import android.net.http.UrlRequest;
import android.net.http.UrlResponseInfo;
import android.os.Bundle;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Device-side test application driven by worker-lan over ADB. */
public final class VpnTestInstrumentation extends Instrumentation {
    private Bundle arguments;
    private Context context;
    private File spoolDirectory;
    private JSONObject eventTarget;
    private int sequence;

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        this.arguments = arguments;
        start();
    }

    @Override
    public void onStart() {
        context = getTargetContext();
        spoolDirectory = new File(context.getExternalFilesDir(null), "telemetry-spool");
        if (!spoolDirectory.exists() && !spoolDirectory.mkdirs()) {
            finishWithError("cannot create telemetry spool");
            return;
        }
        try {
            sequence = Integer.parseInt(arguments.getString("sequenceBase", "0"));
            int bridgePort = Integer.parseInt(arguments.getString("bridgePort", "0"));
            if (bridgePort > 0) {
                writeInstrumentationStatus("waiting_for_bridge", null);
                if (!waitForPort(bridgePort, 20)) throw new IllegalStateException("cellular bridge did not become reachable");
                writeInstrumentationStatus("running", null);
            }
            JSONObject result = runEndpoint();
            File resultFile = new File(context.getExternalFilesDir(null), "latest-result.json");
            write(resultFile, result.toString(2));
            Bundle output = new Bundle();
            output.putString("result_path", resultFile.getAbsolutePath());
            output.putString("endpoint", arguments.getString("endpoint", "unknown"));
            finish(Activity.RESULT_OK, output);
        } catch (Exception exception) {
            writeInstrumentationStatus("error", exception.toString());
            finishWithError(exception.toString());
        }
    }

    private boolean waitForPort(int port, int timeoutSeconds) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds);
        while (System.nanoTime() < deadline) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", port), 250);
                return true;
            } catch (Exception ignored) {
                Thread.sleep(250);
            }
        }
        return false;
    }

    private void writeInstrumentationStatus(String state, String error) {
        try {
            JSONObject status = new JSONObject().put("state", state);
            if (error != null) status.put("error", error);
            File file = new File(context.getExternalFilesDir(null), "instrumentation-status.json");
            write(file, status.toString());
        } catch (Exception ignored) {
            // The actual instrumentation result remains the authoritative error path.
        }
    }

    private JSONObject runEndpoint() throws Exception {
        String planText = new String(Base64.decode(required("planBase64"), Base64.DEFAULT), StandardCharsets.UTF_8);
        JSONObject plan = new JSONObject(planText);
        String endpoint = required("endpoint");
        String profile = arguments.getString("profile", "health");
        int socksPort = Integer.parseInt(arguments.getString("socksPort", "11080"));
        int endpointIndex = Integer.parseInt(arguments.getString("endpointIndex", "0"));
        int endpointTotal = Integer.parseInt(arguments.getString("endpointTotal", "1"));
        long runStarted = System.currentTimeMillis();
        JSONObject result = new JSONObject();
        result.put("endpoint", endpoint);
        result.put("checks", new JSONArray());
        eventTarget = networkMetadata();
        result.put("target", eventTarget);
        result.put("startedAt", Instant.now().toString());
        if (endpointIndex == 0) emit("run_started", endpoint, null, new JSONObject().put("endpointTotal", endpointTotal));
        emit("endpoint_started", endpoint, null, new JSONObject().put("device", result.get("target")));

        JSONArray stages = plan.getJSONObject("profiles").getJSONObject(profile).getJSONArray("stages");
        boolean includeSites = contains(stages, "sites");
        JSONArray checks = plan.getJSONArray("httpChecks");
        JSONArray checkResults = result.getJSONArray("checks");
        Proxy proxy = new Proxy(Proxy.Type.SOCKS, new InetSocketAddress("127.0.0.1", socksPort));
        JSONObject preflight = socksPreflight(socksPort);
        result.put("preflight", preflight);
        emit("stage_finished", endpoint, "preflight", preflight);
        for (int index = 0; index < checks.length(); index++) {
            JSONObject check = checks.getJSONObject(index);
            if (!isCheckSelected(check)) continue;
            if (!"gate".equals(check.getString("group")) && !includeSites) continue;
            JSONObject checkResult = httpCheck(check, proxy);
            checkResults.put(checkResult);
            emit("stage_finished", endpoint, check.getString("id"), checkResult);
        }

        String exitIp = readText("https://api.ipify.org", proxy, 8);
        if (!exitIp.isEmpty()) result.put("exitIp", exitIp);
        JSONObject udp = null;
        if (contains(stages, "udp")) {
            udp = udpCheck(plan.getJSONObject("udpCheck"), socksPort);
            result.put("udp", udp);
            emit("stage_finished", endpoint, "udp", udp);
        }
        if (contains(stages, "throughput")) {
            JSONObject throughput = throughputCheck(plan.getJSONObject("throughput"), proxy);
            result.put("throughput", throughput);
            emit("stage_finished", endpoint, "throughput", throughput);
        }

        if (contains(stages, "quic") && endpointIndex == 0) {
            emit("stage_started", endpoint, "quic", new JSONObject().put("scope", "target-network"));
            JSONObject quic = quicCheck(plan.getJSONObject("quicCheck"));
            result.put("quic", quic);
            emit("stage_finished", endpoint, "quic", quic);
        }
        boolean eligible = endpointEligible(plan, checkResults, profile, udp);
        result.put("eligible", eligible);
        result.put("finishedAt", Instant.now().toString());
        result.put("durationMs", System.currentTimeMillis() - runStarted);
        emit("endpoint_finished", endpoint, null, new JSONObject().put("eligible", eligible));
        if (endpointIndex + 1 == endpointTotal) emit("run_finished", endpoint, null, new JSONObject().put("endpointTotal", endpointTotal));
        return result;
    }

    private boolean isCheckSelected(JSONObject check) throws Exception {
        String id = check.getString("id");
        if (!arguments.containsKey("checks")) return check.optBoolean("enabled", true);
        String selected = arguments.getString("checks", "");
        for (String value : selected.split(",")) {
            if (id.equals(value)) return true;
        }
        return false;
    }

    private JSONObject socksPreflight(int socksPort) throws Exception {
        long started = System.nanoTime();
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", socksPort), 3000);
            return new JSONObject().put("ok", true).put("latencyMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        } catch (Exception exception) {
            return new JSONObject().put("ok", false).put("error", exception.toString());
        }
    }

    private JSONObject httpCheck(JSONObject check, Proxy proxy) throws Exception {
        long started = System.nanoTime();
        HttpURLConnection connection = (HttpURLConnection) new URL(check.getString("url")).openConnection(proxy);
        connection.setConnectTimeout(check.getInt("timeoutSeconds") * 1000);
        connection.setReadTimeout(check.getInt("timeoutSeconds") * 1000);
        connection.setInstanceFollowRedirects(false);
        int code;
        String error = null;
        try {
            code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream != null) stream.close();
        } catch (Exception exception) {
            code = 0;
            error = exception.toString();
        } finally {
            connection.disconnect();
        }
        boolean reachable = code >= 100 && code <= 599;
        boolean contentOk = containsInt(check.getJSONArray("acceptedCodes"), code);
        JSONObject output = new JSONObject()
                .put("id", check.getString("id"))
                .put("label", check.getString("label"))
                .put("group", check.getString("group"))
                .put("code", code)
                .put("latencyMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started))
                .put("reachable", reachable)
                .put("contentOk", contentOk)
                .put("ok", contentOk)
                .put("severity", contentOk ? "ok" : (reachable ? "warning" : "fatal"));
        if (error != null) output.put("error", error);
        return output;
    }

    private JSONObject quicCheck(JSONObject spec) throws Exception {
        if (android.os.Build.VERSION.SDK_INT < 34) {
            return new JSONObject().put("id", spec.getString("id")).put("supported", false).put("ok", JSONObject.NULL);
        }
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network originalNetwork = manager.getBoundNetworkForProcess();
        String requiredTransport = arguments.getString("requiredTransport", "");
        boolean processBound = false;
        if (!requiredTransport.isEmpty()) {
            Network requiredNetwork = validatedNetwork(manager, requiredTransport);
            if (requiredNetwork == null) {
                return new JSONObject().put("id", spec.getString("id")).put("supported", true).put("ok", false)
                        .put("error", "required " + requiredTransport + " network is unavailable");
            }
            processBound = manager.bindProcessToNetwork(requiredNetwork);
            if (!processBound) {
                return new JSONObject().put("id", spec.getString("id")).put("supported", true).put("ok", false)
                        .put("error", "cannot bind QUIC check to " + requiredTransport);
            }
        }
        try {
            ExecutorService executor = Executors.newSingleThreadExecutor();
            CountDownLatch latch = new CountDownLatch(1);
            JSONObject output = new JSONObject().put("id", spec.getString("id")).put("supported", true).put("ok", false);
            HttpEngine engine = new HttpEngine.Builder(context).setEnableQuic(true).build();
            UrlRequest.Callback callback = new UrlRequest.Callback() {
                @Override public void onRedirectReceived(UrlRequest request, UrlResponseInfo info, String newLocationUrl) { request.followRedirect(); }
                @Override public void onResponseStarted(UrlRequest request, UrlResponseInfo info) throws Exception {
                    output.put("code", info.getHttpStatusCode());
                    output.put("protocol", info.getNegotiatedProtocol());
                    output.put("ok", info.getNegotiatedProtocol().toLowerCase().contains("quic") || info.getNegotiatedProtocol().toLowerCase().contains("h3"));
                    request.cancel();
                    latch.countDown();
                }
                @Override public void onReadCompleted(UrlRequest request, UrlResponseInfo info, java.nio.ByteBuffer byteBuffer) { }
                @Override public void onSucceeded(UrlRequest request, UrlResponseInfo info) { latch.countDown(); }
                @Override public void onCanceled(UrlRequest request, UrlResponseInfo info) { latch.countDown(); }
                @Override public void onFailed(UrlRequest request, UrlResponseInfo info, android.net.http.HttpException error) {
                    try { output.put("error", error.toString()); } catch (Exception ignored) { }
                    latch.countDown();
                }
            };
            engine.newUrlRequestBuilder(spec.getString("url"), executor, callback).build().start();
            if (!latch.await(spec.getInt("timeoutSeconds"), TimeUnit.SECONDS)) output.put("error", "QUIC timeout");
            try { engine.shutdown(); } catch (IllegalStateException ignored) { }
            executor.shutdownNow();
            return output;
        } finally {
            if (processBound) manager.bindProcessToNetwork(originalNetwork);
        }
    }

    private JSONObject throughputCheck(JSONObject spec, Proxy proxy) throws Exception {
        long started = System.nanoTime();
        long bytes = 0;
        int code = 0;
        String error = null;
        String url = spec.getString("url") + "?bytes=" + spec.getLong("bytes");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection(proxy);
        connection.setConnectTimeout(spec.getInt("timeoutSeconds") * 1000);
        connection.setReadTimeout(spec.getInt("timeoutSeconds") * 1000);
        try {
            code = connection.getResponseCode();
            try (InputStream stream = connection.getInputStream()) {
                byte[] buffer = new byte[32768];
                int read;
                while ((read = stream.read(buffer)) >= 0) bytes += read;
            }
        } catch (Exception exception) {
            error = exception.toString();
        } finally {
            connection.disconnect();
        }
        double seconds = Math.max(0.001, (System.nanoTime() - started) / 1_000_000_000.0);
        JSONObject output = new JSONObject().put("ok", code >= 200 && code < 400).put("code", code).put("bytes", bytes).put("mbps", Math.round(bytes * 8.0 / seconds / 10_000.0) / 100.0);
        if (error != null) output.put("error", error);
        return output;
    }

    private JSONObject udpCheck(JSONObject spec, int socksPort) throws Exception {
        long started = System.nanoTime();
        try (Socket control = new Socket()) {
            control.connect(new InetSocketAddress("127.0.0.1", socksPort), spec.getInt("timeoutSeconds") * 1000);
            control.setSoTimeout(spec.getInt("timeoutSeconds") * 1000);
            DataInputStream input = new DataInputStream(control.getInputStream());
            DataOutputStream output = new DataOutputStream(control.getOutputStream());
            output.write(new byte[]{5, 1, 0});
            if (input.readUnsignedByte() != 5 || input.readUnsignedByte() != 0) throw new IllegalStateException("SOCKS auth negotiation failed");
            output.write(new byte[]{5, 3, 0, 1, 0, 0, 0, 0, 0, 0});
            if (input.readUnsignedByte() != 5 || input.readUnsignedByte() != 0) throw new IllegalStateException("SOCKS UDP ASSOCIATE failed");
            input.readUnsignedByte();
            int addressType = input.readUnsignedByte();
            byte[] relayAddress;
            if (addressType == 1) relayAddress = input.readNBytes(4);
            else if (addressType == 4) relayAddress = input.readNBytes(16);
            else relayAddress = input.readNBytes(input.readUnsignedByte());
            int relayPort = input.readUnsignedShort();
            InetAddress relay = (addressType == 3) ? InetAddress.getByName(new String(relayAddress, StandardCharsets.US_ASCII)) : InetAddress.getByAddress(relayAddress);
            if (relay.isAnyLocalAddress()) relay = InetAddress.getByName("127.0.0.1");

            byte[] dns = dnsQuery(spec.getString("queryName"));
            ByteArrayOutputStream packetBytes = new ByteArrayOutputStream();
            DataOutputStream packet = new DataOutputStream(packetBytes);
            packet.write(new byte[]{0, 0, 0, 1});
            packet.write(InetAddress.getByName(spec.getString("host")).getAddress());
            packet.writeShort(spec.getInt("port"));
            packet.write(dns);
            try (DatagramSocket datagram = new DatagramSocket()) {
                datagram.setSoTimeout(spec.getInt("timeoutSeconds") * 1000);
                byte[] bytes = packetBytes.toByteArray();
                datagram.send(new DatagramPacket(bytes, bytes.length, relay, relayPort));
                byte[] responseBytes = new byte[4096];
                DatagramPacket response = new DatagramPacket(responseBytes, responseBytes.length);
                datagram.receive(response);
                int dnsOffset = responseBytes[3] == 1 ? 10 : (responseBytes[3] == 4 ? 22 : 7 + (responseBytes[4] & 0xff));
                boolean ok = response.getLength() >= dnsOffset + 12 && responseBytes[dnsOffset] == 0x44 && responseBytes[dnsOffset + 1] == 0x55 && (responseBytes[dnsOffset + 2] & 0x80) != 0;
                return new JSONObject().put("id", spec.getString("id")).put("ok", ok).put("latencyMs", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
            }
        } catch (Exception exception) {
            return new JSONObject().put("id", spec.optString("id", "udp")).put("ok", false).put("error", exception.toString());
        }
    }

    private byte[] dnsQuery(String name) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream output = new DataOutputStream(bytes);
        output.writeShort(0x4455);
        output.writeShort(0x0100);
        output.writeShort(1);
        output.writeShort(0);
        output.writeShort(0);
        output.writeShort(0);
        for (String label : name.split("\\.")) {
            byte[] encoded = label.getBytes(StandardCharsets.US_ASCII);
            output.writeByte(encoded.length);
            output.write(encoded);
        }
        output.writeByte(0);
        output.writeShort(1);
        output.writeShort(1);
        return bytes.toByteArray();
    }

    private String readText(String url, Proxy proxy, int timeoutSeconds) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection(proxy);
            connection.setConnectTimeout(timeoutSeconds * 1000);
            connection.setReadTimeout(timeoutSeconds * 1000);
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                return reader.readLine().trim();
            } finally {
                connection.disconnect();
            }
        } catch (Exception exception) {
            return "";
        }
    }

    private String readText(String url, Network network, int timeoutSeconds) {
        try {
            HttpURLConnection connection = (HttpURLConnection) network.openConnection(new URL(url));
            connection.setConnectTimeout(timeoutSeconds * 1000);
            connection.setReadTimeout(timeoutSeconds * 1000);
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                return reader.readLine().trim();
            } finally {
                connection.disconnect();
            }
        } catch (Exception exception) {
            return "";
        }
    }

    private JSONObject networkMetadata() throws Exception {
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        String requiredTransport = arguments.getString("requiredTransport", "");
        Network network = validatedNetwork(manager, requiredTransport);
        if (network == null) throw new IllegalStateException("required " + requiredTransport + " network is unavailable");
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        String transport = transportName(capabilities);
        String directIp = readText("https://api.ipify.org", network, 8);
        String lanPublicIp = arguments.getString("lanPublicIp", "198.51.100.10");
        String networkClass = "cellular".equals(transport) ? "external-mobile" : (directIp.equals(lanPublicIp) ? "lan" : "external-wireless");
        JSONObject metadata = new JSONObject()
                .put("id", "external-wireless-android")
                .put("networkClass", networkClass)
                .put("client", "xray")
                .put("accessMethod", "socks-proxy")
                .put("wireMethod", "4g")
                .put("hostRole", "android")
                .put("transport", transport)
                .put("directIp", directIp)
                .put("model", android.os.Build.MODEL)
                .put("android", android.os.Build.VERSION.RELEASE);
        String outboundInterface = arguments.getString("outboundInterface", "");
        if (!outboundInterface.isEmpty()) metadata.put("outboundInterface", outboundInterface);
        String outboundPath = arguments.getString("outboundPath", "");
        if (!outboundPath.isEmpty()) metadata.put("outboundPath", outboundPath);
        return metadata;
    }

    private Network validatedNetwork(ConnectivityManager manager, String requiredTransport) {
        if (requiredTransport.isEmpty()) return manager.getActiveNetwork();
        int transportType;
        if ("cellular".equals(requiredTransport)) transportType = NetworkCapabilities.TRANSPORT_CELLULAR;
        else if ("wifi".equals(requiredTransport)) transportType = NetworkCapabilities.TRANSPORT_WIFI;
        else if ("ethernet".equals(requiredTransport)) transportType = NetworkCapabilities.TRANSPORT_ETHERNET;
        else throw new IllegalArgumentException("unsupported requiredTransport: " + requiredTransport);
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null
                    && capabilities.hasTransport(transportType)
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return network;
        }
        return null;
    }

    private String transportName(NetworkCapabilities capabilities) {
        if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        return "unknown";
    }

    private boolean endpointEligible(JSONObject plan, JSONArray checks, String profile, JSONObject udp) throws Exception {
        JSONArray required = plan.getJSONObject("eligibility").getJSONArray("requiredGateChecks");
        for (int index = 0; index < required.length(); index++) {
            String id = required.getString(index);
            boolean found = false;
            for (int checkIndex = 0; checkIndex < checks.length(); checkIndex++) {
                JSONObject check = checks.getJSONObject(checkIndex);
                if (id.equals(check.getString("id")) && check.getBoolean("reachable")) found = true;
            }
            if (!found) return false;
        }
        if (contains(plan.getJSONObject("profiles").getJSONObject(profile).getJSONArray("stages"), "sites")) {
            int siteCount = 0;
            int reachableCount = 0;
            for (int index = 0; index < checks.length(); index++) {
                JSONObject check = checks.getJSONObject(index);
                if (!contains(required, check.getString("id"))) {
                    siteCount++;
                    if (check.getBoolean("reachable")) reachableCount++;
                }
            }
            if (siteCount > 0 && reachableCount / (double) siteCount < plan.getJSONObject("eligibility").getDouble("minimumSiteRatio")) return false;
        }
        if (plan.getJSONObject("eligibility").getBoolean("requireUdp") && udp != null && !udp.getBoolean("ok")) return false;
        return true;
    }

    private void emit(String type, String endpoint, String stage, JSONObject payload) {
        try {
            payload.put("engine", "xray-android-shell");
            JSONObject event = new JSONObject()
                    .put("schemaVersion", 1)
                    .put("eventId", UUID.randomUUID().toString())
                    .put("runId", required("runId"))
                    .put("sequence", ++sequence)
                    .put("timestamp", Instant.now().toString())
                    .put("type", type)
                    .put("profile", arguments.getString("profile", "health"))
                    .put("target", eventTarget != null ? eventTarget : new JSONObject()
                            .put("id", "external-wireless-android")
                            .put("networkClass", "external-mobile")
                            .put("client", "xray")
                            .put("accessMethod", "socks-proxy")
                            .put("wireMethod", "4g")
                            .put("hostRole", "android"))
                    .put("endpoint", endpoint)
                    .put("payload", payload);
            if (stage != null) event.put("stage", stage);
            if (!post(event)) write(new File(spoolDirectory, String.format("%06d-%s.json", sequence, event.getString("eventId"))), event.toString());
        } catch (Exception ignored) {
            // A telemetry failure must not erase the actual network test result.
        }
    }

    private boolean post(JSONObject event) {
        String url = arguments.getString("telemetryUrl", "");
        String key = arguments.getString("telemetryKey", "");
        if (url.isEmpty() || key.isEmpty()) return false;
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setRequestProperty("Authorization", "Bearer " + key);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            connection.getOutputStream().write(event.toString().getBytes(StandardCharsets.UTF_8));
            int code = connection.getResponseCode();
            connection.disconnect();
            return code >= 200 && code < 300;
        } catch (Exception exception) {
            return false;
        }
    }

    private String required(String key) {
        String value = arguments.getString(key);
        if (value == null || value.isEmpty()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    private static boolean contains(JSONArray array, String value) throws Exception {
        for (int index = 0; index < array.length(); index++) if (value.equals(array.getString(index))) return true;
        return false;
    }

    private static boolean containsInt(JSONArray array, int value) throws Exception {
        for (int index = 0; index < array.length(); index++) if (value == array.getInt(index)) return true;
        return false;
    }

    private static void write(File file, String value) throws Exception {
        try (FileOutputStream stream = new FileOutputStream(file)) {
            stream.write(value.getBytes(StandardCharsets.UTF_8));
        }
    }

    private void finishWithError(String error) {
        Bundle output = new Bundle();
        output.putString("error", error);
        finish(Activity.RESULT_CANCELED, output);
    }
}
