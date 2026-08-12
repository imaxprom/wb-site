package ru.imaxprom.shipmentscanner;

import java.io.File;
import java.util.Arrays;

public final class XlsxSmoke {
    public static void main(String[] args) throws Exception {
        ShipmentStore.Row first = new ShipmentStore.Row();
        first.product = "2053541776765";
        first.quantity = 15;
        first.box = "MG_00015549";
        ShipmentStore.Row second = new ShipmentStore.Row();
        second.product = "2053382846146";
        second.quantity = 12;
        second.box = "MG_00015549";
        XlsxExporter.write(new File(args[0]), Arrays.asList(first, second));
    }
}
