// ========== Intercept XMLHttpRequest ==========
(function () {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  
    let currentUrl = "";
    let xClientTransactionId = "";
    let xpForward = "";
    let headerStore = {};

    let token = "";
    let csrfToken = "";
    let aboutAccountQueryId = "";
    let aboutAccountQueryIdPromise = null;
    let tweetProcessingIntervalId = null;
    let mutationObserver = null;
    let processingTimeoutId = null;
    let scrollHandler = null;
    const geoColorPalette = [
        "#FF6B6B",
        "#FFA726",
        "#AB47BC",
        "#29B6F6",
        "#66BB6A",
        "#EC407A",
        "#26C6DA",
        "#EF6C00",
        "#8D6E63",
        "#7E57C2"
    ];
    let geoblockConfig = {
        trackingEnabled: true,
        blockingEnabled: true,
        blockedLocations: []
    };

    // Cache system for user locations (using localStorage)
    const CACHE_KEY = 'geoblock_user_locations';
    const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    
    // Cache statistics
    let cacheHitCount = 0;
    let cacheMissCount = 0;

    function getUserLocationCache() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (e) {
            console.warn("Failed to read location cache:", e);
        }
        return {};
    }
    
    function logCacheStats() {
        const cache = getUserLocationCache();
        const cacheSize = Object.keys(cache).length;
        const totalRequests = cacheHitCount + cacheMissCount;
        const hitRate = totalRequests > 0 ? ((cacheHitCount / totalRequests) * 100).toFixed(1) : 0;
        
        console.log(`%c[GEOBLOCK CACHE STATS]`, 'color: #4CAF50; font-weight: bold;');
        console.log(`  Cache size: ${cacheSize} users`);
        console.log(`  Cache hits: ${cacheHitCount}`);
        console.log(`  Cache misses: ${cacheMissCount}`);
        console.log(`  Hit rate: ${hitRate}%`);
    }

    function saveUserLocationCache(cache) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.warn("Failed to save location cache:", e);
            // If storage is full, clear old entries
            if (e.name === 'QuotaExceededError') {
                clearOldCacheEntries();
            }
        }
    }

    function clearOldCacheEntries() {
        const cache = getUserLocationCache();
        const now = Date.now();
        const cleaned = {};
        let removed = 0;
        
        for (const [username, data] of Object.entries(cache)) {
            if (now - data.timestamp < CACHE_DURATION_MS) {
                cleaned[username] = data;
            } else {
                removed++;
            }
        }
        
        if (removed > 0) {
            console.log(`Cleared ${removed} expired cache entries`);
            saveUserLocationCache(cleaned);
        }
    }

    function getCachedLocation(username) {
        const cache = getUserLocationCache();
        const usernameLower = username.toLowerCase();
        const cached = cache[usernameLower];
        
        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < CACHE_DURATION_MS) {
                cacheHitCount++;
                console.log(`%c[CACHE HIT]`, 'color: #4CAF50; font-weight: bold;', `${username}: ${cached.location}`);
                // Log stats every 10 cache hits
                if (cacheHitCount % 10 === 0) {
                    logCacheStats();
                }
                return cached.location;
            } else {
                // Cache expired, remove it
                delete cache[usernameLower];
                saveUserLocationCache(cache);
                cacheMissCount++;
                console.log(`%c[CACHE MISS - EXPIRED]`, 'color: #FF9800; font-weight: bold;', `${username}`);
            }
        } else {
            cacheMissCount++;
            console.log(`%c[CACHE MISS]`, 'color: #FF9800; font-weight: bold;', `${username}`);
        }
        return null;
    }

    function saveCachedLocation(username, location) {
        const cache = getUserLocationCache();
        const usernameLower = username.toLowerCase();
        cache[usernameLower] = {
            location: location,
            timestamp: Date.now()
        };
        saveUserLocationCache(cache);
        console.log(`%c[CACHE SAVED]`, 'color: #2196F3; font-weight: bold;', `${username}: ${location}`);
        
        // Log stats every 10 saves
        const cacheSize = Object.keys(cache).length;
        if (cacheSize % 10 === 0) {
            logCacheStats();
        }
    }

    // Clean old cache entries on startup
    clearOldCacheEntries();
    
    // Log initial cache stats
    setTimeout(() => {
        logCacheStats();
    }, 1000);

    function normalizeConfigInput(config = {}) {
        // Handle migration from old config format
        let trackingEnabled = config.trackingEnabled;
        let blockingEnabled = config.blockingEnabled;
        
        if (typeof config.enabled === 'boolean') {
            // Migrate old config
            trackingEnabled = config.enabled;
            blockingEnabled = config.enabled;
        } else {
            trackingEnabled = typeof trackingEnabled === 'boolean' ? trackingEnabled : (geoblockConfig.trackingEnabled !== undefined ? geoblockConfig.trackingEnabled : true);
            blockingEnabled = typeof blockingEnabled === 'boolean' ? blockingEnabled : (geoblockConfig.blockingEnabled !== undefined ? geoblockConfig.blockingEnabled : true);
        }
        
        const blockedLocationsSource = Array.isArray(config.blockedLocations) ? config.blockedLocations : geoblockConfig.blockedLocations;
        const blockedLocations = blockedLocationsSource
            .map(entry => (entry || '').toString().trim().toUpperCase())
            .filter((entry, index, array) => entry && array.indexOf(entry) === index);
        return { trackingEnabled, blockingEnabled, blockedLocations };
    }

    function isLocationBlocked(location) {
        console.log("isLocationBlocked:", location, geoblockConfig.blockedLocations);
        if (!location) {
            return false;
        }
        const upperLocation = location.toUpperCase();
        return geoblockConfig.blockedLocations.some((blockedEntry) =>
            upperLocation.includes(blockedEntry)
        );

    }

    function applyBlockOverlay(tweet, location) {
        if (!tweet) {
            return;
        }
        let overlay = tweet.querySelector('[data-geoblock-block-overlay]');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.setAttribute('data-geoblock-block-overlay', 'true');
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.background = 'rgba(244, 67, 54, 0.95)';
            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.fontSize = '20px';
            overlay.style.fontWeight = '800';
            overlay.style.letterSpacing = '0.18em';
            overlay.style.color = '#FFFFFF';
            overlay.style.zIndex = '2147483646';
            overlay.style.borderRadius = 'inherit';
            overlay.style.textAlign = 'center';
            overlay.style.pointerEvents = 'auto';
            overlay.style.cursor = 'not-allowed';
            overlay.style.textTransform = 'uppercase';
            if (!tweet.dataset.geoblockOriginalPosition) {
                tweet.dataset.geoblockOriginalPosition = tweet.style.position || '';
                if (getComputedStyle(tweet).position === 'static') {
                    tweet.style.position = 'relative';
                }
            }
            tweet.appendChild(overlay);
        }
        overlay.textContent = `✕ ${location.toUpperCase()} ✕`;
        tweet.setAttribute('data-geoblock-blocked', 'true');
    }

    function removeBlockOverlay(tweet) {
        const overlay = tweet?.querySelector('[data-geoblock-block-overlay]');
        if (overlay) {
            overlay.remove();
        }
        if (tweet?.dataset?.geoblockOriginalPosition !== undefined) {
            tweet.style.position = tweet.dataset.geoblockOriginalPosition;
            delete tweet.dataset.geoblockOriginalPosition;
        }
        tweet?.removeAttribute?.('data-geoblock-blocked');
    }

    function updateBlockedState(tweet, location) {
        if (!geoblockConfig.blockingEnabled) {
            removeBlockOverlay(tweet);
            return;
        }
        if (isLocationBlocked(location)) {
            applyBlockOverlay(tweet, location);
        } else {
            removeBlockOverlay(tweet);
        }
    }

    function applyBlockedStateAcrossTweets() {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach((tweet) => {
            const location = tweet.getAttribute('data-account-based-in');
            if (!location) {
                removeBlockOverlay(tweet);
                return;
            }
            updateBlockedState(tweet, location);
        });
    }

    function stopTweetProcessingLoop() {
        if (tweetProcessingIntervalId) {
            clearInterval(tweetProcessingIntervalId);
            tweetProcessingIntervalId = null;
        }
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
        if (processingTimeoutId) {
            clearTimeout(processingTimeoutId);
            processingTimeoutId = null;
        }
        if (scrollHandler) {
            window.removeEventListener('scroll', scrollHandler);
            if (scrollHandler.timeout) {
                clearTimeout(scrollHandler.timeout);
            }
            scrollHandler = null;
        }
        // Mark any pending tweets as disabled to prevent them from being processed
        const pendingTweets = document.querySelectorAll('article[data-testid="tweet"][data-geoblock-status="pending"]');
        pendingTweets.forEach((tweet) => {
            tweet.setAttribute('data-geoblock-status', 'disabled');
        });
    }

    function applyConfigUpdate(update = {}) {
        const normalized = normalizeConfigInput(update);
        geoblockConfig = normalized;
        console.log("applyConfigUpdate - trackingEnabled:", geoblockConfig.trackingEnabled, "tokens:", !!token, !!csrfToken);
        if (!geoblockConfig.trackingEnabled) {
            stopTweetProcessingLoop();
        } else {
            // Tracking is enabled - start loop if tokens are available
            if (token && csrfToken) {
                startTweetProcessingLoop();
            }
            // If tokens aren't available yet, the existing interval will start the loop when they become available
        }
        applyBlockedStateAcrossTweets();
    }

    // Listen for config updates from content.js via postMessage
    window.addEventListener('message', (event) => {
        // Only accept messages from the same window
        if (event.source !== window) {
            return;
        }
        
        if (event.data && event.data.type === 'GEOBLOCK_CONFIG_UPDATE') {
            console.log("inject.js received config update:", event.data.config);
            applyConfigUpdate(event.data.config || {});
        }
    });
    
    // setInterval(() => {
    //     applyConfigUpdate(window.__GEOBLOCK_INITIAL_CONFIG__ || {});
    // }, 500)    

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      currentUrl = url;

      headerStore = {}; // reset per request
  
      return originalOpen.call(this, method, url, ...rest);
    };
  
    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
      headerStore[header] = value;
  
      return originalSetRequestHeader.call(this, header, value);
    };
  
    XMLHttpRequest.prototype.send = function (body) {
        if (token && csrfToken) {
            return originalSend.call(this, body);
        } else {
            console.log("%c[XHR SEND]", "color: #66bb6a", "URL:", currentUrl, "Headers:", headerStore, "Body:", body);
            if (headerStore.authorization) {
              console.log("authorization (XHR):", headerStore.authorization);
              if (headerStore.authorization.includes("Bearer")) {
                  token = headerStore.authorization.split(" ")[1];
              }
              if (headerStore['x-csrf-token']) {
                  csrfToken = headerStore['x-csrf-token'];
              }
              if (headerStore['x-client-transaction-id']) {
                xClientTransactionId = headerStore['x-client-transaction-id'];
              }
              if (headerStore['x-xp-forwarded-for']) {
                xpForward = headerStore['x-xp-forwarded-for'];
              }
            }
            return originalSend.call(this, body);
        }
      
    };

    function hashStringToInt(value) {
        let hash = 0;
        for (let i = 0; i < value.length; i++) {
            hash = (hash << 5) - hash + value.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    function getColorForLocation(location) {
        if (!location) {
            return "#546E7A";
        }
        const hash = hashStringToInt(location);
        return geoColorPalette[hash % geoColorPalette.length];
    }

    function applyLocationTag(tweet, location) {
        if (!location) {
            return;
        }

        const uppercaseLocation = location.toUpperCase();
        const color = getColorForLocation(uppercaseLocation);
        const userNameContainer = tweet.querySelector('div[data-testid="User-Name"]');

        if (!userNameContainer) {
            return;
        }

        let badge = userNameContainer.querySelector('[data-geoblock-location]');
        if (!badge) {
            badge = document.createElement('span');
            badge.setAttribute('data-geoblock-location', 'true');
            badge.style.marginLeft = '8px';
            badge.style.padding = '2px 10px';
            badge.style.borderRadius = '999px';
            badge.style.fontSize = '11px';
            badge.style.fontWeight = '700';
            badge.style.letterSpacing = '0.08em';
            badge.style.display = 'inline-flex';
            badge.style.alignItems = 'center';
            userNameContainer.appendChild(badge);
        }

        badge.textContent = uppercaseLocation;
        badge.style.backgroundColor = color;
        badge.style.color = '#FFFFFF';
        badge.style.boxShadow = `0 2px 8px ${color}66`;

        tweet.style.borderRadius = '16px';
        tweet.style.marginTop = '3px';
        tweet.style.boxShadow = `0 0 0 3px ${color}AA, 0 8px 24px ${color}33`;
        tweet.setAttribute('data-geoblock-highlight', color);
        updateBlockedState(tweet, uppercaseLocation);
    }

    async function ensureAboutAccountQueryId() {
        if (aboutAccountQueryId) {
            return aboutAccountQueryId;
        }
        if (aboutAccountQueryIdPromise) {
            return aboutAccountQueryIdPromise;
        }

        const metadataUrl = "https://abs.twimg.com/responsive-web/client-web/shared~bundle.UserAbout~loader.AboutAccount.3b6723aa.js";
        aboutAccountQueryIdPromise = fetch(metadataUrl, {
            method: "GET",
            mode: "cors",
            headers: {
                "Accept": "application/javascript",
                "Accept-Encoding": "gzip, deflate, br"
            }
        }).then(async (response) => {
            const js = await response.text();
            const match = js.match(/params\s*:\s*\{[\s\S]*?id\s*:\s*"([^"]+)"[\s\S]*?name\s*:\s*"AboutAccountQuery"[\s\S]*?\}/);
            if (match) {
                console.log("Extracted ID:", match[1]);
                aboutAccountQueryId = match[1];
            } else {
                console.warn("cannot find graphqlId in metadata");
                aboutAccountQueryId = "";
            }
            return aboutAccountQueryId;
        }).catch((error) => {
            console.error("Failed to fetch AboutAccount metadata", error);
            aboutAccountQueryIdPromise = null;
            return "";
        });

        return aboutAccountQueryIdPromise;
    }

    // Notification system for rate limit errors
    function showRateLimitNotification(resetTimestamp) {
        // Remove any existing notification
        const existing = document.getElementById('geoblock-rate-limit-notification');
        if (existing) {
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.id = 'geoblock-rate-limit-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            max-width: 400px;
            line-height: 1.6;
        `;
        
        // Calculate time until reset
        const now = Math.floor(Date.now() / 1000);
        const resetTime = parseInt(resetTimestamp, 10);
        const secondsUntilReset = Math.max(0, resetTime - now);
        const minutesUntilReset = Math.ceil(secondsUntilReset / 60);
        
        // Format reset time
        const resetDate = new Date(resetTime * 1000);
        const resetTimeString = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Create notification content
        const content = document.createElement('div');
        content.innerHTML = `
            <div style="font-size: 16px; margin-bottom: 8px;">TIMELINE CLEANER RATE LIMITED</div>
            <div style="font-size: 13px; font-weight: 400; opacity: 0.95;">
                Tracking disabled. Resets in ${minutesUntilReset} minute${minutesUntilReset !== 1 ? 's' : ''}<br>
                Reset time: ${resetTimeString}
            </div>
        `;
        notification.appendChild(content);
        
        document.body.appendChild(notification);
        
        // Update countdown every second
        const countdownInterval = setInterval(() => {
            const now = Math.floor(Date.now() / 1000);
            const secondsUntilReset = Math.max(0, resetTime - now);
            const minutesUntilReset = Math.ceil(secondsUntilReset / 60);
            
            if (secondsUntilReset <= 0) {
                clearInterval(countdownInterval);
                if (notification.parentNode) {
                    notification.style.opacity = '0';
                    notification.style.transition = 'opacity 0.3s ease';
                    setTimeout(() => notification.remove(), 300);
                }
                return;
            }
            
            const resetDate = new Date(resetTime * 1000);
            const resetTimeString = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            content.innerHTML = `
                <div style="font-size: 16px; margin-bottom: 8px;">GEO BLOCK RATE LIMITED</div>
                <div style="font-size: 13px; font-weight: 400; opacity: 0.95;">
                    Tracking disabled. Resets in ${minutesUntilReset} minute${minutesUntilReset !== 1 ? 's' : ''}<br>
                    Reset time: ${resetTimeString}
                </div>
            `;
        }, 1000);
        
        // Auto-remove after reset time passes
        const timeUntilReset = (resetTime - now) * 1000;
        setTimeout(() => {
            if (notification.parentNode) {
                clearInterval(countdownInterval);
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, timeUntilReset + 1000);
    }

    // Function to disable tracking until rate limit resets
    function disableTrackingUntilReset(resetTimestamp) {
        // Update config locally
        geoblockConfig.trackingEnabled = false;
        
        // Stop processing
        stopTweetProcessingLoop();
        
        // Show notification with countdown
        showRateLimitNotification(resetTimestamp);
        
        // Dispatch a custom DOM event that content.js can listen to
        // This is the only way to communicate from page context to content script context
        const event = new CustomEvent('geoblock-rate-limit', {
            detail: { action: 'disable_tracking', resetTimestamp: resetTimestamp },
            bubbles: true
        });
        document.dispatchEvent(event);
        
        // Also trigger a config update event so inject.js knows the state changed
        applyConfigUpdate({ trackingEnabled: false });
        
        // Note: Re-enabling is handled by background.js alarm, so no setTimeout needed here
    }

    async function fetchAboutAccount(tweet, username) {
        // Check tracking enabled first - don't even log if disabled
        if (!geoblockConfig.trackingEnabled) {
            tweet.setAttribute('data-geoblock-status', 'disabled');
            return;
        }
        
        // Check if location is already set on the tweet
        if (tweet.getAttribute("data-account-based-in")) {
            applyLocationTag(tweet, tweet.getAttribute("data-account-based-in"));
            tweet.setAttribute('data-geoblock-status', 'complete');
            return;
        }
        
        // Check cache first
        const cachedLocation = getCachedLocation(username);
        if (cachedLocation) {
            tweet.setAttribute("data-account-based-in", cachedLocation);
            applyLocationTag(tweet, cachedLocation);
            tweet.setAttribute('data-geoblock-status', 'complete');
            return;
        }
        
        // No cache, need to fetch from API
        if (!token || !csrfToken) {
            tweet.setAttribute('data-geoblock-status', 'disabled');
            return;
        }
        
        console.log("fetching about account for username:", username);
        
        const features = encodeURIComponent(JSON.stringify({
                view_counts_everywhere_api_enabled: true,
                responsive_web_edit_tweet_api_enabled: true,
                tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
                verified_phone_label_enabled: false,
                responsive_web_twitter_article_tweet_consumption_enabled: true,
                responsive_web_jetfuel_frame: true,
                tweet_awards_web_tipping_enabled: false,
                graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                longform_notetweets_consumption_enabled: true,
                responsive_web_grok_show_grok_translated_post: true,
                standardized_nudges_misinfo: true,
                communities_web_enable_tweet_community_results_fetch: true,
                responsive_web_profile_redirect_enabled: false,
                responsive_web_grok_analysis_button_from_backend: true,
                rweb_tipjar_consumption_enabled: true,
                responsive_web_grok_share_attachment_enabled: true,
                responsive_web_grok_community_note_auto_translation_is_enabled: false,
                c9s_tweet_anatomy_moderator_badge_enabled: true,
                responsive_web_grok_analyze_button_fetch_trends_enabled: false,
                responsive_web_enhance_cards_enabled: false,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                longform_notetweets_inline_media_enabled: true,
                responsive_web_grok_image_annotation_enabled: true,
                longform_notetweets_rich_text_read_enabled: true,
                articles_preview_enabled: true,
                responsive_web_grok_analyze_post_followups_enabled: true,
                rweb_video_screen_enabled: false,
                responsive_web_grok_imagine_annotation_enabled: true,
                profile_label_improvements_pcf_label_in_post_enabled: true,
                creator_subscriptions_tweet_preview_api_enabled: true,
                freedom_of_speech_not_reach_fetch_enabled: true,
                creator_subscriptions_quote_tweet_preview_enabled: false,
                premium_content_api_read_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true
            }));
            
            if (!geoblockConfig.trackingEnabled) {
                tweet.setAttribute('data-geoblock-status', 'disabled');
                return;
            }
            
            const graphqlId = await ensureAboutAccountQueryId();
            if (!graphqlId) {
                tweet.setAttribute('data-geoblock-status', 'failed');
                return;
            }
            
            const url =
                `https://x.com/i/api/graphql/${graphqlId}/AboutAccountQuery?variables=` +
                encodeURIComponent(JSON.stringify({ screenName: username.toLowerCase() })) +
                `&features=${features}`;
            
            try {
                // Final check before making the request
                if (!geoblockConfig.trackingEnabled || !token || !csrfToken) {
                    tweet.setAttribute('data-geoblock-status', 'disabled');
                    return;
                }
                const response = await fetch(url, {
                    "method": "GET",
                    "credentials": "include",
                    "headers": {
                      "accept": "*/*",
                      "content-type": "application/json",
                      "authorization": `Bearer ${token}`,
                      "x-csrf-token": csrfToken,
                      "x-twitter-active-user": "yes",
                      "x-twitter-auth-type": "OAuth2Session",
                    //   "x-client-transaction-id": xClientTransactionId,
                      "x-xp-forwarded-for": xpForward,
                      "x-twitter-client-language": "en",
                      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
                      "sec-fetch-site": "same-origin",
                      "sec-fetch-mode": "cors",
                      "sec-fetch-dest": "empty",
                    }
                });
                
                // Check for 429 rate limit error
                if (response.status === 429) {
                    // Read rate limit headers
                    const rateLimitReset = response.headers.get('x-rate-limit-reset');
                    const rateLimitLimit = response.headers.get('x-rate-limit-limit');
                    const rateLimitRemaining = response.headers.get('x-rate-limit-remaining');
                    
                    console.warn("Rate limit (429) detected", {
                        reset: rateLimitReset,
                        limit: rateLimitLimit,
                        remaining: rateLimitRemaining
                    });
                    
                    if (rateLimitReset) {
                        disableTrackingUntilReset(rateLimitReset);
                    } else {
                        // Fallback to 15 minutes if no reset header
                        const fallbackReset = Math.floor(Date.now() / 1000) + (15 * 60);
                        disableTrackingUntilReset(fallbackReset.toString());
                    }
                    
                    tweet.setAttribute('data-geoblock-status', 'rate-limited');
                    return;
                }
                
                // Check if response is ok before parsing JSON
                if (!response.ok) {
                    console.error("Failed to fetch account info:", response.status, response.statusText);
                    tweet.setAttribute('data-geoblock-status', 'failed');
                    return;
                }
                
                const data = await response.json();
                console.log("data:", data); 
              /* 

              {
    "data": {
        "user_result_by_screen_name": {
            "result": {
                "__typename": "User",
                "avatar": {
                    "image_url": "https://pbs.twimg.com/profile_images/1985475395416723456/P0fkXUnr_normal.jpg"
                },
                "core": {
                    "screen_name": "astraiaintel",
                    "name": "Astraia \uD83C\uDDFA\uD83C\uDDE6\uD83C\uDDEA\uD83C\uDDFA",
                    "created_at": "Sun Apr 23 12:24:34 +0000 2023"
                },
                "profile_image_shape": "Circle",
                "verification": {
                    "verified": false
                },
                "affiliates_highlighted_label": {},
                "is_blue_verified": true,
                "privacy": {
                    "protected": false
                },
                "about_profile": {
                    "account_based_in": "Europe",
                            "location_accurate": true,
                            "learn_more_url": "https://help.twitter.com/managing-your-account/about-twitter-verified-accounts",
                            "source": "Europe App Store",
                            "username_changes": {
                                "count": "8",
                                "last_changed_at_msec": "1760690495816"
                            }
                        },
                        "rest_id": "1650113387320209413",
                        "verification_info": {
                            "reason": {
                                "verified_since_msec": "1733495793364"
                            },
                            "id": "VXNlclZlcmlmaWNhdGlvbkluZm86MTY1MDExMzM4NzMyMDIwOTQxMw=="
                        },
                        "identity_profile_labels_highlighted_label": {},
                        "id": "VXNlcjoxNjUwMTEzMzg3MzIwMjA5NDEz"
                    },
                    "id": "VXNlclJlc3VsdHM6MTY1MDExMzM4NzMyMDIwOTQxMw=="
                }
            }
        }
    */
                const account_based_in = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in;
                console.log("username:", username, "account_based_in:", account_based_in);
                
                // Save to cache and apply location
                const locationToSave = account_based_in || 'UNKNOWN';
                saveCachedLocation(username, locationToSave);
                
                tweet.setAttribute("data-account-based-in", locationToSave);
                applyLocationTag(tweet, locationToSave);
                tweet.setAttribute('data-geoblock-status', 'complete');
            } catch (error) {
                console.error("failed to fetch account info for", username, error);
                tweet.setAttribute('data-geoblock-status', 'failed');
            }
    }

    // Helper function to check if any part of an element is in the viewport
    function isInViewport(element) {
        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        
        // Check if ANY part of the element is visible in viewport
        return (
            rect.bottom > 0 &&           // Bottom edge is below top of viewport
            rect.right > 0 &&            // Right edge is to the right of left of viewport
            rect.top < viewportHeight && // Top edge is above bottom of viewport
            rect.left < viewportWidth &&  // Left edge is to the left of right of viewport
            rect.height > 0 &&           // Element must have height
            rect.width > 0                // Element must have width
        );
    }

    function processFeedAboutAccounts() {
        if (!token || !csrfToken || !geoblockConfig.trackingEnabled) {
            return;
        }
        const allTweets = document.querySelectorAll("article[data-testid=\"tweet\"]");
        if (!allTweets.length) {
            return;
        }

        let processedAny = false;
        for (const tweet of allTweets) {
            if (tweet.getAttribute('data-geoblock-status')) {
                continue;
            }

            // ONLY process tweets that are actually in the viewport
            if (!isInViewport(tweet)) {
                continue;
            }

            const usernameLink = tweet.querySelector("div[data-testid=\"User-Name\"] a");
            if (!usernameLink) {
                // Wait a bit for the DOM to be ready
                continue;
            }

            const parts = usernameLink.getAttribute("href").split("/").filter(Boolean);
            const username = parts[0] ? parts[0].toLowerCase() : "";
            if (!username) {
                tweet.setAttribute('data-geoblock-status', 'skipped');
                continue;
            }

            processedAny = true;
            tweet.setAttribute('data-geoblock-status', 'pending');
            fetchAboutAccount(tweet, username).catch((err) => {
                console.error("fetchAboutAccount threw for", username, err);
                tweet.setAttribute('data-geoblock-status', 'failed');
            });
        }
        return processedAny;
    }

    // Debounced processing function to batch multiple tweet additions
    function scheduleProcessing() {
        // Don't schedule if tracking disabled
        if (!geoblockConfig.trackingEnabled || !token || !csrfToken) {
            return;
        }
        if (processingTimeoutId) {
            clearTimeout(processingTimeoutId);
        }
        processingTimeoutId = setTimeout(() => {
            // Check again before processing (in case it was disabled while waiting)
            if (geoblockConfig.trackingEnabled && token && csrfToken) {
                processFeedAboutAccounts();
            }
            processingTimeoutId = null;
        }, 300); // Wait 300ms to batch multiple additions
    }

    function startTweetProcessingLoop() {
        if (mutationObserver || tweetProcessingIntervalId) {
            return;
        }

        // Process any existing tweets immediately (only if tracking enabled)
        if (geoblockConfig.trackingEnabled && token && csrfToken) {
            processFeedAboutAccounts();
        }

        // Use MutationObserver to watch for new tweets
        mutationObserver = new MutationObserver((mutations) => {
            if (!geoblockConfig.trackingEnabled || !token || !csrfToken) {
                return;
            }

            let hasNewTweets = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    // Check if the added node is a tweet or contains tweets
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches('article[data-testid="tweet"]')) {
                            hasNewTweets = true;
                            break;
                        }
                        if (node.querySelector && node.querySelector('article[data-testid="tweet"]')) {
                            hasNewTweets = true;
                            break;
                        }
                    }
                }
                if (hasNewTweets) break;
            }

            if (hasNewTweets) {
                scheduleProcessing();
            }
        });

        // Observe the main timeline container
        const observeTarget = document.body;
        if (observeTarget) {
            mutationObserver.observe(observeTarget, {
                childList: true,
                subtree: true
            });
        }

        // Add scroll handler to process tweets as they come into view
        scrollHandler = () => {
            if (!geoblockConfig.trackingEnabled || !token || !csrfToken) {
                return;
            }
            // Throttle scroll events
            if (scrollHandler.timeout) {
                clearTimeout(scrollHandler.timeout);
            }
            scrollHandler.timeout = setTimeout(() => {
                processFeedAboutAccounts();
            }, 300);
        };
        window.addEventListener('scroll', scrollHandler, { passive: true });

        // Fallback: check every 10 seconds for any missed tweets (much less frequent)
        tweetProcessingIntervalId = setInterval(() => {
            if (!geoblockConfig.trackingEnabled || !token || !csrfToken) {
                return;
            }
            // Only process if there are unprocessed tweets
            const unprocessedTweets = document.querySelectorAll(
                'article[data-testid="tweet"]:not([data-geoblock-status])'
            );
            if (unprocessedTweets.length > 0) {
                processFeedAboutAccounts();
            }
        }, 10000); // 10 seconds instead of 1 second
    }

    const interval = setInterval(async () => {
        if (token && csrfToken) {
            console.log("token and csrfToken found (XHR):", token, csrfToken);
            // Check if tracking is enabled and start the loop
            if (geoblockConfig.trackingEnabled) {
                startTweetProcessingLoop();
            }
            clearInterval(interval);
        }

    }, 100);
  })();
  
