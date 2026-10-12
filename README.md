# 🌊 SoundWave - Tab Volume & Audio Booster (Chrome Extension)

A Manifest V3 Google Chrome extension that provides per-tab volume control, audio boosting up to 600%, bass enhancement, and a multi-tab audio mixer with a modern glassmorphic cyberpunk UI.

---

## ⚡ Features

- **Per-Tab Volume Tuning**: Adjust volume individually for any tab without affecting other tabs or system volume.
- **Up to 600% Audio Boost**: Amplify quiet videos, movies, and podcasts far beyond normal 100% hardware output.
- **Active Tab Mixer**: Switch to the **Tab Mixer** view to see all tabs playing sound across your browser and tweak or mute them in one centralized console.
- **Real-Time Spectrum Visualizer**: Animated neon frequency bars dancing in sync with the audio track.
- **Bass Boost (+9dB)**: Low-shelf frequency EQ enhancement for punchy lows.
- **Mono Audio Mode**: Downmixes stereo audio to single-channel (ideal for single-earbud listeners).
- **Badge Indicators**: Instant visual feedback directly on Chrome's toolbar icon displaying current tab volume (e.g., `250%`, `MUT`).
- **Clean Detach**: One-click "Restore Native" to release audio capture and restore Chrome's default audio routing immediately.

---

## 🚀 How to Install in Chrome (Takes 15 seconds)

1. Open **Google Chrome**.
2. In the address bar, type:
   ```text
   chrome://extensions
   ```
3. Toggle the **Developer mode** switch in the top-right corner to **ON**.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the repository root folder (the folder containing `manifest.json`).
6. **SoundWave** is now installed! Pin it to your toolbar by clicking the puzzle icon 🧩 in Chrome and clicking the pin icon next to SoundWave.

---

## 🎧 How to Test

1. Open a new tab with any audio source (e.g. YouTube, Spotify Web, Netflix, or SoundCloud).
2. Start playing a video or song.
3. Click the **SoundWave** icon in the Chrome toolbar.
4. Drag the volume slider to boost up to `250%` or `600%`, or tap the quick preset buttons.
5. Try opening a second noisy tab and switch to the **Tab Mixer** tab in SoundWave to mix both tabs simultaneously!

---

## 🛠️ Architecture (Manifest V3 Standard)

SoundWave conforms strictly to the latest Chromium Manifest V3 specifications:

```
[ Active Tab Audio ]
        │
        ▼
[ chrome.tabCapture (getMediaStreamId) ]
        │
        ▼
[ Offscreen Document (offscreen.html / offscreen.js) ]
        │
        ├──> [ MediaStreamAudioSourceNode ]
        │         │
        │         ▼
        ├──> [ BiquadFilterNode (Bass Boost EQ) ]
        │         │
        │         ▼
        ├──> [ GainNode (0.0x to 6.0x Volume Multiplier) ]
        │         │
        │         ▼
        ├──> [ AnalyserNode (Live FFT Spectrum Data) ]
        │         │
        │         ▼
        └──> [ AudioContext.destination (Speakers / Headphones) ]
```

- **`manifest.json`**: Manifest V3 declaration with `tabCapture`, `offscreen`, and `tabs` permissions.
- **`background.js`**: Service worker orchestrating tab lifecycle, offscreen document creation, and badge indicators.
- **`offscreen/offscreen.js`**: Dedicated Web Audio rendering pipeline running in an offscreen document context to bypass service worker DOM restrictions.
- **`popup/`**: Interactive UI with dark obsidian glassmorphism, responsive sliders, canvas FFT visualizer, and tab mixer console.
