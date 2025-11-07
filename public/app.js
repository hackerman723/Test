const statusEl = document.querySelector('#status');
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

const state = {
  mediaRecorder: null,
  audioChunks: [],
  isRecording: false,
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
  segment.textContent = text;

  if (!appendModeEl.checked) {
    transcriptEl.replaceChildren(segment);
  } else {
    transcriptEl.appendChild(segment);
  }

  transcriptEl.scrollTo({ top: transcriptEl.scrollHeight, behavior: 'smooth' });
};

const readTranscriptText = () =>
  Array.from(transcriptEl.querySelectorAll('.transcript__segment'))
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .join('\n\n');

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

    state.audioChunks = [];

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('start', () => {
      setRecordingUi(true);
      setStatus('Recording… speak naturally and tap stop when finished.');
    });

    mediaRecorder.addEventListener('stop', async () => {
      setRecordingUi(false);
      setStatus('Processing recording…');
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(state.audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      state.audioChunks = [];
      await transcribeBlob(blob, 'Live');
      state.mediaRecorder = null;
    });

    mediaRecorder.start();
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

if (!window.MediaRecorder) {
  setStatus('MediaRecorder is not supported. Use the upload button instead.', 'warn');
  startButton.disabled = true;
  stopButton.disabled = true;
} else {
  setStatus('Ready to capture speech.');
}
