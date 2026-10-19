const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(storage=new Map()){
  const elements=new Map(),messages=[],events={},calls=[];let serial=0;
  const $=selector=>{if(!elements.has(selector))elements.set(selector,{style:{},addEventListener(){},focus(){},setSelectionRange(){}});return elements.get(selector);};
  const context={resizeTaskTitles(){},resizeTaskTitle(){},URLSearchParams,console,crypto:{randomUUID:()=>String(++serial)},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{addEventListener:(name,fn)=>events[name]=fn},
    document:{querySelector:$,querySelectorAll:()=>[],addEventListener(){},body:{classList:{add(){throw Error('Foreground must not disable the board');},remove(){}}}},
    connection:async()=>{},restoreGoogleSession:async()=>{},handleTaskShortcut(){},
    setTimeout:()=>1,clearTimeout(){},confirm:()=>true,
  };
  vm.createContext(context);
  for(const name of ['sync','task-view','task-order','app'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),context);
  context.notify=message=>messages.push(message);
  context.api=async(path,method,body)=>{const request=deferred();calls.push({path,method,body,...request});return request.promise;};
  vm.runInContext("token='access';data={lists:[{id:'L',title:'Real list'},{id:'Other',title:'Other list'}],tasks:{L:[{id:'a',title:'A',status:'needsAction'},{id:'b',title:'B',status:'needsAction'}],Other:[]}};list='L';data=restoreSyncDraft(data)||data;render()",context);
  return {context,calls,messages,storage,events,$,eval:source=>vm.runInContext(source,context)};
}

test('edits return immediately while Google is slow; writes serialize and acknowledgements cannot overwrite later edits',async()=>{
  const h=harness();
  await h.context.run(()=>h.context.patch(h.eval('tasks()[0]'),{title:'First'}));
  assert.equal(h.eval('busy'),false);assert.equal(h.eval('tasks()[0].title'),'First');assert.equal(h.calls.length,1);
  await h.context.run(()=>h.context.patch(h.eval('tasks()[0]'),{title:'Second'}));
  assert.equal(h.eval('tasks()[0].title'),'Second');assert.equal(h.calls.length,1);
  h.calls[0].resolve({title:'First'});await tick();
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.title,'Second');
  assert.equal(h.eval('tasks()[0].title'),'Second');
  h.calls[1].resolve({title:'Second'});await tick();
  assert.equal(h.eval('syncPending()'),false);assert.equal(h.$('#status').textContent,'Synced with Google Tasks');
  assert.equal(h.storage.has('taskflow-outbox:L'),false);
});

test('new parents, subtasks, edits and moves resolve temporary IDs without waiting in the foreground',async()=>{
  const h=harness();
  await h.context.run(()=>h.context.add('Parent',null,'b'));
  const parent=h.eval("tasks().find(task=>task.title==='Parent')");
  await h.context.run(()=>h.context.add('Child',parent.id));
  const child=h.eval("tasks().find(task=>task.title==='Child')");
  await h.context.run(()=>h.context.patch(child,{title:'Edited child'}));
  await h.context.run(()=>h.context.move(child,undefined,parent.id));
  assert.equal(h.calls.length,1);assert.equal(child.parent,undefined);
  h.calls[0].resolve({id:'google-parent'});await tick();
  assert.equal(new URLSearchParams(h.calls[1].path.split('?')[1]).get('parent'),'google-parent');
  h.calls[1].resolve({id:'google-child'});await tick();
  assert.match(h.calls[2].path,/google-child$/);assert.equal(h.calls[2].body.title,'Edited child');
  h.calls[2].resolve({});await tick();
  assert.match(h.calls[3].path,/google-child\/move/);
  assert.equal(new URLSearchParams(h.calls[3].path.split('?')[1]).get('previous'),'google-parent');
  h.calls[3].resolve({title:'Old server title',parent:'google-parent'});await tick();
  assert.equal(child.title,'Edited child');assert.equal(child.parent,undefined);
});

test('new lists appear immediately and queued tasks use their eventual Google list ID',async()=>{
  const h=harness();await h.context.run(()=>h.context.createList('New list'));
  await h.context.run(()=>h.context.add('New task'));
  assert.equal(h.eval("data.lists.at(-1).title"),'New list');assert.equal(h.calls.length,1);
  h.calls[0].resolve({id:'google-list'});await tick();
  assert.match(h.calls[1].path,/^\/lists\/google-list\/tasks/);
  h.calls[1].resolve({id:'google-task'});await tick();
  assert.equal(h.eval('syncPending()'),false);
});

test('failures retain optimistic edits and dependent writes, persist the draft, and pause until explicit retry',async()=>{
  const h=harness();await h.context.run(()=>h.context.reorder(h.eval('tasks()[0]'),1));
  await h.context.run(()=>h.context.patch(h.eval("tasks().find(task=>task.id==='a')"),{title:'Keep me'}));
  h.calls[0].reject(Object.assign(Error('Offline'),{status:503}));await tick();
  assert.equal(h.calls.length,1);assert.equal(h.eval('tasks()[1].title'),'Keep me');
  assert.equal(h.eval('syncPending()'),true);assert.equal(h.$('#retrysync').hidden,false);
  assert.equal(JSON.parse(h.storage.get('taskflow-outbox:L')).queue.length,2);
  await h.context.reload();assert.equal(h.calls.length,1);
  h.context.retrySync();assert.equal(h.calls.length,2);
  h.calls[1].resolve({});await tick();h.calls[2].resolve({});await tick();
  assert.equal(h.eval('syncPending()'),false);
});

test('pending drafts restore only after loading the same Google list, and ambiguous creates are not automatically repeated',async()=>{
  const h=harness();await h.context.run(()=>h.context.add('Unsent task'));
  h.calls[0].reject(Error('Connection lost'));await tick();
  const fresh=harness(new Map(h.storage));
  assert.equal(fresh.eval('syncPending()'),true);assert.equal(fresh.calls.length,0);
  assert.ok(fresh.eval("tasks().some(task=>task.title==='Unsent task')"));
  fresh.context.confirm=()=>false;fresh.context.retrySync();assert.equal(fresh.calls.length,0);
  const other=harness();other.storage.set('taskflow-outbox:someone-else',h.storage.get('taskflow-outbox:L'));
  assert.equal(other.context.restoreSyncDraft(other.eval('data')),null);
});

test('a refresh started before an edit cannot overwrite it; list switches do not redirect queued writes',async()=>{
  const h=harness();const read=deferred();
  h.context.all=async path=>path==='/users/@me/lists'?[{id:'L',title:'Real list'}]:read.promise;
  const refresh=h.context.reload();await tick();
  await h.context.run(()=>h.context.patch(h.eval('tasks()[0]'),{title:'New local edit'}));
  h.eval("list='Other';render()");
  assert.match(h.calls[0].path,/^\/lists\/L\/tasks\/a$/);
  h.calls[0].resolve({});await tick();
  read.resolve([{id:'a',title:'Stale title'}]);await refresh;
  assert.equal(h.eval('data.tasks.L[0].title'),'New local edit');assert.equal(h.eval('list'),'Other');
});

test('refresh leaves an active editor and its draft untouched',async()=>{
  const h=harness();h.context.document.activeElement={matches:selector=>selector==='.title',value:'Uncommitted draft'};
  h.context.all=async path=>path==='/users/@me/lists'?[{id:'L',title:'Real list'}]:[{id:'a',title:'Server title'}];
  await h.context.reload();assert.equal(h.eval('data.tasks.L[0].title'),'A');
  assert.equal(h.context.document.activeElement.value,'Uncommitted draft');
});

test('delete creates Deleted once, keeps the current list, and moves tasks without destructive requests',async()=>{
  const h=harness();await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  assert.equal(h.eval('tasks().length'),1);assert.equal(h.eval('list'),'L');
  const deleted=h.eval("data.lists.find(item=>item.title==='Deleted')");
  assert.equal(h.eval('data.tasks["'+deleted.id+'"][0].title'),'A');
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  assert.equal(h.eval("data.lists.filter(item=>item.title==='Deleted').length"),1);
  assert.equal(h.calls[0].path,'/users/@me/lists');
  h.calls[0].resolve({id:'google-deleted'});await tick();
  assert.match(h.calls[1].path,/\/lists\/L\/tasks\/a\/move\?destinationTasklist=google-deleted$/);
  h.calls[1].resolve({id:'a'});await tick();
  h.calls[2].resolve({id:'b'});await tick();
  assert.equal(h.eval('syncPending()'),false);
  assert.ok(h.calls.every(call=>call.method!=='DELETE'));
});

test('delete reuses Deleted and keeps completed and cleared subtasks with their parent',async()=>{
  const h=harness();
  h.eval("data.lists.push({id:'D',title:'Deleted'});data.tasks.D=[];tasks().push({id:'c',parent:'a',title:'Done child',status:'completed',hidden:true,notes:'Keep notes'})");
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  assert.equal(h.eval('data.tasks.D.length'),2);assert.equal(h.eval('data.tasks.D[1].parent'),'a');
  assert.equal(h.eval('data.tasks.D[1].notes'),'Keep notes');assert.equal(h.eval('data.tasks.D[1].status'),'completed');
  assert.match(h.calls[0].path,/destinationTasklist=D/);
  h.calls[0].resolve({id:'a'});await tick();
  h.eval("list='D'");await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  assert.equal(h.calls.length,1);assert.equal(h.eval('tasks().length'),2);
});

test('deleting a subtask promotes it in Deleted and preserves its siblings',async()=>{
  const h=harness();
  h.eval("data.lists.push({id:'D',title:'Deleted'});data.tasks.D=[];tasks()[1].parent='a'");
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[1]')));
  assert.equal(h.eval('tasks()[0].id'),'a');assert.equal(h.eval('data.tasks.D[0].parent'),undefined);
  assert.equal(new URLSearchParams(h.calls[0].path.split('?')[1]).has('parent'),false);
  h.calls[0].resolve({id:'moved-b'});await tick();
  h.eval("list='D'");await h.context.run(()=>h.context.patch(h.eval('tasks()[0]'),{title:'Edited in Deleted'}));
  assert.equal(h.calls[1].path,'/lists/D/tasks/moved-b');
  h.calls[1].resolve({});await tick();
});

test('failed moves stay in the outbox and retry recognizes a move that already reached Deleted',async()=>{
  const h=harness();h.eval("data.lists.push({id:'D',title:'Deleted'});data.tasks.D=[]");
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  h.calls[0].reject(Error('Connection lost'));await tick();
  assert.equal(h.eval('data.tasks.D[0].title'),'A');assert.ok(h.storage.has('taskflow-outbox:L'));
  h.context.retrySync();h.calls[1].reject(Object.assign(Error('Moved already'),{status:404}));await tick();
  assert.equal(h.calls[2].path,'/lists/D/tasks/a');
  h.calls[2].resolve({id:'a'});await tick();assert.equal(h.eval('syncPending()'),false);
});

test('legacy pending deletes also move to Deleted',async()=>{
  const h=harness();h.eval("data.lists.push({id:'D',title:'Deleted'});data.tasks.D=[]");
  h.context.enqueueSync({kind:'delete',listId:'L',id:'a'});
  assert.match(h.calls[0].path,/move\?destinationTasklist=D$/);
  h.calls[0].resolve({id:'a'});await tick();assert.equal(h.eval('syncPending()'),false);
});
