package com.zeengingbee.remote;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BlePeripheralPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
