# Zee-ing Bee v1.0.4

## Downloads

- **Windows:** x64 `.exe` installer.
- **macOS — Apple Silicon:** arm64 `.dmg` for M-series Macs.
- **macOS — Intel:** x64 `.dmg` for Intel Macs.
- SHA-256 checksum files are included alongside the installers.
- **Android:** `Zee-ing-Bee-Mobile-v1.0.4.apk` on this release — sideload it (phone needs "install from unknown sources" allowed).

## Fixed

- **The mobile app could get stuck on "Checking for a desktop…" forever.** Starting Bluetooth advertising in the background had no timeout, so a slow or stuck native call (permission prompt, device quirk) left the whole app unusable with nothing but the search bar showing. It now always falls through to a usable screen within a few seconds no matter what Bluetooth does.
- A Bluetooth permission-callback method was declared `private`, a needless risk of Capacitor's reflection-based invocation silently failing to call it back — made `public`, and the whole advertising setup is now wrapped so it always resolves or rejects instead of possibly hanging.
- App version is now shown in Settings, with a manual "Check for updates" button — previously there was no way to tell what version you were running or whether an update was coming.

## Changed

- **The mobile app is renamed** from "Zee-ing Bee Remote" to "Zee-ing Bee Mobile" (app ID `com.zeengingbee.mobile`), everywhere it's shown.
- **Proper app icon and splash screen** on Android, generated from the real logo, instead of Capacitor's generic default.
- The README now shows the app logo.
