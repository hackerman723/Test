# Orion Speech Studio

An expressive speech-to-text web experience that blends polished UI flourishes with open-source transcription quality. Audio can be streamed live or uploaded for batch processing, with transcripts rendered in an oversized "translation" canvas that highlights key technical and IT terminology.

## Highlights

- ✨ Immersive hero layout with animated capture visualisation and responsive panels.
- 🎙️ Browser-based recording with smart microphone presets for studio, meeting room, and mobile capture.
- ⚡ Real-time streaming transcription that renders text while you speak.
- 🖥️ Provider-aware pipeline that uses Hugging Face inference when a token is present or falls back to a local Transformers.js Whisper model when it is not.
- 🌍 Accent-aware labelling for US and Indian English segments plus optional smart punctuation.
- 📤 Upload support for pre-recorded audio alongside live capture.
- 🧠 Automatic highlighting of technical terms (cloud, DevOps, networking, etc.) in the transcript for faster review.

## Prerequisites

- **Node.js 18+** (to leverage the native `fetch` API on the server).
- (Optional) A Hugging Face API token with access to the desired Whisper model. Create one at <https://huggingface.co/settings/tokens>.

## Configuration

Set the following environment variables before starting the server:

| Variable | Description | Default |
| --- | --- | --- |
| `HF_API_TOKEN` | Hugging Face API token used to authenticate against the model endpoint. | – |
| `HF_API_URL` | Optional. Override the inference URL if you deploy a custom model. | `https://api-inference.huggingface.co/models/openai/whisper-large-v3` |
| `TRANSCRIPTION_PROVIDER` | Force `huggingface` or `local`. Auto-selects based on config when unset. | Auto |
| `LOCAL_MODEL_ID` | Whisper model to load via Transformers.js in local mode. | `Xenova/whisper-small.en` |
| `PORT` | Optional. Port for the Node.js server. | `3000` |

You can export these variables in your shell or manage them through a `.env` file when deploying to hosting providers that support secrets.

## Transcription providers

### Hugging Face inference

When `HF_API_TOKEN` is provided (or when `TRANSCRIPTION_PROVIDER=huggingface` and a token is available), audio is proxied to the configured Hugging Face endpoint. This offers GPU-accelerated inference with the [`openai/whisper-large-v3`](https://huggingface.co/openai/whisper-large-v3) GPT model by default, but you can point to any compatible Whisper checkpoint.

### Local Transformers.js fallback

If a Hugging Face token is not configured, the server automatically loads the open-source [`Xenova/whisper-small.en`](https://huggingface.co/Xenova/whisper-small.en) model through `@xenova/transformers` and `@xenova/ffmpeg`. This runs fully within your Node.js process—ideal for private demos or offline scenarios. You can customise the model with `LOCAL_MODEL_ID` if you prefer a multilingual or larger checkpoint.

## Local development

Install dependencies and start the server:

```bash
npm install
npm start
```

Then visit <http://localhost:3000> in a Chromium-based browser, grant microphone permission, and press **Start recording**. The transcript updates in near real-time through `/api/transcribe/live`, and uploaded files are still processed through `/api/transcribe`. The transcript pane stretches across the layout to remain the primary focus during sessions, and technical keywords are highlighted automatically for quick scanning.

## Deployment

The app is a standard Express server, making it easy to deploy to providers such as Render, Railway, Vercel (Node serverless functions), Fly.io, or any Node-compatible VPS. Ensure requests are served over HTTPS so browsers allow microphone access.

## Health check

`GET /health` returns `{ "status": "ok" }` and can be used for uptime monitoring.

## Troubleshooting

- The `/api/status` endpoint exposes the active provider. The UI surfaces the same information near the transcript header.
- If you request Hugging Face mode without a token, the server logs a warning and falls back to local Transformers.js inference.
- Hugging Face models can take a few seconds to warm up on first request; the UI will display status updates while waiting.
- MediaRecorder is not supported in legacy browsers. Users without support can still upload audio files for transcription.
