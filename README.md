# Timeline Cleaner

Timeline Cleaner is a Chrome extension for directly labeling users in your X (formerly known as Twitter) timeline by their location and, if you'd like, blocking them. I built this after the feature was released because, well, it had to be done.

<div style="text-align: center; width: 100%;">
<img src="https://github.com/user-attachments/assets/c029148f-c0a9-40dc-a433-310dfaeb37e5" alt="crying guy" style="margin: 0 auto;"  width="200"/>
</div>

## Features
- Tags every tweet with a color-coded badge that shows the account's declared country/region (via the About Account GraphQL endpoint).
- Maintains a local cache of account → country lookups (with automatic cleanup) to minimize X API calls.
- Lets you keep tracking and blocking toggles independent—track without blocking or vice versa.
- Blocks by substring match on the country label, case-insensitive (`United States`, `united states`, or even `States` all match).
- Soft-blocks matched tweets by dropping their opacity to 0.1 so they're still scrollable but visually muted.
- Handles X rate limits: when the About Account endpoint returns `429`, the extension pauses tracking, displays a countdown toast, and automatically re-enables tracking once the reset window expires.

## Install & Load
1. Clone or download this repository.
2. Open Chrome (or any Chromium-based browser that supports Manifest V3 extensions).
3. Navigate to `chrome://extensions`.
4. Toggle **Developer mode** on (top-right).
5. Click **Load unpacked** and select this project folder (`geoblock`).
6. The "Timeline Cleaner" icon now appears in your toolbar; pin it for quick access.

## Configure the Extension
Open the popup (`Timeline Cleaner` → click the browser action) to adjust settings.

### Toggles
- **Enable location tracking**: Controls whether the extension fetches the About Account data needed to tag each tweet. When disabled, previously tagged tweets remain but no new requests are made.
- **Enable geoblocking**: Enables or disables the visual filtering logic. Suggested workflow is to leave tracking on yet turn blocking off while you build your allow/block list.

### Manage Blocked Locations
1. Type a country/region in the **Blocked locations** field. Matching is substring-based and case-insensitive, so enter whatever fragment is easiest (e.g., `russia`, `United stateS`).
2. Press **Add**. Duplicates are ignored automatically.
3. Use the `×` icon on each chip to remove it.
4. Changes persist instantly to `chrome.storage.local`.

### Blocking Behavior
Blocked tweets stay in the timeline but are set to `opacity: 0.1`, giving you context without fully removing content. Because the DOM attribute `data-account-based-in` remains on each tweet, you can target these elements with custom user CSS if you want to take the extra step and hide them completely.

## How It Works
- **content.js** injects `inject.js` early (`document_start`), forwards configuration updates, and applies the soft-block overlay loop that keeps opacity in sync.
- **inject.js** hooks into XHR to capture auth tokens, queries the About Account GraphQL endpoint, caches the `account_based_in` value, writes it to each tweet (`data-account-based-in`), and adds badges/borders for at-a-glance context.
- The popup UI (`popup.html` & `popup.js`) manages your settings with immediate feedback and listens for background changes.
- **background.js** listens for rate-limit alarms and unlocks tracking when the rest timer elapses.
- Every network lookup stays in your browser session, and location data is cached for 30 days in `localStorage` so subsequent runs barely hit the network.

## Tips & Best Practices
- Start with tracking ON and blocking OFF to populate location tags quickly before you curate a block list.
- Use broader substrings to catch related regions (e.g., add both `Russia` and `Russian Federation` if you see multiple formats).
- Watch the DevTools console for `[GEOBLOCK CACHE STATS]` logs to understand cache hit rates.
- If X rate-limits you, let the countdown finish or manually re-enable tracking in the popup once you know the cooldown passed.

## Troubleshooting
- **No badges appearing**: Confirm you're logged into X in the same browser profile and the extension is enabled. Tracking must be toggled on.
- **Blocked tweets still visible**: Ensure geoblocking is enabled and that the `Blocked locations` entry matches how X labels the country (`"United States"` vs `"USA"`). Because matching is substring-based, adding both variants is safe.
- **Rate-limit banner stuck**: Force-refresh X, reopen the popup, and toggle tracking off/on. Background alarms should also clear it automatically once the API reset time hits.

## Contributing / Extending
Pull requests are welcome. Ideas:
1. Expose a UI switch between soft/hard block modes (`display: none` vs `opacity`).
2. Sync block lists across devices via Chrome sync storage.
3. Add quick actions (mute/unmute) directly from each badge.
4. Ship a Firefox build using `manifest_version: 2` shim.

## License
MIT © Timeline Cleaner contributors.
