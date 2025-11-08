const express = require('express');
const multer = require('multer');
const path = require('path');

if (typeof global.navigator === 'undefined') {
  global.navigator = { userAgent: 'node.js' };
}

const PORT = process.env.PORT || 3000;
const HF_API_URL =
  process.env.HF_API_URL ||
  'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3';
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

const FALLBACK_STATUSES = new Set([
  401,
  402,
  403,
  404,
  408,
  409,
  410,
  412,
  413,
  414,
  415,
  416,
  417,
  418,
  421,
  422,
  423,
  424,
  425,
  426,
  429,
  430,
  431,
  500,
  502,
  503,
  504,
  507,
  508,
  509,
  511,
]);

if (ACTIVE_PROVIDER === 'local' && !HF_API_TOKEN && PROVIDER_ENV === 'huggingface') {
  // eslint-disable-next-line no-console
  console.warn('TRANSCRIPTION_PROVIDER=huggingface but HF_API_TOKEN missing. Falling back to local mode.');
}

let localPipelinePromise = null;
let localQueue = Promise.resolve();
const localSessions = new Map();

const normaliseErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  if (error.details) {
    if (typeof error.details === 'string' && error.details.trim()) {
      return error.details;
    }
    if (typeof error.details.error === 'string' && error.details.error.trim()) {
      return error.details.error;
    }
  }
  return 'Unexpected provider error';
};

const shouldFallbackToLocal = (error) => {
  if (!error) return false;
  if (ACTIVE_PROVIDER !== 'huggingface') return false;
  if (error.status === 503 && error.details?.estimatedTime) {
    return true;
  }
  if (typeof error.status === 'number' && (error.status >= 500 || FALLBACK_STATUSES.has(error.status))) {
    return true;
  }
  if (!error.status && error.cause instanceof Error) {
    return true;
  }
  return false;
};

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
        transformers.env.allowRemoteModels = true;

        if (!transformers.env.HF_HUB_URL) {
          transformers.env.HF_HUB_URL = 'https://huggingface.co';
        }

        if ('localModelPath' in transformers.env) {
          delete transformers.env.localModelPath;
        }

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

const resolveMimeType = (mimeType) => {
  if (typeof mimeType === 'string') {
    const trimmed = mimeType.trim();
    if (trimmed) {
      if (trimmed === 'application/octet-stream') {
        return 'audio/webm';
      }
      return trimmed;
    }
  }

  return 'audio/webm';
};

const runHuggingFaceTranscription = async (buffer, mimeType) => {
  const resolvedType = resolveMimeType(mimeType);
  let response;
  try {
    response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_TOKEN}`,
        'Content-Type': resolvedType,
        Accept: 'application/json',
      },
      body: buffer,
    });
  } catch (cause) {
    const networkError = new Error('Unable to reach Hugging Face transcription service.');
    networkError.status = 503;
    networkError.cause = cause;
    throw networkError;
  }

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

const runLocalQueuedTranscription = (buffer) => queueLocalTask(() => runLocalTranscription(buffer));

const runPreferredTranscription = async (buffer, mimeType) => {
  if (ACTIVE_PROVIDER === 'huggingface') {
    if (!HF_API_TOKEN) {
      const error = new Error('Server misconfigured: missing HF_API_TOKEN.');
      error.status = 500;
      throw error;
    }

    try {
      const transcript = await runHuggingFaceTranscription(buffer, mimeType);
      return { text: transcript, provider: 'huggingface', fallback: false };
    } catch (error) {
      if (!shouldFallbackToLocal(error)) {
        throw error;
      }

      // eslint-disable-next-line no-console
      console.warn('Hugging Face transcription failed. Falling back to local model.', error);

      try {
        const transcript = await runLocalQueuedTranscription(buffer);
        return {
          text: transcript,
          provider: 'local',
          fallback: true,
          reason: normaliseErrorMessage(error),
        };
      } catch (localError) {
        const combinedError = new Error('Both Hugging Face and local transcription failed.');
        combinedError.status = localError.status || error.status || 500;
        combinedError.details = {
          remote: normaliseErrorMessage(error),
          local: normaliseErrorMessage(localError),
        };
        combinedError.cause = { remote: error, local: localError };
        throw combinedError;
      }
    }
  }

  const transcript = await runLocalQueuedTranscription(buffer);
  return { text: transcript, provider: 'local', fallback: false };
};

const runLocalLiveTranscription = async (sessionId, buffer, isFinalChunk) => {
  const session = localSessions.get(sessionId) || { chunks: [], lastText: '' };
  session.chunks.push(buffer);

  const combined = Buffer.concat(session.chunks);
  const fullTranscript = await runLocalQueuedTranscription(combined);

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

const runPreferredLiveTranscription = async (sessionId, buffer, isFinalChunk, mimeType) => {
  if (ACTIVE_PROVIDER === 'huggingface') {
    try {
      const transcript = await runHuggingFaceTranscription(buffer, mimeType);
      return { text: transcript, provider: 'huggingface', fallback: false };
    } catch (error) {
      if (!shouldFallbackToLocal(error)) {
        throw error;
      }

      // eslint-disable-next-line no-console
      console.warn('Falling back to local live transcription after Hugging Face error.', error);

      const transcript = await runLocalLiveTranscription(sessionId, buffer, isFinalChunk);
      return {
        text: transcript,
        provider: 'local',
        fallback: true,
        reason: normaliseErrorMessage(error),
      };
    }
  }

  const transcript = await runLocalLiveTranscription(sessionId, buffer, isFinalChunk);
  return { text: transcript, provider: 'local', fallback: false };
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
    const result = await runPreferredTranscription(req.file.buffer, req.file.mimetype);
    res.json(result);
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
    const sessionId = req.body?.sessionId || 'default-live-session';

    const result = await runPreferredLiveTranscription(
      sessionId,
      req.file.buffer,
      isFinalChunk,
      req.file.mimetype,
    );
    res.json(result);
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
