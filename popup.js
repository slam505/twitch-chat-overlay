/**
 * Twitch Chat Highlighter - Popup Script
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const obsUrlInput = document.getElementById('obsUrl');
const obsPasswordInput = document.getElementById('obsPassword');
const browserSourceNameInput = document.getElementById('browserSourceName');
const displayDurationInput = document.getElementById('displayDuration');
const showAvatarCheckbox = document.getElementById('showAvatar');
const saveBtn = document.getElementById('saveBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

/**
 * Update status display
 */
function updateStatus(isConnected, isAuthenticated, error = null) {
  statusDot.classList.remove('connected', 'connecting');
  
  if (error) {
    statusText.textContent = error;
    statusDot.style.background = '#ff4444';
  } else if (isAuthenticated) {
    statusDot.classList.add('connected');
    statusText.textContent = 'Connected & Authenticated ✓';
  } else if (isConnected) {
    statusDot.classList.add('connecting');
    statusText.textContent = 'Connected, authenticating...';
  } else {
    statusText.textContent = 'Disconnected';
  }
}

/**
 * Load saved settings
 */
async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  
  obsUrlInput.value = response.obsUrl || 'ws://localhost:4455';
  obsPasswordInput.value = response.obsPassword || '';
  browserSourceNameInput.value = response.browserSourceName || 'TwitchHighlight';
  displayDurationInput.value = response.displayDuration || 8;
  showAvatarCheckbox.checked = response.showAvatar !== false; // Default to true
}

/**
 * Save settings and reconnect
 */
async function saveSettings() {
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  
  // Validate display duration
  let duration = parseInt(displayDurationInput.value) || 8;
  duration = Math.max(1, Math.min(60, duration)); // Clamp between 1-60
  displayDurationInput.value = duration;
  
  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      data: {
        obsUrl: obsUrlInput.value.trim() || 'ws://localhost:4455',
        obsPassword: obsPasswordInput.value,
        browserSourceName: browserSourceNameInput.value.trim() || 'TwitchHighlight',
        displayDuration: duration,
        showAvatar: showAvatarCheckbox.checked,
      },
    });
    
    saveBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveBtn.textContent = 'Save & Connect';
      saveBtn.disabled = false;
    }, 1500);
  } catch (error) {
    console.error('Failed to save:', error);
    saveBtn.textContent = 'Error!';
    setTimeout(() => {
      saveBtn.textContent = 'Save & Connect';
      saveBtn.disabled = false;
    }, 1500);
  }
}

/**
 * Get current connection status
 */
async function getStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    updateStatus(response.isConnected, response.isAuthenticated);
  } catch (error) {
    updateStatus(false, false, error.message);
  }
}

/**
 * Disconnect from OBS
 */
async function disconnect() {
  await chrome.runtime.sendMessage({ type: 'DISCONNECT_OBS' });
  updateStatus(false, false);
}

/**
 * Listen for status updates from background
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_UPDATE') {
    updateStatus(message.data.isConnected, message.data.isAuthenticated, message.data.error);
  }
});

// Event listeners
saveBtn.addEventListener('click', saveSettings);
disconnectBtn.addEventListener('click', disconnect);

// Initialize
loadSettings();
getStatus();

// Poll status every 2 seconds
setInterval(getStatus, 2000);
