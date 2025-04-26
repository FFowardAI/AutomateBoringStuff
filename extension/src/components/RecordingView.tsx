import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

interface RecordingViewProps {
  screenshots: string[]; // Receive screenshots directly
  onCancelClick: () => void
  onDoneClick: () => void // Changed: No longer passes screenshots back, as main.tsx already has them
}

export const RecordingView: React.FC<RecordingViewProps> = ({ 
  screenshots, // Use the passed screenshots
  onCancelClick, 
  onDoneClick 
}) => {

  const handleDone = () => {
    // Simply call onDoneClick, main.tsx already has the screenshots
    onDoneClick();
  }

  return (
    <motion.div
      key="recording"
      className="recording-state"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Remove hidden canvas */}
      {/* <canvas ref={canvasRef} style={{ display: 'none' }} /> */}

      <p className="recording-text">Recording...</p>

      {/* screenshot previews - directly use the prop */}
      <div className="screenshot-previews">
        {screenshots.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Screenshot ${i + 1}`}
            className="screenshot-preview"
          />
        ))}
      </div>

      <motion.div
        className="recording-dot"
        animate={{
          scale: [1, 1.2, 1, 1.2, 1],
          opacity: [1, 0.7, 1, 0.7, 1]
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
      />

      <div className="button-group">
        <button className="button button--secondary" onClick={onCancelClick}>
          Cancel
        </button>
        <button className="button button--primary" onClick={handleDone}>
          Done
        </button>
      </div>
    </motion.div>
  )
}
