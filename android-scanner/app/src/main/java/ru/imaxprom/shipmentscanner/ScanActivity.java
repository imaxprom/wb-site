package ru.imaxprom.shipmentscanner;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;


import java.io.File;
import java.io.IOException;
import java.util.List;

public final class ScanActivity extends Activity {
    private enum Step { PRODUCT, QUANTITY, BOX }

    private ShipmentStore store;
    private AppPrefs prefs;
    private ShipmentStore.Shipment shipment;
    private long shipmentId;
    private Step step = Step.PRODUCT;
    private String pendingProduct = "";
    private TextView instruction;
    private TextView pending;
    private TextView totals;
    private LinearLayout pendingRow;
    private LinearLayout rowsLayout;
    private ScrollView rowScroll;
    private EditText quantity;
    private long lastScanAt;
    private String lastScan = "";
    private boolean waitingEmailResult;

    private final BroadcastReceiver scanReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String data = intent.getStringExtra(DataWedgeManager.DATA);
            if (data != null) handleScan(data);
        }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        store = new ShipmentStore(this);
        prefs = new AppPrefs(this);
        shipmentId = getIntent().getLongExtra("shipment_id", prefs.activeShipmentId());
        shipment = store.getShipment(shipmentId);
        if (shipment == null) { finish(); return; }
        DataWedgeManager.configure(this);
        render();
    }

    @Override protected void onResume() {
        super.onResume();
        IntentFilter filter = new IntentFilter(DataWedgeManager.SCAN_ACTION);
        filter.addCategory(DataWedgeManager.SCAN_CATEGORY);
        registerReceiver(scanReceiver, filter);
        if (waitingEmailResult) {
            waitingEmailResult = false;
            askEmailSent();
        }
    }

    @Override protected void onPause() {
        super.onPause();
        try { unregisterReceiver(scanReceiver); } catch (IllegalArgumentException ignored) {}
    }

    @Override public void onBackPressed() {
        new AlertDialog.Builder(this).setTitle("Отгрузка не завершена")
                .setMessage("Все строки сохранены. Продолжить можно с главного экрана.")
                .setNegativeButton("Остаться", null)
                .setPositiveButton("На главный экран", (d, w) -> finish()).show();
    }

    private void render() {
        LinearLayout page = Ui.page(this);
        page.setPadding(Ui.dp(this, 12), Ui.dp(this, 8), Ui.dp(this, 12), Ui.dp(this, 8));

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = Ui.text(this, compactMarketplace(shipment.marketplace) + " • " + shipment.destination, 19);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.rgb(20, 40, 65));
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setPadding(0, 0, Ui.dp(this, 5), 0);
        titleRow.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        totals = Ui.text(this, "", 12);
        totals.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        totals.setSingleLine(true);
        totals.setTextColor(Color.rgb(75, 86, 98));
        titleRow.addView(totals, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams titleParams = Ui.matchWrap(this);
        titleParams.bottomMargin = Ui.dp(this, 2);
        page.addView(titleRow, titleParams);

        instruction = Ui.text(this, "Отсканируйте баркод товара", 20);
        instruction.setTextColor(Color.rgb(13, 71, 161));
        instruction.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        instruction.setSingleLine(true);
        instruction.setPadding(0, Ui.dp(this, 3), 0, Ui.dp(this, 5));
        LinearLayout.LayoutParams instructionParams = Ui.matchWrap(this);
        instructionParams.bottomMargin = Ui.dp(this, 2);
        page.addView(instruction, instructionParams);

        pendingRow = new LinearLayout(this);
        pendingRow.setOrientation(LinearLayout.HORIZONTAL);
        pendingRow.setGravity(Gravity.CENTER_VERTICAL);
        pendingRow.setVisibility(View.GONE);

        pending = Ui.text(this, "", 16);
        pending.setSingleLine(true);
        pending.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        pending.setTypeface(android.graphics.Typeface.MONOSPACE);
        pendingRow.addView(pending, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        quantity = new EditText(this);
        quantity.setHint("Кол-во");
        quantity.setTextSize(22);
        quantity.setGravity(Gravity.CENTER);
        quantity.setInputType(InputType.TYPE_CLASS_NUMBER);
        quantity.setSingleLine(true);
        quantity.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable s) {
                if (step == Step.QUANTITY && BarcodeRules.parseQuantity(s.toString()) > 0) {
                    step = Step.BOX;
                    instruction.setText("Отсканируйте ШК короба");
                } else if (step == Step.BOX && BarcodeRules.parseQuantity(s.toString()) < 1) {
                    step = Step.QUANTITY;
                    instruction.setText("Введите количество");
                }
            }
        });
        pendingRow.addView(quantity, new LinearLayout.LayoutParams(Ui.dp(this, 130), LinearLayout.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams pendingParams = Ui.matchWrap(this);
        pendingParams.bottomMargin = Ui.dp(this, 4);
        page.addView(pendingRow, pendingParams);

        LinearLayout.LayoutParams headerParams = Ui.matchWrap(this);
        headerParams.bottomMargin = Ui.dp(this, 2);
        page.addView(createTableRow(0, "Баркод товара", "Кол-во", "ШК короба", true), headerParams);

        rowsLayout = new LinearLayout(this);
        rowsLayout.setOrientation(LinearLayout.VERTICAL);
        rowScroll = new ScrollView(this);
        rowScroll.setFillViewport(true);
        rowScroll.addView(rowsLayout);
        page.addView(rowScroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        Button finish = Ui.button(this, "Завершить и отправить");
        finish.setTextSize(17);
        finish.setMinHeight(Ui.dp(this, 48));
        finish.setOnClickListener(v -> confirmFinish());
        LinearLayout.LayoutParams finishParams = Ui.matchWrap(this);
        finishParams.topMargin = Ui.dp(this, 5);
        finishParams.bottomMargin = 0;
        page.addView(finish, finishParams);
        setContentView(page);
        refreshRows();
    }

    private String compactMarketplace(String value) {
        if (value != null && value.trim().equalsIgnoreCase("Wildberries")) return "WB";
        return value == null ? "" : value.trim();
    }

    private TextView tableCell(String text, float size, int gravity, boolean bold) {
        TextView cell = Ui.text(this, text, size);
        cell.setGravity(gravity | Gravity.CENTER_VERTICAL);
        cell.setSingleLine(true);
        cell.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        cell.setPadding(Ui.dp(this, 2), Ui.dp(this, 7), Ui.dp(this, 2), Ui.dp(this, 7));
        if (bold) cell.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return cell;
    }

    private LinearLayout createTableRow(int number, String product, String count, String box, boolean header) {
        LinearLayout line = new LinearLayout(this);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, 0, 0, Ui.dp(this, 1));
        line.setBackgroundColor(header || number % 2 == 0
                ? Color.rgb(226, 232, 240)
                : Color.rgb(247, 249, 252));

        TextView numberCell = tableCell(header ? "№" : String.valueOf(number), header ? 14 : 15, Gravity.CENTER, header);
        TextView productCell = tableCell(product, header ? 14 : 13, Gravity.CENTER, header);
        TextView countCell = tableCell(count, header ? 13 : 17, Gravity.CENTER, header);
        TextView boxCell = tableCell(box, header ? 14 : 13, Gravity.CENTER, header);
        if (!header) {
            productCell.setTypeface(android.graphics.Typeface.MONOSPACE);
            boxCell.setTypeface(android.graphics.Typeface.MONOSPACE);
        }

        line.addView(numberCell, new LinearLayout.LayoutParams(Ui.dp(this, 26), LinearLayout.LayoutParams.MATCH_PARENT));
        line.addView(productCell, new LinearLayout.LayoutParams(Ui.dp(this, 120), LinearLayout.LayoutParams.MATCH_PARENT));
        line.addView(countCell, new LinearLayout.LayoutParams(Ui.dp(this, 52), LinearLayout.LayoutParams.MATCH_PARENT));
        line.addView(boxCell, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1));
        return line;
    }

    private void handleScan(String raw) {
        String value = BarcodeRules.normalize(raw);
        long now = System.currentTimeMillis();
        if (value.equals(lastScan) && now - lastScanAt < 900) {
            fail("Повторный пик. Отсканируйте код один раз.");
            return;
        }
        lastScan = value;
        lastScanAt = now;

        if (step == Step.PRODUCT) {
            if (!BarcodeRules.isProduct(value)) {
                fail(BarcodeRules.isBox(value) ? "Это ШК короба. Сначала нужен баркод товара." : "Неверный баркод товара.");
                return;
            }
            pendingProduct = value;
            step = Step.QUANTITY;
            pending.setText(value);
            instruction.setText("Введите количество");
            pendingRow.setVisibility(View.VISIBLE);
            quantity.setText("");
            quantity.requestFocus();
            ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(quantity, InputMethodManager.SHOW_IMPLICIT);
            return;
        }

        if (step == Step.QUANTITY) {
            fail("Сначала введите количество товара.");
            return;
        }

        int count = BarcodeRules.parseQuantity(quantity.getText().toString());
        if (count < 1) {
            step = Step.QUANTITY;
            fail("Введите количество больше нуля.");
            return;
        }
        if (!BarcodeRules.isBox(value)) {
            fail(BarcodeRules.isProduct(value) ? "Это баркод товара. Сейчас нужен ШК короба." : "Неверный ШК короба.");
            return;
        }

        store.addRow(shipmentId, pendingProduct, count, value);
        pendingProduct = "";
        step = Step.PRODUCT;
        quantity.setText("");
        pendingRow.setVisibility(View.GONE);
        ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(quantity.getWindowToken(), 0);
        pending.setText("");
        instruction.setText("Отсканируйте баркод товара");
        refreshRows();
    }

    private void refreshRows() {
        List<ShipmentStore.Row> rows = store.listRows(shipmentId);
        totals.setText("Стр " + rows.size() + " · Тов " + XlsxExporter.totalItems(rows) + " · Кор " + XlsxExporter.uniqueBoxes(rows));
        rowsLayout.removeAllViews();
        for (int i = 0; i < rows.size(); i++) {
            ShipmentStore.Row row = rows.get(i);
            LinearLayout line = createTableRow(i + 1, row.product, String.valueOf(row.quantity), row.box, false);
            line.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("Удалить строку?")
                    .setMessage(row.product + " · " + row.quantity + " · " + row.box)
                    .setNegativeButton("Нет", null)
                    .setPositiveButton("Удалить", (d, w) -> { store.deleteRow(row.id); refreshRows(); }).show());
            LinearLayout.LayoutParams rowParams = Ui.matchWrap(this);
            rowParams.bottomMargin = Ui.dp(this, 1);
            rowsLayout.addView(line, rowParams);
        }
        if (!rows.isEmpty()) rowScroll.post(() -> rowScroll.fullScroll(View.FOCUS_DOWN));
    }

    private void confirmFinish() {
        List<ShipmentStore.Row> rows = store.listRows(shipmentId);
        if (step != Step.PRODUCT) { fail("Сначала завершите текущую строку."); return; }
        if (rows.isEmpty()) { fail("Нет отсканированных товаров."); return; }
        String message = shipment.marketplace + " · " + shipment.destination + "\n"
                + "Строк: " + rows.size() + "\nТоваров: " + XlsxExporter.totalItems(rows) + "\nКоробов: " + XlsxExporter.uniqueBoxes(rows);
        new AlertDialog.Builder(this).setTitle("Проверьте итог").setMessage(message)
                .setNegativeButton("Назад", null)
                .setPositiveButton("Отправить", (d, w) -> exportAndSend(rows)).show();
    }

    private void exportAndSend(List<ShipmentStore.Row> rows) {
        if (prefs.email().isEmpty()) {
            new AlertDialog.Builder(this).setTitle("Не указана почта")
                    .setMessage("Укажите адрес получателя в настройках.")
                    .setPositiveButton("Понятно", null).show();
            return;
        }
        try {
            File file = XlsxExporter.export(this, shipment, rows);
            store.markExported(shipmentId, file.getName());
            Uri uri = ExportFileProvider.uriForFile(this, file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            send.setPackage("com.google.android.gm");
            send.putExtra(Intent.EXTRA_EMAIL, new String[]{prefs.email()});
            send.putExtra(Intent.EXTRA_SUBJECT, file.getName().replace(".xlsx", ""));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            waitingEmailResult = true;
            try {
                startActivity(send);
            } catch (android.content.ActivityNotFoundException missingGmail) {
                send.setPackage(null);
                startActivity(Intent.createChooser(send, "Отправить отгрузку"));
            }
        } catch (IOException error) {
            fail("Не удалось создать Excel-файл: " + error.getMessage());
        }
    }

    private void askEmailSent() {
        new AlertDialog.Builder(this).setCancelable(false).setTitle("Письмо отправлено?")
                .setMessage("Если письмо не отправилось, выберите «Нет» — отгрузка останется сохранённой.")
                .setNegativeButton("Нет", null)
                .setPositiveButton("Да", (d, w) -> {
                    store.markSent(shipmentId);
                    prefs.clearActiveShipment();
                    Intent home = new Intent(this, MainActivity.class);
                    home.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(home);
                    finish();
                }).show();
    }

    private void fail(String message) {
        new ToneGenerator(AudioManager.STREAM_ALARM, 100).startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 450);
        Toast toast = Toast.makeText(this, message, Toast.LENGTH_LONG);
        View view = toast.getView();
        if (view != null) view.setBackgroundColor(Color.rgb(190, 25, 25));
        toast.show();
    }
}
