/**
 * Twitch Chat Highlighter - Background Service Worker
 * Manages OBS WebSocket connection and authentication
 */

/**
 * OBS WebSocket Configuration
 */
const OBS_CONFIG = {
  url: 'ws://localhost:4455',
  password: '', // Set via popup, stored in chrome.storage
  reconnectInterval: 5000,
  maxReconnectAttempts: 3,
  browserSourceName: 'TwitchHighlight',
};

/**
 * Connection state
 */
let obsWebSocket = null;
let isConnected = false;
let isAuthenticated = false;
let messageRequestId = 1;
let pendingRequests = new Map();
let reconnectAttempts = 0;
let autoReconnect = false;
let keepAliveInterval = null;

/**
 * Generate SHA256 hash using Web Crypto API
 */
async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate Base64 encoded SHA256 hash
 */
async function sha256Base64(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return btoa(String.fromCharCode(...hashArray));
}

/**
 * Generate OBS WebSocket v5 authentication string
 * auth = base64(sha256(password + salt))
 * then = base64(sha256(auth + challenge))
 */
async function generateAuthString(password, salt, challenge) {
  const saltedPassword = password + salt;
  const saltedHash = await sha256Base64(saltedPassword);
  const challengeString = saltedHash + challenge;
  const authResponse = await sha256Base64(challengeString);
  return authResponse;
}

/**
 * Send a message to OBS WebSocket
 */
function sendToOBS(message) {
  if (obsWebSocket && obsWebSocket.readyState === WebSocket.OPEN) {
    obsWebSocket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/**
 * Send a request to OBS and wait for response
 */
function sendRequest(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    const requestId = `req_${messageRequestId++}`;
    
    const message = {
      op: 6,
      d: {
        requestType,
        requestId,
        requestData,
      },
    };
    
    pendingRequests.set(requestId, { resolve, reject });
    
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 10000);
    
    if (!sendToOBS(message)) {
      pendingRequests.delete(requestId);
      reject(new Error('WebSocket not connected'));
    }
  });
}

/**
 * Handle OBS WebSocket messages
 */
async function handleOBSMessage(event) {
  const message = JSON.parse(event.data);
  console.log('[OBS WS] Received:', message);
  
  switch (message.op) {
    case 0: // Hello
      console.log('[OBS WS] Received Hello, authenticating...');
      await handleHello(message.d);
      break;
      
    case 2: // Identified
      console.log('[OBS WS] Successfully identified!');
      isAuthenticated = true;
      startKeepAlive(); // Start keepalive after successful auth
      broadcastStatus();
      break;
      
    case 5: // Event
      console.log('[OBS WS] Event:', message.d.eventType);
      break;
      
    case 7: // RequestResponse
      handleRequestResponse(message.d);
      break;
      
    case 9: // RequestBatchResponse
      console.log('[OBS WS] Batch response received');
      break;
  }
}

/**
 * Handle Hello message and send Identify
 */
async function handleHello(data) {
  const { authentication } = data;
  
  const stored = await chrome.storage.local.get(['obsPassword']);
  const password = stored.obsPassword || OBS_CONFIG.password;
  
  let identifyMessage = {
    op: 1,
    d: {
      rpcVersion: 1,
    },
  };
  
  if (authentication) {
    if (!password) {
      console.error('[OBS WS] Authentication required but no password set');
      broadcastStatus('Password required');
      return;
    }
    
    const { challenge, salt } = authentication;
    const authString = await generateAuthString(password, salt, challenge);
    
    identifyMessage.d.authentication = authString;
    console.log('[OBS WS] Sending authenticated Identify');
  } else {
    console.log('[OBS WS] No authentication required');
  }
  
  sendToOBS(identifyMessage);
}

/**
 * Handle request responses
 */
function handleRequestResponse(data) {
  const { requestId, requestStatus, responseData } = data;
  
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pendingRequests.delete(requestId);
    
    if (requestStatus.result) {
      pending.resolve(responseData);
    } else {
      pending.reject(new Error(requestStatus.comment || 'Request failed'));
    }
  }
}

/**
 * Connect to OBS WebSocket
 */
async function connectToOBS(userInitiated = false) {
  if (obsWebSocket && obsWebSocket.readyState === WebSocket.OPEN) {
    console.log('[OBS WS] Already connected');
    return;
  }
  
  if (userInitiated) {
    autoReconnect = true;
    reconnectAttempts = 0;
  }
  
  const stored = await chrome.storage.local.get(['obsUrl']);
  const url = stored.obsUrl || OBS_CONFIG.url;
  
  console.log('[OBS WS] Connecting to', url);
  
  try {
    obsWebSocket = new WebSocket(url);
    
    obsWebSocket.onopen = () => {
      console.log('[OBS WS] Connection opened');
      isConnected = true;
      reconnectAttempts = 0;
      broadcastStatus();
    };
    
    obsWebSocket.onmessage = handleOBSMessage;
    
    obsWebSocket.onerror = (error) => {
      if (autoReconnect || reconnectAttempts === 0) {
        console.warn('[OBS WS] Connection error - is OBS running with WebSocket enabled?');
      }
      broadcastStatus('Connection error - is OBS running?');
    };
    
    obsWebSocket.onclose = (event) => {
      const wasConnected = isConnected;
      isConnected = false;
      isAuthenticated = false;
      obsWebSocket = null;
      stopKeepAlive();
      
      if (wasConnected) {
        console.log('[OBS WS] Connection closed:', event.code, event.reason);
        broadcastStatus('Disconnected');
      }
      
      // Always try to reconnect if autoReconnect is enabled (no max attempts for keepalive)
      if (autoReconnect) {
        reconnectAttempts++;
        const delay = Math.min(reconnectAttempts * 2000, 30000); // Exponential backoff, max 30s
        console.log(`[OBS WS] Reconnecting in ${delay/1000}s...`);
        setTimeout(() => connectToOBS(false), delay);
      }
    };
  } catch (error) {
    console.error('[OBS WS] Failed to connect:', error);
    broadcastStatus('Failed to connect');
  }
}

/**
 * Disconnect from OBS WebSocket
 */
function disconnectFromOBS() {
  autoReconnect = false;
  reconnectAttempts = 0;
  stopKeepAlive();
  if (obsWebSocket) {
    obsWebSocket.close();
    obsWebSocket = null;
  }
  isConnected = false;
  isAuthenticated = false;
}

/**
 * Keep the service worker alive and maintain WebSocket connection
 * Chrome MV3 terminates service workers after ~30s of inactivity
 */
function startKeepAlive() {
  stopKeepAlive();
  
  // Ping OBS every 20 seconds to keep connection alive
  keepAliveInterval = setInterval(async () => {
    if (isAuthenticated && obsWebSocket?.readyState === WebSocket.OPEN) {
      try {
        // Send a lightweight request to OBS to keep connection active
        await sendRequest('GetVersion', {});
        console.log('[OBS WS] Keepalive ping successful');
      } catch (error) {
        console.warn('[OBS WS] Keepalive ping failed, reconnecting...');
        reconnectAttempts = 0;
        connectToOBS(true);
      }
    } else if (autoReconnect && !isConnected) {
      // Try to reconnect if we should be connected but aren't
      console.log('[OBS WS] Connection lost, attempting to reconnect...');
      reconnectAttempts = 0;
      connectToOBS(true);
    }
  }, 20000); // Every 20 seconds
  
  console.log('[OBS WS] Keepalive started');
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('[OBS WS] Keepalive stopped');
  }
}

/**
 * Broadcast connection status to popup
 */
function broadcastStatus(error = null) {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    data: {
      isConnected,
      isAuthenticated,
      error,
    },
  }).catch(() => {});
}

/**
 * Send highlighted message to OBS overlay
 * Updates the Browser Source URL with message data and refreshes it
 */
async function sendHighlightToOBS(messageData) {
  if (!isAuthenticated) {
    throw new Error('Not connected to OBS');
  }
  
  const stored = await chrome.storage.local.get(['browserSourceName', 'displayDuration']);
  const sourceName = stored.browserSourceName || OBS_CONFIG.browserSourceName;
  const displayDuration = stored.displayDuration || 8;
  
  // Encode message data as URL parameters
  const params = new URLSearchParams({
    username: messageData.username,
    message: messageData.message,
    color: messageData.userColor,
    timestamp: Date.now().toString(),
    duration: displayDuration.toString(),
  });
  
  try {
    // Get current browser source settings
    const currentSettings = await sendRequest('GetInputSettings', {
      inputName: sourceName,
    });
    
    let baseUrl = currentSettings?.inputSettings?.url || '';
    
    if (!baseUrl) {
      throw new Error(`Browser source "${sourceName}" not found or has no URL. Please create a browser source named "${sourceName}" in OBS.`);
    }
    
    // Remove existing query params and add new ones
    const urlBase = baseUrl.split('?')[0];
    const newUrl = urlBase + '?' + params.toString();
    
    // Update browser source URL with message data
    await sendRequest('SetInputSettings', {
      inputName: sourceName,
      inputSettings: {
        url: newUrl,
      },
    });
    
    // Refresh the browser source
    await sendRequest('PressInputPropertiesButton', {
      inputName: sourceName,
      propertyName: 'refreshnocache',
    });
    
    console.log('[OBS WS] Message sent to overlay');
    return true;
  } catch (error) {
    console.error('[OBS WS] Failed to send to overlay:', error);
    throw error;
  }
}

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);
  
  switch (message.type) {
    case 'HIGHLIGHT_MESSAGE':
      sendHighlightToOBS(message.data)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'CONNECT_OBS':
      connectToOBS(true);
      sendResponse({ success: true });
      break;
      
    case 'DISCONNECT_OBS':
      chrome.storage.local.set({ autoReconnect: false });
      disconnectFromOBS();
      sendResponse({ success: true });
      break;
      
    case 'GET_STATUS':
      sendResponse({
        isConnected,
        isAuthenticated,
      });
      break;
      
    case 'SAVE_SETTINGS':
      chrome.storage.local.set({ ...message.data, autoReconnect: true }).then(() => {
        sendResponse({ success: true });
        disconnectFromOBS();
        setTimeout(() => connectToOBS(true), 500);
      });
      return true;
      
    case 'GET_SETTINGS':
      chrome.storage.local.get(['obsUrl', 'obsPassword', 'browserSourceName', 'displayDuration']).then((data) => {
        sendResponse({
          obsUrl: data.obsUrl || OBS_CONFIG.url,
          obsPassword: data.obsPassword || '',
          browserSourceName: data.browserSourceName || OBS_CONFIG.browserSourceName,
          displayDuration: data.displayDuration || 8,
        });
      });
      return true;
  }
});

/**
 * Initialize on service worker start
 * Service worker may restart - check if we should reconnect
 */
console.log('[Background] Service worker started');

// Check if we were previously connected and should auto-reconnect
chrome.storage.local.get(['autoReconnect']).then((data) => {
  if (data.autoReconnect) {
    console.log('[Background] Auto-reconnecting to OBS...');
    autoReconnect = true;
    connectToOBS(false);
  } else {
    console.log('[Background] Click the extension icon and press "Save & Connect" to connect to OBS');
  }
});
