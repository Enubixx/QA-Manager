package com.qamanager.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceBuildsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
