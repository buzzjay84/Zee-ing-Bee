# Zee-ing Bee v1.0.2

## Downloads

- **Windows:** x64 `.exe` installer.
- **macOS — Apple Silicon:** arm64 `.dmg` for M-series Macs.
- **macOS — Intel:** x64 `.dmg` for Intel Macs.
- SHA-256 checksum files are included alongside the installers.
- **Android remote:** built separately from this repo's mobile companion app — see the project's GitHub Actions artifacts for the `.apk`.

## New

- **Phone remote control.** A new "Remote" button opens a QR code — scan it with a phone on the same WiFi to search the song catalog and reserve songs from across the room, synced live to the desktop's queue.
- **Bluetooth fallback pairing.** If there's no WiFi (not even a hotspot), the Remote dialog can connect directly over Bluetooth instead — search and reserve still work, with full catalog browsing and offline song sync reserved for WiFi.
- **Standalone phone playback.** The companion app can also sing songs on its own, from content it previously synced while connected to a desktop, for when no desktop is around at all.

## Fixed

- App-only installs (no bundled song packs) now actually fetch their songs in the background — previously they never did, because nothing pointed the downloader at a real server.
