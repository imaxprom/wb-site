package ru.imaxprom.shipmentscanner;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

public final class ExportFileProvider extends ContentProvider {
    public static Uri uriForFile(Context context, File file) {
        return new Uri.Builder()
                .scheme("content")
                .authority(context.getPackageName() + ".files")
                .appendPath("export")
                .appendPath(file.getName())
                .build();
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file = resolve(uri);
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] values = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = file.getName();
            else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = file.length();
        }
        cursor.addRow(values);
        return cursor;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Только чтение");
        File file = resolve(uri);
        if (!file.isFile()) throw new FileNotFoundException(file.getName());
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    private File resolve(Uri uri) {
        if (getContext() == null || uri.getPathSegments().size() != 2 || !"export".equals(uri.getPathSegments().get(0))) {
            throw new SecurityException("Недопустимый путь");
        }
        File directory = new File(getContext().getFilesDir(), "exports");
        File file = new File(directory, uri.getLastPathSegment());
        try {
            String root = directory.getCanonicalPath() + File.separator;
            if (!file.getCanonicalPath().startsWith(root)) throw new SecurityException("Недопустимый путь");
        } catch (IOException error) {
            throw new SecurityException("Недопустимый путь", error);
        }
        return file;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException(); }
}
