import React, { useState, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView'
import { RecordingView } from './components/RecordingView'
import { AuthView } from './components/AuthView'
import { AutoActionView } from './components/AutoActionView'

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
    script?: string; // Make script optional in case API doesn't always return it
    message?: string;
    // Add other potential fields
}

// Combine view states
type ViewState = 'authenticating' | 'authRequired' | 'loading' | 'empty' | 'recording' | 'uploading' | 'error' | 'action';

const API_BASE_URL = "https://31ca-4-39-199-2.ngrok-free.app"; // Define your backend URL
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
        while(n--){
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], {type:mime});
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
      // Only process updates if we are in a post-auth state
      if (viewState === 'empty' || viewState === 'recording') {
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
         const errorMsg = chrome.runtime.lastError?.message || (response as {error: string})?.error || 'Unknown background start error';
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

            if (!apiResponse.ok) {
                throw new Error(data?.message || `API Error: ${apiResponse.status}`);
            }
            if (!data.id) {
                throw new Error("Backend did not return a recording ID.");
            }

            console.log("Backend recording created successfully. ID:", data.id);
            setRecordingId(data.id); 

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
    setActionScript(null); // Clear previous script

    if (!currentRecordingId) {
        console.warn("Done clicked, no recording ID. Cannot upload.");
        setViewState('empty');
        return;
    }
    if (finalScreenshots.length === 0) {
        console.log("No screenshots captured. Skipping upload.");
        setViewState('empty');
        return;
    }

    setIsLoading(true);
    setViewState('uploading');

    const formData = new FormData();
    let conversionFailures = 0;
    let uploadSucceeded = false; // Flag to track success

    console.log("Converting screenshots...");
    for (let i = 0; i < finalScreenshots.length; i++) {
        const screenshotDataUrl = finalScreenshots[i];
        const blob = dataURLtoBlob(screenshotDataUrl);

        if (!blob) {
            console.error(`Failed to convert screenshot ${i + 1} to Blob.`);
            conversionFailures++;
            continue;
        }
        formData.append('files', blob, `screenshot_${i + 1}.png`);
    }

    if (conversionFailures > 0) {
        console.warn(`Skipped ${conversionFailures} screenshots due to conversion errors.`);
    }
    
    const filesToUploadCount = formData.getAll('files').length;
    if (filesToUploadCount === 0) {
        console.warn("No valid screenshots to upload after conversion.");
        setErrorMessage("Failed to process screenshots for upload.");
        // Skip fetch, go directly to finally block (which now sets state based on uploadSucceeded)
        throw new Error("No valid files to upload"); // Throw to go to catch block
    } else {
        // Send the single POST request with all files
        console.log(`Uploading ${filesToUploadCount} screenshots...`);
        try {
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
               const responseJson: FinalizeResponse = await uploadResponse.json();
               console.log("Batch upload response JSON:", responseJson);

               if (responseJson.script && typeof responseJson.script === 'string') {
                   console.log("Script received, setting action state.");
                   setActionScript(responseJson.script);
                   setViewState('action'); // Transition to action view
                   uploadSucceeded = true; // Mark as success
               } else {
                   console.warn("Upload succeeded, but no valid script found in response.");
                   setErrorMessage("Processing complete, but failed to retrieve action script.");
                   // Decide: go to empty or error? Let's go to error for clarity.
                   setViewState('error'); 
               }
            }
        } catch (uploadError: any) {
            console.error(`Network or server error during batch upload:`, uploadError);
            setErrorMessage(`Upload failed: ${uploadError.message}`);
            // Go to error state on failure
            setViewState('error'); 
        } finally {
            setIsLoading(false); // Stop loading indicator
            // Only set to empty if upload didn't succeed AND we are not in error state
            if (!uploadSucceeded && viewState !== 'error' && viewState !== 'action') {
               setViewState('empty'); 
            } 
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
             <motion.div key="authenticating" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center'}}>
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
             <motion.div key="loading" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center'}}>
                Loading recording state...
             </motion.div>
          )}
          {viewState === 'uploading' && (
             <motion.div 
                key="uploading" 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                style={{textAlign: 'center', padding: '20px'}}
              >
                <p>Uploading screenshots...</p>
                {/* You could add a spinner component here */} 
             </motion.div>
          )}
          {viewState === 'empty' && (
            <EmptyView 
              key="empty" 
              onRecordClick={handleRecordClick} 
              onRandomViewClick={handleConsume} 
              disabled={isLoading} // Disable button during upload
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
             />
           )}
           {viewState === 'error' && (
             <motion.div key="error" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center', color: 'red'}}>
                <p>An error occurred:</p>
                <p>{errorMessage || 'An unknown error occurred.'}</p>
                <button 
                    className="button button--secondary" 
                    // Reset to auth check on error retry
                    onClick={() => setViewState('authenticating')} 
                    style={{marginTop: '1rem'}}
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
