# Zee-ing Bee v1.0.6

## Downloads

- **Windows:** x64 `.exe` installer.
- **macOS — Apple Silicon:** arm64 `.dmg` for M-series Macs.
- **macOS — Intel:** x64 `.dmg` for Intel Macs.
- SHA-256 checksum files are included alongside the installers.
- **Android:** `Zee-ing-Bee-Mobile-v1.0.6.apk` on this release — sideload it (phone needs "install from unknown sources" allowed).

## New

- **Songs download by themselves.** On first launch, the desktop app and the phone app both download the song library (about 515 MB) in the background. A banner shows the percentage, and songs appear as each part arrives, so you can start singing before it finishes. If the connection drops, it picks up again by itself.
- **The phone looks and works like the desktop.** It has the same song list with category chips, the number keypad with **Reserve** and **▶ Sing now**, and the Reserved list. Singing on the phone now has the desktop's stage: title card, big lyrics, and Key, Tempo, Guide, Mixer, Pause, Skip and Stop.
- **The phone sings without a desktop.** With the songs downloaded, the phone plays any song on its own. Song numbers match the desktop's, so the printed songbook works on the phone too.

## Fixed

- The installed Android app could get stuck on "Checking for a desktop…" with buttons that did nothing. It now starts properly.
- The app icon was missing on Windows (it showed the default Electron icon). It's back.

## Changed

- When paired with a desktop over WiFi, the phone no longer copies songs it already got from the song download. It only copies songs you added on the desktop yourself.
- Updated the Android build tools to the latest (Android Gradle plugin 9.4.1, Gradle 9.6.0).
