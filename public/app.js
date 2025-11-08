const statusEl = document.querySelector('#status');
const providerEl = document.querySelector('#provider');
const transcriptEl = document.querySelector('#transcript');
const languageEl = document.querySelector('#language');
const qualityEl = document.querySelector('#quality');
const autoPunctuateEl = document.querySelector('#auto-punctuate');
const appendModeEl = document.querySelector('#append-mode');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const clearButton = document.querySelector('#clear');
const copyButton = document.querySelector('#copy');
const uploadInput = document.querySelector('#upload');
const meterEl = document.querySelector('#record-visualizer');

const TECH_KEYWORDS = [
  'API',
  'APIs',
  'access control',
  'algorithm',
  'analytics',
  'automation',
  'availability',
  'bandwidth',
  'cloud',
  'cluster',
  'compile',
  'container',
  'cybersecurity',
  'database',
  'data center',
  'debug',
  'deploy',
  'DevOps',
  'disaster recovery',
  'Docker',
  'endpoint',
  'encryption',
  'firewall',
  'framework',
  'Git',
  'integration',
  'infrastructure',
  'Kubernetes',
  'latency',
  'load balancer',
  'microservice',
  'network',
  'pipeline',
  'production',
  'release',
  'repository',
  'scalability',
  'server',
  'service desk',
  'sprint',
  'SQL',
  'throughput',
  'virtual machine',
  'virtualization',
  'workflow',
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapedKeywords = TECH_KEYWORDS.map(escapeRegExp).sort((a, b) => b.length - a.length);
const keywordPattern = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');

const escapeHtml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const highlightTechnicalTerms = (text) => {
  if (!text) return '';
  return escapeHtml(text).replace(keywordPattern, (match) => `<mark>${match}</mark>`);
};

const updateSegmentContent = (segment, text) => {
  segment.dataset.raw = text;
  segment.innerHTML = highlightTechnicalTerms(text);
};

const state = {
  mediaRecorder: null,
  isRecording: false,
  liveSessionId: null,
  liveSegment: null,
  liveBuffer: '',
  chunkQueue: Promise.resolve(),
  awaitingFinalChunk: false,
  provider: 'unknown',
};

const setStatus = (message, tone = 'info') => {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
};

const setRecordingUi = (isRecording) => {
  state.isRecording = isRecording;
  startButton.disabled = isRecording;
  stopButton.disabled = !isRecording;
  meterEl.dataset.active = String(isRecording);
};

const getAccentLabel = () => {
  const option = languageEl.options[languageEl.selectedIndex];
  return option ? option.textContent.trim() : 'English';
};

const formatTranscript = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!autoPunctuateEl.checked) {
    return trimmed;
  }

  const capitalised = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  if (/[.!?…]$/.test(capitalised)) {
    return capitalised;
  }
  return `${capitalised}.`;
};

const renderSegment = (text, source) => {
  const segment = document.createElement('p');
  segment.className = 'transcript__segment';
  segment.dataset.source = source;
  updateSegmentContent(segment, text);

  if (!appendModeEl.checked) {
    transcriptEl.replaceChildren(segment);
  } else {
    transcriptEl.appendChild(segment);
  }

  transcriptEl.scrollTo({ top: transcriptEl.scrollHeight, behavior: 'smooth' });
};

const readTranscriptText = () =>
  Array.from(transcriptEl.querySelectorAll('.transcript__segment'))
    .map((node) => (node.dataset.raw || node.textContent || '').trim())
    .filter(Boolean)
    .join('\n\n');

const ensureLiveSegment = () => {
  if (state.liveSegment && transcriptEl.contains(state.liveSegment)) {
    return state.liveSegment;
  }

  const accentLabel = getAccentLabel();
  const segment = document.createElement('p');
  segment.className = 'transcript__segment transcript__segment--live';
  segment.dataset.source = `Live · ${accentLabel}`;
  segment.dataset.live = 'true';
  segment.textContent = '';

  if (!appendModeEl.checked) {
    transcriptEl.replaceChildren(segment);
  } else {
    transcriptEl.appendChild(segment);
  }

  transcriptEl.scrollTo({ top: transcriptEl.scrollHeight, behavior: 'smooth' });
  state.liveSegment = segment;
  state.liveBuffer = '';
  return segment;
};

const appendLiveText = (chunkText) => {
  if (!chunkText) return;

  const segment = ensureLiveSegment();
  const formatted = formatTranscript(chunkText);

  state.liveBuffer = state.liveBuffer
    ? `${state.liveBuffer} ${formatted}`.trim()
    : formatted;

  updateSegmentContent(segment, state.liveBuffer);
};

const finaliseLiveSegment = () => {
  if (state.liveSegment && transcriptEl.contains(state.liveSegment)) {
    state.liveSegment.dataset.live = 'false';
  }

  state.liveSegment = null;
  state.liveSessionId = null;
  state.awaitingFinalChunk = false;
};

const handleLiveChunk = async (blob, { isFinal = false } = {}) => {
  if (!blob || blob.size === 0) {
    if (isFinal && !state.liveBuffer) {
      setStatus('No speech detected in that recording.', 'warn');
      finaliseLiveSegment();
    }
    return;
  }

  ensureLiveSegment();
  setStatus(isFinal ? 'Finalising live transcription…' : 'Transcribing live audio…');

  const formData = new FormData();
  const fileExtension = blob.type.split('/')[1] || 'webm';
  formData.append('audio', blob, `live-chunk-${Date.now()}.${fileExtension}`);
  formData.append('sessionId', state.liveSessionId || 'live');
  formData.append('accent', languageEl.value);
  formData.append('quality', qualityEl.value);
  formData.append('isFinal', String(isFinal));

  try {
    const response = await fetch('/api/transcribe/live', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const message = errorPayload.error || `Live request failed (${response.status})`;
      throw new Error(message);
    }

    const payload = await response.json();
    const text = (payload.text || '').trim();

    if (text) {
      appendLiveText(text);
      setStatus(
        isFinal ? 'Live transcription complete ✓' : 'Listening for more speech…',
        isFinal ? 'success' : 'info',
      );
    } else if (isFinal && !state.liveBuffer) {
      setStatus('No speech detected in that recording.', 'warn');
      if (state.liveSegment) {
        transcriptEl.removeChild(state.liveSegment);
      }
      state.liveSegment = null;
      state.liveBuffer = '';
      state.liveSessionId = null;
    } else if (isFinal) {
      setStatus('Live transcription complete ✓', 'success');
    }
  } catch (error) {
    console.error('Live transcription error', error);
    setStatus(error.message || 'Live transcription failed. Check server logs.', 'error');
  } finally {
    if (isFinal) {
      finaliseLiveSegment();
    }
  }
};

const queueLiveChunk = (blob, options = {}) => {
  state.chunkQueue = state.chunkQueue.catch(() => {}).then(() => handleLiveChunk(blob, options));
};

const transcribeBlob = async (blob, sourceLabel) => {
  if (!blob || blob.size === 0) {
    setStatus('No audio captured. Try recording again.', 'warn');
    return;
  }

  setStatus('Uploading audio to Whisper GPT…');

  const formData = new FormData();
  const fileExtension = blob.type.split('/')[1] || 'webm';
  formData.append('audio', blob, `speech-${Date.now()}.${fileExtension}`);
  formData.append('accent', languageEl.value);
  formData.append('quality', qualityEl.value);

  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const message = errorPayload.error || `Request failed (${response.status})`;
      throw new Error(message);
    }

    const payload = await response.json();
    const formatted = formatTranscript(payload.text || '');

    if (!formatted) {
      setStatus('No speech detected in that recording.', 'warn');
      return;
    }

    const accentLabel = getAccentLabel();
    renderSegment(formatted, `${sourceLabel} · ${accentLabel}`);
    setStatus('Transcription complete ✓', 'success');
  } catch (error) {
    console.error('Transcription error', error);
    setStatus(error.message || 'Transcription failed. Check server logs.', 'error');
  }
};

const startRecording = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Microphone access is not supported in this browser.', 'error');
    return;
  }

  if (state.isRecording) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: qualityEl.value !== 'studio',
        echoCancellation: qualityEl.value !== 'studio',
        autoGainControl: qualityEl.value === 'mobile',
      },
    });

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined,
    });

    state.liveSessionId = (crypto.randomUUID && crypto.randomUUID())
      || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.chunkQueue = Promise.resolve();
    state.liveBuffer = '';
    state.liveSegment = null;
    state.awaitingFinalChunk = false;

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        const isFinalChunk = state.awaitingFinalChunk || mediaRecorder.state === 'inactive';
        queueLiveChunk(event.data, { isFinal: isFinalChunk });
        state.awaitingFinalChunk = false;
      }
    });

    mediaRecorder.addEventListener('start', () => {
      setRecordingUi(true);
      setStatus('Recording… technical terms will be highlighted automatically.');
    });

    mediaRecorder.addEventListener('stop', async () => {
      setRecordingUi(false);
      stream.getTracks().forEach((track) => track.stop());
      await state.chunkQueue;
      if (!state.liveBuffer) {
        setStatus('No speech detected in that recording.', 'warn');
      }
      state.mediaRecorder = null;
    });

    mediaRecorder.start(1500);
    state.mediaRecorder = mediaRecorder;
  } catch (error) {
    console.error('Unable to access microphone', error);
    setStatus('Unable to start recording. Check microphone permissions.', 'error');
    setRecordingUi(false);
  }
};

const stopRecording = () => {
  if (!state.mediaRecorder) return;
  if (state.mediaRecorder.state === 'inactive') return;
  setStatus('Finalising recording…');
  state.awaitingFinalChunk = true;
  state.mediaRecorder.stop();
};

startButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);

clearButton.addEventListener('click', () => {
  transcriptEl.replaceChildren();
  setStatus('Transcript cleared.');
});

copyButton.addEventListener('click', async () => {
  const text = readTranscriptText();
  if (!text) {
    setStatus('Nothing to copy yet.', 'warn');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus('Transcript copied to clipboard.', 'success');
  } catch (error) {
    console.error('Clipboard error', error);
    setStatus('Clipboard copy failed. Try again.', 'error');
  }
});

uploadInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  setStatus(`Uploading ${file.name}…`);
  await transcribeBlob(file, 'Upload');
  uploadInput.value = '';
});

const hydrateProviderDetails = async () => {
  setStatus('Preparing transcription engine…');

  try {
    const response = await fetch('/api/status');
    if (!response.ok) {
      throw new Error(`Status request failed (${response.status})`);
    }

    const payload = await response.json();
    state.provider = payload.provider || 'unknown';

    const providerLabel =
      state.provider === 'huggingface'
        ? 'Hugging Face Whisper GPT'
        : `Local Whisper (${payload?.local?.modelId || 'Xenova/whisper-small.en'})`;

    if (providerEl) {
      providerEl.textContent = providerLabel;
      providerEl.dataset.provider = state.provider;
    }

    if (state.provider === 'huggingface') {
      setStatus('Ready to capture speech with low-latency Hugging Face inference.');
    } else {
      setStatus('Ready to capture speech with on-device Whisper transcription.');
    }
  } catch (error) {
    console.warn('Unable to determine provider', error);
    state.provider = 'unknown';
    if (providerEl) {
      providerEl.textContent = 'Transcriber not initialised';
      providerEl.dataset.provider = 'unknown';
    }
    setStatus('Ready to capture speech. Configure the server if you encounter issues.', 'warn');
  }
};

if (!window.MediaRecorder) {
  setStatus('MediaRecorder is not supported. Use the upload button instead.', 'warn');
  startButton.disabled = true;
  stopButton.disabled = true;
} else {
  hydrateProviderDetails();
}
