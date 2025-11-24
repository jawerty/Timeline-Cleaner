const DEFAULT_CONFIG = {
  trackingEnabled: true,
  blockingEnabled: true,
  blockedLocations: [],
};

const normalizeConfig = (config = {}) => {
  // Handle migration from old config format
  let trackingEnabled = config.trackingEnabled;
  let blockingEnabled = config.blockingEnabled;
  
  if (typeof config.enabled === "boolean") {
    // Migrate old config: if enabled was set, apply to both
    trackingEnabled = config.enabled;
    blockingEnabled = config.enabled;
  } else {
    // Default to true if not set
    trackingEnabled = typeof trackingEnabled === "boolean" ? trackingEnabled : true;
    blockingEnabled = typeof blockingEnabled === "boolean" ? blockingEnabled : true;
  }

  const blockedLocations = Array.isArray(config.blockedLocations)
    ? config.blockedLocations
    : [];

  const normalizedBlocked = blockedLocations
    .map((entry) => (entry || "").toString().trim().toUpperCase())
    .filter((entry, index, array) => entry && array.indexOf(entry) === index);

  return {
    trackingEnabled,
    blockingEnabled,
    blockedLocations: normalizedBlocked,
  };
};

// Send config to inject.js via postMessage (no inline scripts)
const pushConfigToPage = (config) => {
  console.log("pushConfigToPage:", config);
  // Use postMessage to send config to inject.js (which runs in page context)
  window.postMessage({
    type: 'GEOBLOCK_CONFIG_UPDATE',
    config: config
  }, '*');
};

const injectMainScript = () => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inject.js");
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => {
    // Send initial config after inject.js loads
    const fallbackConfig = normalizeConfig(DEFAULT_CONFIG);
    pushConfigToPage(fallbackConfig);
    // Also send stored config if available
    chrome.storage.local.get({ geoblockConfig: fallbackConfig }, (result) => {
      const storedConfig = normalizeConfig(result.geoblockConfig);
      pushConfigToPage(storedConfig);
    });
    script.remove();
  };
};

// Function to check if a location is blocked
const isLocationBlocked = (location, blockedLocations) => {
  if (!location) {
    return false;
  }
  const upperLocation = location.toUpperCase();
  return blockedLocations.some((blockedEntry) =>
    upperLocation.includes(blockedEntry)
  );
};

// Function to apply opacity blocking to tweets
const applyOpacityBlocking = (config) => {
  if (!config.blockingEnabled) {
    // If blocking disabled, restore all tweets to normal opacity
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    tweets.forEach((tweet) => {
      tweet.style.opacity = "";
      tweet.removeAttribute('data-geoblock-opacity-blocked');
    });
    return;
  }

  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  tweets.forEach((tweet) => {
    const location = tweet.getAttribute('data-account-based-in');
    if (!location) {
      // No location attribute yet, skip
      return;
    }

    const shouldBlock = isLocationBlocked(location, config.blockedLocations);
    if (shouldBlock) {
      tweet.style.opacity = '0.1';
      tweet.setAttribute('data-geoblock-opacity-blocked', 'true');
    } else {
      tweet.style.opacity = '';
      tweet.removeAttribute('data-geoblock-opacity-blocked');
    }
  });
};

// Start the blocking loop
let blockingIntervalId = null;

const startBlockingLoop = (config) => {
  // Clear existing interval if any
  if (blockingIntervalId) {
    clearInterval(blockingIntervalId);
  }

  if (!config.blockingEnabled) {
    applyOpacityBlocking(config);
    return;
  }

  // Apply immediately
  applyOpacityBlocking(config);

  // Then run in a loop to catch new tweets
  blockingIntervalId = setInterval(() => {
    applyOpacityBlocking(config);
  }, 500);
};

// Function to handle config updates (both initial load and changes)
const handleConfigUpdate = (config) => {
  const normalizedConfig = normalizeConfig(config);
  pushConfigToPage(normalizedConfig);
  startBlockingLoop(normalizedConfig);
};

injectMainScript();

// Initialize with current config
const fallbackConfig = normalizeConfig(DEFAULT_CONFIG);
chrome.storage.local.get({ geoblockConfig: fallbackConfig }, (result) => {
  console.log("get geoblockConfig:", result.geoblockConfig);
  handleConfigUpdate(result.geoblockConfig);
});

// Update when config changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.geoblockConfig) {
    return;
  }
  handleConfigUpdate(changes.geoblockConfig.newValue);
});

// Listen for rate limit events from inject.js via DOM events
document.addEventListener('geoblock-rate-limit', (event) => {
  const action = event.detail?.action;
  console.log("Rate limit event received:", action);
  
  if (action === 'disable_tracking') {
    const resetTimestamp = event.detail?.resetTimestamp;
    chrome.storage.local.get({ geoblockConfig: DEFAULT_CONFIG }, (result) => {
      const currentConfig = normalizeConfig(result.geoblockConfig);
      const updatedConfig = {
        trackingEnabled: false,
        blockingEnabled: currentConfig.blockingEnabled,
        blockedLocations: currentConfig.blockedLocations
      };
      chrome.storage.local.set({ geoblockConfig: updatedConfig }, () => {
        console.log("Tracking disabled due to rate limit, storage updated");
        // Force a config update to content.js as well
        handleConfigUpdate(updatedConfig);
        
        // Create alarm to re-enable tracking at reset time
        if (resetTimestamp) {
          const resetTime = parseInt(resetTimestamp, 10);
          const now = Math.floor(Date.now() / 1000);
          const when = resetTime * 1000; // Convert to milliseconds
          
          // Clear any existing alarm
          chrome.alarms.clear('geoblock-rate-limit-reset', () => {
            // Create new alarm for reset time
            chrome.alarms.create('geoblock-rate-limit-reset', {
              when: when
            });
            console.log(`Alarm set to re-enable tracking at ${new Date(when).toLocaleString()}`);
          });
        }
      });
    });
  } else if (action === 'enable_tracking') {
    // Clear any pending alarm since we're manually enabling
    chrome.alarms.clear('geoblock-rate-limit-reset');
    
    chrome.storage.local.get({ geoblockConfig: DEFAULT_CONFIG }, (result) => {
      const currentConfig = normalizeConfig(result.geoblockConfig);
      const updatedConfig = {
        trackingEnabled: true,
        blockingEnabled: currentConfig.blockingEnabled,
        blockedLocations: currentConfig.blockedLocations
      };
      chrome.storage.local.set({ geoblockConfig: updatedConfig }, () => {
        console.log("Tracking re-enabled after rate limit cooldown");
        // Force a config update to content.js as well
        handleConfigUpdate(updatedConfig);
      });
    });
  }
});

