import React, { useState, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView'
import { RecordingView } from './components/RecordingView'
import { AuthView } from './components/AuthView'
import { AutoActionView } from './components/AutoActionView'
import { ShowScriptsView } from './components/ShowScriptsView'
import { LoadingView } from './components/LoadingView'

// Define expected state structure from background
interface BackgroundState {
  isRecording: boolean;
  screenshots: string[];
}

// Add Auth related types
interface User {
  id: string | null; // ID might be null if inferred from 409 conflict
  name: string;
  email: string;
  // Add other relevant user fields from your API response
}

// Type for the expected response when creating a recording
interface RecordingResponse {
  id: string;
  message?: string; // Add optional message for potential errors
}

// Add session response type
interface SessionResponse {
  id: string;
  user_id: string;
  // Add other fields returned by POST /api/sessions
  message?: string;
}

// Add type for the finalize endpoint response
interface FinalizeResponse {
  script?: {
    content: string;
  }; 
  message?: string;
}

// Script type
interface Script {
  id: string;
  session_id: string;
  content: string;
  status: string;
  created_at: string;
}

// Combine view states
type ViewState = 'authenticating' | 'authRequired' | 'loading' | 'empty' | 'recording' | 'processingAction' | 'error' | 'action' | 'browseScripts';

const API_BASE_URL = "https://faf7-65-112-8-50.ngrok-free.app"; // Define your backend URL
// AUTH_COOKIE_NAME is no longer checked here, but might still be relevant for backend interactions
// const AUTH_COOKIE_NAME = "auth_session";

// --- Helper Functions --- 

// Helper to convert data URL to Blob
function dataURLtoBlob(dataurl: string): Blob | null {
  try {
    const arr = dataurl.split(',');
    if (!arr[0]) return null;
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[arr.length - 1]); // Use arr.length - 1 to handle potential commas in data
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error("Error converting data URL to blob:", e);
    return null;
  }
}

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('authenticating'); // Start in authenticating state
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null); // State for backend recording ID
  const [sessionId, setSessionId] = useState<string | null>(null); // State for backend session ID
  const [isLoading, setIsLoading] = useState<boolean>(false); // Add loading state for uploads
  const [actionScript, setActionScript] = useState<string | null>(null); // State for the script content
  const [processingStep, setProcessingStep] = useState<number>(1); // Track script generation progress
  const [processingStatusText, setProcessingStatusText] = useState<string>(''); // Status text for LoadingView

  // --- Check Local Storage for Auth Details --- 
  useEffect(() => {
    const checkStoredAuth = async () => {
      console.log("Checking local storage for auth details...");
      try {
        // Check if user ID, name, and email exist in local storage
        const storedData = await chrome.storage.local.get(['userId', 'userName', 'userEmail']);

        if (storedData.userId && storedData.userName && storedData.userEmail) {
          console.log("Found stored user ID, name, and email:", storedData);
          // Create the user object directly from storage
          const user: User = {
            id: storedData.userId,
            name: storedData.userName,
            email: storedData.userEmail
          };
          setCurrentUser(user); // Set the current user state
          // User details found, now try to create/get session using the stored ID
          await createOrGetSession(user);
        } else {
          console.log("Stored user details incomplete or missing. Requiring auth.");
          // Require login/signup via AuthView
          setViewState('authRequired');
        }
      } catch (error) {
        console.error("Error checking local storage:", error);
        setErrorMessage("Error accessing extension storage.");
        setViewState('error');
      }
    };

    // Only run this check once when the component mounts and state is 'authenticating'
    if (viewState === 'authenticating') {
      checkStoredAuth();
    }
    // The dependency array is empty as we only want this to run on mount
    // We use the viewState check inside to prevent re-running after initial load.
  }, []); // Run only on mount

  // --- Communication with Background Script (Recording State) --- 

  const fetchStateFromBackground = useCallback(() => {
    if (viewState !== 'loading') return; // Only fetch if we are past auth

    chrome.runtime.sendMessage({ type: "get_state" }, (response: BackgroundState | { error: string }) => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching state:", chrome.runtime.lastError.message);
        setErrorMessage(`Error connecting to background: ${chrome.runtime.lastError.message}`);
        setViewState('error');
        return;
      }
      if (response && 'error' in response) {
        console.error("Error received from background:", response.error);
        setErrorMessage(`Background error: ${response.error}`);
        setViewState('error');
      } else if (response) {
        console.log("Received state from background:", response);
        setScreenshots(response.screenshots || []);
        setViewState(response.isRecording ? 'recording' : 'empty');
      } else {
        console.warn("Received empty response from background script.");
        setErrorMessage("Background script did not respond correctly.");
        setViewState('error');
      }
    });
  }, [viewState]);

  const handleConsume = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
      const tabId = tabs[0]?.id as number;
      if (!tabId) return;

      chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: "MAIN",
        func: () => {
          const selector = [
            "a[href]",
            "button",
            'input[type="button"]',
            'input[type="submit"]',
            '[role="button"]',
            "[onclick]",
          ].join(",");
          const elems = Array.from(
            document.querySelectorAll<HTMLElement>(selector)
          );
          if (!elems.length) {
            console.warn("No clickable elements found");
            return;
          }
          const rnd = elems[Math.floor(Math.random() * elems.length)];
          const evt = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          });
          rnd.dispatchEvent(evt);
          console.log(
            `⚡ clicked random <${rnd.tagName.toLowerCase()}#${rnd.id}>`
          );
        },
      });
    });
  }, []);

  // Effect to fetch initial recording state and listen for updates (only runs AFTER auth)
  useEffect(() => {
    // Only proceed if authenticated and ready to load recording state
    if (viewState === 'loading') {
      fetchStateFromBackground();
    }

    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      // Only process updates if we are in a post-auth state and not in the uploading state
      // Important: don't auto-transition from uploading state, as it should be controlled by the handleDoneClick flow
      if ((viewState === 'empty' || viewState === 'recording') && viewState !== 'processingAction') {
        if (message.type === "state_update") {
          console.log("Popup received state update:", message.payload);
          const newState: BackgroundState = message.payload;
          setScreenshots(newState.screenshots || []);
          setViewState(currentState => {
            const nextViewState = newState.isRecording ? 'recording' : 'empty';
            // Avoid flicker if state hasn't actually changed
            return currentState === nextViewState ? currentState : nextViewState;
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      console.log("Popup closed, listener removed.");
    };
    // Dependencies: viewState ensures listener re-registers if needed, fetchState included
  }, [viewState, fetchStateFromBackground]);

  // --- Helper Functions --- 

  // Function to create a backend session
  const createOrGetSession = async (user: User | null) => {
    console.log("Creating or getting session for user:", user);
    if (!user || !user.id) {
      console.error("Cannot create session: User ID is missing.");
      setErrorMessage("User information incomplete. Cannot start session. Please log in.");
      setViewState('authRequired');
      return;
    }

    console.log("Attempting to create backend session for user:", user.id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          context: "Started from Chrome Extension"
        })
      });

      const data: SessionResponse = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || `API Error: ${response.status}`);
      }
      if (!data.id) {
        throw new Error("Backend did not return a session ID.");
      }

      console.log("Backend session created successfully. ID:", data.id);
      setSessionId(data.id);
      setViewState('loading');

    } catch (error: any) {
      console.error("Error creating backend session:", error);
      setErrorMessage(`Failed to create session: ${error.message}`);
      setViewState('error');
    }
  };

  // --- Event Handlers --- 
  const handleAuthSuccess = async (userData: User) => {
    console.log("Authentication successful in parent:", userData);
    setCurrentUser(userData);
    // Now attempt to create the session
    await createOrGetSession(userData);
  };

  const handleRecordClick = () => {
    // Session ID is now required to create a recording
    if (!sessionId) {
      console.error("Cannot start recording: Session ID not available.");
      setErrorMessage("Session not initialized. Please restart the extension or log in again.");
      setViewState('error');
      return;
    }

    console.log("Sending start_recording message to background...");
    chrome.runtime.sendMessage({ type: "start_recording" }, async (response) => {
      if (chrome.runtime.lastError || (response && response.error)) {
        const errorMsg = chrome.runtime.lastError?.message || (response as { error: string })?.error || 'Unknown background start error';
        console.error("Error starting background recording:", errorMsg);
        setErrorMessage(`Failed to start local recording: ${errorMsg}`);
        setViewState('error');
        return;
      }

      console.log("Background recording started. Creating backend recording entry...");
      try {
        // Use sessionId, add start_time
        const apiResponse = await fetch(`${API_BASE_URL}/api/recordings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({
            session_id: sessionId, // Use the stored session ID
            start_time: new Date().toISOString(),
          })
        });

        const data: RecordingResponse = await apiResponse.json();
        console.log("API Recording response:", data);

        if (!apiResponse.ok) {
          throw new Error(data?.message || `API Error: ${apiResponse.status}`);
        }
        if (!data.id) {
          throw new Error("Backend did not return a recording ID.");
        }

        console.log("Backend recording created successfully. ID:", data.id);
        setRecordingId(data.id);

        // IMPORTANT: Store recording ID in chrome.storage for persistence
        try {
          await chrome.storage.local.set({ currentRecordingId: data.id });
          console.log("Saved recording ID to local storage:", data.id);
        } catch (storageError) {
          console.error("Failed to save recording ID to storage:", storageError);
        }

      } catch (apiError: any) {
        console.error("Error creating backend recording:", apiError);
        setErrorMessage(`Failed to create backend recording: ${apiError.message}`);
        setViewState('error');
      }
    });
  };

  const handleCancelClick = () => {
    console.log("Sending stop_recording message (Cancel)...");
    // Tell background to stop local recording
    chrome.runtime.sendMessage({ type: "stop_recording" });
    // Clear local recording ID state, don't finalize backend record
    setRecordingId(null);
    // Also clear from storage
    chrome.storage.local.remove(['currentRecordingId']);
    // UI update to 'empty' will come from background listener
    // setViewState('empty'); // Or set immediately for responsiveness
  };

  const handleDoneClick = async () => {
    const currentRecordingId = recordingId;
    const finalScreenshots = [...screenshots];

    console.log(`Stopping recording, preparing upload for ID: ${currentRecordingId}...`);

    chrome.runtime.sendMessage({ type: "stop_recording" });
    setRecordingId(null);
    setScreenshots([]);
    setActionScript(null);

    if (!currentRecordingId) {
      setViewState('empty');
      return;
    }
    if (finalScreenshots.length === 0) {
      setViewState('empty');
      return;
    }

    setIsLoading(true);
    setProcessingStatusText("Uploading screenshots...");
    setViewState('processingAction');

    const formData = new FormData();
    let conversionFailures = 0;
    let uploadSucceeded = false;

    console.log("Converting screenshots...");
    for (let i = 0; i < finalScreenshots.length; i++) {
      const screenshotDataUrl = finalScreenshots[i];
      const blob = dataURLtoBlob(screenshotDataUrl);

      if (blob) {
        formData.append('files', blob, `screenshot_${i + 1}.png`);
      } else {
        conversionFailures++;
      }
    }

    if (conversionFailures > 0) {
      console.warn(`Skipped ${conversionFailures} screenshots due to conversion errors.`);
    }

    const filesToUploadCount = formData.getAll('files').length;
    if (filesToUploadCount === 0) {
      console.warn("No valid screenshots to upload after conversion.");
      setErrorMessage("Failed to process screenshots for upload.");
      setViewState('error');
      throw new Error("No valid files to upload");
    } else {
      console.log(`Uploading ${filesToUploadCount} screenshots...`);
      try {
        console.log(`Making finalize request to: ${API_BASE_URL}/api/recordings/${currentRecordingId}/finalize`);

        setProcessingStep(2);

        await new Promise(resolve => setTimeout(resolve, 500));

        const uploadResponse = await fetch(`${API_BASE_URL}/api/recordings/${currentRecordingId}/finalize`, {
          method: 'POST',
          headers: {
            'ngrok-skip-browser-warning': 'true'
          },
          body: formData,
        });

        console.log("Batch upload response status:", uploadResponse.status);

        if (!uploadResponse.ok) {
          let errorText = `Status: ${uploadResponse.status}`;
          try { errorText = await uploadResponse.text(); } catch { /* ignore */ }
          console.error(`Failed to upload screenshot batch. Error: ${errorText}`);
          throw new Error(`Batch upload failed: ${errorText}`);
        } else {
          setProcessingStep(3);

          setProcessingStatusText("Processing recording...");

          const responseJson: FinalizeResponse = await uploadResponse.json();
          console.log("Batch upload response JSON:", responseJson);

          if (responseJson.script) {
            console.log("Script received, setting action state.");
            setProcessingStep(4);

            await new Promise(resolve => setTimeout(resolve, 800));

            console.log(`response: ${JSON.stringify(responseJson)}`);
            setActionScript(responseJson.script.content);
            setViewState('action');
            uploadSucceeded = true;
          } else {
            console.warn("Upload succeeded, but no valid script found in response.");
            setErrorMessage("Processing complete, but failed to retrieve action script.");
            setViewState('error');
          }
        }
      } catch (uploadError: any) {
        console.error(`Processing error:`, uploadError);
        setErrorMessage(uploadError.message || "An unknown error occurred during processing.");
        setViewState('error');
      } finally {
        setIsLoading(false);
        // State is now set explicitly within try/catch blocks for success/failure
        // No need to set state here unless there's a fallback needed
      }
    }
  };

  // TODO: Add a Logout handler that clears the cookie and resets state
  // const handleLogout = async () => { ... chrome.cookies.remove ... setViewState('authRequired'); setCurrentUser(null); ... }

  return (
    <div className="app">
      <header className="app__header">
        🚜 Automate Boring Stuff
        {/* Show loading state */}
        {isLoading && <span style={{ marginLeft: '10px', fontStyle: 'italic' }}>(Uploading...)</span>}
        {/* Display error message if any (could be styled better) */}
        {errorMessage && <p style={{ color: 'orange', fontSize: '0.8em', margin: '0 5px' }}>{errorMessage}</p>}
      </header>
      <div className="app__body">
        <AnimatePresence mode="wait">
          {viewState === 'authenticating' && (
            <motion.div key="authenticating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center' }}>
              Loading...
            </motion.div>
          )}
          {viewState === 'authRequired' && (
            <AuthView
              key="auth"
              baseUrl={API_BASE_URL}
              onAuthSuccess={handleAuthSuccess}
            />
          )}
          {viewState === 'loading' && !isLoading && ( // Only show if not also doing uploads
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center' }}>
              Loading recording state...
            </motion.div>
          )}
          {viewState === 'processingAction' && (
            <LoadingView
              key="processing"
              statusText={processingStatusText || "Processing..."}
            />
          )}
          {viewState === 'empty' && (
            <EmptyView
              key="empty"
              onRecordClick={handleRecordClick}
              onBrowseScriptsClick={() => setViewState('browseScripts')}
              disabled={isLoading} // Disable buttons during loading
            />
          )}
          {viewState === 'recording' && (
            <RecordingView
              key="recording"
              screenshots={screenshots}
              onCancelClick={handleCancelClick}
              onDoneClick={handleDoneClick}
              disabled={isLoading} // Disable buttons during upload
            />
          )}
          {viewState === 'action' && actionScript && ( // Only render if script exists
            <AutoActionView
              key="action"
              markdown={actionScript} // Pass the script content
              onShowAllScripts={() => setViewState('browseScripts')}
            />
          )}
          {viewState === 'browseScripts' && (
            <ShowScriptsView
              key="scripts"
              baseUrl={API_BASE_URL}
              onBack={() => setViewState('empty')}
              onScriptSelect={(script) => {
                setActionScript(script.content);
                setViewState('action');
              }}
            />
          )}
          {viewState === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center', color: 'red' }}>
              <p>An error occurred:</p>
              <p>{errorMessage || 'An unknown error occurred.'}</p>
              <button
                className="button button--secondary"
                // Reset to auth check on error retry
                onClick={() => setViewState('authenticating')}
                style={{ marginTop: '1rem' }}
              >
                Retry
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
