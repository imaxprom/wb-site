package ru.imaxprom.shipmentscanner;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.res.ColorStateList;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.PopupWindow;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity {
    private static final String DESTINATION_PLACEHOLDER = "Выберите направление";

    private AppPrefs prefs;
    private ShipmentStore store;
    private LinearLayout root;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new AppPrefs(this);
        store = new ShipmentStore(this);
        DataWedgeManager.configure(this);
    }

    @Override protected void onResume() {
        super.onResume();
        render();
    }

    private void render() {
        root = Ui.page(this);
        root.addView(Ui.title(this, "Сканер отгрузки"));

        long activeId = prefs.activeShipmentId();
        ShipmentStore.Shipment active = activeId > 0 ? store.getShipment(activeId) : null;
        if (active != null && !"SENT".equals(active.status)) {
            TextView warning = Ui.text(this, "Есть незавершённая отгрузка\n" + active.marketplace + " · " + active.destination, 19);
            warning.setPadding(Ui.dp(this, 14), Ui.dp(this, 14), Ui.dp(this, 14), Ui.dp(this, 14));
            root.addView(warning, Ui.matchWrap(this));

            LinearLayout draftActions = new LinearLayout(this);
            draftActions.setOrientation(LinearLayout.HORIZONTAL);
            Button resume = Ui.button(this, "Продолжить");
            resume.setOnClickListener(v -> openScan(active.id));
            Button delete = Ui.button(this, "Удалить");
            delete.setTextColor(Color.WHITE);
            delete.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(190, 35, 45)));
            delete.setOnClickListener(v -> confirmDeleteDraft(active));
            draftActions.addView(resume, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            LinearLayout.LayoutParams deleteParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
            deleteParams.leftMargin = Ui.dp(this, 8);
            draftActions.addView(delete, deleteParams);
            root.addView(draftActions, Ui.matchWrap(this));
        } else if (activeId > 0) {
            prefs.clearActiveShipment();
        }

        root.addView(Ui.text(this, "Маркетплейс", 18), Ui.matchWrap(this));
        ChoiceField market = choiceField(prefs.marketplaces());
        root.addView(market.view, Ui.matchWrap(this));

        root.addView(Ui.text(this, "Направление", 18), Ui.matchWrap(this));
        ChoiceField destination = choiceField(prefs.destinations(), DESTINATION_PLACEHOLDER);
        root.addView(destination.view, Ui.matchWrap(this));

        Button start = Ui.button(this, "Начать сканирование");
        start.setEnabled(false);
        destination.setOnSelectionChanged(value -> start.setEnabled(!value.isEmpty()));
        start.setOnClickListener(v -> {
            if (prefs.activeShipmentId() > 0 && store.getShipment(prefs.activeShipmentId()) != null) {
                new AlertDialog.Builder(this).setTitle("Есть незавершённая отгрузка")
                        .setMessage("Сначала завершите текущую отгрузку.")
                        .setPositiveButton("Понятно", null).show();
                return;
            }
            if (destination.selected().isEmpty()) {
                new AlertDialog.Builder(this).setTitle("Выберите направление")
                        .setMessage("Перед началом сканирования укажите город отгрузки.")
                        .setPositiveButton("Понятно", null).show();
                return;
            }
            long id = store.createShipment(market.selected(), destination.selected());
            prefs.setActiveShipmentId(id);
            openScan(id);
        });
        root.addView(start, Ui.matchWrap(this));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.HORIZONTAL);
        Button archive = Ui.button(this, "Архив");
        archive.setOnClickListener(v -> startActivity(new Intent(this, ArchiveActivity.class)));
        Button settings = Ui.button(this, "Настройки");
        settings.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        bottom.addView(archive, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        bottom.addView(settings, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        root.addView(bottom, Ui.matchWrap(this));
        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }

    private ChoiceField choiceField(List<String> sourceValues) {
        return choiceField(sourceValues, null);
    }

    private ChoiceField choiceField(List<String> sourceValues, String placeholder) {
        List<String> values = new ArrayList<>(sourceValues);
        if (values.isEmpty()) values.add("Не задано");
        TextView field = Ui.text(this, placeholder == null ? values.get(0) : placeholder, 18);
        field.setGravity(Gravity.CENTER_VERTICAL);
        field.setMinHeight(Ui.dp(this, 56));
        field.setBackgroundResource(R.drawable.spinner_field);
        field.setPadding(Ui.dp(this, 14), 0, Ui.dp(this, 44), 0);
        field.setClickable(true);
        field.setFocusable(true);

        ChoiceField result = new ChoiceField(field, values, placeholder != null);
        field.setOnClickListener(v -> showChoicePopup(result));
        return result;
    }

    private void showChoicePopup(ChoiceField choice) {
        LinearLayout options = new LinearLayout(this);
        options.setOrientation(LinearLayout.VERTICAL);
        options.setPadding(Ui.dp(this, 4), Ui.dp(this, 4), Ui.dp(this, 4), Ui.dp(this, 4));

        PopupWindow popup = new PopupWindow(
                options,
                choice.view.getWidth(),
                LinearLayout.LayoutParams.WRAP_CONTENT,
                true
        );
        popup.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        popup.setOutsideTouchable(true);
        popup.setElevation(Ui.dp(this, 10));
        popup.setAnimationStyle(R.style.ChoicePopupAnimation);

        for (String value : choice.values) {
            TextView option = Ui.text(this, value, 18);
            option.setGravity(Gravity.CENTER_VERTICAL);
            option.setMinHeight(Ui.dp(this, 52));
            option.setPadding(Ui.dp(this, 14), 0, Ui.dp(this, 14), 0);
            if (value.equals(choice.selected())) {
                option.setTextColor(Color.rgb(13, 71, 161));
                option.setBackgroundResource(R.drawable.choice_popup_item_selected);
            }
            option.setOnClickListener(v -> {
                choice.select(value);
                popup.dismiss();
            });
            options.addView(option, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
            ));
        }
        options.setBackgroundResource(R.drawable.choice_popup_background);
        popup.showAsDropDown(choice.view, 0, Ui.dp(this, 6));
    }

    private static final class ChoiceField {
        interface OnSelectionChanged {
            void onSelectionChanged(String value);
        }

        final TextView view;
        final List<String> values;
        private String selected;
        private OnSelectionChanged onSelectionChanged;

        ChoiceField(TextView view, List<String> values, boolean emptyInitially) {
            this.view = view;
            this.values = values;
            this.selected = emptyInitially ? "" : values.get(0);
        }

        String selected() {
            return selected;
        }

        void select(String value) {
            selected = value;
            view.setText(value);
            if (onSelectionChanged != null) onSelectionChanged.onSelectionChanged(value);
        }

        void setOnSelectionChanged(OnSelectionChanged listener) {
            onSelectionChanged = listener;
        }
    }

    private void openScan(long id) {
        Intent intent = new Intent(this, ScanActivity.class);
        intent.putExtra("shipment_id", id);
        startActivity(intent);
    }

    private void confirmDeleteDraft(ShipmentStore.Shipment shipment) {
        new AlertDialog.Builder(this)
                .setTitle("Удалить незавершённую отгрузку?")
                .setMessage("Все отсканированные строки этой отгрузки будут удалены. Отменить действие нельзя.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить", (dialog, which) -> {
                    if (store.deleteUnsentShipment(shipment.id)) {
                        if (prefs.activeShipmentId() == shipment.id) prefs.clearActiveShipment();
                        render();
                    } else {
                        new AlertDialog.Builder(this)
                                .setTitle("Не удалось удалить")
                                .setMessage("Отгрузка уже отправлена или не найдена.")
                                .setPositiveButton("Понятно", null)
                                .show();
                    }
                })
                .show();
    }
}
