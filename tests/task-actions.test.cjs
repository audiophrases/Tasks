const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness(options = {}) {
  const task = {id:'a',title:'Saved title',status:'needsAction'};
  const input = {value:'Current full task text',selectionStart:4,selectionEnd:4};
  const row = {dataset:{id:'a'},querySelector(){return input;}};
  const target = {closest(){return row;},selectionStart:4,selectionEnd:4};
  const copied=[],messages=[],patches=[],deleted=[],focused=[];
  const items=options.items?[task,...options.items]:[task,...(options.neighbor?[{id:'b',title:'Next task',status:'needsAction'}]:[])];
  let prevented=false,work;
  const context = {
    navigator:{clipboard:{async writeText(value){if(options.blockCopy)throw Error('Blocked');copied.push(value);}}},
    window:{getSelection(){return {toString(){return '';}};}},
    notify(message){messages.push(message);},tasks(){return items;},
    busy:options.busy||false,showCompleted:false,
    run(fn){work=fn();return work;},
    async patch(value,changes){patches.push(changes);Object.assign(value,changes);},
    isDeletedList(){return Boolean(options.inDeleted);},
    deleteTask(value){deleted.push(value);items.splice(items.indexOf(value),1);},
    ordered(){return items;},focus(id){focused.push(id);},$(){return {focus(){focused.push('quick');}};},
    visibleTasks(){return items.filter(item=>options.archived || item.status!=='completed');},
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/task-actions.js','utf8'),context);
  return {context,task,input,target,copied,messages,patches,deleted,focused,
    event(overrides={}){return {target,key:'c',ctrlKey:true,preventDefault(){prevented=true;},...overrides};},
    get prevented(){return prevented;},get work(){return work;}};
}
test('Copy with no selection copies the entire current title without changing tasks',async()=>{
  const h=harness();assert.equal(h.context.handleTaskShortcut(h.event()),true);
  await Promise.resolve();assert.equal(h.prevented,true);
  assert.deepEqual(h.copied,['Current full task text']);assert.equal(h.patches.length,0);
});
test('selected text retains native Copy behavior',()=>{
  const h=harness();h.target.selectionEnd=10;
  assert.equal(h.context.handleTaskShortcut(h.event()),false);
  assert.equal(h.prevented,false);assert.equal(h.copied.length,0);
});
test('Command+C supports Mac',async()=>{
  const h=harness();h.context.handleTaskShortcut(h.event({ctrlKey:false,metaKey:true}));
  await Promise.resolve();assert.equal(h.copied.length,1);
});
test('Alt+Enter saves the edited title and completes the task in one update',async()=>{
  const h=harness();h.context.handleTaskShortcut(h.event({key:'Enter',ctrlKey:false,altKey:true}));
  await h.work;assert.equal(h.task.status,'completed');assert.equal(h.task.title,h.input.value);
  assert.equal(h.patches.length,1);
});
test('existing completion shortcut reopens a completed task',async()=>{
  const h=harness();h.task.status='completed';
  h.context.handleTaskShortcut(h.event({key:'Enter',shiftKey:true}));await h.work;
  assert.equal(h.task.status,'needsAction');
});
test('completion ignores held keys, IME composition and in-flight writes',()=>{
  for(const overrides of [{repeat:true},{isComposing:true}]){
    const h=harness();h.context.handleTaskShortcut(h.event({key:'Enter',ctrlKey:false,altKey:true,...overrides}));
    assert.equal(h.patches.length,0);
  }
  const h=harness({busy:true});h.context.handleTaskShortcut(h.event({key:'Enter',shiftKey:true}));assert.equal(h.patches.length,0);
});
test('clipboard denial reports failure without claiming success',async()=>{
  const h=harness({blockCopy:true});await h.context.copyTaskText({querySelector(){return h.input;}},h.task);
  assert.match(h.messages[0],/blocked/);assert.equal(h.copied.length,0);
});

test('Ctrl+Delete saves the current title, moves the task to Deleted, and focuses the next task',async()=>{
  const h=harness({neighbor:true});
  assert.equal(h.context.handleTaskShortcut(h.event({key:'Delete'})),true);
  await h.work;
  assert.equal(h.prevented,true);assert.deepEqual(h.deleted,[h.task]);
  assert.equal(h.task.title,h.input.value);assert.equal(h.patches.length,1);
  assert.deepEqual(h.focused,['b']);
});

test('Command+Delete and Mac Command+Backspace support the same move action',async()=>{
  for(const key of ['Delete','Backspace']){
    const h=harness();
    assert.equal(h.context.handleTaskShortcut(h.event({key,ctrlKey:false,metaKey:true})),true);
    await h.work;assert.equal(h.deleted.length,1);assert.deepEqual(h.focused,['quick']);
  }
});

test('normal text deletion and unrelated modifier combinations retain native behavior',()=>{
  for(const keys of [{key:'Delete',ctrlKey:false},{key:'Backspace',ctrlKey:false},
    {key:'Backspace'},{key:'Delete',altKey:true},{key:'Delete',shiftKey:true}]){
    const h=harness();assert.equal(h.context.handleTaskShortcut(h.event(keys)),false);
    assert.equal(h.prevented,false);assert.equal(h.deleted.length,0);
  }
});

test('delete shortcut ignores held keys, composition, and busy operations',()=>{
  for(const options of [{repeat:true},{isComposing:true}]){
    const h=harness();h.context.handleTaskShortcut(h.event({key:'Delete',...options}));
    assert.equal(h.deleted.length,0);assert.equal(h.patches.length,0);
  }
  const h=harness({busy:true});h.context.handleTaskShortcut(h.event({key:'Delete'}));
  assert.equal(h.deleted.length,0);assert.equal(h.patches.length,0);
});

test('the same shortcut removes tasks in Deleted without saving an unnecessary title edit',async()=>{
  const h=harness({inDeleted:true,neighbor:true});h.context.handleTaskShortcut(h.event({key:'Delete'}));
  await h.work;assert.deepEqual(h.focused,['b']);assert.equal(h.context.tasks().length,1);
  assert.equal(h.deleted[0],h.task);assert.equal(h.patches.length,0);
});

const done=(id,completed,parent)=>({id,title:id,status:'completed',completed,...(parent?{parent}:{})});
const reopenKey={key:'Enter',ctrlKey:false,altKey:true,shiftKey:true};

test('Alt+Shift+Enter reopens only the focused completed task or subtask and saves its edited title',async()=>{
  for(const parent of [undefined,'p']){
    const h=harness({items:[done('child','2026-10-28T10:00:00.000Z','a'),
      done('sibling','2026-10-28T11:00:00.000Z','p'),done('p','2026-10-28T12:00:00.000Z')]});
    Object.assign(h.task,done('a','2026-10-28T09:00:00.000Z',parent));
    assert.equal(h.context.handleTaskShortcut(h.event(reopenKey)),true);await h.work;
    assert.equal(h.prevented,true);assert.equal(h.task.title,h.input.value);
    assert.deepEqual(h.context.tasks().map(t=>t.status),['needsAction','completed','completed','completed']);
    assert.equal(h.patches.length,1);assert.deepEqual(h.focused,[]);
    assert.equal(h.messages[0],parent?'Subtask reopened':'Task reopened');
    // Another press must not complete this row or reopen another completed item.
    h.context.handleTaskShortcut(h.event(reopenKey));await h.work;
    assert.equal(h.task.status,'needsAction');assert.equal(h.patches.length,1);
  }
});

test('reopen on an unfinished task or subtask consumes Enter without changing any task',async()=>{
  for(const parent of [undefined,'p']){
    const h=harness({items:[done('child','2026-10-28T10:00:00.000Z','a'),
      done('sibling','2026-10-28T11:00:00.000Z','p')]});
    if(parent)h.task.parent=parent;
    assert.equal(h.context.handleTaskShortcut(h.event(reopenKey)),true);await h.work;
    assert.equal(h.prevented,true);assert.equal(h.patches.length,0);
    assert.deepEqual(h.context.tasks().map(t=>t.status),['needsAction','completed','completed']);
  }
});

test('reopen outside any task leaves completed tasks alone',()=>{
  const h=harness({items:[done('other','2026-10-28T10:00:00.000Z')]});
  assert.equal(h.context.handleTaskShortcut(h.event({...reopenKey,target:{closest:()=>null}})),false);
  assert.equal(h.patches.length,0);assert.equal(h.prevented,false);assert.deepEqual(h.focused,[]);
});

test('reopen works on a focused cleared completed task or subtask',async()=>{
  for(const parent of [undefined,'p']){
    const h=harness({archived:true});
    Object.assign(h.task,{status:'completed',hidden:true,...(parent?{parent}:{})});
    assert.equal(h.context.handleTaskShortcut(h.event(reopenKey)),true);await h.work;
    assert.equal(h.task.status,'needsAction');assert.equal(h.patches.length,1);
    assert.deepEqual(h.focused,[]);
  }
});

test('reopen ignores deleted tasks, held keys, composition and busy operations',()=>{
  for(const options of [{deleted:true},{repeat:true},{isComposing:true},{busy:true}]){
    const h=harness({busy:options.busy});
    Object.assign(h.task,{status:'completed',hidden:options.hidden,deleted:options.deleted});
    h.context.handleTaskShortcut(h.event({...reopenKey,repeat:options.repeat,isComposing:options.isComposing}));
    assert.equal(h.patches.length,0);assert.equal(h.task.status,'completed');
  }
});
