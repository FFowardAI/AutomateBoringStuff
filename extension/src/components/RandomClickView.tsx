import React, { useCallback } from "react"
import { motion } from "framer-motion"

interface RandomClickViewProps {
  items: string[]                   // selectors or IDs passed in
  onConsume: (item: string) => void // called with the chosen item
  onBack: () => void
}

export const RandomClickView: React.FC<RandomClickViewProps> = ({
  items,
  onConsume,
  onBack,
}) => {
  const handleRandom = useCallback(() => {
    if (!items.length) return
    const choice = items[Math.floor(Math.random() * items.length)]
    onConsume(choice)
  }, [items, onConsume])

  return (
    <motion.div
      key="random"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <h4>Clickable items in this tab:</h4>
      <ul style={{ maxHeight: 150, overflowY: "auto" }}>
        {items.length ? (
          items.map((it, i) => <li key={i}>{it}</li>)
        ) : (
          <li><em>No items</em></li>
        )}
      </ul>

      <button className="button button--primary" onClick={handleRandom}>
        Click a Random Item
      </button>
      <button className="button button--secondary" onClick={onBack}>
        Back
      </button>
    </motion.div>
  )
}