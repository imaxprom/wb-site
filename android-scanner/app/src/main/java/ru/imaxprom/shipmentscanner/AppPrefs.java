package ru.imaxprom.shipmentscanner;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class AppPrefs {
    private static final String FILE = "shipment_scanner";
    private static final String DEFAULT_MARKETS = "Wildberries\nOzon";
    private static final String DEFAULT_DESTINATIONS = "Рязань\nЕкатеринбург\nКоледино\nПодольск";

    private final SharedPreferences prefs;

    public AppPrefs(Context context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String email() { return prefs.getString("email", ""); }
    public void setEmail(String value) { prefs.edit().putString("email", value.trim()).apply(); }

    public List<String> marketplaces() { return split(prefs.getString("markets", DEFAULT_MARKETS)); }
    public void setMarketplaces(String value) { prefs.edit().putString("markets", normalizeLines(value, DEFAULT_MARKETS)).apply(); }

    public List<String> destinations() { return split(prefs.getString("destinations", DEFAULT_DESTINATIONS)); }
    public void setDestinations(String value) { prefs.edit().putString("destinations", normalizeLines(value, DEFAULT_DESTINATIONS)).apply(); }

    public String marketplacesText() { return String.join("\n", marketplaces()); }
    public String destinationsText() { return String.join("\n", destinations()); }

    public long activeShipmentId() { return prefs.getLong("active_shipment", -1); }
    public void setActiveShipmentId(long id) { prefs.edit().putLong("active_shipment", id).apply(); }
    public void clearActiveShipment() { prefs.edit().remove("active_shipment").apply(); }

    private static String normalizeLines(String value, String fallback) {
        List<String> rows = split(value);
        return rows.isEmpty() ? fallback : String.join("\n", rows);
    }

    private static List<String> split(String value) {
        List<String> rows = new ArrayList<>();
        if (value == null) return rows;
        for (String row : Arrays.asList(value.split("[\\r\\n,;]+"))) {
            String clean = row.trim();
            if (!clean.isEmpty() && !rows.contains(clean)) rows.add(clean);
        }
        return rows;
    }
}
