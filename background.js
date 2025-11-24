chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (!details.requestHeaders) return;
  
      for (const header of details.requestHeaders) {
        if (header.name.toLowerCase() === "header-blue") {
          console.log("HEADER-BLUE FOUND:", header.value, "URL:", details.url);
        }
      }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
  );

// Handle rate limit reset alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'geoblock-rate-limit-reset') {
    console.log('Rate limit reset time reached, re-enabling tracking');
    
    // Get current config and re-enable tracking
    chrome.storage.local.get({ geoblockConfig: {} }, (result) => {
      const currentConfig = result.geoblockConfig || {};
      const updatedConfig = {
        ...currentConfig,
        trackingEnabled: true
      };
      
      chrome.storage.local.set({ geoblockConfig: updatedConfig }, () => {
        console.log('Tracking re-enabled after rate limit reset');
      });
    });
  }
});  