(() => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="chatEditPreview" style="width:min(920px,calc(100% - 28px))"><div class="eyebrow">Review AI edit</div><h2 style="margin-top:8px">Preview changes</h2><p>Review the proposed update before applying it to this note.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px" id="chatEditColumns"><section style="border:1px solid var(--line);border-radius:9px;padding:12px;min-width:0"><div class="eyebrow">Current</div><h3 id="chatCurrentTitle" style="margin:8px 0"></h3><div id="chatCurrentBody" style="white-space:normal;line-height:1.6;overflow:auto;max-height:300px"></div></section><section style="border:1px solid var(--line);border-radius:9px;padding:12px;min-width:0;background:var(--soft)"><div class="eyebrow">Proposed</div><h3 id="chatProposedTitle" style="margin:8px 0"></h3><div id="chatProposedBody" style="white-space:normal;line-height:1.6;overflow:auto;max-height:300px"></div></section></div><div class="dialog-actions"><button class="btn" id="cancelChatPreview">Keep current note</button><button class="btn primary" id="applyChatPreview">Apply changes</button></div></dialog>',
  );
  const dialog = document.querySelector('#chatEditPreview');
  let apply = null;
  window.previewChatEdit = (update, onApply) => {
    const note = active();
    document.querySelector('#chatCurrentTitle').textContent = note.title || 'Untitled note';
    document.querySelector('#chatCurrentBody').innerHTML =
      note.body || '<span style="color:var(--muted)">Empty note</span>';
    document.querySelector('#chatProposedTitle').textContent = update.title?.trim() || note.title || 'Untitled note';
    document.querySelector('#chatProposedBody').innerHTML =
      typeof update.body === 'string' ? update.body : note.body || '<span style="color:var(--muted)">Empty note</span>';
    apply = onApply;
    if (!dialog.open) dialog.showModal();
  };
  document.querySelector('#cancelChatPreview').onclick = () => {
    apply = null;
    dialog.close();
  };
  document.querySelector('#applyChatPreview').onclick = () => {
    if (apply) apply();
    apply = null;
    dialog.close();
  };
})();
