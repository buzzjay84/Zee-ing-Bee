package com.zeengingbee.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BlePeripheralPlugin.class);
        registerPlugin(QrScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
