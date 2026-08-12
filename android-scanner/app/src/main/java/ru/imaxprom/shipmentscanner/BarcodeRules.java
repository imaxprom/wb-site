package ru.imaxprom.shipmentscanner;

import java.util.Locale;
import java.util.regex.Pattern;

public final class BarcodeRules {
    private static final Pattern PRODUCT = Pattern.compile("^[0-9]{4,32}$");
    private static final Pattern BOX_ALLOWED = Pattern.compile("^[A-Z0-9_-]{4,64}$");
    private static final Pattern HAS_LETTER = Pattern.compile(".*[A-Z].*");
    private static final Pattern HAS_DIGIT = Pattern.compile(".*[0-9].*");

    private BarcodeRules() {}

    public static String normalize(String raw) {
        return raw == null ? "" : raw.trim().replace(" ", "").toUpperCase(Locale.ROOT);
    }

    public static boolean isProduct(String raw) {
        return PRODUCT.matcher(normalize(raw)).matches();
    }

    public static boolean isBox(String raw) {
        String value = normalize(raw);
        return BOX_ALLOWED.matcher(value).matches()
                && HAS_LETTER.matcher(value).matches()
                && HAS_DIGIT.matcher(value).matches();
    }

    public static int parseQuantity(String raw) {
        if (raw == null || !raw.matches("[1-9][0-9]{0,5}")) return -1;
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }
}
