import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path' // Import resolve for path manipulation

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Ensure relative paths for extension assets
  build: {
    outDir: 'dist', // Explicitly set the output directory (Vite's default is 'dist')
    rollupOptions: {
      input: {
        // Define entry point for the popup page (HTML)
        main: resolve(__dirname, 'index.html'),
        // Define entry point for the background script
        background: resolve(__dirname, 'src/background.ts')
      },
      output: {
        // Configure output file names
        entryFileNames: chunkInfo => {
          // Check if the entry point name is 'background'
          if (chunkInfo.name === 'background') {
            // Output the background script as src/background.js in the dist folder
            // This matches the path specified in manifest.json
            return 'src/background.js';
          }
          // Use default naming convention for other entry points (e.g., popup JS)
          // Vite's default often includes hashing for cache busting: assets/[name]-[hash].js
          return 'assets/[name]-[hash].js';
        },
        // Naming convention for code-split chunks
        chunkFileNames: 'assets/[name]-[hash].js',
        // Naming convention for static assets (CSS, images, etc.)
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
})