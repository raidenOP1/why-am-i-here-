/**
 * Generate storage key for session storage
 * Format: w{windowId}-t{tabId}
 */
export function generateStorageKey(windowId, tabId) {
  return `w${windowId}-t${tabId}`;
}

/**
 * Generate hash key for local storage backup
 * Uses SHA-256 hash of sanitized URL
 */
export async function generateHashKey(url) {
  try {
    // Sanitize URL (strip query params and fragments)
    const urlObj = new URL(url);
    const sanitized = `${urlObj.origin}${urlObj.pathname}`;
    
    // Generate SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(sanitized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `url_${hashHex.substring(0, 32)}`;
  } catch (err) {
    console.error('Hash generation error:', err);
    // Fallback to simple hash
    return `url_${btoa(url).substring(0, 32)}`;
  }
}

/**
 * Debounce function
 * Delays execution until after wait milliseconds have elapsed
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Parse storage key to extract windowId and tabId
 */
export function parseStorageKey(key) {
  const match = key.match(/^w(\d+)-t(\d+)$/);
  if (!match) return null;
  
  return {
    windowId: parseInt(match[1], 10),
    tabId: parseInt(match[2], 10)
  };
}