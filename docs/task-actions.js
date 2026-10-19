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

function handleTaskShortcut(event) {
  const row = event.target.closest('.row');
  if (!row || event.isComposing) return false;
  const task = tasks().find(task => task.id === row.dataset.id);
  if (!task) return false;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
    // Preserve the browser's normal Copy behavior whenever text is selected.
    if (hasSelectedText(event.target)) return false;
    event.preventDefault();
    void copyTaskText(row, task);
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
