package ru.imaxprom.shipmentscanner;

import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class XlsxExporterTest {
    @Test public void repeatedBoxesCountOnce() {
        ShipmentStore.Row a = new ShipmentStore.Row(); a.box = "MG_0001"; a.quantity = 15;
        ShipmentStore.Row b = new ShipmentStore.Row(); b.box = "mg_0001"; b.quantity = 5;
        ShipmentStore.Row c = new ShipmentStore.Row(); c.box = "MG_0002"; c.quantity = 12;
        assertEquals(2, XlsxExporter.uniqueBoxes(Arrays.asList(a, b, c)));
        assertEquals(32, XlsxExporter.totalItems(Arrays.asList(a, b, c)));
    }
}
