import React, { useState, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView'
import { RecordingView } from './components/RecordingView'
import { PermissionGuideView } from './components/PermissionGuideView'

type ViewState = 'empty' | 'permissionNeeded' | 'capturing' | 'recording';

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('empty');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Function to clean up stream and video element
  const cleanupMedia = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.remove();
      videoRef.current = null;
    }
  }, []);

  // Function to start the screen capture process
  const startCapture = useCallback(() => {
    setViewState('capturing'); // Indicate we are trying to capture
    cleanupMedia(); // Clean up any previous media

    if (chrome.desktopCapture?.chooseDesktopMedia) {
      chrome.desktopCapture.chooseDesktopMedia(
        ['screen', 'window', 'tab'],
        (streamId) => {
          if (!streamId) {
            console.warn('User cancelled desktop capture');
            setViewState('empty'); // Go back if user cancels picker
            return;
          }

          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              // @ts-ignore
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: streamId
              }
            }
          }).then((stream) => {
            streamRef.current = stream;
            const video = document.createElement('video');
            video.style.display = 'none';
            video.srcObject = stream;
            video.onloadedmetadata = () => {
              video.play();
              videoRef.current = video; // Store ref only after ready
              setScreenshots([]); // Clear previous screenshots
              setViewState('recording'); // Move to recording view
            };
            document.body.appendChild(video);
            
            // Handle stream ending (e.g., user clicks "Stop sharing")
            stream.getVideoTracks()[0].onended = () => {
                console.log("Stream ended by user.");
                cleanupMedia();
                setViewState('empty');
            };

          }).catch((err) => {
            console.error('Error getting desktop stream:', err);
            // Check for permission error (NotAllowedError is common)
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              setViewState('permissionNeeded');
            } else {
              // Handle other errors (e.g., constraints invalid)
              setViewState('empty'); // Go back to empty for other errors
            }
          });
        }
      );
    } else {
      console.warn('desktopCapture API not available');
      alert('Desktop Capture API is not available. Ensure your extension has permissions.');
      setViewState('empty');
    }
  }, [cleanupMedia]);

  const handleCancelClick = () => {
    cleanupMedia();
    setViewState('empty');
  };

  const handleDoneClick = (capturedScreenshots: string[]) => {
    console.log(`Recording finished with ${capturedScreenshots.length} screenshots.`);
    // TODO: Process/save screenshots
    cleanupMedia();
    setViewState('empty');
  };

  const handlePermissionConfirmed = () => {
    // User confirmed, try starting capture again
    startCapture();
  };

  return (
    <div className="app">
      <header className="app__header">
      🚜 Automate Boring Stuff
      </header>
      <div className="app__body">
        <AnimatePresence mode="wait">
          {viewState === 'empty' && (
            <EmptyView key="empty" onRecordClick={startCapture} />
          )}
          {viewState === 'permissionNeeded' && (
            <PermissionGuideView key="permission" onConfirm={handlePermissionConfirmed} />
          )}
          {viewState === 'recording' && videoRef.current && (
            <RecordingView
              key="recording"
              videoElement={videoRef.current}
              onCancelClick={handleCancelClick}
              onDoneClick={handleDoneClick}
            />
          )}
           {viewState === 'capturing' && (
             <motion.div key="capturing" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} style={{textAlign: 'center'}}>
                Requesting permission...
             </motion.div>
           )}
        </AnimatePresence>
      </div>
      </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)