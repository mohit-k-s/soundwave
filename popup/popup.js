// SoundWave Popup Controller
// Coordinates UI state, Web Audio interactions, presets, live visualizer, and tab mixer.

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements - Navigation
  const btnNavCurrent = document.getElementById('btnNavCurrent');
  const btnNavMixer = document.getElementById('btnNavMixer');
  const paneCurrent = document.getElementById('paneCurrent');
  const paneMixer = document.getElementById('paneMixer');
  const mixerCountBadge = document.getElementById('mixerCount');

  // DOM Elements - Notice Banner
  const noticeBanner = document.getElementById('noticeBanner');
  const noticeText = document.getElementById('noticeText');
  const noticeClose = document.getElementById('noticeClose');

  // DOM Elements - Current Tab Card
  const currentFavicon = document.getElementById('currentFavicon');
  const currentTitle = document.getElementById('currentTitle');
  const currentDomain = document.getElementById('currentDomain');
  const tabStatusPill = document.getElementById('tabStatusPill');
  const statusText = document.getElementById('statusText');

  // DOM Elements - Hero Volume & Visualizer
  const volumeDisplay = document.getElementById('volumeDisplay');
  const volumeTag = document.getElementById('volumeTag');
  const visualizerCanvas = document.getElementById('visualizerCanvas');
  const canvasCtx = visualizerCanvas.getContext('2d');

  // DOM Elements - Controls
  const volumeSlider = document.getElementById('volumeSlider');
  const pillButtons = document.querySelectorAll('.pill-btn');
  const btnBassBoost = document.getElementById('btnBassBoost');
  const statusBass = document.getElementById('statusBass');
  const btnMono = document.getElementById('btnMono');
  const statusMono = document.getElementById('statusMono');
  const btnMute = document.getElementById('btnMute');
  const textMute = document.getElementById('textMute');
  const btnReset = document.getElementById('btnReset');

  // DOM Elements - Mixer
  const mixerList = document.getElementById('mixerList');
  const mixerEmpty = document.getElementById('mixerEmpty');

  // State
  let currentTab = null;
  let tabState = {
    volume: 1.0,
    isMuted: false,
    isCaptured: false,
    bassBoost: false,
    mono: false
  };
  let visualizerAnimId = null;
  let visualizerData = null;

  // Banner Notice Helper
  function showNotice(msg) {
    if (!msg) {
      noticeBanner.style.display = 'none';
      return;
    }
    noticeText.textContent = msg;
    noticeBanner.style.display = 'flex';
  }

  noticeClose?.addEventListener('click', () => {
    noticeBanner.style.display = 'none';
  });

  // Verify whether the URL can be captured by chrome.tabCapture
  function isCapturableTab(tab) {
    if (!tab || !tab.url) return false;
    const url = tab.url.toLowerCase();
    return !url.startsWith('chrome://') &&
           !url.startsWith('chrome-extension://') &&
           !url.startsWith('edge://') &&
           !url.startsWith('about:') &&
           !url.startsWith('devtools://') &&
           !url.includes('chromewebstore.google.com');
  }

  // Helper to obtain a streamId directly within user gesture context
  function requestStreamId(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          const err = chrome.runtime.lastError?.message || 'Could not acquire media stream ID';
          return reject(new Error(err));
        }
        resolve(streamId);
      });
    });
  }

  // Initialize: Get active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      currentTitle.textContent = 'No active tab found';
      return;
    }
    currentTab = tab;

    // Display tab info
    currentTitle.textContent = tab.title || 'Untitled Tab';
    if (tab.favIconUrl) {
      currentFavicon.src = tab.favIconUrl;
    }
    try {
      const urlObj = new URL(tab.url || '');
      currentDomain.textContent = urlObj.hostname || tab.url;
    } catch {
      currentDomain.textContent = tab.url || 'Internal Chrome Tab';
    }

    // Check if on an internal Chrome page (e.g., chrome://extensions)
    if (!isCapturableTab(tab)) {
      showNotice('Chrome prohibits tab capture on internal pages (chrome://). Please open YouTube, Spotify, or any web page to test audio!');
    }

    // Fetch tab state from background
    const response = await chrome.runtime.sendMessage({
      type: 'GET_TAB_STATE',
      tabId: currentTab.id
    });

    if (response?.success && response.state) {
      tabState = response.state;
    }

    updateUI();
    startVisualizerLoop();
    updateMixerCount();
  } catch (err) {
    console.error('[SoundWave Popup] Init error:', err);
  }

  // Update UI to reflect current state
  function updateUI() {
    const pct = Math.round(tabState.volume * 100);
    volumeSlider.value = tabState.isMuted ? 0 : pct;
    volumeDisplay.textContent = tabState.isMuted ? '0' : pct;

    // Style volume number and mode tags
    volumeDisplay.className = 'volume-number';
    volumeSlider.className = 'custom-slider';

    if (tabState.isMuted) {
      volumeDisplay.classList.add('muted');
      volumeTag.textContent = 'Muted';
      tabStatusPill.className = 'header-status muted';
      statusText.textContent = 'Muted';
    } else if (pct > 100) {
      volumeDisplay.classList.add('boost');
      volumeSlider.classList.add('boost-mode');
      volumeTag.textContent = `Boosted (+${pct - 100}%)`;
      tabStatusPill.className = 'header-status boost';
      statusText.textContent = tabState.isCaptured ? 'Live Boost' : 'Ready';
    } else if (pct < 100) {
      volumeTag.textContent = 'Attenuated';
      tabStatusPill.className = 'header-status active';
      statusText.textContent = tabState.isCaptured ? 'Active' : 'Ready';
    } else {
      volumeTag.textContent = 'Normal 100%';
      tabStatusPill.className = tabState.isCaptured ? 'header-status active' : 'header-status';
      statusText.textContent = tabState.isCaptured ? 'Captured' : 'Ready';
    }

    // Update Presets highlight
    pillButtons.forEach((btn) => {
      const val = parseInt(btn.dataset.val, 10);
      const isTarget = tabState.isMuted ? val === 0 : val === pct;
      btn.classList.toggle('active-preset', isTarget);
    });

    // Update Enhancers
    btnBassBoost.classList.toggle('active', tabState.bassBoost);
    statusBass.textContent = tabState.bassBoost ? 'ON (+9dB)' : 'OFF';

    btnMono.classList.toggle('active', tabState.mono);
    statusMono.textContent = tabState.mono ? 'ON' : 'OFF';

    // Update Mute button
    btnMute.classList.toggle('is-muted', tabState.isMuted);
    textMute.textContent = tabState.isMuted ? 'Unmute Tab' : 'Mute Tab';
  }

  // Send Audio Updates to background using direct user gesture
  async function applyAudioChange(updates) {
    if (!currentTab) return;

    if (!isCapturableTab(currentTab)) {
      showNotice('Audio cannot be captured on chrome:// system pages. Please test on YouTube or another web tab.');
      return;
    }

    Object.assign(tabState, updates);
    updateUI();

    try {
      if (!tabState.isCaptured) {
        // Must request streamId directly within user gesture here in popup!
        const streamId = await requestStreamId(currentTab.id);

        const resp = await chrome.runtime.sendMessage({
          type: 'START_TAB_CAPTURE',
          tabId: currentTab.id,
          streamId,
          updates
        });

        if (resp?.success && resp.state) {
          tabState = resp.state;
          updateUI();
          showNotice(''); // clear warning if any
        } else if (resp?.error) {
          showNotice(resp.error);
        }
      } else {
        // Tab is already captured, update gain/EQ directly
        const resp = await chrome.runtime.sendMessage({
          type: 'UPDATE_TAB_AUDIO',
          tabId: currentTab.id,
          updates
        });
        if (resp?.success && resp.state) {
          tabState = resp.state;
          updateUI();
        }
      }
    } catch (err) {
      console.error('[SoundWave Popup] Capture error:', err);
      showNotice(err.message || 'Could not capture tab audio');
    }
  }

  // Slider change
  volumeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    applyAudioChange({
      volume: val / 100,
      isMuted: val === 0
    });
  });

  // Preset buttons
  pillButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val, 10);
      applyAudioChange({
        volume: val / 100,
        isMuted: val === 0
      });
    });
  });

  // Bass Boost toggle
  btnBassBoost.addEventListener('click', () => {
    applyAudioChange({
      bassBoost: !tabState.bassBoost
    });
  });

  // Mono toggle
  btnMono.addEventListener('click', () => {
    applyAudioChange({
      mono: !tabState.mono
    });
  });

  // Mute button
  btnMute.addEventListener('click', () => {
    applyAudioChange({
      isMuted: !tabState.isMuted
    });
  });

  // Reset / Detach native audio
  btnReset.addEventListener('click', async () => {
    if (!currentTab) return;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'RESET_TAB_AUDIO',
        tabId: currentTab.id
      });
      if (resp?.success && resp.state) {
        tabState = resp.state;
        updateUI();
        showNotice('');
      }
    } catch (err) {
      console.warn('[SoundWave Popup] Reset error:', err);
    }
  });

  // Navigation Switcher
  btnNavCurrent.addEventListener('click', () => {
    btnNavCurrent.classList.add('active');
    btnNavMixer.classList.remove('active');
    paneCurrent.classList.add('active');
    paneMixer.classList.remove('active');
  });

  btnNavMixer.addEventListener('click', () => {
    btnNavMixer.classList.add('active');
    btnNavCurrent.classList.remove('active');
    paneMixer.classList.add('active');
    paneCurrent.classList.remove('active');
    loadMixerTabs();
  });

  // Tab Mixer Logic
  async function updateMixerCount() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_ALL_AUDIO_TABS' });
      if (resp?.success && resp.tabs) {
        mixerCountBadge.textContent = resp.tabs.length;
      }
    } catch {}
  }

  async function loadMixerTabs() {
    mixerList.innerHTML = '';
    mixerEmpty.style.display = 'none';

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_ALL_AUDIO_TABS' });
      if (!resp?.success || !resp.tabs || resp.tabs.length === 0) {
        mixerEmpty.style.display = 'block';
        mixerCountBadge.textContent = '0';
        return;
      }

      mixerCountBadge.textContent = resp.tabs.length;

      resp.tabs.forEach((tab) => {
        const item = document.createElement('div');
        item.className = 'mixer-item';
        if (currentTab && tab.id === currentTab.id) {
          item.classList.add('is-current');
        }

        const pct = Math.round((tab.state?.volume ?? 1.0) * 100);
        const isMuted = tab.state?.isMuted ?? false;

        item.innerHTML = `
          <div class="mixer-top">
            <div class="mixer-info" title="Switch to tab">
              <img class="mixer-favicon" src="${tab.favIconUrl || '../icons/icon16.png'}" alt="Tab">
              <div class="mixer-text">
                <div class="mixer-title">${escapeHTML(tab.title || 'Untitled Tab')}</div>
              </div>
            </div>
            <span class="mixer-badge" id="badge-${tab.id}">${isMuted ? 'MUTE' : pct + '%'}</span>
          </div>
          <div class="mixer-controls">
            <button class="mixer-btn-mute ${isMuted ? 'muted' : ''}" id="muteBtn-${tab.id}" title="Toggle Mute">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            </button>
            <input 
              type="range" 
              class="mixer-slider" 
              id="slider-${tab.id}" 
              min="0" 
              max="600" 
              value="${isMuted ? 0 : pct}"
            >
          </div>
        `;

        // Switch to tab on click
        item.querySelector('.mixer-info').addEventListener('click', () => {
          chrome.tabs.update(tab.id, { active: true });
        });

        // Inline slider
        const slider = item.querySelector(`#slider-${tab.id}`);
        const badge = item.querySelector(`#badge-${tab.id}`);
        const muteBtn = item.querySelector(`#muteBtn-${tab.id}`);

        slider.addEventListener('input', async (e) => {
          const val = parseInt(e.target.value, 10);
          badge.textContent = val === 0 ? 'MUTE' : `${val}%`;

          try {
            if (!tab.state?.isCaptured) {
              const streamId = await requestStreamId(tab.id);
              await chrome.runtime.sendMessage({
                type: 'START_TAB_CAPTURE',
                tabId: tab.id,
                streamId,
                updates: { volume: val / 100, isMuted: val === 0 }
              });
              tab.state = { ...(tab.state || {}), isCaptured: true, volume: val / 100, isMuted: val === 0 };
            } else {
              await chrome.runtime.sendMessage({
                type: 'UPDATE_TAB_AUDIO',
                tabId: tab.id,
                updates: { volume: val / 100, isMuted: val === 0 }
              });
            }

            if (tab.id === currentTab?.id) {
              tabState.volume = val / 100;
              tabState.isMuted = val === 0;
              updateUI();
            }
          } catch (err) {
            console.error('[SoundWave Mixer] Capture error:', err);
          }
        });

        // Inline mute
        muteBtn.addEventListener('click', async () => {
          const newMute = !muteBtn.classList.contains('muted');
          muteBtn.classList.toggle('muted', newMute);
          badge.textContent = newMute ? 'MUTE' : `${Math.round((tab.state?.volume ?? 1) * 100)}%`;

          try {
            if (!tab.state?.isCaptured) {
              const streamId = await requestStreamId(tab.id);
              await chrome.runtime.sendMessage({
                type: 'START_TAB_CAPTURE',
                tabId: tab.id,
                streamId,
                updates: { isMuted: newMute }
              });
              tab.state = { ...(tab.state || {}), isCaptured: true, isMuted: newMute };
            } else {
              await chrome.runtime.sendMessage({
                type: 'UPDATE_TAB_AUDIO',
                tabId: tab.id,
                updates: { isMuted: newMute }
              });
            }

            if (tab.id === currentTab?.id) {
              tabState.isMuted = newMute;
              updateUI();
            }
          } catch (err) {
            console.error('[SoundWave Mixer] Mute error:', err);
          }
        });

        mixerList.appendChild(item);
      });
    } catch (err) {
      console.error('[SoundWave Mixer] Error loading tabs:', err);
    }
  }

  // Visualizer Animation Loop
  let idlePhase = 0;
  function startVisualizerLoop() {
    let lastPoll = 0;

    function render(timestamp) {
      // Poll visualizer data from offscreen every ~60ms if tab is captured and active
      if (tabState.isCaptured && !tabState.isMuted && timestamp - lastPoll > 60) {
        lastPoll = timestamp;
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'GET_VISUALIZER_DATA',
          tabId: currentTab.id
        }, (resp) => {
          if (resp?.success && resp.data) {
            visualizerData = resp.data;
          }
        });
      }

      drawVisualizer();
      visualizerAnimId = requestAnimationFrame(render);
    }

    visualizerAnimId = requestAnimationFrame(render);
  }

  function drawVisualizer() {
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    canvasCtx.clearRect(0, 0, width, height);

    const numBars = 24;
    const barSpacing = 4;
    const barWidth = (width - (numBars - 1) * barSpacing) / numBars;

    idlePhase += 0.05;

    for (let i = 0; i < numBars; i++) {
      let barHeight = 4;

      if (tabState.isCaptured && !tabState.isMuted && visualizerData && visualizerData.length > 0) {
        const dataIndex = Math.floor((i / numBars) * (visualizerData.length / 2));
        const val = visualizerData[dataIndex] || 0;
        barHeight = Math.max(4, (val / 255) * height);
      } else {
        // Subtle ambient breathing wave when idle or silent
        const wave = Math.sin(idlePhase + i * 0.3) * 0.5 + 0.5;
        barHeight = 4 + wave * 6;
      }

      const x = i * (barWidth + barSpacing);
      const y = height - barHeight;

      // Color Gradient
      const grad = canvasCtx.createLinearGradient(0, height, 0, 0);
      if (tabState.volume > 1.0) {
        grad.addColorStop(0, '#3b82f6');
        grad.addColorStop(1, '#a855f7');
      } else {
        grad.addColorStop(0, '#06b6d4');
        grad.addColorStop(1, '#00f2fe');
      }

      canvasCtx.fillStyle = grad;
      canvasCtx.beginPath();
      canvasCtx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      canvasCtx.fill();
    }
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
