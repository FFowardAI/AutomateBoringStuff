import React from 'react'
import { motion } from 'framer-motion'

interface EmptyViewProps {
  onRecordClick: () => void
  onBrowseScriptsClick?: () => void
  disabled?: boolean
}

export const EmptyView: React.FC<EmptyViewProps> = ({
  onRecordClick,
  onBrowseScriptsClick,
  disabled
}) => (
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

    <button
      className="button button--primary"
      onClick={onRecordClick}
      disabled={disabled}
    >
      Record
    </button>
    {onBrowseScriptsClick && (
      <button
        className="button button--secondary"
        onClick={onBrowseScriptsClick}
        disabled={disabled}
        style={{ marginTop: '0.5rem' }}
      >
        Browse Scripts
      </button>
    )}
  </motion.div>
)