import React from 'react';
import { motion } from 'framer-motion';

interface EmptyViewProps {
  onRecordClick: () => void;
}

export const EmptyView: React.FC<EmptyViewProps> = ({ onRecordClick }) => {
  return (
    <motion.div
      key="initial"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }} /* Maintain layout */
    >
      <ul className="roadmap">
        <li className="roadmap__item">1. click Record</li>
        <li className="roadmap__item">2. do boring stuff</li>
        <li className="roadmap__item">3. never do it again</li>
      </ul>
      <button className="button button--primary" onClick={onRecordClick}>
        Record
      </button>
    </motion.div>
  );
}; 