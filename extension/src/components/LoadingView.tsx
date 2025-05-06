import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LoadingViewProps {
  statusText: string;
}

const piledrivers = [
  "🚜",
  "🚜 🚜",
  "🚜 🚜 🚜",
];

export const LoadingView: React.FC<LoadingViewProps> = ({ statusText }) => {
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentFrame((prevFrame) => (prevFrame + 1) % piledrivers.length);
    }, 300); // Adjust speed as needed

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  return (
    <motion.div
      key="loading-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        textAlign: 'center',
        height: '100%', // Make it take full height of its container
        flex: 1 // Ensure it grows to fill flex space
      }}
    >
      <p style={{ marginBottom: '20px' }}>{statusText}</p>
      {/* Removed animation from the emoji display div for direct transition */}
      <div style={{ fontSize: '2rem', minHeight: '3em' /* Prevent layout shifts */ }}>
        {/* Using key still helps React update, but no motion props for animation */}
        <div key={currentFrame}>
          {piledrivers[currentFrame]}
        </div>
      </div>
    </motion.div>
  );
}; 