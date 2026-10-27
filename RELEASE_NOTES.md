# Zee-ing Bee v1.0.3

## Downloads

- **Windows:** x64 `.exe` installer.
- **macOS — Apple Silicon:** arm64 `.dmg` for M-series Macs.
- **macOS — Intel:** x64 `.dmg` for Intel Macs.
- SHA-256 checksum files are included alongside the installers.
- **Android remote:** `Zee-ing-Bee-Remote-v1.0.3.apk` on this release — sideload it (phone needs "install from unknown sources" allowed).

## New

- **Bluetooth mode now sings on the phone.** Reserving a song over Bluetooth now queues it on the phone itself and plays it there (like Standalone mode), fetching the song and sound bank from the desktop on demand the first time each is needed, instead of only remote-controlling the desktop's queue.
- **Visible download progress.** The phone's background sync (pulling the whole catalog for offline play once connected over WiFi) now shows a "Downloading songs for offline play… 45/212" banner instead of running silently with no feedback.

## Fixed

- The phone's Bluetooth listeners were being re-registered every ~20 seconds while WiFi was unreachable, causing duplicate event handling the longer it searched.
- A Bluetooth notification could be sent again before the previous one finished transmitting, which the radio silently drops — multi-chunk Bluetooth messages could arrive corrupted. Sends are now properly serialized.
- The phone's Bluetooth advertisement included the device's system name, which could overflow the 31-byte legacy advertisement limit (if the name was long enough) and make advertising fail outright; it also renamed the phone's Bluetooth adapter as a side effect. Advertising now matches by service ID only.
