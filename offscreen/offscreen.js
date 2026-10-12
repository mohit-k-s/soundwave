// SoundWave Offscreen Audio Pipeline
// Handles tab media streams, Web Audio graph, Gain, EQ, and visualizer data.

const pipelines = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  switch (message.type) {
    case 'START_CAPTURE':
      startCapture(message)
        .then((result) => sendResponse({ success: true, result }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true; // async response

    case 'UPDATE_AUDIO':
      updateAudio(message);
      sendResponse({ success: true });
      return false;

    case 'STOP_CAPTURE':
      stopCapture(message.tabId);
      sendResponse({ success: true });
      return false;

    case 'GET_VISUALIZER_DATA':
      const data = getVisualizerData(message.tabId);
      sendResponse({ success: true, data });
      return false;

    case 'GET_ACTIVE_PIPELINES':
      const activeIds = Array.from(pipelines.keys());
      sendResponse({ success: true, activeTabIds: activeIds });
      return false;

    default:
      return false;
  }
});

async function startCapture({ tabId, streamId, volume = 1.0, isMuted = false, bassBoost = false, mono = false }) {
  // If an existing pipeline exists for this tab, stop it first
  if (pipelines.has(tabId)) {
    stopCapture(tabId);
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);

    // Bass Filter Node (lowshelf filter around 180Hz)
    const bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 180;
    bassFilter.gain.value = bassBoost ? 9 : 0; // +9dB boost if enabled

    // Volume Gain Node (supports attenuation up to 600% / 6.0 multiplier)
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(isMuted ? 0 : volume, audioCtx.currentTime);

    // Spectrum Analyser for real-time visualizer
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;

    // Mono downmix handling
    if (mono) {
      audioCtx.destination.channelCount = 1;
      audioCtx.destination.channelCountMode = 'explicit';
    } else {
      audioCtx.destination.channelCount = 2;
      audioCtx.destination.channelCountMode = 'max';
    }

    // Connect audio processing graph:
    // source -> bassFilter -> gainNode -> analyser -> speakers
    source.connect(bassFilter);
    bassFilter.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    // When the stream track ends (e.g., tab closed or captured stopped by Chrome)
    const [audioTrack] = stream.getAudioTracks();
    if (audioTrack) {
      audioTrack.onended = () => {
        stopCapture(tabId);
        chrome.runtime.sendMessage({
          type: 'TAB_CAPTURE_ENDED',
          tabId
        }).catch(() => {});
      };
    }

    pipelines.set(tabId, {
      stream,
      audioCtx,
      source,
      bassFilter,
      gainNode,
      analyser,
      volume,
      isMuted,
      bassBoost,
      mono
    });

    return { tabId, volume, isMuted, bassBoost, mono };
  } catch (err) {
    console.error(`[SoundWave Offscreen] Capture failed for tab ${tabId}:`, err);
    throw err;
  }
}

function updateAudio({ tabId, volume, isMuted, bassBoost, mono }) {
  const pipeline = pipelines.get(tabId);
  if (!pipeline) return;

  const { audioCtx, gainNode, bassFilter } = pipeline;

  if (typeof volume === 'number') {
    pipeline.volume = volume;
  }
  if (typeof isMuted === 'boolean') {
    pipeline.isMuted = isMuted;
  }
  if (typeof bassBoost === 'boolean') {
    pipeline.bassBoost = bassBoost;
    bassFilter.gain.setValueAtTime(bassBoost ? 9 : 0, audioCtx.currentTime);
  }
  if (typeof mono === 'boolean') {
    pipeline.mono = mono;
    audioCtx.destination.channelCount = mono ? 1 : 2;
  }

  const effectiveGain = pipeline.isMuted ? 0 : pipeline.volume;
  gainNode.gain.setValueAtTime(effectiveGain, audioCtx.currentTime);
}

function stopCapture(tabId) {
  const pipeline = pipelines.get(tabId);
  if (!pipeline) return;

  try {
    const { stream, audioCtx, source, bassFilter, gainNode, analyser } = pipeline;

    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    bassFilter.disconnect();
    gainNode.disconnect();
    analyser.disconnect();

    if (audioCtx.state !== 'closed') {
      audioCtx.close();
    }
  } catch (err) {
    console.warn(`[SoundWave Offscreen] Cleanup warning for tab ${tabId}:`, err);
  } finally {
    pipelines.delete(tabId);
  }
}

function getVisualizerData(tabId) {
  const pipeline = pipelines.get(tabId);
  if (!pipeline) return null;

  const { analyser } = pipeline;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  return Array.from(dataArray);
}
