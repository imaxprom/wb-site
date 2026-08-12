package ru.imaxprom.shipmentscanner;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Toast;
import android.content.Intent;
import android.net.Uri;

public final class SettingsActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        AppPrefs prefs = new AppPrefs(this);
        LinearLayout page = Ui.page(this);
        page.addView(Ui.title(this, "Настройки"));

        page.addView(Ui.text(this, "Почта получателя", 18), Ui.matchWrap(this));
        EditText email = input(prefs.email(), false);
        email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        page.addView(email, Ui.matchWrap(this));

        page.addView(Ui.text(this, "Маркетплейсы — по одному в строке", 18), Ui.matchWrap(this));
        EditText markets = input(prefs.marketplacesText(), true);
        page.addView(markets, Ui.matchWrap(this));

        page.addView(Ui.text(this, "Направления — по одному в строке", 18), Ui.matchWrap(this));
        EditText destinations = input(prefs.destinationsText(), true);
        page.addView(destinations, Ui.matchWrap(this));

        Button save = Ui.button(this, "Сохранить");
        save.setOnClickListener(v -> {
            String address = email.getText().toString().trim();
            if (!address.isEmpty() && !android.util.Patterns.EMAIL_ADDRESS.matcher(address).matches()) {
                email.setError("Проверьте адрес");
                return;
            }
            prefs.setEmail(address);
            prefs.setMarketplaces(markets.getText().toString());
            prefs.setDestinations(destinations.getText().toString());
            Toast.makeText(this, "Настройки сохранены", Toast.LENGTH_SHORT).show();
            finish();
        });
        page.addView(save, Ui.matchWrap(this));

        Button test = Ui.button(this, "Проверить почту");
        test.setOnClickListener(v -> {
            String address = email.getText().toString().trim();
            if (!android.util.Patterns.EMAIL_ADDRESS.matcher(address).matches()) {
                email.setError("Сначала укажите правильный адрес");
                return;
            }
            Intent message = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(address)));
            message.putExtra(Intent.EXTRA_SUBJECT, "Проверка сканера отгрузки");
            message.setPackage("com.google.android.gm");
            try {
                startActivity(message);
            } catch (android.content.ActivityNotFoundException error) {
                message.setPackage(null);
                startActivity(message);
            }
        });
        page.addView(test, Ui.matchWrap(this));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(page);
        setContentView(scroll);
    }

    private EditText input(String value, boolean multiline) {
        EditText input = new EditText(this);
        input.setText(value);
        input.setTextSize(19);
        input.setPadding(Ui.dp(this, 12), Ui.dp(this, 10), Ui.dp(this, 12), Ui.dp(this, 10));
        if (multiline) {
            input.setMinLines(3);
            input.setGravity(android.view.Gravity.TOP);
        } else {
            input.setSingleLine(true);
        }
        return input;
    }
}
