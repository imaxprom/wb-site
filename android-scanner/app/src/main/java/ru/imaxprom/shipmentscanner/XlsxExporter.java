package ru.imaxprom.shipmentscanner;

import android.content.Context;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class XlsxExporter {
    private XlsxExporter() {}

    public static int uniqueBoxes(List<ShipmentStore.Row> rows) {
        Set<String> boxes = new HashSet<>();
        for (ShipmentStore.Row row : rows) boxes.add(BarcodeRules.normalize(row.box));
        return boxes.size();
    }

    public static int totalItems(List<ShipmentStore.Row> rows) {
        int total = 0;
        for (ShipmentStore.Row row : rows) total += row.quantity;
        return total;
    }

    public static String buildFileName(ShipmentStore.Shipment shipment, int boxes) {
        String date = new SimpleDateFormat("dd.MM.yyyy", new Locale("ru", "RU")).format(new Date());
        String raw = shipment.marketplace + " — " + shipment.destination + " — " + boxes + " " + boxWord(boxes) + " — " + date + ".xlsx";
        return raw.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private static String boxWord(int value) {
        int n100 = value % 100;
        int n10 = value % 10;
        if (n100 >= 11 && n100 <= 19) return "коробов";
        if (n10 == 1) return "короб";
        if (n10 >= 2 && n10 <= 4) return "короба";
        return "коробов";
    }

    public static File export(Context context, ShipmentStore.Shipment shipment, List<ShipmentStore.Row> rows) throws IOException {
        File directory = new File(context.getFilesDir(), "exports");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Не удалось создать папку экспорта");
        String fileName = buildFileName(shipment, uniqueBoxes(rows));
        File output = new File(directory, fileName);
        write(output, rows);
        return output;
    }

    static void write(File output, List<ShipmentStore.Row> rows) throws IOException {
        try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(output)))) {
            entry(zip, "[Content_Types].xml", contentTypes());
            entry(zip, "_rels/.rels", rootRels());
            entry(zip, "docProps/app.xml", appProps());
            entry(zip, "docProps/core.xml", coreProps());
            entry(zip, "xl/workbook.xml", workbook());
            entry(zip, "xl/_rels/workbook.xml.rels", workbookRels());
            entry(zip, "xl/styles.xml", styles());
            entry(zip, "xl/worksheets/sheet1.xml", sheet(rows));
        }
    }

    private static void entry(ZipOutputStream zip, String name, String body) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(body.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private static String contentTypes() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"
                + "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>"
                + "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
                + "</Types>";
    }

    private static String rootRels() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
                + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>"
                + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>"
                + "</Relationships>";
    }

    private static String appProps() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\"><Application>Shipment Scanner</Application></Properties>";
    }

    private static String coreProps() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:creator>Сканер отгрузки</dc:creator><dcterms:created xsi:type=\"dcterms:W3CDTF\">" + format.format(new Date()) + "</dcterms:created></cp:coreProperties>";
    }

    private static String workbook() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Отгрузка\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>";
    }

    private static String workbookRels() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>";
    }

    private static String styles() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"2\"><font><sz val=\"12\"/><name val=\"Arial\"/></font><font><b/><sz val=\"12\"/><name val=\"Arial\"/></font></fonts><fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs></styleSheet>";
    }

    private static String sheet(List<ShipmentStore.Row> rows) {
        StringBuilder xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews><cols><col min=\"1\" max=\"1\" width=\"20\" customWidth=\"1\"/><col min=\"2\" max=\"2\" width=\"18\" customWidth=\"1\"/><col min=\"3\" max=\"3\" width=\"24\" customWidth=\"1\"/><col min=\"4\" max=\"4\" width=\"18\" customWidth=\"1\"/></cols><sheetData>");
        xml.append("<row r=\"1\">").append(textCell("A1", "Баркод товара", 1)).append(textCell("B1", "Кол-во товаров", 1)).append(textCell("C1", "ШК короба", 1)).append(textCell("D1", "Срок годности", 1)).append("</row>");
        int number = 2;
        for (ShipmentStore.Row row : rows) {
            xml.append("<row r=\"").append(number).append("\">")
                    .append(textCell("A" + number, row.product, 0))
                    .append("<c r=\"B").append(number).append("\" t=\"n\"><v>").append(row.quantity).append("</v></c>")
                    .append(textCell("C" + number, row.box, 0))
                    .append(textCell("D" + number, row.expiry, 0))
                    .append("</row>");
            number++;
        }
        xml.append("</sheetData><autoFilter ref=\"A1:D").append(Math.max(1, number - 1)).append("\"/></worksheet>");
        return xml.toString();
    }

    private static String textCell(String ref, String value, int style) {
        return "<c r=\"" + ref + "\" s=\"" + style + "\" t=\"inlineStr\"><is><t>" + escape(value) + "</t></is></c>";
    }

    private static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }
}
