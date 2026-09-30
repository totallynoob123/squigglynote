(() => {
  const STORE = 'squiggly-chat-sessions-v1',
    panel = document.querySelector('#notesChatPanel'),
    deleteButton = document.querySelector('#deleteChat');
  if (!panel || !deleteButton || document.querySelector('#renameChat')) return;
  const getDialog = () => {
    let modal = document.querySelector('#renameChatDialog');
    if (modal) return modal;
    modal = document.createElement('dialog');
    modal.id = 'renameChatDialog';
    modal.innerHTML =
      '<form method="dialog" class="rename-chat-card"><h3>Rename chat</h3><label for="renameChatInput">Chat name</label><input id="renameChatInput" name="chatName" maxlength="80" autocomplete="off" required><div class="rename-chat-actions"><button type="button" class="btn" data-action="cancel">Cancel</button><button type="submit" class="btn" data-action="save">Save</button></div></form>';
    document.body.append(modal);
    modal.querySelector('[data-action="cancel"]').onclick = () => modal.close();
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.close();
    });
    modal.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const name = modal.querySelector('#renameChatInput').value.trim();
      if (!name) return;
      const data = JSON.parse(localStorage.getItem(STORE) || 'null'),
        chat = data?.items?.find(item => item.id === data.activeId);
      if (!chat) return;
      chat.title = name;
      localStorage.setItem(STORE, JSON.stringify(data));
      location.reload();
    };
    return modal;
  };
  const button = document.createElement('button');
  button.className = 'btn';
  button.id = 'renameChat';
  button.type = 'button';
  button.textContent = 'Rename';
  button.title = 'Rename current chat';
  button.onclick = () => {
    const data = JSON.parse(localStorage.getItem(STORE) || 'null'),
      chat = data?.items?.find(item => item.id === data.activeId);
    if (!chat) return;
    const modal = getDialog();
    const input = modal.querySelector('#renameChatInput');
    input.value = chat.title || '';
    modal.showModal();
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  };
  deleteButton.insertAdjacentElement('beforebegin', button);
})();
