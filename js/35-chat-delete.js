(() => {
  const STORE = 'squiggly-chat-sessions-v1',
    panel = document.querySelector('#notesChatPanel');
  if (!panel || document.querySelector('#deleteChat')) return;
  const remove = () => {
    const data = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!data?.items?.length) return;
    data.items = data.items.filter(item => item.id !== data.activeId);
    if (!data.items.length)
      data.items = [{ id: crypto.randomUUID(), title: 'New chat', messages: [], created: Date.now() }];
    data.activeId = data.items[0].id;
    localStorage.setItem(STORE, JSON.stringify(data));
    location.reload();
  };
  const getDialog = () => {
    let modal = document.querySelector('#deleteChatDialog');
    if (modal) return modal;
    modal = document.createElement('dialog');
    modal.id = 'deleteChatDialog';
    modal.innerHTML =
      '<div class="delete-chat-card"><h3>Delete chat?</h3><p id="deleteChatMessage"></p><div class="delete-chat-actions"><button type="button" class="btn" data-action="cancel">Cancel</button><button type="button" class="btn delete-chat-confirm" data-action="delete">Delete chat</button></div></div>';
    document.body.append(modal);
    modal.querySelector('[data-action="cancel"]').onclick = () => modal.close();
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.close();
    });
    return modal;
  };
  const button = document.createElement('button');
  button.className = 'btn';
  button.id = 'deleteChat';
  button.type = 'button';
  button.textContent = 'Delete';
  button.title = 'Delete current chat';
  button.onclick = () => {
    const data = JSON.parse(localStorage.getItem(STORE) || 'null'),
      chat = data?.items?.find(item => item.id === data.activeId);
    if (!chat) return;
    const modal = getDialog();
    modal.querySelector('#deleteChatMessage').textContent =
      'Delete “' + (chat.title || 'this chat') + '”? This cannot be undone.';
    modal.querySelector('[data-action="delete"]').onclick = remove;
    modal.showModal();
  };
  panel.firstElementChild?.append(button);
})();
