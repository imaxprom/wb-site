package ru.imaxprom.shipmentscanner;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class Ui {
    private Ui() {}

    public static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    public static LinearLayout page(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(context, 18), dp(context, 18), dp(context, 18), dp(context, 18));
        layout.setBackgroundColor(Color.rgb(247, 249, 252));
        return layout;
    }

    public static TextView title(Context context, String text) {
        TextView view = text(context, text, 25);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setTextColor(Color.rgb(20, 40, 65));
        view.setPadding(0, 0, 0, dp(context, 16));
        return view;
    }

    public static TextView text(Context context, String text, float sp) {
        TextView view = new TextView(context);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(Color.rgb(30, 45, 60));
        return view;
    }

    public static Button button(Context context, String text) {
        Button button = new Button(context);
        button.setText(text);
        button.setTextSize(18);
        button.setMinHeight(dp(context, 54));
        button.setAllCaps(false);
        return button;
    }

    public static LinearLayout.LayoutParams matchWrap(Context context) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(context, 10);
        return params;
    }

    public static void center(View view) {
        if (view instanceof TextView) ((TextView) view).setGravity(Gravity.CENTER);
    }
}
