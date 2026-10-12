// SoundWave Background Service Worker
// Manages tab audio capture lifecycles, offscreen document, badge indicators, and state persistence.

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// In-memory tab states: tabId -> { volume, isMuted, isCaptured, bassBoost, mono }
const tabStates = new Map();

// Helper: Ensure the single offscreen document is active
async function ensureOffscreenDocument() {
  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    if (contexts.length > 0) return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.AUDIO_PLAYBACK
      ],
      justification: 'Captures and applies real-time gain/EQ processing to tab audio'
    });
  } catch (err) {
    if (!err.message?.includes('Only a single offscreen document may be created')) {
      console.error('[SoundWave Background] Failed to create offscreen document:', err);
      throw err;
    }
  }
}

// Helper: Get or initialize tab state
function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, {
      volume: 1.0,
      isMuted: false,
      isCaptured: false,
      bassBoost: false,
      mono: false
    });
  }
  return tabStates.get(tabId);
}

// Helper: Update extension badge for the tab
function updateBadge(tabId, state) {
  if (!state || !state.isCaptured) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  if (state.isMuted) {
    chrome.action.setBadgeText({ tabId, text: 'MUT' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' });
    return;
  }

  const pct = Math.round(state.volume * 100);
  if (pct === 100 && !state.bassBoost && !state.mono) {
    chrome.action.setBadgeText({ tabId, text: '' });
  } else {
    chrome.action.setBadgeText({ tabId, text: `${pct}%` });
    if (pct > 100) {
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#a855f7' }); // Vibrant Purple boost
    } else {
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#06b6d4' }); // Cyan normal/attenuated
    }
  }
}

// Connect stream to offscreen document using streamId obtained via user gesture in popup
async function startCaptureWithStreamId(tabId, streamId, updates = {}) {
  const state = getTabState(tabId);
  Object.assign(state, updates);
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'START_CAPTURE',
      tabId,
      streamId,
      volume: state.volume,
      isMuted: state.isMuted,
      bassBoost: state.bassBoost,
      mono: state.mono
    }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        const err = chrome.runtime.lastError?.message || response?.error || 'Offscreen capture failed';
        console.error(`[SoundWave Background] Offscreen capture failed for tab ${tabId}:`, err);
        return reject(new Error(err));
      }

      state.isCaptured = true;
      updateBadge(tabId, state);
      resolve(state);
    });
  });
}

// Update audio settings for an already captured tab
function updateTabAudio(tabId, updates = {}) {
  const state = getTabState(tabId);
  Object.assign(state, updates);

  if (state.isCaptured) {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'UPDATE_AUDIO',
      tabId,
      volume: state.volume,
      isMuted: state.isMuted,
      bassBoost: state.bassBoost,
      mono: state.mono
    }).catch(() => {});
    updateBadge(tabId, state);
  }

  return state;
}

// Detach / reset audio capture on a tab
async function resetTabAudio(tabId) {
  const state = getTabState(tabId);
  state.volume = 1.0;
  state.isMuted = false;
  state.isCaptured = false;
  state.bassBoost = false;
  state.mono = false;

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'STOP_CAPTURE',
    tabId
  }).catch(() => {});

  updateBadge(tabId, state);
  tabStates.delete(tabId);
  return state;
}

// Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'offscreen') return false;

  switch (message.type) {
    case 'GET_TAB_STATE': {
      const state = getTabState(message.tabId);
      sendResponse({ success: true, state });
      return false;
    }

    case 'START_TAB_CAPTURE': {
      startCaptureWithStreamId(message.tabId, message.streamId, message.updates)
        .then((state) => sendResponse({ success: true, state }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async
    }

    case 'UPDATE_TAB_AUDIO': {
      const state = updateTabAudio(message.tabId, message.updates);
      sendResponse({ success: true, state });
      return false;
    }

    case 'RESET_TAB_AUDIO': {
      resetTabAudio(message.tabId)
        .then((state) => sendResponse({ success: true, state }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async
    }

    case 'GET_ALL_AUDIO_TABS': {
      (async () => {
        try {
          const audibleTabs = await chrome.tabs.query({ audible: true });
          const capturedTabIds = Array.from(tabStates.keys()).filter(id => tabStates.get(id).isCaptured);
          
          const tabMap = new Map();
          for (const tab of audibleTabs) {
            tabMap.set(tab.id, {
              id: tab.id,
              title: tab.title,
              url: tab.url,
              favIconUrl: tab.favIconUrl,
              audible: true,
              state: getTabState(tab.id)
            });
          }

          for (const id of capturedTabIds) {
            if (!tabMap.has(id)) {
              try {
                const tab = await chrome.tabs.get(id);
                tabMap.set(id, {
                  id: tab.id,
                  title: tab.title,
                  url: tab.url,
                  favIconUrl: tab.favIconUrl,
                  audible: false,
                  state: getTabState(id)
                });
              } catch {
                tabStates.delete(id);
              }
            }
          }

          sendResponse({ success: true, tabs: Array.from(tabMap.values()) });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // async
    }

    case 'TAB_CAPTURE_ENDED': {
      if (tabStates.has(message.tabId)) {
        const state = tabStates.get(message.tabId);
        state.isCaptured = false;
        updateBadge(message.tabId, state);
      }
      return false;
    }

    default:
      return false;
  }
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabStates.has(tabId)) {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'STOP_CAPTURE',
      tabId
    }).catch(() => {});
    tabStates.delete(tabId);
  }
});

// Reset badge on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && tabStates.has(tabId)) {
    const state = tabStates.get(tabId);
    if (state.isCaptured) {
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'STOP_CAPTURE',
        tabId
      }).catch(() => {});
      state.isCaptured = false;
      updateBadge(tabId, state);
    }
  }
});
