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

async function reopenLastCompleted(focused) {
  const scope = focused && (focused.parent || focused.id);
  let latest, latestTime = -Infinity;
  for (const task of ordered()) {
    if (task.status !== 'completed' || task.deleted) continue;
    if (scope && task.id !== scope && task.parent !== scope) continue;
    const completedTime = Date.parse(task.completed) || 0;
    if (completedTime >= latestTime) { latest = task; latestTime = completedTime; }
  }
  if (!latest) {
    notify(scope ? 'No completed tasks to reopen in this group' : 'No completed tasks to reopen');
    return;
  }
  await patch(latest, {status: 'needsAction'});
  notify(latest.parent ? 'Subtask reopened' : 'Task reopened');
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
  const reopen = event.key === 'Enter' && event.altKey && event.shiftKey && !modifier;
  if (reopen) {
    event.preventDefault();
    if (!busy && !event.repeat) void run(() => reopenLastCompleted(task));
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
