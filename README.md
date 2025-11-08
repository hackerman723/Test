# Orion Translation Studio

An expressive speech-to-text translation experience that blends polished UI flourishes with open-source model quality. Audio can be streamed live or uploaded for batch processing, with the oversized translation canvas highlighting key technical and IT terminology in real time.

## Highlights

- ✨ Immersive hero layout with animated capture visualisation and responsive panels.
- 🎙️ Browser-based recording with smart microphone presets for studio, meeting room, and mobile capture plus 1-second streaming chunks for quick updates.
- ⚡ Real-time streaming translation that renders text while you speak and keeps the oversized translation tab in focus.
- 🛡️ Automatic provider failover that switches to the local Transformers.js Whisper model whenever Hugging Face is warming up or unreachable.
- 🌍 Accent-aware labelling for US and Indian English segments plus optional smart punctuation.
- 📤 Upload support for pre-recorded audio alongside live capture with the same fallback behaviour.
- 🧠 Automatic highlighting of technical terms (cloud, DevOps, networking, etc.) in the translation for faster review.

## Prerequisites

- **Node.js 18+** (to leverage the native `fetch` API on the server).
- (Optional) A Hugging Face API token with access to the desired Whisper model. Create one at <https://huggingface.co/settings/tokens>.

## Configuration

Set the following environment variables before starting the server:

| Variable | Description | Default |
| --- | --- | --- |
| `HF_API_TOKEN` | Hugging Face API token used to authenticate against the model endpoint. | – |
| `HF_API_URL` | Optional. Override the inference URL if you deploy a custom model. | `https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3` |
| `TRANSCRIPTION_PROVIDER` | Force `huggingface` or `local`. Auto-selects based on config when unset. | Auto |
| `LOCAL_MODEL_ID` | Whisper model to load via Transformers.js in local mode. | `Xenova/whisper-small.en` |
| `PORT` | Optional. Port for the Node.js server. | `3000` |

You can export these variables in your shell or manage them through a `.env` file when deploying to hosting providers that support secrets.

## Translation providers

### Hugging Face inference

When `HF_API_TOKEN` is provided (or when `TRANSCRIPTION_PROVIDER=huggingface` and a token is available), audio is proxied to the configured Hugging Face endpoint. This offers GPU-accelerated inference with the [`openai/whisper-large-v3`](https://huggingface.co/openai/whisper-large-v3) GPT model by default, but you can point to any compatible Whisper checkpoint. If the endpoint is warming up, rate-limited, or temporarily unreachable, the server automatically falls back to the local Transformers.js pipeline and surfaces that change to the client UI.

### Local Transformers.js fallback

If a Hugging Face token is not configured—or if Hugging Face fails during a request—the server loads the open-source [`Xenova/whisper-small.en`](https://huggingface.co/Xenova/whisper-small.en) model through `@xenova/transformers`. This runs fully within your Node.js process—ideal for private demos or offline scenarios. You can customise the model with `LOCAL_MODEL_ID` if you prefer a multilingual or larger checkpoint.

## Local development

Install dependencies and start the server:

```bash
npm install
npm start
```

Then visit <http://localhost:3000> in a Chromium-based browser, grant microphone permission, and press **Start recording**. The translation updates roughly every second through `/api/transcribe/live`, and uploaded files are still processed through `/api/transcribe`. The dominant translation pane stays anchored to the left of the layout for readability while technical keywords are highlighted automatically for quick scanning. Status messages and the provider badge will indicate when the app falls back to the on-device Whisper model.

## Deployment

The app is a standard Express server, making it easy to deploy to providers such as Render, Railway, Vercel (Node serverless functions), Fly.io, or any Node-compatible VPS. Ensure requests are served over HTTPS so browsers allow microphone access.

## Health check

`GET /health` returns `{ "status": "ok" }` and can be used for uptime monitoring.

## Troubleshooting

- The `/api/status` endpoint exposes the preferred provider and local model ID. Live responses from `/api/transcribe` and `/api/transcribe/live` also include `provider`, `fallback`, and `reason` fields so the UI can react to provider switches.
- If you request Hugging Face mode without a token, the server logs a warning and remains in local mode. When Hugging Face returns warm-up or network errors mid-session, the app automatically switches to local Transformers.js inference and updates the provider badge.
- Hugging Face models can take a few seconds to warm up on first request. The UI will display status updates during the warm-up, and fallback engages automatically to keep translations flowing.
- MediaRecorder is not supported in legacy browsers. Users without support can still upload audio files for translation.
