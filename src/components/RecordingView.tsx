import React from 'react';
import { motion } from 'framer-motion';

interface RecordingViewProps {
  onCancelClick: () => void;
  onDoneClick: () => void; // TODO: Implement done logic
}

export const RecordingView: React.FC<RecordingViewProps> = ({ onCancelClick, onDoneClick }) => {
  return (
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
      {/* Button Group */}
      <div className="button-group">
        <button className="button button--secondary" onClick={onCancelClick}>
          Cancel
        </button>
        <button className="button button--primary" onClick={onDoneClick}>
          Done
        </button>
      </div>
    </motion.div>
  );
}; 