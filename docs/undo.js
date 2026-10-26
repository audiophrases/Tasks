// Undo replays the inverse of a task action through the normal sync queue.
const UNDO_LIMIT = 100;
const undoHistory = [];
let undoing = false, undoTypingField = null, nativeUndoField = null;

function clearUndoHistory() {
  undoHistory.length = 0;
}

function titleUndo(entry) {
  return entry?.kind === 'patch' && Object.keys(entry.before).join() === 'title';
}

function recordUndo(entry) {
  if (undoing) return;
  // A field's own text undo applies only until another action is recorded.
  if (!titleUndo(entry)) undoTypingField = null;
  undoHistory.push(entry);
  if (undoHistory.length > UNDO_LIMIT) undoHistory.shift();
}

function recordPatchUndo(task, changes) {
  if (undoing) return;
  const keys = Object.keys(changes), last = undoHistory.at(-1);
  if (keys.every(key => task[key] === changes[key])) return;
  // Typing in one title is a single step; typing the original back cancels it.
  if (keys.join() === 'title' && titleUndo(last) && last.listId === list && last.id === task.id) {
    if (last.before.title === changes.title) undoHistory.pop();
    return;
  }
  recordUndo({kind:'patch', listId:list, id:task.id, before:Object.fromEntries(keys.map(key => [key, task[key]]))});
}

// Entries keep the IDs seen at the time; synced items may have Google IDs now.
function undoListId(id) {
  const item = data.lists.find(item => item.id === id || item.id === remoteId(id));
  if (!item) throw Error('List not found');
  return item.id;
}

function undoTask(listId, id) {
  const task = (data.tasks[listId] || []).find(item => item.id === id || item.id === remoteId(id));
  if (!task) throw Error('Task not found');
  return task;
}

function restoreDeletedTask(entry, listId) {
  const deletedId = undoListId(entry.deletedListId), task = undoTask(deletedId, entry.id);
  const parent = entry.parent && undoTask(listId, entry.parent).id;
  validateParent(parent);
  const previous = previousAnchor(parent, entry.previous && undoTask(listId, entry.previous).id);
  const family = data.tasks[deletedId].filter(item => item.id === task.id || item.parent === task.id);
  data.tasks[deletedId] = data.tasks[deletedId].filter(item => !family.includes(item));
  if (parent) task.parent = parent;
  tasks().splice(taskInsertionIndex(parent, previous), 0, ...family);
  enqueueSync({kind:'moveToList', listId:deletedId, id:task.id, destinationListId:listId, parent, previous});
  return task;
}

function focusUndone(task, before) {
  const visible = visibleTasks();
  if (visible.includes(task)) {
    focus(task.id);
    return;
  }
  // The task is now hidden or gone; stay where it was.
  const index = before.indexOf(task);
  const next = index < 0 ? undefined :
    before.slice(0, index).reverse().find(item => visible.includes(item)) ||
    before.slice(index + 1).find(item => visible.includes(item));
  if (next) focus(next.id);
  else $('#quick').focus();
}

function undoMessage(entry) {
  if (entry.kind === 'move') return 'Task moved back';
  if (entry.kind === 'add') return 'New task removed';
  if (entry.kind === 'delete') return 'Task restored';
  if ('status' in entry.before) return entry.before.status === 'completed' ? 'Task marked complete again' : 'Task reopened';
  return 'Title restored';
}

async function applyUndo(entry) {
  const listId = undoListId(entry.listId);
  // Show the list where the action happened, so the reversal is visible.
  if (list !== listId) { list = listId; selected = null; }
  const before = visibleTasks();
  let task;
  if (entry.kind === 'patch') {
    task = undoTask(listId, entry.id);
    await patch(task, entry.before);
  } else if (entry.kind === 'move') {
    task = undoTask(listId, entry.id);
    await move(task, entry.parent && undoTask(listId, entry.parent).id, entry.previous && undoTask(listId, entry.previous).id);
  } else if (entry.kind === 'add') {
    task = undoTask(listId, entry.id);
    data.tasks[listId] = tasks().filter(item => item.id !== task.id && item.parent !== task.id);
    enqueueSync({kind:'permanentDelete', listId, id:task.id});
  } else {
    task = restoreDeletedTask(entry, listId);
  }
  focusUndone(task, before);
  notify(undoMessage(entry));
}

function undoLastAction() {
  if (!undoHistory.length) {
    notify('Nothing to undo');
    return;
  }
  void run(async () => {
    const entry = undoHistory.pop(), previousList = list, previousSelected = selected;
    undoTypingField = null;
    if (entry.kind === 'permanentDelete') {
      notify('Permanently deleted tasks can’t be restored.');
      return;
    }
    undoing = true;
    try {
      await applyUndo(entry);
    } catch {
      // Validation happens before any change, so only the list switch is reverted.
      list = previousList;
      selected = previousSelected;
      throw Error('Can’t undo: those tasks have changed since.');
    } finally {
      undoing = false;
    }
  });
}

document.addEventListener('input', event => {
  if (event.inputType === 'historyUndo' && event.target === nativeUndoField) nativeUndoField = null;
  undoTypingField = event.target;
}, true);

document.addEventListener('keydown', event => {
  const undoKey = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z';
  if (!undoKey || event.isComposing || event.defaultPrevented || $('#modal').open || $('#listpicker').open) return;
  if (event.target === undoTypingField) {
    // The browser undoes this field's typing first; once it has nothing
    // left to undo, no input event follows and task actions are undone.
    if (event.repeat) return;
    const field = nativeUndoField = event.target;
    setTimeout(() => {
      if (nativeUndoField !== field) return;
      nativeUndoField = null;
      undoLastAction();
    });
    return;
  }
  event.preventDefault();
  if (!event.repeat) undoLastAction();
});
