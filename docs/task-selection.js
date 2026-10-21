// Task selection is separate from the focused title, so copying never edits tasks.
const taskSelection = new Set();
let taskSelectionList = list, taskSelectionAnchor = null, taskSelectionMode = false;
let taskSelectionFocus = null;
let selectingTaskFocus = false;
const selectionBoard = $('#tasks');

function selectedTaskItems() {
  if (taskSelectionList !== list) {
    taskSelection.clear();
    taskSelectionList = list;
    taskSelectionAnchor = null;
    taskSelectionMode = false;
    taskSelectionFocus = null;
  }
  const visible = visibleTasks();
  const ids = new Set(visible.map(task => task.id));
  for (const id of taskSelection) if (!ids.has(id)) taskSelection.delete(id);
  if (!ids.has(taskSelectionAnchor)) taskSelectionAnchor = null;
  return visible.filter(task => taskSelection.has(task.id));
}

function paintTaskSelection() {
  const items = selectedTaskItems();
  for (const row of selectionBoard.querySelectorAll('.row')) {
    row.classList.toggle('multi-selected', taskSelectionMode && taskSelection.has(row.dataset.id));
  }
  const status = $('#selectionstatus');
  status.hidden = !taskSelectionMode;
  status.textContent = `${items.length} task${items.length === 1 ? '' : 's'} selected · Ctrl/Cmd + C to copy · Esc to clear`;
}

function selectTaskRow(event) {
  const row = event.target.closest('.row');
  if (!row || event.button !== 0 || event.altKey || busy) return;
  selectedTaskItems();
  const id = row.dataset.id, modifier = event.ctrlKey || event.metaKey;
  if (event.shiftKey || modifier) {
    // Prevent native Shift-click text ranges and modified button actions.
    event.preventDefault();
    if (event.shiftKey) {
      const visible = visibleTasks();
      const anchor = taskSelectionAnchor || (visible.some(task => task.id === selected) ? selected : id);
      const start = visible.findIndex(task => task.id === anchor);
      const end = visible.findIndex(task => task.id === id);
      if (!modifier) taskSelection.clear();
      for (const task of visible.slice(Math.max(0, Math.min(start, end)), Math.max(start, end) + 1)) {
        taskSelection.add(task.id);
      }
      taskSelectionAnchor = start < 0 ? id : anchor;
    } else {
      // Start with the focused task when adding the first extra row.
      if (!taskSelectionMode && selected && visibleTasks().some(task => task.id === selected)) {
        taskSelection.add(selected);
      }
      if (taskSelection.has(id)) taskSelection.delete(id);
      else taskSelection.add(id);
      taskSelectionAnchor = id;
    }
    taskSelectionMode = true;
    taskSelectionFocus = id;
    selectingTaskFocus = true;
    try {
      const input = row.querySelector('.title');
      input?.focus({preventScroll:true});
      if (input) input.setSelectionRange(input.selectionStart, input.selectionStart);
      window.getSelection()?.removeAllRanges();
    } finally { selectingTaskFocus = false; }
  } else {
    taskSelection.clear();
    taskSelection.add(id);
    taskSelectionAnchor = id;
    taskSelectionMode = false;
    taskSelectionFocus = id;
  }
  paintTaskSelection();
}

selectionBoard.addEventListener('mousedown', selectTaskRow);
selectionBoard.addEventListener('click', event => {
  if (event.target.closest('.row') && !event.altKey && (event.ctrlKey || event.metaKey || event.shiftKey)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
selectionBoard.addEventListener('focusin', event => {
  if (selectingTaskFocus) return;
  const row = event.target.closest('.row');
  if (!row) return;
  selectedTaskItems();
  if (!taskSelectionMode || (!taskSelection.has(row.dataset.id) && taskSelectionFocus !== row.dataset.id)) {
    taskSelection.clear();
    taskSelection.add(row.dataset.id);
    taskSelectionAnchor = row.dataset.id;
    taskSelectionMode = false;
  }
  taskSelectionFocus = row.dataset.id;
  paintTaskSelection();
});

async function copySelectedTasks(items) {
  const rows = new Map([...selectionBoard.querySelectorAll('.row')].map(row => [row.dataset.id, row]));
  const text = items.map(task => rows.has(task.id) ? taskText(rows.get(task.id), task) : task.title).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    notify(`${items.length} task${items.length === 1 ? '' : 's'} copied`);
  } catch {
    notify('Copy was blocked. Allow clipboard access for this site and try again.');
  }
}

document.addEventListener('keydown', event => {
  if (event.isComposing || event.defaultPrevented || $('#modal').open || $('#listpicker').open) return;
  const items = selectedTaskItems();
  if (!taskSelectionMode || (!selectionBoard.contains(event.target) && event.target !== document.body)) return;
  if (event.key === 'Escape') {
    taskSelection.clear();
    taskSelectionMode = false;
    taskSelectionAnchor = null;
    paintTaskSelection();
    event.preventDefault();
    event.stopPropagation();
  } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
    // Dragging over text still gets the browser's normal Copy behavior.
    if (hasSelectedText(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (items.length) void copySelectedTasks(items);
  }
}, true);

// Render replaces rows after edits, refreshes and list changes. Keep the marks
// attached to task IDs, pruning tasks that are no longer visible.
const taskSelectionObserver = new MutationObserver(paintTaskSelection);
taskSelectionObserver.observe(selectionBoard, {childList:true});
paintTaskSelection();
