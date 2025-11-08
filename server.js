const express = require('express');
const multer = require('multer');
const path = require('path');

if (typeof global.navigator === 'undefined') {
  global.navigator = { userAgent: 'node.js' };
}

const PORT = process.env.PORT || 3000;
const HF_API_URL =
  process.env.HF_API_URL || 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const LOCAL_MODEL_ID = process.env.LOCAL_MODEL_ID || 'Xenova/whisper-small.en';
const PROVIDER_ENV = (process.env.TRANSCRIPTION_PROVIDER || '').toLowerCase();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024, // 30 MB
  },
});

const determineProvider = () => {
  if (PROVIDER_ENV === 'huggingface') {
    return HF_API_TOKEN ? 'huggingface' : 'local';
  }
  if (PROVIDER_ENV === 'local') {
    return 'local';
  }
  return HF_API_TOKEN ? 'huggingface' : 'local';
};

const ACTIVE_PROVIDER = determineProvider();

if (ACTIVE_PROVIDER === 'local' && !HF_API_TOKEN && PROVIDER_ENV === 'huggingface') {
  // eslint-disable-next-line no-console
  console.warn('TRANSCRIPTION_PROVIDER=huggingface but HF_API_TOKEN missing. Falling back to local mode.');
}

let localPipelinePromise = null;
let localQueue = Promise.resolve();
const localSessions = new Map();

const queueLocalTask = (task) => {
  localQueue = localQueue.catch(() => {}).then(() => task());
  return localQueue;
};

const loadLocalPipeline = async () => {
  if (!localPipelinePromise) {
    localPipelinePromise = (async () => {
      const transformers = await import('@xenova/transformers');

      if (transformers?.env) {
        transformers.env.allowLocalModels = false;
        transformers.env.localModelPath = null;
        transformers.env.backends.onnx.wasm.wasmPaths = transformers.env.backends.onnx.wasm.wasmPaths || {};
      }

      return transformers.pipeline('automatic-speech-recognition', LOCAL_MODEL_ID, {
        quantized: true,
      });
    })();
  }

  return localPipelinePromise;
};

const runLocalTranscription = async (buffer) => {
  const pipeline = await loadLocalPipeline();
  const output = await pipeline(buffer, {
    chunk_length_s: 20,
    stride_length_s: 5,
    return_timestamps: false,
  });

  return (output?.text || '').trim();
};

const runHuggingFaceTranscription = async (buffer) => {
  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_API_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      Accept: 'application/json',
    },
    body: buffer,
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const errorPayload = isJson ? await response.json() : await response.text();

    if (response.status === 503 && errorPayload && errorPayload.estimated_time) {
      const error = new Error('Model is warming up. Please retry shortly.');
      error.status = 503;
      error.details = { estimatedTime: errorPayload.estimated_time };
      throw error;
    }

    const error = new Error('Transcription failed.');
    error.status = response.status;
    error.details = errorPayload;
    throw error;
  }

  const result = await response.json();
  let transcript = '';

  if (typeof result.text === 'string') {
    transcript = result.text;
  } else if (Array.isArray(result) && result[0] && typeof result[0].text === 'string') {
    transcript = result[0].text;
  }

  return transcript.trim();
};

const runTranscription = (buffer) => {
  if (ACTIVE_PROVIDER === 'huggingface') {
    if (!HF_API_TOKEN) {
      const error = new Error('Server misconfigured: missing HF_API_TOKEN.');
      error.status = 500;
      throw error;
    }
    return runHuggingFaceTranscription(buffer);
  }

  return queueLocalTask(() => runLocalTranscription(buffer));
};

const runLocalLiveTranscription = async (sessionId, buffer, isFinalChunk) => {
  const session = localSessions.get(sessionId) || { chunks: [], lastText: '' };
  session.chunks.push(buffer);

  const combined = Buffer.concat(session.chunks);
  const fullTranscript = await runTranscription(combined);

  let delta = fullTranscript;
  if (session.lastText) {
    const previous = session.lastText.trim();
    const next = fullTranscript.trim();

    if (next.toLowerCase().startsWith(previous.toLowerCase())) {
      delta = next.slice(previous.length).trim();
    } else {
      const idx = next.toLowerCase().lastIndexOf(previous.toLowerCase());
      delta = idx >= 0 ? next.slice(idx + previous.length).trim() : next;
    }
  }

  session.lastText = fullTranscript;

  if (isFinalChunk) {
    localSessions.delete(sessionId);
  } else {
    localSessions.set(sessionId, session);
  }

  return delta.trim();
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/status', (req, res) => {
  res.json({
    provider: ACTIVE_PROVIDER,
    huggingface: {
      configured: Boolean(HF_API_TOKEN),
      endpoint: HF_API_URL,
    },
    local: {
      modelId: LOCAL_MODEL_ID,
      queueDepth: localSessions.size,
    },
  });
});

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No audio file received.' });
    return;
  }

  try {
    const transcript = await runTranscription(req.file.buffer);
    res.json({ text: transcript });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) {
      res.status(status).json({ error: error.message, details: error.details });
      return;
    }

    // eslint-disable-next-line no-console
    console.error('Transcription error', error);
    res.status(500).json({ error: error.message || 'Unexpected server error during transcription.' });
  }
});

app.post('/api/transcribe/live', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No audio chunk received.' });
    return;
  }

  try {
    const isFinalChunk = req.body?.isFinal === 'true';

    if (ACTIVE_PROVIDER === 'local') {
      const sessionId = req.body?.sessionId || 'default-live-session';
      const transcript = await runLocalLiveTranscription(sessionId, req.file.buffer, isFinalChunk);
      res.json({ text: transcript });
      return;
    }

    const transcript = await runTranscription(req.file.buffer);
    res.json({ text: transcript });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) {
      res.status(status).json({ error: error.message, details: error.details });
      return;
    }

    // eslint-disable-next-line no-console
    console.error('Live transcription error', error);
    res
      .status(500)
      .json({ error: error.message || 'Unexpected server error during live transcription.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Speech-to-text web app listening on port ${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Active transcription provider: ${ACTIVE_PROVIDER}`);
});
