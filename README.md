# Orion Speech Studio

An expressive speech-to-text web experience that blends polished UI flourishes with open-source transcription quality. Audio is recorded or uploaded in the browser and securely streamed to a Hugging Face Inference endpoint running the open-source [`openai/whisper-large-v3`](https://huggingface.co/openai/whisper-large-v3) GPT model.

## Highlights

- ✨ Immersive hero layout with animated capture visualisation and responsive panels.
- 🎙️ Browser-based recording with smart microphone presets for studio, meeting room, and mobile capture.
- 🌍 Accent-aware labelling for US and Indian English segments plus optional smart punctuation.
- 📤 Upload support for pre-recorded audio alongside live capture.
- 🧠 Server bridge to an open-source Whisper GPT model for high-quality transcription results.

## Prerequisites

- **Node.js 18+** (to leverage the native `fetch` API on the server).
- A Hugging Face API token with access to the desired Whisper model. Create one at <https://huggingface.co/settings/tokens>.

## Configuration

Set the following environment variables before starting the server:

| Variable | Description | Default |
| --- | --- | --- |
| `HF_API_TOKEN` | Required. Hugging Face API token used to authenticate against the model endpoint. | – |
| `HF_API_URL` | Optional. Override the inference URL if you deploy a custom model. | `https://api-inference.huggingface.co/models/openai/whisper-large-v3` |
| `PORT` | Optional. Port for the Node.js server. | `3000` |

You can export these variables in your shell or manage them through a `.env` file when deploying to hosting providers that support secrets.

## Local development

Install dependencies and start the server:

```bash
npm install
npm start
```

Then visit <http://localhost:3000> in a Chromium-based browser, grant microphone permission, and press **Start recording**. Uploaded files are sent to the same `/api/transcribe` endpoint.

## Deployment

The app is a standard Express server, making it easy to deploy to providers such as Render, Railway, Vercel (Node serverless functions), Fly.io, or any Node-compatible VPS. Ensure requests are served over HTTPS so browsers allow microphone access.

## Health check

`GET /health` returns `{ "status": "ok" }` and can be used for uptime monitoring.

## Troubleshooting

- If you see `Server misconfigured: missing HF_API_TOKEN`, confirm the token is present in the environment before starting `npm start`.
- Hugging Face models can take a few seconds to warm up on first request; the UI will display status updates while waiting.
- MediaRecorder is not supported in legacy browsers. Users without support can still upload audio files for transcription.
