# Zee-ing Bee v1.0.0

## Downloads

- **Windows:** x64 `.exe` installer.
- **macOS — Apple Silicon:** arm64 `.dmg` for M-series Macs.
- **macOS — Intel:** x64 `.dmg` for Intel Macs.
- SHA-256 checksum files are included alongside the installers.

## Features

- A separate karaoke display while the dashboard stays available for song selection, reservations and playback controls.
- Automatic use of a second monitor when one is connected.
- MIDI/KAR playback with timed lyric highlighting, an intro countdown, key and tempo controls, guide melody and a sound mixer.
- An enabled-by-default melody guide with an On/Off button and a dedicated volume slider to help singers follow the tune. Guide preferences are remembered between sessions.
- Permanent five-digit song numbers, category filters, exact search matches above suggested songs, and a printable PDF songbook.
- Background videos prioritize official music videos, then Wish or other live performances, then a random background. Background video audio stays muted.
- Matching online background videos save locally for later offline playback when downloading succeeds.
- **Find online karaoke** searches for missing title/artist pairs and downloads karaoke videos with their backing audio and on-video lyrics. Saved songs receive library numbers and work offline.
- Zee-ing Bee branding and support for local custom logos and app icons.

## Fixes

- Improved recovery and failover when a video freezes or cannot play.
- Fixed online background lookup on fresh installations without local background videos.
- Active video downloads stop when the app quits, preserving partial files for retry.
- Fixed stale video callbacks and download results affecting a different song or source.
- Pausing while a video loads no longer incorrectly discards that source.
- Added local-video byte-range support for seeking and stricter checks for incomplete MP4 downloads.
- Prevented duplicate library entries from overlapping folders and repeated karaoke imports.
- Kept the karaoke display synchronized when the dashboard is minimized.
- Updated the Electron runtime and ZIP extractor to address known dependency vulnerabilities.

## First-time setup

These installers include the app and the basic GeneralUser GS sound bank with its license. Private song packs, background media, logos and icons are not included.

Use **Add song folder** for local MIDI/KAR files, or **Find online karaoke** to download individual karaoke songs. Downloaded songs and videos remain available offline after saving completes.

Google Drive library downloads and the planned 10% early-access threshold will be configured in a later update. They are not enabled in this release.

## Installation notes

Installers are currently unsigned and macOS builds are not notarized. Windows or macOS may require approval on first launch. An internet connection is needed for online search and downloads; playback of saved files works offline.
