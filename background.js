import { generateStorageKey, generateHashKey } from './utils.js';

// State
let settings = {
  notificationsEnabled: false
};

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
  // Create context menu
  chrome.contextMenus.create({
    id: 'add-tab-note',
    title: 'Add note to this tab',
    contexts: ['page']
  });

  // Load settings
  const stored = await chrome.storage.local.get('settings');
  if (stored.settings) {
    settings = stored.settings;
  }
});

// Tab Activated - Show badge and notification
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId, windowId } = activeInfo;
  const key = generateStorageKey(windowId, tabId);
  
  try {
    // Check session storage for note
    const result = await chrome.storage.session.get(key);
    
    if (result[key]) {
      const note = result[key];
      
      // Set badge
      await chrome.action.setBadgeText({ 
        text: '!', 
        tabId: tabId 
      });
      await chrome.action.setBadgeBackgroundColor({ 
        color: '#4285f4', 
        tabId: tabId 
      });
      
      // Optional notification
      if (settings.notificationsEnabled) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Tab Note',
          message: note.text,
          silent: true,
          requireInteraction: false
        });
      }
    } else {
      // Clear badge
      await chrome.action.setBadgeText({ text: '', tabId: tabId });
    }
  } catch (err) {
    console.error('Error in onActivated:', err);
  }
});

// Tab Created - Handle duplication and crash recovery
chrome.tabs.onCreated.addListener(async (tab) => {
  const { id: tabId, windowId, openerTabId, url } = tab;
  
  // Handle tab duplication (copy parent note)
  if (openerTabId) {
    const parentKey = generateStorageKey(windowId, openerTabId);
    const parentResult = await chrome.storage.session.get(parentKey);
    
    if (parentResult[parentKey]) {
      const childKey = generateStorageKey(windowId, tabId);
      const copiedNote = {
        text: `[COPY] ${parentResult[parentKey].text}`,
        created: Date.now(),
        url: url
      };
      
      await chrome.storage.session.set({ [childKey]: copiedNote });
      await chrome.action.setBadgeText({ text: '!', tabId: tabId });
    }
  }
  
  // Crash recovery - check if URL has backup
  if (url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) {
    const hashKey = await generateHashKey(url);
    const backupResult = await chrome.storage.local.get(hashKey);
    
    if (backupResult[hashKey]) {
      const sessionKey = generateStorageKey(windowId, tabId);
      await chrome.storage.session.set({ 
        [sessionKey]: backupResult[hashKey] 
      });
      await chrome.action.setBadgeText({ text: '!', tabId: tabId });
    }
  }
});

// Tab Removed - Cleanup
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const { windowId } = removeInfo;
  const key = generateStorageKey(windowId, tabId);
  
  await chrome.storage.session.remove(key);
});

// Tab Updated - Handle URL changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const { windowId, url } = tab;
    const sessionKey = generateStorageKey(windowId, tabId);
    
    // Check if note exists for old URL
    const result = await chrome.storage.session.get(sessionKey);
    if (result[sessionKey]) {
      // Update URL in note
      result[sessionKey].url = url;
      await chrome.storage.session.set({ [sessionKey]: result[sessionKey] });
      
      // Update backup
      const hashKey = await generateHashKey(url);
      await chrome.storage.local.set({ [hashKey]: result[sessionKey] });
    }
  }
});

// Context Menu Click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'add-tab-note') {
    chrome.action.openPopup();
  }
});

// Message handler for settings updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'updateSettings') {
    settings = request.settings;
    chrome.storage.local.set({ settings: settings });
    sendResponse({ success: true });
  }
  return true;
});