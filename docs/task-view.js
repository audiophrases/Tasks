// Archive is a visual boundary; Google parent relationships stay intact.
function taskDisplayGroups(items, includeCompleted) {
  const families = new Map();
  for (const task of items.filter(task => !task.deleted)) {
    const id = task.parent || task.id;
    if (!families.has(id)) families.set(id, []);
    families.get(id).push(task);
  }
  const groups = [];
  let archive;
  for (const family of families.values()) {
    family.sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent)));
    const root = family.find(task => !task.parent);
    if (!archive && root?.title.trim().toLowerCase() === 'archive') {
      archive = {archived: true, marker: root.id, tasks: []};
      groups.push(archive);
    }
    if (archive) archive.tasks.push(...family);
    else {
      const visible = family.filter(task => !task.hidden && (includeCompleted || task.status !== 'completed'));
      if (visible.length) groups.push({archived: false, tasks: visible});
    }
  }
  return groups;
}

function visibleTasks() {
  return taskDisplayGroups(tasks(), showCompleted).flatMap(group => group.tasks);
}
