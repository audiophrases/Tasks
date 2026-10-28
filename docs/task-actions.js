function taskText(row, task) {
  return row.querySelector('.title')?.value ?? task.title;
}

async function copyTaskText(row, task) {
  try {
    await navigator.clipboard.writeText(taskText(row, task));
    notify('Task text copied');
  } catch {
    notify('Copy was blocked. Allow clipboard access for this site and try again.');
  }
}

function hasSelectedText(target) {
  if (typeof target.selectionStart === 'number' && target.selectionStart !== target.selectionEnd) return true;
  return Boolean(window.getSelection()?.toString());
}

// With a scope (a parent task id) only that task's subtasks are considered.
function lastCompletedTask(scope) {
  let last;
  for (const task of ordered()) {
    if (task.status !== 'completed' || task.deleted || task.hidden || (scope && task.parent !== scope)) continue;
    if (!last || (task.completed || '') >= (last.completed || '')) last = task;
  }
  return last;
}

async function reopenLastCompleted(focused) {
  const task = lastCompletedTask(focused && (focused.parent || focused.id));
  if (!task) {
    notify(focused ? 'No completed subtasks to reopen here' : 'No completed tasks to reopen');
    return;
  }
  await patch(task, {status: 'needsAction'});
  notify(task.parent ? 'Subtask reopened' : 'Task reopened');
  // Keep the caret where it is when working inside a task.
  if (!focused) focus(task.id);
}

function handleTaskShortcut(event) {
  const row = event.target.closest('.row');
  if (!row || event.isComposing) return false;
  const task = tasks().find(task => task.id === row.dataset.id);
  if (!task) return false;
  const modifier = event.ctrlKey || event.metaKey;
  const remove = !event.altKey && !event.shiftKey && (
    (modifier && event.key === 'Delete') || (event.metaKey && event.key === 'Backspace')
  );
  if (remove) {
    event.preventDefault();
    if (busy || event.repeat) return true;
    const title = taskText(row, task).trim();
    void run(async () => {
      const before = visibleTasks(), index = before.indexOf(task);
      if (!isDeletedList() && title && title !== task.title) await patch(task, {title});
      deleteTask(task);
      const remaining = visibleTasks();
      const next = before.slice(index + 1).find(item => remaining.includes(item)) ||
        before.slice(0, index).reverse().find(item => remaining.includes(item));
      if (next) focus(next.id);
      else $('#quick').focus();
    });
    return true;
  }
  if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
    // Preserve the browser's normal Copy behavior whenever text is selected.
    if (hasSelectedText(event.target)) return false;
    event.preventDefault();
    void copyTaskText(row, task);
    return true;
  }
  if (event.key === 'Enter' && event.altKey && event.shiftKey && !modifier) {
    event.preventDefault();
    if (busy || event.repeat) return true;
    void run(() => reopenLastCompleted(task));
    return true;
  }
  const done = event.key === 'Enter' && (
    (event.altKey && !modifier && !event.shiftKey) ||
    (modifier && event.shiftKey && !event.altKey)
  );
  if (!done) return false;
  event.preventDefault();
  if (busy || event.repeat) return true;
  const title = taskText(row, task).trim();
  void run(async () => {
    await patch(task, {
      ...(title && title !== task.title ? {title} : {}),
      status: task.status === 'completed' ? 'needsAction' : 'completed',
    });
    const visible = visibleTasks();
    if (!visible.includes(task)) {
      const index = ordered().indexOf(task);
      const next = ordered().slice(index + 1).find(item => visible.includes(item)) || visible.at(-1);
      if (next) focus(next.id);
      else $('#quick').focus();
    }
  });
  return true;
}
