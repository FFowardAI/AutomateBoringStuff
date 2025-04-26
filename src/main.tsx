import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { motion, AnimatePresence } from 'framer-motion'
import './main.css'

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);

  const handleRecordClick = () => {
    setIsRecording(true);
  };

  return (
    <div className="app">
      <header className="app__header">
      🚜 Automate Boring Stuff
      </header>
      <div className="app__body">
        <AnimatePresence mode="wait">
          {isRecording ? (
            <motion.div
              key="recording"
              className="recording-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <p className="recording-text">Recording...</p>
              <motion.div
                className="recording-dot"
                animate={{
                  scale: [1, 1.2, 1, 1.2, 1],
                  opacity: [1, 0.7, 1, 0.7, 1],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
              <div className="button-group">
                <button className="button button--secondary" onClick={() => setIsRecording(false)}>
                  Cancel
                </button>
                <button className="button button--primary" onClick={() => { /* TODO: Add done logic */ }}>
                  Done
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="initial"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              <ul className="roadmap">
                <li className="roadmap__item">1. click Record</li>
                <li className="roadmap__item">2. do boring stuff</li>
                <li className="roadmap__item">3. never do it again</li>
              </ul>
              <button className="button button--primary" onClick={handleRecordClick}>
                Record
              </button>
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