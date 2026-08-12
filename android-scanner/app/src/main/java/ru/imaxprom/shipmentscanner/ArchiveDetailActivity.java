package ru.imaxprom.shipmentscanner;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public final class ArchiveDetailActivity extends Activity {
    private ShipmentStore store;
    private AppPrefs prefs;
    private ShipmentStore.Shipment shipment;
    private List<ShipmentStore.Row> rows;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new ShipmentStore(this);
        prefs = new AppPrefs(this);
        shipment = store.getShipment(getIntent().getLongExtra("shipment_id", -1));
        if (shipment == null) { finish(); return; }
        rows = store.listRows(shipment.id);
        render();
    }

    private void render() {
        LinearLayout page = Ui.page(this);
        page.setPadding(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12));
        page.addView(Ui.title(this, "Состав отгрузки"));

        SimpleDateFormat date = new SimpleDateFormat("dd.MM.yyyy HH:mm", new Locale("ru", "RU"));
        TextView summary = Ui.text(this,
                shipment.marketplace + " · " + shipment.destination + "\n"
                        + date.format(new Date(shipment.createdAt)) + " · " + ("SENT".equals(shipment.status) ? "Отправлено" : "Не отправлено") + "\n"
                        + "Строк: " + rows.size() + " · Товаров: " + XlsxExporter.totalItems(rows) + " · Коробов: " + XlsxExporter.uniqueBoxes(rows),
                17);
        summary.setLineSpacing(Ui.dp(this, 3), 1f);
        summary.setBackgroundResource(R.drawable.archive_card);
        page.addView(summary, Ui.matchWrap(this));

        LinearLayout table = new LinearLayout(this);
        table.setOrientation(LinearLayout.VERTICAL);
        table.addView(tableRow("№", "Баркод товара", "Кол-во", "ШК короба", true));
        for (int i = 0; i < rows.size(); i++) {
            ShipmentStore.Row row = rows.get(i);
            table.addView(tableRow(String.valueOf(i + 1), row.product, String.valueOf(row.quantity), row.box, false));
        }
        ScrollView tableScroll = new ScrollView(this);
        tableScroll.addView(table);
        page.addView(tableScroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        Button resend = Ui.button(this, "Отправить повторно");
        resend.setEnabled(!rows.isEmpty());
        resend.setOnClickListener(v -> resend());
        LinearLayout.LayoutParams resendParams = Ui.matchWrap(this);
        resendParams.topMargin = Ui.dp(this, 8);
        resendParams.bottomMargin = 0;
        page.addView(resend, resendParams);
        setContentView(page);
    }

    private LinearLayout tableRow(String number, String product, String quantity, String box, boolean header) {
        LinearLayout line = new LinearLayout(this);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setBackgroundColor(header ? Color.TRANSPARENT : Color.rgb(247, 249, 252));
        if (header) line.setBackgroundResource(R.drawable.archive_table_header);
        line.setPadding(0, Ui.dp(this, 2), 0, Ui.dp(this, 2));
        line.addView(cell(number, header ? 14 : 15, header), new LinearLayout.LayoutParams(Ui.dp(this, 26), Ui.dp(this, 52)));
        line.addView(cell(product, header ? 14 : 13, header), new LinearLayout.LayoutParams(Ui.dp(this, 120), Ui.dp(this, 52)));
        line.addView(cell(quantity, header ? 13 : 16, header), new LinearLayout.LayoutParams(Ui.dp(this, 52), Ui.dp(this, 52)));
        line.addView(cell(box, header ? 14 : 13, header), new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1));
        return line;
    }

    private TextView cell(String value, float size, boolean bold) {
        TextView view = Ui.text(this, value, size);
        view.setGravity(Gravity.CENTER);
        view.setSingleLine(true);
        view.setPadding(Ui.dp(this, 2), 0, Ui.dp(this, 2), 0);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        else view.setTypeface(android.graphics.Typeface.MONOSPACE);
        return view;
    }

    private void resend() {
        if (prefs.email().isEmpty()) {
            new AlertDialog.Builder(this).setTitle("Не указана почта").setMessage("Укажите получателя в настройках.").setPositiveButton("Понятно", null).show();
            return;
        }
        try {
            File file = XlsxExporter.export(this, shipment, rows);
            Uri uri = ExportFileProvider.uriForFile(this, file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            send.setPackage("com.google.android.gm");
            send.putExtra(Intent.EXTRA_EMAIL, new String[]{prefs.email()});
            send.putExtra(Intent.EXTRA_SUBJECT, file.getName().replace(".xlsx", ""));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                startActivity(send);
            } catch (android.content.ActivityNotFoundException missingGmail) {
                send.setPackage(null);
                startActivity(Intent.createChooser(send, "Отправить отгрузку"));
            }
        } catch (IOException error) {
            new AlertDialog.Builder(this).setTitle("Ошибка").setMessage("Не удалось создать Excel-файл.").setPositiveButton("Понятно", null).show();
        }
    }
}
