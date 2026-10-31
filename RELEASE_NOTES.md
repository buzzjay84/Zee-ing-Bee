# Zee-ing Bee v1.0.5

## Downloads

- **Windows:** x64 `.exe` installer.
- **macOS — Apple Silicon:** arm64 `.dmg` for M-series Macs.
- **macOS — Intel:** x64 `.dmg` for Intel Macs.
- SHA-256 checksum files are included alongside the installers.
- **Android:** `Zee-ing-Bee-Mobile-v1.0.5.apk` on this release — sideload it (phone needs "install from unknown sources" allowed).

## New

- **The phone is now a full remote.** With the desktop app open, search on the phone and tap **Sing now** to play a song on the laptop right away, or **Reserve** to queue it. Tap ✕ to take a song off the queue. The phone shows the live queue and what's playing.
- **Scan the desktop QR inside the app.** Tap **Scan desktop QR to use as remote** in Zee-ing Bee Mobile. Scanning with the phone's camera app opens a browser instead. If the scanner can't open, type the address shown under the QR.
- **No WiFi? Use Bluetooth.** On the desktop, open **Remote → Connect via Bluetooth instead**. The phone works as the same full remote. A phone hotspot or USB tethering also works with the QR.
- **Pair once.** The desktop now keeps the same pairing code and port (47800) across restarts, so a paired phone reconnects by itself.

## Fixed

- The installed Android app could never connect to the desktop over WiFi: the desktop rejected its requests. It now allows them.
- If a desktop appeared while the phone was singing on its own, the phone kept going and then tried to play the desktop's queue itself. It now stops and becomes the remote.
- Over Bluetooth, the phone no longer says "Reserved" when the connection has dropped.

## Changed

- In Bluetooth mode the phone no longer downloads songs and plays them itself. Without a desktop, it still plays songs already downloaded over WiFi.
- The splash screen is now on the app's dark background.
- Updated Capacitor to 8.6.0 and Gradle to 9.5.0. That's the newest Gradle this Android setup supports, and it builds with Android Studio's bundled Java 25.
