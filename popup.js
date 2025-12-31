import { generateStorageKey, generateHashKey, debounce } from './utils.js';

// DOM Elements
const currentView = document.getElementById('currentView');
const allTabsView = document.getElementById('allTabsView');
const settingsView = document.getElementById('settingsView');
const currentTabBtn = document.getElementById('currentTabBtn');
const allTabsBtn = document.getElementById('allTabsBtn');
const settingsBtn = document.getElementById('settingsBtn');
const backBtn = document.getElementById('backBtn');

// Current Tab View Elements
const noteInput = document.getElementById('noteInput');
const charCount = document.getElementById('charCount');
const saveIndicator = document.getElementById('saveIndicator');
const tabTitle = document.getElementById('tabTitle');
const tabUrl = document.getElementById('tabUrl');
const tabFavicon = document.getElementById('tabFavicon');
const clearBtn = document.getElementById('clearBtn');
const deleteBtn = document.getElementById('deleteBtn');
const status = document.getElementById('status');

// All Tabs View Elements
const notesContainer = document.getElementById('notesContainer');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const tabCount = document.getElementById('tabCount');

// Settings Elements
const notificationsToggle = document.getElementById('notificationsToggle');
const clearAllBtn = document.getElementById('clearAllBtn');
const exportBtn = document.getElementById('exportBtn');
const configureShortcutBtn = document.getElementById('configureShortcutBtn');

// Onboarding Elements
const onboardingModal = document.getElementById('onboardingModal');
const setupShortcutBtn = document.getElementById('setupShortcutBtn');
const skipOnboardingBtn = document.getElementById('skipOnboardingBtn');
const shortcutHint = document.getElementById('shortcutHint');
const closeHint = document.getElementById('closeHint');

// Support Elements
const githubBtn = document.getElementById('githubBtn');
const showCryptoBtn = document.getElementById('showCryptoBtn');
const cryptoContainer = document.getElementById('cryptoContainer');

// State
let currentTab = null;
let storageKey = null;
let allNotes = [];
let allTabs = [];

// ============================================
// HELPER: SAFE URL PARSING (Fixes the Edge Error)
// ============================================
function getHostnameSafe(urlString) {
  if (!urlString) return 'Unknown Page';
  try {
    return new URL(urlString).hostname;
  } catch (e) {
    // If URL is invalid (e.g. edge:// or about:blank), return the raw string or a fallback
    return urlString.startsWith('edge://') ? 'Edge System Page' : 
           urlString.startsWith('chrome://') ? 'Chrome System Page' : 
           'System Page';
  }
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
  try {
    // Check if first time user
    await checkFirstTimeUser();
    
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    
    // Generate storage key
    storageKey = generateStorageKey(tab.windowId, tab.id);
    
    // Display tab info (WITH SAFE URL PARSING)
    tabTitle.textContent = tab.title || 'Untitled';
    tabUrl.textContent = getHostnameSafe(tab.url);
    
    if (tab.favIconUrl) {
      tabFavicon.src = tab.favIconUrl;
      tabFavicon.style.display = 'block';
    }
    
    // Load existing note for current tab
    const result = await chrome.storage.session.get(storageKey);
    if (result[storageKey]) {
      noteInput.value = result[storageKey].text;
      updateCharCount();
    }
    
    // Load all notes for dashboard
    await loadAllNotes();
    
    // Load settings
    const settingsResult = await chrome.storage.local.get('settings');
    if (settingsResult.settings) {
      notificationsToggle.checked = settingsResult.settings.notificationsEnabled || false;
    }
    
    // Update tab count
    updateTabCount();
    
    // Focus input
    noteInput.focus();
    
  } catch (err) {
    console.error('Init error:', err);
    showStatus('Error loading notes', 'error');
  }
}

// ============================================
// MULTI-LAYERED SAVE STRATEGY (v1.1)
// ============================================

/**
 * Core save function - extracted for reuse across all save triggers
 * @param {string} text - The note text to save
 * @param {string} source - Source of save trigger (for debugging)
 */
async function performSave(text, source = 'unknown') {
  const trimmedText = text.trim();
  
  // If empty, delete the note
  if (!trimmedText) {
    await deleteNote(false);
    return;
  }
  
  try {
    updateSaveIndicator('saving');
    
    const note = {
      text: trimmedText,
      created: Date.now(),
      url: currentTab.url
    };
    
    // Save to session storage (primary)
    await chrome.storage.session.set({ [storageKey]: note });
    
    // Backup to local storage (crash recovery)
    const hashKey = await generateHashKey(currentTab.url);
    await chrome.storage.local.set({ [hashKey]: note });
    
    // Update badge
    await chrome.action.setBadgeText({ 
      text: '!', 
      tabId: currentTab.id 
    });
    await chrome.action.setBadgeBackgroundColor({ 
      color: '#4285f4', 
      tabId: currentTab.id 
    });
    
    // Update dashboard if visible
    if (allTabsView.classList.contains('active')) {
      await loadAllNotes();
    }
    updateTabCount();
    
    updateSaveIndicator('saved');
    
    // Only show status toast for debounced saves
    if (source === 'debounce') {
      showStatus('Saved', 'success');
    }
    
  } catch (err) {
    console.error(`Save error (${source}):`, err);
    updateSaveIndicator('error');
    if (source === 'debounce') {
      showStatus('Save failed', 'error');
    }
  }
}

// Layer 1: Debounced save (performance optimization)
const debouncedSave = debounce(() => {
  performSave(noteInput.value, 'debounce');
}, 1000);

// Layer 2: Blur save (immediate save when user leaves textarea)
noteInput.addEventListener('blur', () => {
  if (noteInput.value.trim()) {
    performSave(noteInput.value, 'blur');
  }
});

// Layer 3: Visibility change (popup loses focus)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && noteInput.value.trim()) {
    performSave(noteInput.value, 'visibility-hidden');
  }
});

// ============================================
// VISUAL SAVE INDICATOR
// ============================================

function updateSaveIndicator(state) {
  saveIndicator.className = 'save-indicator';
  
  switch(state) {
    case 'saving':
      saveIndicator.textContent = '💾 Saving...';
      saveIndicator.classList.add('saving');
      break;
    case 'saved':
      saveIndicator.textContent = '✓ Saved';
      saveIndicator.classList.add('saved');
      setTimeout(() => {
        saveIndicator.className = 'save-indicator';
        saveIndicator.textContent = '';
      }, 2000);
      break;
    case 'error':
      saveIndicator.textContent = '⚠️ Error';
      saveIndicator.classList.add('error');
      setTimeout(() => {
        saveIndicator.className = 'save-indicator';
        saveIndicator.textContent = '';
      }, 3000);
      break;
  }
}

// ============================================
// DASHBOARD FUNCTIONALITY
// ============================================

// Load all notes from all tabs
async function loadAllNotes() {
  try {
    // Get all tabs
    allTabs = await chrome.tabs.query({});
    
    // Get all notes from session storage
    const sessionData = await chrome.storage.session.get(null);
    
    // Build notes array with tab info
    allNotes = [];
    for (const tab of allTabs) {
      const key = generateStorageKey(tab.windowId, tab.id);
      if (sessionData[key]) {
        allNotes.push({
          tabId: tab.id,
          windowId: tab.windowId,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          note: sessionData[key].text,
          created: sessionData[key].created,
          storageKey: key
        });
      }
    }
    
    // Sort by creation time (newest first)
    allNotes.sort((a, b) => b.created - a.created);
    
    renderDashboard();
    
  } catch (err) {
    console.error('Load all notes error:', err);
  }
}

// Render dashboard view
function renderDashboard(filterText = '') {
  if (allNotes.length === 0) {
    emptyState.style.display = 'flex';
    notesContainer.innerHTML = '';
    return;
  }
  
  emptyState.style.display = 'none';
  
  // Filter notes by search
  const filteredNotes = filterText 
    ? allNotes.filter(note => 
        note.note.toLowerCase().includes(filterText.toLowerCase()) ||
        note.title.toLowerCase().includes(filterText.toLowerCase())
      )
    : allNotes;
  
  if (filteredNotes.length === 0) {
    notesContainer.innerHTML = '<div class="no-results">No matching notes found</div>';
    return;
  }
  
  // Group by window
  const notesByWindow = {};
  filteredNotes.forEach(note => {
    if (!notesByWindow[note.windowId]) {
      notesByWindow[note.windowId] = [];
    }
    notesByWindow[note.windowId].push(note);
  });
  
  // Render grouped notes
  let html = '';
  const windowIds = Object.keys(notesByWindow).sort((a, b) => b - a);
  
  windowIds.forEach((windowId, index) => {
    const notes = notesByWindow[windowId];
    const windowNumber = windowIds.length > 1 ? index + 1 : null;
    
    if (windowNumber) {
      html += `
        <div class="window-group">
          <div class="window-header">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M1 5h14" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            Window ${windowNumber}
            <span class="window-count">${notes.length} tab${notes.length > 1 ? 's' : ''}</span>
          </div>
      `;
    }
    
    notes.forEach(note => {
      html += createNoteCard(note);
    });
    
    if (windowNumber) {
      html += '</div>';
    }
  });
  
  notesContainer.innerHTML = html;
  
  // Attach event listeners
  attachNoteCardListeners();
}

// Create individual note card HTML
function createNoteCard(note) {
  // USE SAFETY CHECK HERE
  const hostname = getHostnameSafe(note.url); 
  const timeAgo = formatTimeAgo(note.created);
  
  return `
    <div class="note-card" data-tab-id="${note.tabId}" data-window-id="${note.windowId}">
      <div class="note-card-header">
        <div class="note-tab-info">
          ${note.favIconUrl ? `<img class="note-favicon" src="${note.favIconUrl}" alt="">` : '<div class="note-favicon-placeholder"></div>'}
          <div class="note-tab-details">
            <div class="note-tab-title">${escapeHtml(note.title)}</div>
            <div class="note-tab-url">${escapeHtml(hostname)}</div>
          </div>
        </div>
        <button class="note-delete-btn" data-storage-key="${note.storageKey}" data-tab-id="${note.tabId}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="note-content">${escapeHtml(note.note)}</div>
      <div class="note-footer">
        <span class="note-time">${timeAgo}</span>
        <button class="note-goto-btn" data-tab-id="${note.tabId}" data-window-id="${note.windowId}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3h6v6M11 3L3 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Go to tab
        </button>
      </div>
    </div>
  `;
}

// Attach event listeners to note cards
function attachNoteCardListeners() {
  // Go to tab buttons
  document.querySelectorAll('.note-goto-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      const windowId = parseInt(btn.dataset.windowId);
      
      try {
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(windowId, { focused: true });
        window.close();
      } catch (err) {
        console.error('Go to tab error:', err);
        showStatus('Tab not found', 'error');
      }
    });
  });
  
  // Delete buttons
  document.querySelectorAll('.note-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const storageKey = btn.dataset.storageKey;
      const tabId = parseInt(btn.dataset.tabId);
      
      try {
        await chrome.storage.session.remove(storageKey);
        
        const hashKey = await generateHashKey(
          allNotes.find(n => n.tabId === tabId)?.url || ''
        );
        await chrome.storage.local.remove(hashKey);
        
        await chrome.action.setBadgeText({ text: '', tabId: tabId });
        
        await loadAllNotes();
        updateTabCount();
        showStatus('Note deleted', 'success');
      } catch (err) {
        console.error('Delete note error:', err);
        showStatus('Delete failed', 'error');
      }
    });
  });
  
  // Click card to go to tab
  document.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.note-delete-btn') || e.target.closest('.note-goto-btn')) {
        return;
      }
      
      const tabId = parseInt(card.dataset.tabId);
      const windowId = parseInt(card.dataset.windowId);
      
      try {
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(windowId, { focused: true });
        window.close();
      } catch (err) {
        console.error('Card click error:', err);
      }
    });
  });
}

// Update tab count display
function updateTabCount() {
  const count = allNotes.length;
  tabCount.textContent = count === 0 ? 'No notes' : count === 1 ? '1 note' : `${count} notes`;
}

// Delete note
async function deleteNote(showMessage = true) {
  try {
    await chrome.storage.session.remove(storageKey);
    
    const hashKey = await generateHashKey(currentTab.url);
    await chrome.storage.local.remove(hashKey);
    
    await chrome.action.setBadgeText({ text: '', tabId: currentTab.id });
    
    noteInput.value = '';
    updateCharCount();
    updateSaveIndicator(''); // Clear indicator
    
    await loadAllNotes();
    updateTabCount();
    
    if (showMessage) {
      showStatus('Note deleted', 'success');
    }
    
  } catch (err) {
    console.error('Delete error:', err);
    showStatus('Delete failed', 'error');
  }
}

// Update character count
function updateCharCount() {
  const count = noteInput.value.length;
  charCount.textContent = `${count}/500`;
  
  if (count > 450) {
    charCount.style.color = '#ea4335';
  } else {
    charCount.style.color = '#5f6368';
  }
}

// Show status message
function showStatus(message, type) {
  status.textContent = message;
  status.className = `status ${type} show`;
  
  setTimeout(() => {
    status.classList.remove('show');
  }, 2000);
}

// View switching (with pre-save)
function switchView(viewName) {
  // Layer 3: Save before switching views
  if (noteInput.value.trim()) {
    performSave(noteInput.value, 'view-switch');
  }
  
  currentView.classList.remove('active');
  allTabsView.classList.remove('active');
  settingsView.classList.remove('active');
  
  currentTabBtn.classList.remove('active');
  allTabsBtn.classList.remove('active');
  
  if (viewName === 'current') {
    currentView.classList.add('active');
    currentTabBtn.classList.add('active');
  } else if (viewName === 'all') {
    allTabsView.classList.add('active');
    allTabsBtn.classList.add('active');
    loadAllNotes();
  } else if (viewName === 'settings') {
    settingsView.classList.add('active');
  }
}

// Clear all notes
async function clearAllNotes() {
  if (!confirm('Delete all notes from all tabs? This cannot be undone.')) {
    return;
  }
  
  try {
    await chrome.storage.session.clear();
    
    const localData = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(localData).filter(key => key.startsWith('url_'));
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
    
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      await chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }
    
    noteInput.value = '';
    updateCharCount();
    await loadAllNotes();
    updateTabCount();
    
    showStatus('All notes cleared', 'success');
    
  } catch (err) {
    console.error('Clear all error:', err);
    showStatus('Clear failed', 'error');
  }
}

// Export notes
async function exportNotes() {
  try {
    const exportData = {
      exported: new Date().toISOString(),
      version: '1.2.0',
      notes: allNotes.map(note => ({
        title: note.title,
        url: note.url,
        note: note.note,
        created: new Date(note.created).toISOString()
      }))
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `tab-notes-${Date.now()}.json`;
    link.click();
    
    showStatus('Notes exported', 'success');
    
  } catch (err) {
    console.error('Export error:', err);
    showStatus('Export failed', 'error');
  }
}

// Update settings
async function updateSettings() {
  const settings = {
    notificationsEnabled: notificationsToggle.checked
  };
  
  await chrome.storage.local.set({ settings: settings });
  
  chrome.runtime.sendMessage({ 
    type: 'updateSettings', 
    settings: settings 
  });
  
  showStatus('Settings saved', 'success');
}

// Utility functions
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// ONBOARDING & SHORTCUT MANAGEMENT
// ============================================

async function checkFirstTimeUser() {
  const data = await chrome.storage.local.get(['hasSeenOnboarding', 'hideShortcutHint']);
  
  if (!data.hasSeenOnboarding) {
    showOnboarding();
  } else if (!data.hideShortcutHint) {
    // Show hint for returning users who haven't dismissed it
    shortcutHint.style.display = 'flex';
  }
}

function showOnboarding() {
  onboardingModal.classList.remove('hidden');
}

function hideOnboarding() {
  onboardingModal.classList.add('hidden');
  chrome.storage.local.set({ hasSeenOnboarding: true });
}

function openShortcutsPage() {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
}

function hideShortcutHint() {
  shortcutHint.style.display = 'none';
  chrome.storage.local.set({ hideShortcutHint: true });
}

// ============================================
// EVENT LISTENERS
// ============================================

// Optimistic UI: Update badge immediately on input
noteInput.addEventListener('input', () => {
  updateCharCount();
  
  // Optimistic badge update (instant feedback)
  if (noteInput.value.trim()) {
    chrome.action.setBadgeText({ text: '!', tabId: currentTab.id });
    chrome.action.setBadgeBackgroundColor({ 
      color: '#4285f4', 
      tabId: currentTab.id 
    });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: currentTab.id });
  }
  
  // Trigger debounced save
  debouncedSave();
});

clearBtn.addEventListener('click', () => {
  noteInput.value = '';
  updateCharCount();
  deleteNote(false);
});

deleteBtn.addEventListener('click', () => deleteNote(true));

currentTabBtn.addEventListener('click', () => switchView('current'));
allTabsBtn.addEventListener('click', () => switchView('all'));
settingsBtn.addEventListener('click', () => switchView('settings'));
backBtn.addEventListener('click', () => switchView('current'));

searchInput.addEventListener('input', debounce(() => {
  renderDashboard(searchInput.value);
}, 300));

notificationsToggle.addEventListener('change', updateSettings);
clearAllBtn.addEventListener('click', clearAllNotes);
exportBtn.addEventListener('click', exportNotes);

// Onboarding & Shortcuts
setupShortcutBtn.addEventListener('click', () => {
  hideOnboarding();
  openShortcutsPage();
});

skipOnboardingBtn.addEventListener('click', hideOnboarding);

configureShortcutBtn.addEventListener('click', openShortcutsPage);

closeHint.addEventListener('click', hideShortcutHint);

// Support & Crypto Listeners
if (githubBtn) {
  githubBtn.addEventListener('click', () => {
    // CORRECTED REPO URL
    chrome.tabs.create({ url: 'https://github.com/raidenOP1/why-am-i-here-' });
  });
}

if (showCryptoBtn) {
  showCryptoBtn.addEventListener('click', () => {
    cryptoContainer.classList.toggle('hidden');
  });
}

document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    
    // Select & Copy
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      // Visual Feedback
      const originalText = btn.textContent;
      btn.textContent = '✓';
      btn.classList.add('copied');
      
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('copied');
      }, 2000);
    });
  });
});

// Handle favicon load errors
tabFavicon.addEventListener('error', () => {
  tabFavicon.style.display = 'none';
});

// Initialize on load
init();
