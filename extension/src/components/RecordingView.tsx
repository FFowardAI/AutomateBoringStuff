import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

interface RecordingViewProps {
  videoElement: HTMLVideoElement; // Receive the playing video element
  onCancelClick: () => void
  onDoneClick: (screenshots: string[]) => void
}

export const RecordingView: React.FC<RecordingViewProps> = ({ 
  videoElement, 
  onCancelClick, 
  onDoneClick 
}) => {
  const [screenshots, setScreenshots] = useState<string[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Effect to capture frames from the passed videoElement
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoElement) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const interval = setInterval(() => {
       // Ensure video dimensions are available
       if (videoElement.readyState < videoElement.HAVE_METADATA || videoElement.videoWidth === 0) {
         return; // Skip if video not ready or dimensions unknown
       }
       
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      try {
        ctx.drawImage(videoElement, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        setScreenshots((prev) => [...prev, dataUrl]);
      } catch (error) {
        console.error("Error drawing video frame to canvas:", error);
        // Optionally stop recording or handle error
      }
    }, 500); // Keep interval at 500ms as rate limit was for API call

    return () => {
      clearInterval(interval);
    }
    // Depend on videoElement presence
  }, [videoElement]); 

  const handleDone = () => {
    onDoneClick(screenshots)
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
      {/* hidden canvas for snapshots */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <p className="recording-text">Recording...</p>

      {/* screenshot previews */}
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
