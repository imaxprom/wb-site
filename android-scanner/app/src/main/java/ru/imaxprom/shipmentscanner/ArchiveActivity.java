package ru.imaxprom.shipmentscanner;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;


public final class ArchiveActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        ShipmentStore store = new ShipmentStore(this);
        LinearLayout page = Ui.page(this);
        page.addView(Ui.title(this, "Архив отгрузок"));
        List<ShipmentStore.Shipment> shipments = store.listShipments();
        if (shipments.isEmpty()) page.addView(Ui.text(this, "Отгрузок пока нет", 18));
        SimpleDateFormat date = new SimpleDateFormat("dd.MM.yyyy HH:mm", new Locale("ru", "RU"));
        for (ShipmentStore.Shipment shipment : shipments) {
            List<ShipmentStore.Row> rows = store.listRows(shipment.id);
            String status = "SENT".equals(shipment.status) ? "Отправлено" : "Не отправлено";
            TextView item = Ui.text(this,
                    shipment.marketplace + " · " + shipment.destination + "\n"
                            + date.format(new Date(shipment.createdAt)) + " · " + status + "\n"
                            + XlsxExporter.totalItems(rows) + " товаров · " + XlsxExporter.uniqueBoxes(rows) + " коробов",
                    18);
            item.setPadding(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12));
            item.setBackgroundResource(R.drawable.archive_card);
            item.setClickable(true);
            item.setFocusable(true);
            item.setOnClickListener(v -> {
                Intent detail = new Intent(this, ArchiveDetailActivity.class);
                detail.putExtra("shipment_id", shipment.id);
                startActivity(detail);
            });
            page.addView(item, Ui.matchWrap(this));
        }
        ScrollView scroll = new ScrollView(this);
        scroll.addView(page);
        setContentView(scroll);
    }
}
