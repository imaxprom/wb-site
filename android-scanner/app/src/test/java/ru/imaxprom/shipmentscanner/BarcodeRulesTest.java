package ru.imaxprom.shipmentscanner;

import org.junit.Test;
import static org.junit.Assert.*;

public class BarcodeRulesTest {
    @Test public void productCodesAreNumeric() {
        assertTrue(BarcodeRules.isProduct("2053541776765"));
        assertTrue(BarcodeRules.isProduct("5032780255680"));
        assertFalse(BarcodeRules.isProduct("WB-GI-264125431"));
        assertFalse(BarcodeRules.isProduct("MG_00015549"));
    }

    @Test public void boxCodesContainLettersAndDigits() {
        assertTrue(BarcodeRules.isBox("MG_00015549"));
        assertTrue(BarcodeRules.isBox("wb-gi-264125431"));
        assertFalse(BarcodeRules.isBox("2053541776765"));
        assertEquals("MG_00015549", BarcodeRules.normalize(" mg_00015549 "));
    }

    @Test public void quantitiesMustBePositiveIntegers() {
        assertEquals(15, BarcodeRules.parseQuantity("15"));
        assertEquals(-1, BarcodeRules.parseQuantity("0"));
        assertEquals(-1, BarcodeRules.parseQuantity("1.5"));
        assertEquals(-1, BarcodeRules.parseQuantity(""));
    }
}
