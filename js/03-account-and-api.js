(() => {
  const GOOGLE_CLIENT_ID = '52788138271-h7kenp1gibepd167jcrdodntk7tjrmvp.apps.googleusercontent.com';
  const dialog = document.querySelector('#accountDialog');
  const completeGoogleSignIn = response => {
    try {
      const payload = JSON.parse(atob(response.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.email) throw new Error('No email returned');
      localStorage.setItem(
        ACCOUNT,
        JSON.stringify({ email: payload.email, name: payload.name || '', picture: payload.picture || '' }),
      );
      location.reload();
    } catch {
      document
        .querySelector('#accountEmail')
        .setCustomValidity('Google sign-in could not be completed. Please try again.');
      document.querySelector('#accountEmail').reportValidity();
    }
  };
  window.initGoogleSignIn = () => {
    if (!window.google || !google.accounts?.id) return;
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: completeGoogleSignIn });
    google.accounts.id.renderButton(document.querySelector('#googleSignIn'), {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: 300,
    });
  };
  window.addEventListener('load', window.initGoogleSignIn);
  const email = document.querySelector('#accountEmail');
  const openAccount = () => {
    const saved = account();
    email.value = saved ? saved.email : '';
    if (!dialog.open) dialog.showModal();
    email.focus();
  };
  document.querySelector('#signIn').onclick = openAccount;
  document.querySelector('#account').onclick = openAccount;
  document.querySelector('#cancelAccount').onclick = () => dialog.close();
  document.querySelector('#saveAccount').onclick = () => {
    const value = email.value.trim();
    if (!email.checkValidity()) {
      email.reportValidity();
      return;
    }
    localStorage.setItem(ACCOUNT, JSON.stringify({ email: value }));
    location.reload();
  };

  const refreshSettings = () =>
    document
      .querySelectorAll('[data-key]')
      .forEach(button => button.classList.toggle('active', prefs[button.dataset.key] === button.dataset.value));
  const openCustomSettings = () => {
    const settings = document.querySelector('#settingsDialog');
    refreshSettings();
    if (!settings.open) settings.showModal();
  };
  document.querySelector('#homeSettings').onclick = openCustomSettings;
  document.querySelector('#workspaceSettings').onclick = openCustomSettings;
  document.querySelectorAll('[data-key]').forEach(button => {
    button.onclick = () => {
      prefs[button.dataset.key] = button.dataset.value;
      if (button.dataset.key === 'theme' && button.dataset.value === 'dark') prefs.background = 'warm';
      if (button.dataset.key === 'background' && button.dataset.value === 'clean') prefs.theme = 'light';
      applyPrefs();
      refreshSettings();
    };
  });
  const tunnel = document.querySelector('#apiTunnel');
  const TUNNEL_KEY = 'squiggly-api-tunnel-v1';
  tunnel.value = localStorage.getItem(TUNNEL_KEY) || '';
  tunnel.oninput = () => localStorage.setItem(TUNNEL_KEY, tunnel.value.trim());
  const openaiKey = document.querySelector('#openaiKey');
  const OPENAI_KEY = 'squiggly-openai-key-session';
  openaiKey.value = sessionStorage.getItem(OPENAI_KEY) || '';
  openaiKey.oninput = () => sessionStorage.setItem(OPENAI_KEY, openaiKey.value.trim());
  window.resolveApiTunnel = (entered, action) => {
    const endpoint = String(action).replace(/^\/+|\/+$/g, '');
    const url = new URL(entered);
    const knownEndpoint = /\/(?:chat|tts|transcribe|rewrite)\/?$/;
    let basePath = url.pathname.replace(/\/+$/, '');
    if (knownEndpoint.test(url.pathname)) basePath = url.pathname.replace(knownEndpoint, '').replace(/\/+$/, '');
    url.pathname = (basePath || '') + '/' + endpoint;
    return url.toString();
  };
  window.apiEndpoint = action => {
    const entered = tunnel.value.trim();
    if (!entered) return action === 'rewrite' ? '/api/concise' : '/api/transcribe';
    return window.resolveApiTunnel(entered, action);
  };
  let recorder,
    audioChunks = [];
  const mic = document.querySelector('#transcribe');
  mic.onclick = async () => {
    const status = document.querySelector('#status');
    if (recorder?.state === 'recording') {
      recorder.stop();
      return;
    }
    if (!tunnel.value.trim()) {
      status.textContent = 'Add your rewrite tunnel URL first.';
      status.className = 'status error';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = event => {
        if (event.data.size) audioChunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        mic.innerHTML = window.microphoneGlyph;
        mic.disabled = true;
        status.textContent = 'Transcribing…';
        status.className = 'status';
        try {
          const audioBlob = new Blob(audioChunks, { type: recorder.mimeType || 'audio/wav' });
          const formData = new FormData();
          formData.append('file', audioBlob, 'audio.wav');
          const response = await window.transcribeWithFallback(formData);
          if (!response.ok) throw new Error();
          const data = await response.json();
          const transcript = data.text || data.transcript || data.result;
          if (!transcript) throw new Error();
          document.querySelector('#editor').innerText +=
            (document.querySelector('#editor').innerText ? '\n\n' : '') + transcript;
          edit();
          status.textContent = 'Transcript added to your note.';
          status.className = 'status good';
        } catch {
          status.textContent = 'Could not transcribe the recording.';
          status.className = 'status error';
        } finally {
          mic.disabled = false;
        }
      };
      recorder.start();
      mic.innerHTML = '&#9632;';
      status.textContent = 'Recording… click the microphone again to transcribe.';
      status.className = 'status';
    } catch {
      status.textContent = 'Microphone access was not available.';
      status.className = 'status error';
    }
  };
  const feedbackDialog = document.querySelector('#feedbackDialog');
  window.showFeedback = (title, message, suggestion) => {
    document.querySelector('#feedbackTitle').textContent = title;
    document.querySelector('#feedbackMessage').textContent = message;
    document.querySelector('#feedbackSuggestion').textContent = suggestion;
    if (!feedbackDialog.open) feedbackDialog.showModal();
  };
  document.querySelector('#closeFeedback').onclick = () => feedbackDialog.close();
  const endpointProblem = (action, error) => {
    const detail = error.message || '';
    if (action === 'rewrite' && sessionStorage.getItem(OPENAI_KEY))
      return [
        'OpenAI request failed',
        'The browser could not complete the request with the entered API key.',
        'Check that the key is active and has API billing. If the browser blocks the request, use your ngrok rewrite endpoint instead.',
      ];
    if (!tunnel.value.trim())
      return [
        `Add a ${action} endpoint`,
        'No API tunnel URL is configured.',
        'Paste your ngrok rewrite URL into API tunnel below Edit history.',
      ];
    if (detail.startsWith('HTTP 401') || detail.startsWith('HTTP 403'))
      return [
        'Tunnel rejected the request',
        'The API returned ' + detail + '.',
        'Check your ngrok access policy and that the tunnel is public.',
      ];
    if (detail.startsWith('HTTP 404'))
      return [
        `${action} endpoint not found`,
        'The API returned HTTP 404.',
        action === 'rewrite'
          ? 'Confirm the URL ends in /rewrite.'
          : 'Confirm the rewrite URL maps to a /transcribe route.',
      ];
    return [
      `Could not ${action}`,
      'The tunnel could not be reached or returned an invalid response.',
      'Check that ngrok is running, the URL is current, and the API allows this browser origin.',
    ];
  };
  document.querySelector('#concise').onclick = async () => {
    const editor = document.querySelector('#editor');
    const text = editor.innerText.trim();
    if (!text) {
      showFeedback(
        'Nothing to rewrite',
        'Your active note is empty.',
        'Write or paste text into the note, then try Make concise again.',
      );
      return;
    }
    const button = document.querySelector('#concise');
    const status = document.querySelector('#status');
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      const apiKey = sessionStorage.getItem(OPENAI_KEY);
      const useOpenAI = !!apiKey;
      const response = await fetch(
        useOpenAI ? 'https://api.openai.com/v1/chat/completions' : apiEndpoint('rewrite'),
        useOpenAI
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
              body: JSON.stringify({
                model: 'gpt-5-mini',
                messages: [
                  {
                    role: 'system',
                    content:
                      'Rewrite the user text to be concise while preserving its meaning. Return only the revised text.',
                  },
                  { role: 'user', content: text },
                ],
              }),
            }
          : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) },
      );
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const revised = data.text || data.concise || data.result || data.choices?.[0]?.message?.content;
      if (!revised) throw new Error('The rewrite response did not contain text.');
      editor.textContent = revised;
      edit();
      status.textContent = 'Concise version ready.';
      status.className = 'status good';
    } catch (error) {
      const problem = endpointProblem('rewrite', error);
      status.textContent = problem[0];
      status.className = 'status error';
      showFeedback(...problem);
    } finally {
      button.disabled = false;
      button.textContent = 'Make concise';
    }
  };
  let audioRecorder,
    recordedChunks = [];
  const recordButton = document.querySelector('#transcribe');
  recordButton.onclick = async () => {
    const status = document.querySelector('#status');
    if (audioRecorder?.state === 'recording') {
      audioRecorder.stop();
      return;
    }
    if (!tunnel.value.trim()) {
      const problem = endpointProblem('transcription', new Error());
      status.textContent = problem[0];
      status.className = 'status error';
      showFeedback(...problem);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      audioRecorder = new MediaRecorder(stream);
      audioRecorder.ondataavailable = event => {
        if (event.data.size) recordedChunks.push(event.data);
      };
      audioRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        recordButton.innerHTML = window.microphoneGlyph;
        recordButton.disabled = true;
        status.textContent = 'Transcribing…';
        status.className = 'status';
        try {
          const formData = new FormData();
          formData.append(
            'file',
            new Blob(recordedChunks, { type: audioRecorder.mimeType || 'audio/wav' }),
            'audio.wav',
          );
          const response = await window.transcribeWithFallback(formData);
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          const transcript = data.text || data.transcript || data.result;
          if (!transcript) throw new Error('The transcription response did not contain text.');
          const editor = document.querySelector('#editor');
          editor.innerText += (editor.innerText ? '\n\n' : '') + transcript;
          edit();
          status.textContent = 'Transcript added to your note.';
          status.className = 'status good';
        } catch (error) {
          const problem = endpointProblem('transcription', error);
          status.textContent = problem[0];
          status.className = 'status error';
          showFeedback(...problem);
        } finally {
          recordButton.disabled = false;
        }
      };
      audioRecorder.start();
      recordButton.innerHTML = '&#9632;';
      status.textContent = 'Recording… click the microphone again to transcribe.';
      status.className = 'status';
    } catch (error) {
      const message =
        error.name === 'NotAllowedError' ? 'Microphone access was denied.' : 'A microphone could not be started.';
      status.textContent = message;
      status.className = 'status error';
      showFeedback(
        'Microphone unavailable',
        message,
        'Allow microphone access in your browser settings, then try again.',
      );
    }
  };
})();
