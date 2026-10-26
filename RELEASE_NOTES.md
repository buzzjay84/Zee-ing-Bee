# Zee-ing Bee v1.0.1

## Downloads

- **Windows:** x64 `.exe` installer.
- **macOS — Apple Silicon:** arm64 `.dmg` for M-series Macs.
- **macOS — Intel:** x64 `.dmg` for Intel Macs.
- SHA-256 checksum files are included alongside the installers.

## New

- **Auto-update.** The app checks for a newer version in the background and shows a "Restart & update" banner once it's ready — it never restarts on its own, so a song in progress is never interrupted.
- **Music videos dialog and "Listen instead."** Browse and play saved music videos, with auto-advance through the list, without triggering a new download.
- **Downloaded asset exports.** Saved music and karaoke videos are copied to a readable folder in Documents with metadata, so they're easy to find outside the app.

## Improved

- Background and music videos now save at up to 1080p (previously capped at 720p) when the source offers it, with picture and sound merged via a bundled ffmpeg.
- Video downloads now time out on inactivity instead of a fixed 15 minutes, so large HD files on a slow connection aren't killed partway through.
- Saved videos below the 1080p target are re-saved in HD automatically the next time that song plays online; a video whose source is genuinely capped at a lower resolution is recorded honestly and not retried forever.
- Leftover fragment files from an interrupted download no longer corrupt the next attempt.
- Saved music videos keep their original audio; silent legacy caches upgrade automatically the next time they play.
- "Listen instead" enables as soon as the current song's video has saved, or waits for a save already in progress.

## Fixed

- Lyrics using the Soft Karaoke "/" and "\" line markers no longer show those characters literally when a song's file doesn't carry the usual karaoke header — about 1% of the bundled library was affected.
- The live YouTube preview no longer forces a bitrate the connection can't sustain, which was causing rebuffering/stutter.
- The dashboard keeps exporting remaining downloaded assets when one file fails at startup, instead of stopping early.
- Returns to home instead of a stuck stage when music-only playback fails.

## First-time setup

These installers include the app and the basic GeneralUser GS sound bank with its license. Private song packs, background media, logos and icons are not included.

Use **Add song folder** for local MIDI/KAR files, or **Find online karaoke** to download individual karaoke songs. Downloaded songs and videos remain available offline after saving completes.

Google Drive library downloads and the planned 10% early-access threshold will be configured in a later update. They are not enabled in this release.

## Installation notes

Installers are currently unsigned and macOS builds are not notarized. Windows or macOS may require approval on first launch. An internet connection is needed for online search and downloads; playback of saved files works offline.

Auto-update works on unsigned Windows builds. macOS auto-update needs an Apple Developer ID certificate to install updates — until then, Mac users will see that an update is available but will need to download the new `.dmg` manually.
