(() => {
  const dialog = document.querySelector('#todoDialog');
  const landing = document.querySelector('#landing');
  const notesApp = document.querySelector('#app');
  const todoButton = document.querySelector('#openTodoList');
  if (!dialog || !landing || !notesApp || !todoButton) return;

  const todoPage = document.createElement('main');
  todoPage.className = 'app';
  todoPage.id = 'todoPage';
  todoPage.innerHTML =
    '<header class="topbar"><div><div class="brand">Squiggly To-do</div><div class="eyebrow">Your task workspace</div></div><div class="actions"><button class="btn" id="todoOpenNotes">Notes</button><button class="btn" id="todoBack">Back</button></div></header><section class="card todo-card"></section>';
  const card = todoPage.querySelector('.todo-card');
  const renderExistingList = todoButton.onclick;
  if (typeof renderExistingList === 'function') {
    renderExistingList();
    dialog.close();
  }
  while (dialog.firstChild) card.appendChild(dialog.firstChild);
  dialog.remove();
  document.body.append(todoPage);

  const showTodo = () => {
    landing.hidden = true;
    notesApp.classList.remove('visible');
    todoPage.classList.add('visible');
    document.querySelector('#todoItems')?.dispatchEvent(new Event('todo-render-request'));
  };
  const showHome = () => {
    todoPage.classList.remove('visible');
    notesApp.classList.remove('visible');
    landing.hidden = false;
  };
  todoButton.onclick = showTodo;
  document.querySelector('#closeTodoList').textContent = 'Back';
  document.querySelector('#closeTodoList').onclick = showHome;
  document.querySelector('#todoBack').onclick = showHome;
  document.querySelector('#todoOpenNotes').onclick = () => {
    todoPage.classList.remove('visible');
    landing.hidden = true;
    notesApp.classList.add('visible');
    window.render?.();
  };
  document.querySelector('#openApp').addEventListener('click', () => todoPage.classList.remove('visible'));
  document.querySelector('#startWriting').addEventListener('click', () => todoPage.classList.remove('visible'));
  document.querySelector('#back').addEventListener('click', () => todoPage.classList.remove('visible'));
})();

(() => {
  const notesActions = document.querySelector('#app .topbar .actions');
  const todoLauncher = document.querySelector('#openTodoList');
  const todoPage = document.querySelector('#todoPage');
  if (!notesActions || !todoLauncher || !todoPage || document.querySelector('#openTodoFromNotes')) return;
  const button = document.createElement('button');
  button.className = 'btn';
  button.id = 'openTodoFromNotes';
  button.textContent = 'To-do list';
  notesActions.insertBefore(button, notesActions.querySelector('#back'));
  button.onclick = () => todoLauncher.click();
})();
