// Google's `previous` anchor must be a non-hidden sibling in the same list.
// Completed tasks cleared in Google remain in API reads with hidden=true.
function siblingTasks(parent, {visible = false} = {}) {
  return tasks().filter(task =>
    (task.parent || '') === (parent || '') && !task.deleted &&
    (!visible || (!task.hidden && (showCompleted || task.status !== 'completed')))
  );
}

function previousAnchor(parent, requestedId, movingId) {
  if (!requestedId) return undefined;
  const siblings = siblingTasks(parent);
  const index = siblings.findIndex(task => task.id === requestedId);
  if (index < 0) throw Error('The task order changed. Refresh the list and try again.');
  return siblings.slice(0, index + 1).reverse().find(task => !task.hidden && task.id !== movingId)?.id;
}

function validateParent(parent) {
  if (!parent) return;
  const task = tasks().find(task => task.id === parent && !task.deleted && !task.hidden);
  if (!task) throw Error('That parent task is no longer available. Refresh the list and try again.');
}

async function add(title, parent, previous, {allowEmpty = false} = {}) {
  if (!title.trim() && !(allowEmpty && parent)) return;
  validateParent(parent);
  previous = previousAnchor(parent, previous);
  const task = {id:'pending:'+uid(),title:title.trim(),status:'needsAction',...(parent ? {parent} : {})};
  const listId=list;
  const items = tasks();
  const index = previous ? items.findIndex(item => item.id === previous) + 1
    : parent ? items.findIndex(item => item.id === parent) + 1 : 0;
  items.splice(index, 0, task);
  if(token)enqueueSync({kind:'create',listId,id:task.id,title:task.title,parent,previous});
  focus(task.id);
}

async function move(task, parent, previous) {
  if (previous === task.id || parent === task.id) return;
  if (task.hidden) throw Error('This task was cleared in Google. Reopen it before reordering.');
  validateParent(parent);
  if (parent && tasks().some(item => item.parent === task.id && !item.deleted)) {
    throw Error('Move this task’s subtasks out first.');
  }
  previous = previousAnchor(parent, previous, task.id);
  const listId=list;
  const items = tasks();
  items.splice(items.indexOf(task), 1);
  if (parent) task.parent = parent;
  else delete task.parent;
  const index = previous ? items.findIndex(item => item.id === previous) + 1
    : parent ? items.findIndex(item => item.id === parent) + 1 : 0;
  items.splice(index, 0, task);
  if(token)enqueueSync({kind:'move',listId,id:task.id,parent,previous});
  focus(task.id);
}

async function reorder(task, direction) {
  const siblings = siblingTasks(task.parent, {visible:true});
  const index = siblings.indexOf(task), target = index + direction;
  if (index < 0) return;
  if (target < 0 || target >= siblings.length) {
    if (!task.parent) return;
    // At a group's edge, keep the task indented and move to the adjacent parent.
    const roots = siblingTasks(undefined, {visible:true});
    const parentIndex = roots.findIndex(root => root.id === task.parent);
    if (parentIndex < 0) return;
    const parent = roots[parentIndex + direction];
    if (!parent) return;
    const previous = direction < 0 ? siblingTasks(parent.id, {visible:true}).at(-1)?.id : undefined;
    await move(task, parent.id, previous);
    return;
  }
  const previous = direction < 0 ? siblings[index - 2]?.id : siblings[index + 1].id;
  await move(task, task.parent, previous);
}

async function indent(task, out = false) {
  if (out) {
    if (task.parent) await move(task, undefined, task.parent);
    return;
  }
  if (task.parent) return;
  const roots = siblingTasks(undefined, {visible:true});
  const parent = roots[roots.indexOf(task) - 1];
  if (parent) await move(task, parent.id, siblingTasks(parent.id, {visible:true}).at(-1)?.id);
}
