package ru.imaxprom.shipmentscanner;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

public final class ShipmentStore extends SQLiteOpenHelper {
    public static final class Shipment {
        public long id;
        public String marketplace;
        public String destination;
        public long createdAt;
        public String status;
        public String fileName;
    }

    public static final class Row {
        public long id;
        public String product;
        public int quantity;
        public String box;
        public String expiry = "";
    }

    public ShipmentStore(Context context) {
        super(context, "shipments.db", null, 1);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE shipments (id INTEGER PRIMARY KEY AUTOINCREMENT, marketplace TEXT NOT NULL, destination TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', file_name TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE TABLE rows (id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id INTEGER NOT NULL, product TEXT NOT NULL, quantity INTEGER NOT NULL, box TEXT NOT NULL, expiry TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, FOREIGN KEY(shipment_id) REFERENCES shipments(id) ON DELETE CASCADE)");
        db.execSQL("CREATE INDEX rows_shipment_idx ON rows(shipment_id)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    public long createShipment(String marketplace, String destination) {
        ContentValues values = new ContentValues();
        values.put("marketplace", marketplace);
        values.put("destination", destination);
        values.put("created_at", System.currentTimeMillis());
        values.put("status", "DRAFT");
        return getWritableDatabase().insertOrThrow("shipments", null, values);
    }

    public Shipment getShipment(long id) {
        try (Cursor c = getReadableDatabase().query("shipments", null, "id=?", new String[]{String.valueOf(id)}, null, null, null)) {
            if (!c.moveToFirst()) return null;
            return readShipment(c);
        }
    }

    public List<Shipment> listShipments() {
        List<Shipment> result = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query("shipments", null, null, null, null, null, "created_at DESC")) {
            while (c.moveToNext()) result.add(readShipment(c));
        }
        return result;
    }

    private Shipment readShipment(Cursor c) {
        Shipment s = new Shipment();
        s.id = c.getLong(c.getColumnIndexOrThrow("id"));
        s.marketplace = c.getString(c.getColumnIndexOrThrow("marketplace"));
        s.destination = c.getString(c.getColumnIndexOrThrow("destination"));
        s.createdAt = c.getLong(c.getColumnIndexOrThrow("created_at"));
        s.status = c.getString(c.getColumnIndexOrThrow("status"));
        s.fileName = c.getString(c.getColumnIndexOrThrow("file_name"));
        return s;
    }

    public long addRow(long shipmentId, String product, int quantity, String box) {
        ContentValues values = new ContentValues();
        values.put("shipment_id", shipmentId);
        values.put("product", product);
        values.put("quantity", quantity);
        values.put("box", box);
        values.put("expiry", "");
        values.put("created_at", System.currentTimeMillis());
        return getWritableDatabase().insertOrThrow("rows", null, values);
    }

    public List<Row> listRows(long shipmentId) {
        List<Row> result = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query("rows", null, "shipment_id=?", new String[]{String.valueOf(shipmentId)}, null, null, "id ASC")) {
            while (c.moveToNext()) {
                Row row = new Row();
                row.id = c.getLong(c.getColumnIndexOrThrow("id"));
                row.product = c.getString(c.getColumnIndexOrThrow("product"));
                row.quantity = c.getInt(c.getColumnIndexOrThrow("quantity"));
                row.box = c.getString(c.getColumnIndexOrThrow("box"));
                row.expiry = c.getString(c.getColumnIndexOrThrow("expiry"));
                result.add(row);
            }
        }
        return result;
    }

    public void deleteRow(long rowId) {
        getWritableDatabase().delete("rows", "id=?", new String[]{String.valueOf(rowId)});
    }

    public boolean deleteUnsentShipment(long shipmentId) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try (Cursor c = db.query(
                "shipments",
                new String[]{"status"},
                "id=?",
                new String[]{String.valueOf(shipmentId)},
                null,
                null,
                null
        )) {
            if (!c.moveToFirst() || "SENT".equals(c.getString(0))) return false;
            db.delete("rows", "shipment_id=?", new String[]{String.valueOf(shipmentId)});
            int deleted = db.delete("shipments", "id=? AND status<>?", new String[]{String.valueOf(shipmentId), "SENT"});
            if (deleted != 1) return false;
            db.setTransactionSuccessful();
            return true;
        } finally {
            db.endTransaction();
        }
    }

    public void markExported(long shipmentId, String fileName) {
        ContentValues values = new ContentValues();
        values.put("status", "READY_TO_SEND");
        values.put("file_name", fileName);
        getWritableDatabase().update("shipments", values, "id=?", new String[]{String.valueOf(shipmentId)});
    }

    public void markSent(long shipmentId) {
        ContentValues values = new ContentValues();
        values.put("status", "SENT");
        getWritableDatabase().update("shipments", values, "id=?", new String[]{String.valueOf(shipmentId)});
    }

    public void clearExportStatus(long shipmentId) {
        ContentValues values = new ContentValues();
        values.put("status", "DRAFT");
        getWritableDatabase().update("shipments", values, "id=?", new String[]{String.valueOf(shipmentId)});
    }
}
