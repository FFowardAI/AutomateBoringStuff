import React, { useState, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView'
import { RecordingView } from './components/RecordingView'
// Removed unused PermissionGuideView and error message state

// Define expected state structure from background
interface BackgroundState {
  isRecording: boolean;
  screenshots: string[];
}

type ViewState = 'loading' | 'empty' | 'recording' | 'error'; // Added loading state

const App: React.FC = () => {
  // State now reflects the background script's state
  const [viewState, setViewState] = useState<ViewState>('loading'); 
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Removed intervalRef and local state management logic

  // --- Communication with Background Script --- 

  // Function to request state update from background
  const fetchStateFromBackground = useCallback(() => {
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
         // Handle unexpected response (e.g., background script not ready)
         console.warn("Received empty response from background script.");
         setErrorMessage("Background script did not respond correctly.");
         setViewState('error');
      }
    });
  }, []);

  // Effect to fetch initial state and listen for updates
  useEffect(() => {
    // Fetch initial state when popup opens
    fetchStateFromBackground();

    // Listener for updates pushed from background
    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      if (message.type === "state_update") {
        console.log("Popup received state update:", message.payload);
        const newState: BackgroundState = message.payload;
        setScreenshots(newState.screenshots || []);
        // Only change view state if it differs, avoid unnecessary re-renders
        setViewState(currentState => {
            const nextViewState = newState.isRecording ? 'recording' : 'empty';
            return currentState === nextViewState ? currentState : nextViewState;
        });
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup listener when popup closes
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      console.log("Popup closed, listener removed.");
    };
  }, [fetchStateFromBackground]); // Dependency array includes the memoized fetch function

  // --- Event Handlers --- 

  const handleRecordClick = () => {
    console.log("Sending start_recording message...");
    // Ask background to start
    chrome.runtime.sendMessage({ type: "start_recording" }, (response) => {
       if (chrome.runtime.lastError || (response && response.error)) {
         console.error("Error starting recording:", chrome.runtime.lastError?.message || response?.error);
         setErrorMessage(`Failed to start: ${chrome.runtime.lastError?.message || response?.error}`);
         setViewState('error');
       } else {
         // State update will come via the listener, can optionally update immediately
         console.log("Start recording request acknowledged.");
         // setViewState('recording'); // Optional immediate feedback
       }
    });
  };

  const handleCancelClick = () => {
    console.log("Sending stop_recording message (Cancel)...");
    // Ask background to stop
    chrome.runtime.sendMessage({ type: "stop_recording" }, (response) => {
        if (chrome.runtime.lastError || (response && response.error)) {
          console.error("Error stopping recording (cancel):", chrome.runtime.lastError?.message || response?.error);
          // Even if stopping fails, try to go back to empty view
          setErrorMessage(`Failed to stop cleanly: ${chrome.runtime.lastError?.message || response?.error}`);
          setViewState('empty'); 
        } else {
          // State update listener will set view to 'empty'
          console.log("Stop recording request acknowledged (Cancel).");
        }
    });
    // Immediately try to set view state for responsiveness, listener will correct if needed
    setViewState('empty');
  };

  const handleDoneClick = () => {
    console.log("Sending stop_recording message (Done)...");
    // Ask background to stop and process
    chrome.runtime.sendMessage({ type: "stop_recording" }, (response: BackgroundState | {error: string}) => {
        if (chrome.runtime.lastError || (response && 'error' in response)) {
          console.error("Error stopping recording (done):", chrome.runtime.lastError?.message || (response as {error: string}).error);
          setErrorMessage(`Failed to stop cleanly: ${chrome.runtime.lastError?.message || (response as {error: string}).error}`);
          // Go back to empty view even if there was an error stopping
          setViewState('empty');
        } else if (response) {
          console.log(`Recording finished with ${response.screenshots?.length || 0} screenshots.`);
          // Background script handles saving/processing. Listener will set state to empty.
        }
    });
     // Immediately try to set view state for responsiveness
    setViewState('empty');
  };

  return (
    <div className="app">
      <header className="app__header">
        🚜 Automate Boring Stuff
      </header>
      <div className="app__body">
        <AnimatePresence mode="wait">
          {viewState === 'loading' && (
             <motion.div key="loading" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center'}}>
                Loading state...
             </motion.div>
          )}
          {viewState === 'empty' && (
            <EmptyView key="empty" onRecordClick={handleRecordClick} />
          )}
          {viewState === 'recording' && (
             <RecordingView
              key="recording"
              screenshots={screenshots} // Pass screenshots received from background
              onCancelClick={handleCancelClick}
              onDoneClick={handleDoneClick} // Done now just sends stop message
            />
          )}
           {viewState === 'error' && (
             <motion.div key="error" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center', color: 'red'}}>
                <p>An error occurred:</p>
                <p>{errorMessage || 'An unknown error occurred.'}</p>
                <button 
                    className="button button--secondary" 
                    onClick={fetchStateFromBackground} // Add a retry button
                    style={{marginTop: '1rem'}}
                >
                    Retry Connection
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
