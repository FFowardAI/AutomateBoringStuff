// Service Worker for Persistent Recording State
console.log("Background service worker started.");

// Define the structure of the state
interface RecordingState {
  isRecording: boolean;
  screenshots: string[];
}

// In-memory state. For more robust persistence (across browser restarts),
// consider chrome.storage.session or chrome.storage.local.
let state: RecordingState = {
  isRecording: false,
  screenshots: [], // Initially empty array of strings
};

let intervalId: number | null = null;
const CAPTURE_INTERVAL_MS = 1000;

/** 
 * Sends the current state to listening popup(s).
 * Handles potential errors if no popup is open.
 */
const sendStateUpdate = () => {
  chrome.runtime.sendMessage({ type: "state_update", payload: state }).catch(err => {
    // Ignore errors if no popup is listening - this is expected
    if (err.message !== "Could not establish connection. Receiving end does not exist.") {
      console.warn("Error sending state update:", err);
    }
  });
}

/**
 * Captures a frame of the currently active tab.
 */
const captureFrame = () => {
  if (!state.isRecording) {
    console.warn("captureFrame called but not recording. Stopping interval.");
    stopRecording(); // Ensure interval is cleared if state is inconsistent
    return;
  }

  // Find the active tab in the current window
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.error("Error querying tabs:", chrome.runtime.lastError.message);
      return; // Cannot proceed without a tab
    }
    if (tabs.length === 0 || tabs[0].id === undefined) {
      console.warn("No active tab found or tab has no ID.");
      return; // No active tab to capture
    }

    const targetTabId = tabs[0].id;

    // Capture the visible area of the target tab
    chrome.tabs.captureVisibleTab( // Note: captureVisibleTab uses the *current* window implicitly if windowId is omitted
      // We don't need to specify the windowId if we queried for the active tab in the current window.
      { format: 'png' },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error("Capture Error:", chrome.runtime.lastError.message);
          // Stop recording on persistent errors? Maybe add a counter?
          // For now, just log and skip frame.
          return;
        }
        // Check if still recording, might have been stopped between async calls
        if (!state.isRecording) {
          return;
        }
        if (dataUrl) {
          state.screenshots.push(dataUrl);
          sendStateUpdate(); // Send the updated state
        }
      }
    );
  });
};

/**
 * Starts the recording process.
 */
const startRecording = () => {
  if (state.isRecording) {
    console.warn("Recording already in progress.");
    return;
  }
  console.log("Starting recording...");
  // Reset state for a new recording session
  state = { isRecording: true, screenshots: [] };
  captureFrame(); // Capture the first frame immediately
  // Clear any residual interval before setting a new one
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(captureFrame, CAPTURE_INTERVAL_MS);
  sendStateUpdate(); // Notify popup about the new state
};

/**
 * Stops the recording process.
 * Returns the final state with the captured screenshots.
 */
const stopRecording = (): RecordingState => {
  if (!state.isRecording && intervalId === null) {
    console.warn("Recording not in progress.");
    // Return a non-recording state structure
    return { isRecording: false, screenshots: [] };
  }
  console.log("Stopping recording...");
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  // Create a snapshot of the final state before resetting
  const finalState: RecordingState = {
    isRecording: false, // Mark as not recording
    screenshots: [...state.screenshots] // Copy screenshots
  };
  // Reset the global state
  state = { isRecording: false, screenshots: [] };
  sendStateUpdate(); // Notify popup that recording has stopped
  return finalState; // Return the captured data
};

// --- Message Listener --- 

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);
  // Using a flag for async response is cleaner for future changes
  let sendResponseAsync = false;

  switch (message.type) {
    case "get_state":
      sendResponse(state);
      break;
    case "start_recording":
      startRecording();
      sendResponse(state); // Respond immediately with the current state
      break;
    case "stop_recording":
      const finalState = stopRecording();
      console.log(`Stopped recording. Collected ${finalState.screenshots.length} screenshots.`);
      sendResponse(finalState); // Respond with the final state including screenshots
      break;
    default:
      console.warn("Unknown message type received:", message.type);
      sendResponse({ error: "Unknown message type" });
  }

  // Return true if sendResponse will be called asynchronously later.
  // In this specific implementation, all responses are sent synchronously.
  return sendResponseAsync;
});

// --- Lifecycle Events --- 

// Optional: Log when the service worker becomes inactive
chrome.runtime.onSuspend.addListener(() => {
  console.log("Background service worker suspending.");
  // If recording is active, the interval *should* keep it alive.
  // If using chrome.storage, you might persist state here.
});

// Optional: Log when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed or updated.");
  // Register the side panel when the extension is installed
  if (chrome.sidePanel) {
    chrome.sidePanel.setOptions({
      enabled: true,
      path: 'dist/index.html'
    });
  }
});

// Handle browser action click to open the side panel
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    // Open the side panel in the current window
    chrome.sidePanel.open({
      windowId: tab.windowId
    });
  }
}); 