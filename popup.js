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
    .map((loc) => (loc || "").toString().trim().toUpperCase())
    .filter((loc, index, self) => loc && self.indexOf(loc) === index);

  return { trackingEnabled, blockingEnabled, blockedLocations: normalizedBlocked };
};

let state = normalizeConfig(DEFAULT_CONFIG);

const trackingToggleEl = document.getElementById("tracking-toggle");
const blockingToggleEl = document.getElementById("blocking-toggle");
const formEl = document.getElementById("block-form");
const inputEl = document.getElementById("location-input");
const listEl = document.getElementById("blocked-list");

const renderBlockedList = () => {
  listEl.innerHTML = "";
  if (!state.blockedLocations.length) {
    const empty = document.createElement("div");
    empty.className = "chips__empty";
    empty.textContent = "No locations blocked";
    listEl.appendChild(empty);
    return;
  }

  state.blockedLocations.forEach((location) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = location;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("data-remove-location", location);
    removeButton.setAttribute("aria-label", `Remove ${location}`);
    removeButton.textContent = "×";

    chip.appendChild(removeButton);
    listEl.appendChild(chip);
  });
};

const render = () => {
  console.log("Popup render - trackingEnabled:", state.trackingEnabled, "blockingEnabled:", state.blockingEnabled);
  trackingToggleEl.checked = state.trackingEnabled;
  blockingToggleEl.checked = state.blockingEnabled;
  // Form is always enabled - you can manage the block list regardless of blocking toggle
  inputEl.disabled = false;
  formEl.querySelector("button").disabled = false;
  renderBlockedList();
};

const persistState = () => {
  const configToSave = {
    trackingEnabled: state.trackingEnabled,
    blockingEnabled: state.blockingEnabled,
    blockedLocations: [...state.blockedLocations],
  };

  chrome.storage.local.set({ geoblockConfig: configToSave }, () => {
    if (chrome.runtime.lastError) {
      console.error("Failed to save GeoBlock config", chrome.runtime.lastError);
    }
  });
};

const init = () => {
  chrome.storage.local.get({ geoblockConfig: DEFAULT_CONFIG }, (result) => {
    state = normalizeConfig(result.geoblockConfig);
    render();
  });
};

trackingToggleEl.addEventListener("change", () => {
  state.trackingEnabled = trackingToggleEl.checked;
  render();
  persistState();
});

blockingToggleEl.addEventListener("change", () => {
  state.blockingEnabled = blockingToggleEl.checked;
  render();
  persistState();
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = (inputEl.value || "").trim();
  if (!value) {
    return;
  }
  const normalized = value.toUpperCase();
  inputEl.value = "";
  if (state.blockedLocations.includes(normalized)) {
    return;
  }
  state.blockedLocations.push(normalized);
  state.blockedLocations.sort();
  render();
  persistState();
});

listEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-remove-location]");
  if (!target) {
    return;
  }
  const location = target.getAttribute("data-remove-location");
  state.blockedLocations = state.blockedLocations.filter(
    (entry) => entry !== location
  );
  render();
  persistState();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.geoblockConfig) {
    return;
  }
  console.log("Popup: storage changed, new value:", changes.geoblockConfig.newValue);
  state = normalizeConfig(changes.geoblockConfig.newValue);
  render();
});

// Also poll storage periodically to catch any missed updates (fallback)
setInterval(() => {
  chrome.storage.local.get({ geoblockConfig: DEFAULT_CONFIG }, (result) => {
    const storedConfig = normalizeConfig(result.geoblockConfig);
    // Only update if different to avoid unnecessary re-renders
    if (storedConfig.trackingEnabled !== state.trackingEnabled || 
        storedConfig.blockingEnabled !== state.blockingEnabled) {
      console.log("Popup: polling detected change, updating state");
      state = storedConfig;
      render();
    }
  });
}, 1000); // Check every second

init();
