/**
 * Twitch Chat Highlighter - Content Script
 * Injects "Highlight" buttons next to Twitch chat messages
 * 
 * Compatible with: Native Twitch, 7TV, BTTV, FFZ
 * 
 * ============================================
 * SELECTOR CONFIG - Update these when Twitch/extensions change their CSS
 * ============================================
 */
const SELECTORS = {
  // Chat containers (try multiple for compatibility)
  chatContainers: [
    '.chat-scrollable-area__message-container',
    '[data-test-selector="chat-scrollable-area__message-container"]',
    '.chat-list--default',
    '.chat-list',
    '.seventv-chat-list',              // 7TV
  ],
  
  // Individual chat message lines (multiple selectors for extension compatibility)
  chatLines: [
    '[data-a-target="chat-line-message"]',
    '.chat-line__message',
    '.seventv-message',                // 7TV - main message container
    '[msg-id]',                        // 7TV uses msg-id attribute
    '.seventv-user-message',           // 7TV
  ],
  
  // Username selectors (try multiple)
  usernames: [
    '[data-a-target="chat-message-username"]',
    '.chat-author__display-name',
    '.seventv-chat-user-username',     // 7TV
    '.seventv-chat-user',              // 7TV - has color style
  ],
  
  // Message text selectors
  messageTexts: [
    '[data-a-target="chat-line-message-body"]',
    '.text-fragment',
    '.seventv-chat-message-body',      // 7TV
    '.text-token',                     // 7TV text content
  ],
  
  // Badge/username container (where to insert button)
  usernameContainers: [
    '.chat-line__username-container',
    '.chat-line__message--badges',
    '.seventv-chat-user',              // 7TV - insert before username
  ],
  
  // 7TV button container (can insert our button here too)
  sevenTVButtons: '.seventv-chat-message-buttons',
  
  // Timestamp
  timestamps: [
    '.chat-line__timestamp',
    '[class*="timestamp"]',
  ],
};

/**
 * Button styling config
 */
const BUTTON_CONFIG = {
  className: 'twitch-obs-highlight-btn',
  text: '✨',
  title: 'Highlight on Stream',
};

/**
 * Track processed messages by a unique identifier
 */
const processedMessageIds = new Set();

/**
 * Try multiple selectors and return the first match
 */
function queryWithFallbacks(element, selectors) {
  for (const selector of selectors) {
    try {
      const result = element.querySelector(selector);
      if (result) return result;
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return null;
}

/**
 * Try multiple selectors and return all matches
 */
function queryAllWithFallbacks(element, selectors) {
  const results = new Set();
  for (const selector of selectors) {
    try {
      const elements = element.querySelectorAll(selector);
      elements.forEach(el => results.add(el));
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return Array.from(results);
}

/**
 * Generate a unique ID for a chat message element
 */
function getMessageId(chatLine) {
  // Try various attributes that might be unique
  return chatLine.getAttribute('data-a-id') ||
         chatLine.getAttribute('data-message-id') ||
         chatLine.getAttribute('data-seventv-message-id') ||
         chatLine.getAttribute('id') ||
         // Fallback: use position + content hash
         `${chatLine.textContent?.slice(0, 50)}-${Date.now()}`;
}

/**
 * Check if element already has our button
 */
function hasHighlightButton(element) {
  return element.querySelector(`.${BUTTON_CONFIG.className}`) !== null;
}

/**
 * Extract message data from a chat line element
 */
function extractMessageData(chatLine) {
  // Get username - try multiple selectors
  let usernameEl = queryWithFallbacks(chatLine, SELECTORS.usernames);
  let username = '';
  
  // For 7TV, the username might be nested deeper
  if (usernameEl) {
    // Try to get the innermost text
    const innerUsername = usernameEl.querySelector('.seventv-chat-user-username span span');
    if (innerUsername) {
      username = innerUsername.textContent?.trim() || '';
    }
    if (!username) {
      username = usernameEl.textContent?.trim() || '';
    }
  }
  username = username || 'Anonymous';
  
  // Clean username (remove any extra characters)
  username = username.replace(/^[@]/, '').trim();
  
  // Get message text - try multiple approaches
  let messageText = '';
  
  // Try message body selectors
  const messageEl = queryWithFallbacks(chatLine, SELECTORS.messageTexts);
  if (messageEl) {
    // Get all text, including from nested elements
    messageText = messageEl.textContent?.trim() || '';
  }
  
  // If still no message, try getting text from the entire chat line
  if (!messageText) {
    // Clone and remove username/badges to get just the message
    const clone = chatLine.cloneNode(true);
    const toRemove = clone.querySelectorAll('[class*="username"], [class*="badge"], [class*="timestamp"], [class*="button"], button, svg');
    toRemove.forEach(el => el.remove());
    messageText = clone.textContent?.trim() || '';
  }
  
  // Clean up the message
  messageText = messageText
    .replace(/^\s*:\s*/, '') // Remove leading colon
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
  
  // Get user color - 7TV puts it on .seventv-chat-user as inline style
  let userColor = '#9147ff';
  const colorEl = chatLine.querySelector('.seventv-chat-user[style*="color"]') || usernameEl;
  if (colorEl) {
    const styleColor = colorEl.style?.color;
    if (styleColor && styleColor !== '') {
      userColor = styleColor;
    } else {
      const computed = window.getComputedStyle(colorEl).color;
      if (computed && computed !== 'rgb(0, 0, 0)') {
        userColor = computed;
      }
    }
  }
  
  // Get timestamp
  const timestampEl = queryWithFallbacks(chatLine, SELECTORS.timestamps);
  const timestamp = timestampEl?.textContent?.trim() || new Date().toLocaleTimeString();
  
  return {
    username,
    message: messageText,
    userColor,
    timestamp,
    extractedAt: Date.now(),
  };
}

/**
 * Create the highlight button element
 */
function createHighlightButton(chatLine) {
  const button = document.createElement('button');
  button.className = BUTTON_CONFIG.className;
  button.textContent = BUTTON_CONFIG.text;
  button.title = BUTTON_CONFIG.title;
  
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const messageData = extractMessageData(chatLine);
    console.log('[Twitch Highlighter] Extracted message:', messageData);
    
    button.textContent = '⏳';
    button.disabled = true;
    
    try {
      if (!chrome.runtime?.id) {
        throw new Error('Extension reloaded - please refresh the page');
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'HIGHLIGHT_MESSAGE',
        data: messageData,
      });
      
      if (response?.success) {
        button.textContent = '✅';
        setTimeout(() => {
          button.textContent = BUTTON_CONFIG.text;
          button.disabled = false;
        }, 2000);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (error) {
      console.error('[Twitch Highlighter] Error:', error);
      
      const errorMsg = error.message || '';
      if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('Extension reloaded')) {
        button.textContent = '🔄';
        button.title = 'Extension reloaded - refresh page (F5)';
        alert('Extension was reloaded. Please refresh the page (F5) to reconnect.');
      } else {
        button.textContent = '❌';
        button.title = `Error: ${errorMsg}`;
        setTimeout(() => {
          button.textContent = BUTTON_CONFIG.text;
          button.title = BUTTON_CONFIG.title;
          button.disabled = false;
        }, 3000);
      }
    }
  });
  
  return button;
}

/**
 * Process a single chat line and add highlight button
 */
function processChatLine(chatLine) {
  // Skip if already has button
  if (hasHighlightButton(chatLine)) {
    return;
  }
  
  const button = createHighlightButton(chatLine);
  
  // Try 7TV button container first (best integration)
  const sevenTVButtons = chatLine.querySelector(SELECTORS.sevenTVButtons);
  if (sevenTVButtons) {
    // Insert at the beginning of 7TV's button row
    sevenTVButtons.insertBefore(button, sevenTVButtons.firstChild);
    console.log('[Twitch Highlighter] Added button to 7TV message');
    return;
  }
  
  // Try username containers
  let insertTarget = queryWithFallbacks(chatLine, SELECTORS.usernameContainers);
  
  // Fallback: try to find username element's parent
  if (!insertTarget) {
    const usernameEl = queryWithFallbacks(chatLine, SELECTORS.usernames);
    insertTarget = usernameEl?.parentElement;
  }
  
  // Last resort: insert at the beginning of the chat line itself
  if (!insertTarget) {
    insertTarget = chatLine;
  }
  
  // Insert button
  if (insertTarget === chatLine) {
    chatLine.insertBefore(button, chatLine.firstChild);
  } else {
    insertTarget.insertBefore(button, insertTarget.firstChild);
  }
  
  console.log('[Twitch Highlighter] Added button to message');
}

/**
 * Scan and process all chat messages
 */
function scanAndProcessMessages() {
  const chatLines = queryAllWithFallbacks(document, SELECTORS.chatLines);
  let processed = 0;
  
  chatLines.forEach(chatLine => {
    if (!hasHighlightButton(chatLine)) {
      processChatLine(chatLine);
      processed++;
    }
  });
  
  if (processed > 0) {
    console.log(`[Twitch Highlighter] Processed ${processed} new messages`);
  }
}

/**
 * Find chat container with fallbacks
 */
function findChatContainer() {
  for (const selector of SELECTORS.chatContainers) {
    try {
      const container = document.querySelector(selector);
      if (container) return container;
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return null;
}

/**
 * Set up MutationObserver to watch for new/modified chat messages
 */
function observeChat() {
  const chatContainer = findChatContainer();
  
  if (!chatContainer) {
    console.log('[Twitch Highlighter] Chat container not found, retrying...');
    setTimeout(observeChat, 1000);
    return;
  }
  
  console.log('[Twitch Highlighter] Chat container found, starting observer');
  
  // Process existing messages
  scanAndProcessMessages();
  
  // Watch for new and modified messages
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    
    for (const mutation of mutations) {
      // Check added nodes
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
      
      // Check if attributes changed (7TV modifies existing elements)
      if (mutation.type === 'attributes') {
        shouldScan = true;
        break;
      }
      
      // Check for subtree modifications
      if (mutation.type === 'childList') {
        shouldScan = true;
        break;
      }
    }
    
    if (shouldScan) {
      // Debounce scanning
      clearTimeout(observeChat.scanTimeout);
      observeChat.scanTimeout = setTimeout(scanAndProcessMessages, 100);
    }
  });
  
  observer.observe(chatContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-a-target', 'data-seventv-message-id'],
  });
  
  // Also observe document body for 7TV which might replace the entire chat
  const bodyObserver = new MutationObserver(() => {
    // Check if chat container still exists, if not re-initialize
    if (!findChatContainer()) {
      console.log('[Twitch Highlighter] Chat container lost, re-initializing...');
      observer.disconnect();
      setTimeout(observeChat, 1000);
    }
  });
  
  bodyObserver.observe(document.body, {
    childList: true,
    subtree: false,
  });
  
  console.log('[Twitch Highlighter] Observer active');
  
  // Periodic scan to catch any messages that slipped through
  // This helps with extensions that modify DOM after initial render
  setInterval(scanAndProcessMessages, 3000);
}

/**
 * Initialize the content script
 */
function init() {
  console.log('[Twitch Highlighter] Content script loaded (with 7TV/BTTV/FFZ support)');
  
  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(observeChat, 2000));
  } else {
    // Give Twitch and extensions time to render
    setTimeout(observeChat, 2000);
  }
  
  // Watch for SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[Twitch Highlighter] URL changed, re-initializing...');
      setTimeout(observeChat, 2000);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// Start
init();
