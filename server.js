const express = require('express');
const multer = require('multer');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HF_API_URL =
  process.env.HF_API_URL || 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';
const HF_API_TOKEN = process.env.HF_API_TOKEN;

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024, // 30 MB
  },
});

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

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No audio file received.' });
    return;
  }

  if (!HF_API_TOKEN) {
    res.status(500).json({ error: 'Server misconfigured: missing HF_API_TOKEN.' });
    return;
  }

  try {
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        Accept: 'application/json',
      },
      body: req.file.buffer,
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const errorPayload = isJson ? await response.json() : await response.text();

      if (response.status === 503 && errorPayload && errorPayload.estimated_time) {
        res.status(503).json({
          error: 'Model is warming up. Please retry shortly.',
          estimatedTime: errorPayload.estimated_time,
        });
        return;
      }

      res.status(response.status).json({
        error: 'Transcription failed.',
        details: errorPayload,
      });
      return;
    }

    const result = await response.json();
    let transcript = '';

    if (typeof result.text === 'string') {
      transcript = result.text;
    } else if (Array.isArray(result) && result[0] && typeof result[0].text === 'string') {
      transcript = result[0].text;
    }

    res.json({ text: transcript.trim() });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Transcription error', error);
    res.status(500).json({ error: 'Unexpected server error during transcription.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Speech-to-text web app listening on port ${PORT}`);
});
