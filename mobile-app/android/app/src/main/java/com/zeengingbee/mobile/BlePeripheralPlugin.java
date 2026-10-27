package com.zeengingbee.mobile;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.ParcelUuid;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.UUID;

/**
 * The phone's half of the Bluetooth fallback transport (see src/shared/bluetooth.js for
 * the UUIDs/framing both sides must agree on, and src/renderer/bluetooth-remote.js for
 * the desktop's central-side counterpart). The phone is always the BLE *peripheral* -
 * Android supports advertising/GATT-server mode natively, which is why this role landed
 * here rather than on the desktop (no Windows-compatible Node library exists for it).
 *
 * UNVERIFIED: written from the documented Capacitor plugin and Android BLE APIs, with no
 * access to real Bluetooth hardware or an Android device/emulator to run it on.
 */
@CapacitorPlugin(
    name = "BlePeripheral",
    permissions = { @Permission(strings = { Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetooth") }
)
public class BlePeripheralPlugin extends Plugin {

    // Must match src/shared/bluetooth.js exactly - both sides hardcode the same UUIDs.
    private static final UUID SERVICE_UUID = UUID.fromString("7b1f5a10-4b8e-4e1a-9c3d-6a2f8e0c9d41");
    private static final UUID COMMANDS_CHARACTERISTIC_UUID = UUID.fromString("7b1f5a11-4b8e-4e1a-9c3d-6a2f8e0c9d41");
    private static final UUID STATE_CHARACTERISTIC_UUID = UUID.fromString("7b1f5a12-4b8e-4e1a-9c3d-6a2f8e0c9d41");
    private static final UUID CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private BluetoothGattServer gattServer;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothDevice connectedCentral;
    private BluetoothGattCharacteristic commandsCharacteristic;
    // A legacy BLE advertisement packet is capped at 31 bytes. The 128-bit service UUID
    // alone already uses 18 of them, so the advertisement deliberately carries nothing
    // else (no device name) - a long phone name would otherwise push it over the limit
    // and make startAdvertising() fail outright. Matching happens by service UUID only.
    private PluginCall pendingNotifyCall;

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "startAdvertisingPermissionCallback");
            return;
        }
        doStartAdvertising(call);
    }

    // Public, not private: Capacitor invokes @PermissionCallback methods by name via
    // reflection, and a private method is a needless risk of that silently failing to
    // fire - which would leave the JS side's startAdvertising() call hanging forever
    // with no response, since nothing else ever resolves or rejects it.
    @PermissionCallback
    public void startAdvertisingPermissionCallback(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) doStartAdvertising(call);
        else call.reject("Bluetooth permission was denied.");
    }

    // Wrapped in try/catch so any unexpected failure here (a permission race, a device
    // quirk) always resolves or rejects `call` rather than leaving the JS side waiting
    // forever - mode.js also has its own timeout as a second line of defense.
    private void doStartAdvertising(PluginCall call) {
        try {
            if (gattServer != null) {
                call.resolve();
                return;
            }
            BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                call.reject("Bluetooth is turned off on this phone.");
                return;
            }
            advertiser = adapter.getBluetoothLeAdvertiser();
            if (advertiser == null) {
                call.reject("This phone can't advertise over Bluetooth LE.");
                return;
            }

            BluetoothGattService service = new BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);

            commandsCharacteristic = new BluetoothGattCharacteristic(
                COMMANDS_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
            );
            commandsCharacteristic.addDescriptor(
                new BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE)
            );
            service.addCharacteristic(commandsCharacteristic);

            BluetoothGattCharacteristic stateCharacteristic = new BluetoothGattCharacteristic(
                STATE_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            );
            service.addCharacteristic(stateCharacteristic);

            gattServer = manager.openGattServer(getContext(), gattServerCallback);
            if (gattServer == null) {
                call.reject("Could not open a Bluetooth GATT server.");
                return;
            }
            gattServer.addService(service);

            AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .build();
            AdvertiseData data = new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE_UUID)).build();
            advertiser.startAdvertising(settings, data, advertiseCallback);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not start Bluetooth advertising: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        if (advertiser != null) advertiser.stopAdvertising(advertiseCallback);
        if (gattServer != null) gattServer.close();
        gattServer = null;
        advertiser = null;
        connectedCentral = null;
        commandsCharacteristic = null;
        if (pendingNotifyCall != null) {
            pendingNotifyCall.reject("Bluetooth advertising stopped.");
            pendingNotifyCall = null;
        }
        call.resolve();
    }

    /**
     * One raw GATT notify carrying a single chunk (see createReassembler() in
     * bluetooth.js). A BLE connection allows only one outstanding notification at a time -
     * calling notifyCharacteristicChanged() again before the previous one's
     * onNotificationSent callback fires silently drops it at the stack level. The call
     * only resolves once that callback confirms this notification actually went out, so
     * the JS side's sequential `for (chunk of chunks) await notify(chunk)` loop can't
     * outrun the radio and corrupt a multi-chunk message.
     */
    @PluginMethod
    public void notify(PluginCall call) {
        String data = call.getString("data");
        if (gattServer == null || connectedCentral == null || commandsCharacteristic == null || data == null) {
            call.reject("No desktop is connected over Bluetooth right now.");
            return;
        }
        if (pendingNotifyCall != null) {
            call.reject("Another notification is still being sent.");
            return;
        }
        commandsCharacteristic.setValue(Base64.decode(data, Base64.NO_WRAP));
        pendingNotifyCall = call;
        boolean started = gattServer.notifyCharacteristicChanged(connectedCentral, commandsCharacteristic, false);
        if (!started) {
            pendingNotifyCall = null;
            call.reject("Could not send the Bluetooth notification.");
        }
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override
        public void onStartFailure(int errorCode) {
            // Nothing to surface to a pending call here (none was kept) - the next
            // startAdvertising() call simply tries again.
        }
    };

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedCentral = device;
                notifyListeners("centralConnected", new JSObject());
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedCentral = null;
                if (pendingNotifyCall != null) {
                    pendingNotifyCall.reject("The desktop disconnected while a notification was in flight.");
                    pendingNotifyCall = null;
                }
                notifyListeners("centralDisconnected", new JSObject());
            }
        }

        @Override
        public void onNotificationSent(BluetoothDevice device, int status) {
            if (pendingNotifyCall == null) return;
            PluginCall call = pendingNotifyCall;
            pendingNotifyCall = null;
            if (status == BluetoothGatt.GATT_SUCCESS) call.resolve();
            else call.reject("Bluetooth notification failed with status " + status);
        }

        @Override
        public void onCharacteristicWriteRequest(
            BluetoothDevice device,
            int requestId,
            BluetoothGattCharacteristic characteristic,
            boolean preparedWrite,
            boolean responseNeeded,
            int offset,
            byte[] value
        ) {
            if (STATE_CHARACTERISTIC_UUID.equals(characteristic.getUuid())) {
                JSObject event = new JSObject();
                event.put("data", Base64.encodeToString(value, Base64.NO_WRAP));
                notifyListeners("stateWrite", event);
            }
            if (responseNeeded) gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
        }

        @Override
        public void onDescriptorWriteRequest(
            BluetoothDevice device,
            int requestId,
            BluetoothGattDescriptor descriptor,
            boolean preparedWrite,
            boolean responseNeeded,
            int offset,
            byte[] value
        ) {
            if (responseNeeded) gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
        }
    };
}
