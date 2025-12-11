/**
 * Twitch Chat Highlighter - Popup Script
 */

const statusDot = document.getElementById('statusDot');
const obsUrlInput = document.getElementById('obsUrl');
const obsPasswordInput = document.getElementById('obsPassword');
const displayDurationInput = document.getElementById('displayDuration');
const autoTimeoutToggle = document.getElementById('autoTimeoutToggle');
const whooshVolumeInput = document.getElementById('whooshVolume');
const volumeDisplay = document.getElementById('volumeDisplay');
const saveBtn = document.getElementById('saveBtn');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

function updateDurationState() {
  const enabled = autoTimeoutToggle.checked;
  const formGroup = displayDurationInput.closest('.form-group');

  displayDurationInput.disabled = !enabled;

  if (formGroup) {
    formGroup.classList.toggle('disabled', !enabled);
  }
}

function updateVolumeDisplay() {
  const percent = Math.round(parseFloat(whooshVolumeInput.value) * 100);
  volumeDisplay.textContent = `${percent}%`;
}

/**
 * Update status display (via header dot tooltip)
 */
function updateStatus(isConnected, isAuthenticated, error = null) {
  statusDot.classList.remove('connected', 'connecting');
  statusDot.style.background = '';
  
  if (error) {
    statusDot.title = error;
    statusDot.style.background = '#ff4444';
  } else if (isAuthenticated) {
    statusDot.classList.add('connected');
    statusDot.title = 'Connected & Authenticated ✓';
  } else if (isConnected) {
    statusDot.classList.add('connecting');
    statusDot.title = 'Connected, authenticating...';
  } else {
    statusDot.title = 'Disconnected';
  }
}

/**
 * Load saved settings
 */
async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  
  obsUrlInput.value = response.obsUrl || 'ws://localhost:4455';
  obsPasswordInput.value = response.obsPassword || '';
  displayDurationInput.value = response.displayDuration || 8;
  autoTimeoutToggle.checked = response.autoTimeoutEnabled !== false;
  whooshVolumeInput.value = response.whooshVolume ?? 0.5;
  updateDurationState();
  updateVolumeDisplay();
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
        displayDuration: duration,
        autoTimeoutEnabled: autoTimeoutToggle.checked,
      whooshVolume: parseFloat(whooshVolumeInput.value) ?? 0.5,
      },
    });
    
    saveBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }, 1500);
  } catch (error) {
    console.error('Failed to save:', error);
    saveBtn.textContent = 'Error!';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
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

function connectAndSave() {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  saveSettings().then(() => {
    chrome.runtime.sendMessage({ type: 'CONNECT_OBS' }).finally(() => {
      connectBtn.textContent = 'Connect';
      connectBtn.disabled = false;
    });
  });
}

// Event listeners
saveBtn.addEventListener('click', saveSettings);
connectBtn.addEventListener('click', connectAndSave);
disconnectBtn.addEventListener('click', disconnect);
autoTimeoutToggle.addEventListener('change', updateDurationState);
whooshVolumeInput.addEventListener('input', updateVolumeDisplay);

// Initialize
loadSettings();
getStatus();

// Poll status every 2 seconds
setInterval(getStatus, 2000);
