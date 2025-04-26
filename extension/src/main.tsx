import React, { useState, useRef, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView'
import { RecordingView } from './components/RecordingView'
// PermissionGuideView is likely not needed for captureVisibleTab
// import { PermissionGuideView } from './components/PermissionGuideView'

type ViewState = 'empty' | 'recording' | 'error'; // Simplified states

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>("empty");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null); // Use number for setInterval ID in browser

  // Function to clean up interval
  const cleanupCapture = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Function to start capturing screenshots from the active tab
  const startRecording = useCallback(() => {
    cleanupCapture(); // Clean up any previous interval
    setScreenshots([]); // Clear previous screenshots
    setErrorMessage(null); // Clear previous errors
    setViewState('recording'); // Move to recording view

    if (chrome.tabs?.captureVisibleTab) {
      // Start capturing immediately and then set an interval
      const captureFrame = () => {
        chrome.tabs.captureVisibleTab(
          // Use the current window. Passing null/undefined uses the current window.
          // Specify options like format and quality if needed.
          { format: 'png' }, 
          (dataUrl) => {
            if (chrome.runtime.lastError) {
              console.error('Error capturing tab:', chrome.runtime.lastError.message);
              setErrorMessage(`Error capturing tab: ${chrome.runtime.lastError.message}`);
              setViewState('error'); // Go to an error state
              cleanupCapture(); // Stop trying
              return;
            }
            if (dataUrl) {
              setScreenshots((prev) => [...prev, dataUrl]);
            }
          }
        );
      };

      captureFrame(); // Capture the first frame immediately
      intervalRef.current = setInterval(captureFrame, 500); // Capture every 500ms

    } else {
      console.error('chrome.tabs.captureVisibleTab API not available.');
      setErrorMessage('Tab Capture API is not available. Ensure your extension has permissions and is running in a valid context.');
      setViewState('error');
    }
  }, [cleanupCapture]);

  const handleCancelClick = () => {
    cleanupCapture();
    setViewState('empty');
  };

  const handleDoneClick = () => {
    console.log(`Recording finished with ${screenshots.length} screenshots.`);
    // TODO: Process/save screenshots
    cleanupCapture();
    setViewState('empty');
  };

  // Clean up interval on component unmount
  useEffect(() => {
    return () => {
      cleanupCapture();
    };
  }, [cleanupCapture]);

  return (
    <div className="app">
      <header className="app__header">
        🚜 Automate Boring Stuff
      </header>
      <div className="app__body">
        <AnimatePresence mode="wait">
          {viewState === 'empty' && (
            <EmptyView key="empty" onRecordClick={startRecording} />
          )}
          {/* Removed PermissionGuideView and 'permissionNeeded' state */}
          {viewState === 'recording' && (
             <RecordingView
              key="recording"
              screenshots={screenshots} // Pass screenshots directly
              onCancelClick={handleCancelClick}
              onDoneClick={() => handleDoneClick()} // Pass collected screenshots on Done
            />
          )}
          {/* Removed 'capturing' state */}
           {viewState === 'error' && (
             <motion.div key="error" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center', color: 'red'}}>
                <p>Could not start recording:</p>
                <p>{errorMessage || 'An unknown error occurred.'}</p>
                <button className="button button--secondary" onClick={() => setViewState('empty')} style={{marginTop: '1rem'}}>
                    Close
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
