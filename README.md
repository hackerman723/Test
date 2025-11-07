# Speech to Text Web App

A lightweight speech-to-text web application that supports both US and Indian English accents. The app uses the browser's built-in Web Speech API for transcription and serves static assets through a minimal Node.js HTTP server so external users can access it.

## Features

- Toggle between **English (United States)** and **English (India)** recognition modes.
- Optional continuous recognition for extended conversations.
- Real-time transcript viewer with copy and clear actions.
- Graceful handling for browsers without speech-recognition support.

## Getting started

1. (Optional) Install dependencies to initialize a local `node_modules` directory:

   ```bash
   npm install
   ```

2. Start the web server (defaults to port `3000`):

   ```bash
   npm start
   ```

3. Visit `http://localhost:3000` in a modern Chromium-based browser (e.g., Chrome or Edge), grant microphone access, and begin transcribing.

4. To share the application externally, deploy the Node.js server to your preferred hosting provider (Render, Railway, Azure App Service, etc.) and ensure the external hostname is reachable over HTTPS so browsers allow microphone usage.

## Health check

A basic health endpoint is available at `/health` and returns `{ "status": "ok" }`.

## Notes

- The Web Speech API is experimental; recognition quality may vary by browser and device.
- Safari only supports the API on macOS and may require enabling experimental features.
