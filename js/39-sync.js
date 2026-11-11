// Keeps notes, to-dos, chats, settings and recordings in sync with the signed-in account.
//
// Each collection is synced with a three-way merge: this computer's copy, the account's copy on
// the server, and the last copy both agreed on (the "base", kept in localStorage). Comparing
// each item with the base shows which side changed it, so an edit here and a deletion elsewhere,
// or two edits to different notes, are both kept. When both sides changed the same item, the
// more recently edited one wins.
(() => {
  const session = account();
  window.squigglySyncStatus = '';
  window.squigglySync = { now: async () => false };
  if (!session?.token) return;

  const API = window.SQUIGGLY_API;
  const BASE = 'squiggly-sync-base-' + OWNER + '-';
  const AUDIO_SYNCED = 'squiggly-audio-synced-' + OWNER;
  const nativeSetItem = Storage.prototype.setItem;
  const read = key => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  };
  // Writes without counting as a local change (used when applying what came from the server).
  const write = (key, value) => nativeSetItem.call(localStorage, key, JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const changed = name => document.dispatchEvent(new CustomEvent('squiggly-synced', { detail: name }));

  // ------------------------------------------------------------------ merging
  const lastTouched = item =>
    Math.max(item?.edited || 0, item?.created || 0, ...(item?.messages || []).map(message => message.time || 0));
  const mergeLists = (base, local, remote) => {
    const byId = list => new Map((Array.isArray(list) ? list : []).filter(item => item?.id).map(item => [item.id, item]));
    const B = byId(base), L = byId(local), R = byId(remote);
    const ids = [...R.keys(), ...L.keys()].filter((id, index, all) => all.indexOf(id) === index);
    const merged = [];
    for (const id of ids) {
      const b = B.get(id), l = L.get(id), r = R.get(id);
      if (l && r) {
        const localChanged = !same(l, b), remoteChanged = !same(r, b);
        merged.push(localChanged && remoteChanged ? (lastTouched(r) > lastTouched(l) ? r : l) : remoteChanged ? r : l);
      } else if (l) {
        if (!b || !same(l, b)) merged.push(l); // new here, or edited here after another computer deleted it
      } else if (r) {
        if (!b || !same(r, b)) merged.push(r); // new elsewhere, or edited elsewhere after this computer deleted it
      }
    }
    return merged;
  };
  const mergeSettings = (base, local, remote) => {
    const merged = { ...(remote || {}) };
    for (const [key, value] of Object.entries(local || {})) if (!same(value, base?.[key])) merged[key] = value;
    return merged;
  };

  // ------------------------------------------------------------------ what is synced
  const isBlankChat = chat => !chat.messages?.length && chat.title === 'New chat';
  const notesKey = KEY + '-' + OWNER;
  const todosKey = 'squiggly-todos-v1-' + OWNER;
  const collections = {
    notes: {
      key: notesKey,
      empty: [],
      // Nothing saved yet means a computer new to this account: its placeholder note shouldn't be uploaded.
      get: () => read(notesKey)?.notes || [],
      set: notes => {
        state.notes = notes.length ? notes : [blank()];
        if (!state.notes.some(note => note.id === state.activeId)) state.activeId = state.notes[0].id;
        write(notesKey, state);
        render();
      },
      merge: mergeLists,
    },
    todos: {
      key: todosKey,
      empty: [],
      get: () => read(todosKey) || [],
      set: list => {
        write(todosKey, list);
        changed('todos');
      },
      merge: mergeLists,
    },
    // Untouched "New chat" tabs stay on their own computer; otherwise every computer's blank
    // starting chat would pile up everywhere.
    chats: {
      key: CHAT_STORE,
      empty: [],
      get: () => (read(CHAT_STORE)?.items || []).filter(chat => !isBlankChat(chat)),
      set: items => {
        const data = read(CHAT_STORE) || {};
        data.items = [...items, ...(data.items || []).filter(isBlankChat)];
        if (!data.items.length) data.items = [{ id: crypto.randomUUID(), title: 'New chat', messages: [], created: Date.now() }];
        if (!data.items.some(chat => chat.id === data.activeId)) data.activeId = data.items[0].id;
        write(CHAT_STORE, data);
        changed('chats');
      },
      merge: (base, local, remote) => mergeLists(base, local, remote).filter(chat => !isBlankChat(chat)),
    },
    prefs: {
      key: PREF,
      empty: {},
      get: () => read(PREF) || {},
      set: value => {
        prefs = value;
        applyPrefs();
      },
      merge: mergeSettings,
    },
  };
  const watched = new Set(Object.values(collections).map(c => c.key));

  // ------------------------------------------------------------------ talking to the server
  class SignedOut extends Error {}
  const api = async (path, options = {}) => {
    const response = await fetch(API + path, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: 'Bearer ' + session.token },
    });
    if (response.status === 401) throw new SignedOut('Your session ended');
    return response;
  };

  const syncDocuments = async () => {
    const response = await api('/sync');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const { docs } = await response.json();
    let retry = false;
    for (const [name, collection] of Object.entries(collections)) {
      let remote = docs[name];
      for (let attempt = 0; attempt < 4; attempt++) {
        const base = read(BASE + name);
        const local = collection.get();
        const remoteData = remote.data ?? collection.empty;
        const merged = collection.merge(base?.data ?? collection.empty, local, remoteData);
        if (!same(merged, local)) {
          // Someone typed while this was in flight: leave it for the next round rather than overwrite it.
          if (!same(collection.get(), local)) {
            retry = true;
            break;
          }
          collection.set(merged);
        }
        if (remote.version && same(merged, remoteData)) {
          write(BASE + name, { version: remote.version, data: merged });
          break;
        }
        const put = await api('/sync/' + name, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base_version: remote.version, data: merged }),
        });
        const result = await put.json();
        if (put.ok) {
          write(BASE + name, { version: result.version, data: merged });
          break;
        }
        if (put.status !== 409) throw new Error(result.detail || 'HTTP ' + put.status);
        remote = { version: result.version, data: result.data }; // another computer saved first; merge again
      }
    }
    return retry;
  };

  // ------------------------------------------------------------------ recordings
  const recordings = (mode, action) =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('recordings', mode);
        const result = action(transaction.objectStore('recordings'));
        transaction.oncomplete = () => resolve(result?.result);
        transaction.onerror = () => reject(transaction.error);
      };
    });

  // Recordings made as a guest on this computer join the account the first time it signs in here.
  const adoptGuestRecordings = async () => {
    const flag = 'squiggly-adopt-guest-audio-' + OWNER;
    if (!localStorage.getItem(flag)) return;
    const guest = await new Promise(resolve => {
      const request = indexedDB.open('squiggly-recordings-guest', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
      request.onerror = () => resolve([]);
      request.onsuccess = () => {
        const all = request.result.transaction('recordings').objectStore('recordings').getAll();
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => resolve([]);
      };
    });
    if (guest.length) await recordings('readwrite', store => guest.forEach(item => store.put(item)));
    localStorage.removeItem(flag);
  };

  const syncRecordings = async () => {
    await adoptGuestRecordings();
    const local = await recordings('readonly', store => store.getAll());
    const response = await api('/sync/audio');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const remote = (await response.json()).recordings;
    const known = read(AUDIO_SYNCED) || {}; // id -> name last agreed with the server
    const localById = new Map(local.map(item => [item.id, item]));
    const remoteIds = new Set(remote.map(item => item.id));
    let libraryChanged = false;
    const upload = async (item, withFile) => {
      const form = new FormData();
      form.append('meta', JSON.stringify({ name: item.name, fileName: item.fileName, created: item.created }));
      if (withFile) form.append('file', item.blob, item.fileName || item.name + '.wav');
      const put = await api('/sync/audio/' + encodeURIComponent(item.id), { method: 'PUT', body: form });
      if (!put.ok) throw new Error('Uploading a recording failed (HTTP ' + put.status + ')');
      known[item.id] = item.name;
    };
    for (const item of remote) {
      const mine = localById.get(item.id);
      if (item.deleted) {
        if (mine) {
          await recordings('readwrite', store => store.delete(item.id));
          libraryChanged = true;
        }
        delete known[item.id];
      } else if (!mine) {
        if (item.id in known) {
          await api('/sync/audio/' + encodeURIComponent(item.id), { method: 'DELETE' }); // deleted on this computer
          delete known[item.id];
        } else {
          const file = await api('/sync/audio/' + encodeURIComponent(item.id) + '/file');
          if (!file.ok) continue;
          const blob = new Blob([await file.blob()], { type: 'audio/wav' });
          await recordings('readwrite', store =>
            store.put({ id: item.id, name: item.name, fileName: item.fileName, created: item.created, blob }),
          );
          known[item.id] = item.name;
          libraryChanged = true;
        }
      } else if (mine.name !== item.name) {
        if (mine.name !== known[item.id]) await upload(mine, false); // renamed here
        else {
          await recordings('readwrite', store => store.put({ ...mine, name: item.name })); // renamed elsewhere
          known[item.id] = item.name;
          libraryChanged = true;
        }
      } else known[item.id] = item.name;
    }
    for (const item of local) if (!remoteIds.has(item.id)) await upload(item, true);
    write(AUDIO_SYNCED, known);
    if (libraryChanged) window.refreshAudioLibrary?.();
  };

  // ------------------------------------------------------------------ when to sync
  const setStatus = (short, detail) => {
    window.squigglySyncStatus = short;
    window.squigglySyncDetail = detail;
    renderIdentity();
    const line = document.querySelector('#accountSyncStatus');
    if (line) line.textContent = detail;
  };

  let running = null;
  let timer = null;
  let lastInput = 0;
  let stopped = false;

  const syncOnce = async () => {
    if (stopped) return false;
    setStatus('Syncing…', 'Syncing…');
    try {
      const retry = await syncDocuments();
      await syncRecordings();
      setStatus('Synced', 'Everything is synced (last checked ' + new Date().toLocaleTimeString() + ').');
      if (retry) schedule(3000);
      return true;
    } catch (problem) {
      if (problem instanceof SignedOut) {
        stopped = true;
        // Keep the notes here, but stop syncing until they sign in again.
        localStorage.setItem(ACCOUNT, JSON.stringify({ email: session.email, name: session.name || '' }));
        setStatus('signed out', 'Your session ended. Sign in again to keep syncing.');
        return false;
      }
      console.warn('Sync failed; will retry.', problem);
      setStatus('offline', "Can't reach the Squiggly server right now. Changes are saved here and will sync when it's back.");
      return false;
    } finally {
      running = null;
    }
  };

  const run = () => (running ||= syncOnce());
  function schedule(delay = 1500) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Don't change the page under someone who is typing; try again once they pause.
      const sinceInput = Date.now() - lastInput;
      if (sinceInput < 4000) return schedule(4100 - sinceInput);
      if (running) return schedule(2000);
      run();
    }, delay);
  }

  Storage.prototype.setItem = function (key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && watched.has(key)) schedule();
  };
  document.addEventListener('input', () => (lastInput = Date.now()), true);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedule(0));
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('squiggly-audio-saved', () => schedule());
  setInterval(() => schedule(0), 30000);

  window.squigglySync = {
    // Used by "Sync now" and before signing out: waits for any sync in progress, then runs one.
    now: async () => {
      clearTimeout(timer);
      if (running) await running;
      return run();
    },
  };
  schedule(0);
})();
