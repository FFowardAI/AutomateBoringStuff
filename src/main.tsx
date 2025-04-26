import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView'
import { RecordingView } from './components/RecordingView'

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);

  const handleRecordClick = () => {
    setIsRecording(true);
  };

  const handleCancelClick = () => {
    setIsRecording(false);
  };

  const handleDoneClick = () => {
    // TODO: Implement actual done logic (e.g., save recording)
    console.log("Recording finished (placeholder)");
    setIsRecording(false); // Go back to empty view for now
  };

  return (
    <div className="app">
      <header className="app__header">
      🚜 Automate Boring Stuff
      </header>
      <div className="app__body">
        <AnimatePresence mode="wait">
          {isRecording ? (
            <RecordingView
              key="recording" // Key needed directly on the component for AnimatePresence
              onCancelClick={handleCancelClick}
              onDoneClick={handleDoneClick}
            />
          ) : (
            <EmptyView
              key="initial" // Key needed directly on the component for AnimatePresence
              onRecordClick={handleRecordClick}
            />
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