package ru.imaxprom.shipmentscanner;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import java.util.ArrayList;

public final class DataWedgeManager {
    public static final String PROFILE = "ShipmentScanner";
    public static final String SCAN_ACTION = "ru.imaxprom.shipmentscanner.SCAN";
    public static final String SCAN_CATEGORY = "android.intent.category.DEFAULT";
    public static final String DATA = "com.symbol.datawedge.data_string";
    public static final String LABEL_TYPE = "com.symbol.datawedge.label_type";

    private DataWedgeManager() {}

    public static void configure(Context context) {
        Bundle main = new Bundle();
        main.putString("PROFILE_NAME", PROFILE);
        main.putString("PROFILE_ENABLED", "true");
        main.putString("CONFIG_MODE", "CREATE_IF_NOT_EXIST");

        Bundle app = new Bundle();
        app.putString("PACKAGE_NAME", context.getPackageName());
        app.putStringArray("ACTIVITY_LIST", new String[]{"*"});
        main.putParcelableArray("APP_LIST", new Bundle[]{app});

        ArrayList<Bundle> plugins = new ArrayList<>();

        Bundle barcodeParams = new Bundle();
        barcodeParams.putString("scanner_selection", "auto");
        barcodeParams.putString("scanner_input_enabled", "true");
        Bundle barcode = new Bundle();
        barcode.putString("PLUGIN_NAME", "BARCODE");
        barcode.putString("RESET_CONFIG", "false");
        barcode.putBundle("PARAM_LIST", barcodeParams);
        plugins.add(barcode);

        Bundle intentParams = new Bundle();
        intentParams.putString("intent_output_enabled", "true");
        intentParams.putString("intent_action", SCAN_ACTION);
        intentParams.putString("intent_category", SCAN_CATEGORY);
        intentParams.putInt("intent_delivery", 2);
        Bundle intentOutput = new Bundle();
        intentOutput.putString("PLUGIN_NAME", "INTENT");
        intentOutput.putString("RESET_CONFIG", "true");
        intentOutput.putBundle("PARAM_LIST", intentParams);
        plugins.add(intentOutput);

        Bundle keyParams = new Bundle();
        keyParams.putString("keystroke_output_enabled", "false");
        Bundle keyOutput = new Bundle();
        keyOutput.putString("PLUGIN_NAME", "KEYSTROKE");
        keyOutput.putString("RESET_CONFIG", "true");
        keyOutput.putBundle("PARAM_LIST", keyParams);
        plugins.add(keyOutput);

        main.putParcelableArrayList("PLUGIN_CONFIG", plugins);

        Intent command = new Intent("com.symbol.datawedge.api.ACTION");
        command.putExtra("com.symbol.datawedge.api.SET_CONFIG", main);
        command.putExtra("SEND_RESULT", "LAST_RESULT");
        command.putExtra("COMMAND_IDENTIFIER", "SHIPMENT_SCANNER_SETUP");
        context.sendBroadcast(command);
    }
}
