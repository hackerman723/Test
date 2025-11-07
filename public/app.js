const statusEl = document.querySelector('#status');
const transcriptEl = document.querySelector('#transcript');
const languageEl = document.querySelector('#language');
const continuousEl = document.querySelector('#continuous');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const clearButton = document.querySelector('#clear');
const copyButton = document.querySelector('#copy');
const unsupportedTemplate = document.querySelector('#no-support');

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition;

if (!SpeechRecognition) {
  const clone = unsupportedTemplate.content.cloneNode(true);
  document.querySelector('main').replaceWith(clone);
  statusEl.textContent = 'Speech recognition is unavailable in this browser.';
  startButton.disabled = true;
  stopButton.disabled = true;
  clearButton.disabled = true;
  copyButton.disabled = true;
} else {
  const recognition = new SpeechRecognition();
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalTranscript = '';
  let shouldAutoRestart = false;

  const updateStatus = (message) => {
    statusEl.textContent = message;
  };

  const setActiveState = (active) => {
    startButton.disabled = active;
    stopButton.disabled = !active;
    languageEl.disabled = active;
    continuousEl.disabled = active;
  };

  recognition.addEventListener('result', (event) => {
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;

      if (result.isFinal) {
        finalTranscript += `${text}\n`;
      } else {
        interimTranscript += `${text} `;
      }
    }

    const combined = `${finalTranscript}${interimTranscript}`.trim();
    transcriptEl.value = combined;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  });

  recognition.addEventListener('speechstart', () => updateStatus('Listening…'));
  recognition.addEventListener('speechend', () => updateStatus('Speech ended. Processing…'));
  recognition.addEventListener('start', () => {
    shouldAutoRestart = continuousEl.checked;
  });

  recognition.addEventListener('end', () => {
    setActiveState(false);
    if (shouldAutoRestart && continuousEl.checked) {
      recognition.start();
      setActiveState(true);
    } else {
      updateStatus('Recognition stopped.');
    }
  });

  recognition.addEventListener('error', (event) => {
    console.error('Speech recognition error', event.error);
    updateStatus(`Error: ${event.error}`);
    setActiveState(false);
  });

  const startRecognition = () => {
    finalTranscript = transcriptEl.value ? `${transcriptEl.value}\n` : '';
    recognition.lang = languageEl.value;
    recognition.continuous = continuousEl.checked;
    shouldAutoRestart = continuousEl.checked;

    try {
      recognition.start();
      setActiveState(true);
      updateStatus('Microphone activated. Speak now…');
    } catch (error) {
      console.error('Unable to start recognition', error);
      updateStatus('Unable to start recognition. Try again.');
    }
  };

  startButton.addEventListener('click', startRecognition);

  stopButton.addEventListener('click', () => {
    shouldAutoRestart = false;
    recognition.stop();
    setActiveState(false);
    updateStatus('Stopping recognition…');
  });

  clearButton.addEventListener('click', () => {
    finalTranscript = '';
    transcriptEl.value = '';
    updateStatus('Transcript cleared.');
  });

  copyButton.addEventListener('click', async () => {
    const text = transcriptEl.value.trim();
    if (!text) {
      updateStatus('Nothing to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      updateStatus('Transcript copied to clipboard.');
    } catch (error) {
      console.error('Clipboard error', error);
      updateStatus('Clipboard copy failed.');
    }
  });
}
