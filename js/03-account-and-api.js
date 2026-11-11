(() => {
  const GOOGLE_CLIENT_ID = '52788138271-h7kenp1gibepd167jcrdodntk7tjrmvp.apps.googleusercontent.com';
  const dialog = document.querySelector('#accountDialog');
  const form = document.querySelector('#accountForm');
  const email = document.querySelector('#accountEmail');
  const password = document.querySelector('#accountPassword');
  const nameInput = document.querySelector('#accountName');
  const error = document.querySelector('#accountError');
  const submit = document.querySelector('#saveAccount');
  const toggle = document.querySelector('#accountModeToggle');
  let creating = false;

  const authRequest = async (path, body) => {
    let response;
    try {
      response = await fetch(window.SQUIGGLY_API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Can't reach the Squiggly server right now. Try again in a minute.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Sign-in failed (HTTP ' + response.status + ').');
    return data;
  };

  // The first time an account is used on this computer, the guest notes, to-dos, chats and
  // recordings already here are copied into it, so they sync instead of being left behind.
  const adoptGuestData = owner => {
    if (OWNER !== 'guest' || localStorage.getItem(KEY + '-' + owner)) return;
    const copy = (from, to) => {
      const value = localStorage.getItem(from);
      if (value && !localStorage.getItem(to)) localStorage.setItem(to, value);
    };
    copy(localStorage.getItem(KEY + '-guest') ? KEY + '-guest' : KEY, KEY + '-' + owner);
    copy('squiggly-todos-v1-guest', 'squiggly-todos-v1-' + owner);
    copy('squiggly-chat-sessions-v1', 'squiggly-chat-sessions-v1-' + owner);
    localStorage.setItem('squiggly-adopt-guest-audio-' + owner, '1');
  };

  const finishSignIn = ({ token, user }) => {
    const owner = user.email.toLowerCase();
    adoptGuestData(owner);
    localStorage.setItem(ACCOUNT, JSON.stringify({ email: user.email, name: user.name || '', token }));
    location.reload();
  };

  const showError = message => {
    error.className = 'status error';
    error.textContent = message;
  };

  const completeGoogleSignIn = async response => {
    try {
      finishSignIn(await authRequest('/auth/google', { credential: response.credential }));
    } catch (problem) {
      showError(problem.message);
    }
  };

  const setMode = create => {
    creating = create;
    document.querySelector('#accountHeading').textContent = create ? 'Create an account' : 'Sign in';
    submit.textContent = create ? 'Create account' : 'Sign in';
    toggle.textContent = create ? 'Already have an account? Sign in' : 'New here? Create an account';
    password.autocomplete = create ? 'new-password' : 'current-password';
    nameInput.hidden = !create;
    nameInput.previousElementSibling.hidden = !create;
    error.textContent = '';
  };
  toggle.onclick = () => setMode(!creating);

  form.onsubmit = async event => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const body = { email: email.value.trim(), password: password.value };
      if (creating) body.name = nameInput.value.trim();
      finishSignIn(await authRequest(creating ? '/auth/register' : '/auth/login', body));
    } catch (problem) {
      showError(problem.message);
    } finally {
      submit.disabled = false;
    }
  };

  // Removes an account's notes, to-dos, chats and recordings from this browser
  // (they stay in the account), so signing out of a shared computer leaves nothing behind.
  const forgetThisComputer = owner =>
    new Promise(resolve => {
      [KEY + '-' + owner, 'squiggly-todos-v1-' + owner, 'squiggly-chat-sessions-v1-' + owner, 'squiggly-audio-synced-' + owner]
        .concat(Object.keys(localStorage).filter(key => key.startsWith('squiggly-sync-base-' + owner + '-')))
        .forEach(key => localStorage.removeItem(key));
      const request = indexedDB.open('squiggly-recordings-' + owner, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const transaction = request.result.transaction('recordings', 'readwrite');
        transaction.objectStore('recordings').clear();
        transaction.oncomplete = transaction.onerror = () => resolve();
      };
    });

  const signOut = async keepOnThisComputer => {
    const session = account();
    fetch(window.SQUIGGLY_API + '/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token },
    }).catch(() => {});
    if (!keepOnThisComputer) await forgetThisComputer(OWNER);
    localStorage.removeItem(ACCOUNT);
    location.reload();
  };

  document.querySelector('#signOut').onclick = async () => {
    const button = document.querySelector('#signOut');
    button.disabled = true;
    document.querySelector('#accountSyncStatus').textContent = 'Saving your latest changes…';
    const synced = await window.squigglySync?.now();
    button.disabled = false;
    if (synced) return signOut(false);
    openConfirm(
      'Sign out without syncing?',
      "Your latest changes couldn't be saved to your account. If you sign out now they stay on this computer only.",
      () => signOut(true),
    );
  };

  document.querySelector('#deleteAccount').onclick = () =>
    openConfirm(
      'Delete your account?',
      'This permanently deletes your account and everything synced to it, from every computer. This cannot be undone.',
      async () => {
        const response = await fetch(window.SQUIGGLY_API + '/auth/account', {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + account().token },
        }).catch(() => null);
        if (!response?.ok) {
          showFeedback('Could not delete the account', "The Squiggly server couldn't be reached.", 'Try again in a minute.');
          return;
        }
        await forgetThisComputer(OWNER);
        localStorage.removeItem(ACCOUNT);
        location.reload();
      },
    );

  document.querySelector('#syncNow').onclick = () => window.squigglySync?.now();
  document.querySelector('#closeAccount').onclick = () => dialog.close();

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
  const openAccount = () => {
    const saved = account();
    const signedIn = !!saved?.token;
    document.querySelector('#accountSignedOut').hidden = signedIn;
    document.querySelector('#accountSignedIn').hidden = !signedIn;
    if (signedIn) {
      document.querySelector('#accountWho').textContent = saved.email;
      document.querySelector('#accountSyncStatus').textContent = window.squigglySyncDetail || '';
    } else {
      setMode(false);
      email.value = saved?.email || '';
      password.value = '';
      // Older versions "signed in" with just an email and no password; those need a real account to sync.
      if (saved) {
        error.className = 'status';
        error.textContent = 'Sign in, or create an account with this email, to start syncing your notes.';
      }
    }
    if (!dialog.open) dialog.showModal();
    (signedIn ? document.querySelector('#closeAccount') : email.value ? password : email).focus();
  };
  document.querySelector('#signIn').onclick = openAccount;
  document.querySelector('#account').onclick = openAccount;
  document.querySelector('#cancelAccount').onclick = () => dialog.close();

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
