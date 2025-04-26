import React, { useState, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView'
import { RecordingView } from './components/RecordingView'
import { AuthView } from './components/AuthView'

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

// Combine view states
type ViewState = 'authenticating' | 'authRequired' | 'loading' | 'empty' | 'recording' | 'error';

const API_BASE_URL = "https://5aca-4-39-199-2.ngrok-free.app"; // Define your backend URL
// AUTH_COOKIE_NAME is no longer checked here, but might still be relevant for backend interactions
// const AUTH_COOKIE_NAME = "auth_session";

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('authenticating'); // Start in authenticating state
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // --- Check Local Storage for Auth Details --- 
  useEffect(() => {
    const checkStoredAuth = async () => {
      try {
        // Check if user details exist in local storage
        const storedData = await chrome.storage.local.get(['userName', 'userEmail']);
        
        if (storedData.userName && storedData.userEmail) {
          console.log("Found stored user details, assuming logged in:", storedData);
          // Store details in state if needed later
          setCurrentUser({ name: storedData.userName, email: storedData.userEmail, id: null }); // ID is unknown here
          // Proceed directly to loading app state
          setViewState('loading'); 
        } else {
          console.log("No stored user details found.");
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
  }, [viewState]); // Rerun if viewState becomes 'loading'

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

  // --- Event Handlers --- 

  const handleAuthSuccess = (userData: User) => {
    console.log("Authentication successful in parent:", userData);
    setCurrentUser(userData); // Store user data
    setViewState('loading'); // Move to loading the recording state
  };

  const handleRecordClick = () => {
    console.log("Sending start_recording message...");
    chrome.runtime.sendMessage({ type: "start_recording" }, (response) => {
       if (chrome.runtime.lastError || (response && response.error)) {
         console.error("Error starting recording:", chrome.runtime.lastError?.message || response?.error);
         setErrorMessage(`Failed to start: ${chrome.runtime.lastError?.message || response?.error}`);
         setViewState('error');
       } else {
         console.log("Start recording request acknowledged.");
       }
    });
  };

  const handleCancelClick = () => {
    console.log("Sending stop_recording message (Cancel)...");
    chrome.runtime.sendMessage({ type: "stop_recording" }, (response) => {
        if (chrome.runtime.lastError || (response && response.error)) {
          console.error("Error stopping recording (cancel):", chrome.runtime.lastError?.message || response?.error);
          setErrorMessage(`Failed to stop cleanly: ${chrome.runtime.lastError?.message || response?.error}`);
          setViewState('empty'); 
        } else {
          console.log("Stop recording request acknowledged (Cancel).");
        }
    });
    setViewState('empty');
  };

  const handleDoneClick = () => {
    console.log("Sending stop_recording message (Done)...");
    chrome.runtime.sendMessage({ type: "stop_recording" }, (response: BackgroundState | {error: string}) => {
        if (chrome.runtime.lastError || (response && 'error' in response)) {
          console.error("Error stopping recording (done):", chrome.runtime.lastError?.message || (response as {error: string}).error);
          setErrorMessage(`Failed to stop cleanly: ${chrome.runtime.lastError?.message || (response as {error: string}).error}`);
          setViewState('empty');
        } else if (response) {
          console.log(`Recording finished with ${response.screenshots?.length || 0} screenshots.`);
        }
    });
    setViewState('empty');
  };
  
  // TODO: Add a Logout handler that clears the cookie and resets state
  // const handleLogout = async () => { ... chrome.cookies.remove ... setViewState('authRequired'); setCurrentUser(null); ... }

  return (
    <div className="app">
      <header className="app__header">
        🚜 Automate Boring Stuff
        {/* TODO: Optionally show user info or logout button here if currentUser */} 
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
          {viewState === 'loading' && (
             <motion.div key="loading" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center'}}>
                Loading recording state...
             </motion.div>
          )}
          {viewState === 'empty' && (
            <EmptyView key="empty" onRecordClick={handleRecordClick} onRandomViewClick={() => {}} onRandomViewClick={handleConsume} />
          )}
          {viewState === 'recording' && (
             <RecordingView
              key="recording"
              screenshots={screenshots}
              onCancelClick={handleCancelClick}
              onDoneClick={handleDoneClick}
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
