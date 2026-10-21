const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(storage=new Map()){
  const elements=new Map(),messages=[],events={},calls=[],timers=new Map();let serial=0,timerId=0,now=Date.now();
  class TestDate extends Date{static now(){return now;}}
  const $=selector=>{if(!elements.has(selector))elements.set(selector,{style:{},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},focus(){},setSelectionRange(){}});return elements.get(selector);};
  const context={resizeTaskTitles(){},resizeTaskTitle(){},URLSearchParams,console,crypto:{randomUUID:()=>String(++serial)},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{addEventListener:(name,fn)=>events[name]=fn},
    document:{querySelector:$,querySelectorAll:()=>[],addEventListener(){},body:{classList:{add(){throw Error('Foreground must not disable the board');},remove(){}}}},
    connection:async()=>{},restoreGoogleSession:async()=>{},handleTaskShortcut(){},
    Date:TestDate,setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),confirm:()=>true,
  };
  vm.createContext(context);
  for(const name of ['sync','task-view','task-order','app'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),context);
  context.notify=message=>messages.push(message);
  context.api=async(path,method,body)=>{const request=deferred();calls.push({path,method,body,...request});return request.promise;};
  vm.runInContext("token='access';data={lists:[{id:'L',title:'Real list'},{id:'Other',title:'Other list'}],tasks:{L:[{id:'a',title:'A',status:'needsAction'},{id:'b',title:'B',status:'needsAction'}],Other:[]}};list='L';data=restoreSyncDraft(data)||data;render()",context);
  return {context,calls,messages,storage,events,$,eval:source=>vm.runInContext(source,context),
    async advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}await tick();},
    input(id,value,extra={}){
      const target={value,selectionStart:value.length,selectionEnd:value.length,matches:()=>true,closest:()=>({dataset:{id}})};
      context.document.activeElement=target;
      $('#tasks').listeners.input({target,...extra});
      return target;
    },
  };
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

test('typing tasks and subtasks saves locally immediately and syncs after a 700ms pause without leaving the editor',async()=>{
  for(const parent of [undefined,'a']){
    const h=harness();await tick();if(parent)h.eval("tasks()[1].parent='a'");
    const input=h.input('b','Edited while focused');
    assert.equal(h.eval('tasks()[1].title'),'Edited while focused');assert.equal(h.calls.length,0);
    assert.equal(JSON.parse(h.storage.get('taskflow-outbox:L')).data.tasks.L[1].title,input.value);
    await h.advance(699);assert.equal(h.calls.length,0);
    await h.advance(1);assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.title,input.value);
    h.calls[0].resolve({title:'Older acknowledgement'});await tick();
    assert.equal(h.context.document.activeElement,input);assert.equal(input.selectionStart,input.value.length);
    assert.equal(h.eval('syncPending()'),false);assert.equal(h.eval('busy'),false);
  }
});

test('typing bursts collapse to one latest title write and survive reloading before the delay expires',async()=>{
  const h=harness();await tick();
  h.input('a','One');await h.advance(200);
  h.input('a','One two');await h.advance(200);
  h.input('a','One two three');
  assert.equal(h.eval('syncQueue.length'),1);
  const reopened=harness(new Map(h.storage));await tick();
  assert.equal(reopened.eval('tasks()[0].title'),'One two three');assert.equal(reopened.calls.length,0);
  await h.advance(699);assert.equal(h.calls.length,0);
  await h.advance(1);assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.title,'One two three');
  h.calls[0].resolve({});await tick();
});

test('new typing never mutates an in-flight title request or loses the newest text',async()=>{
  const h=harness();await tick();h.input('a','First');await h.advance(700);
  const latest=h.input('a','Latest text');await h.advance(700);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.title,'First');
  h.calls[0].resolve({title:'First'});await tick();
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.title,'Latest text');
  h.calls[1].resolve({});await tick();
  assert.equal(h.eval('tasks()[0].title'),'Latest text');assert.equal(latest.value,'Latest text');
});

test('blur flushes a pending title once and delayed writes retain the original list',async()=>{
  const h=harness();await tick();const input=h.input('a','Finish now');
  h.$('#tasks').listeners.change({target:input});await tick();
  assert.equal(h.calls.length,1);h.calls[0].resolve({});await tick();
  await h.advance(700);assert.equal(h.calls.length,1);
  h.input('b','Save in original list');h.eval("list='Other';render()");
  await h.advance(700);assert.match(h.calls[1].path,/^\/lists\/L\/tasks\/b$/);
  h.calls[1].resolve({});await tick();
});

test('composition waits for committed text and clearing a title syncs an empty string',async()=>{
  const h=harness();await tick();
  const composing=h.input('a','Composing text',{isComposing:true});await h.advance(1000);
  assert.equal(h.calls.length,0);assert.equal(h.eval('tasks()[0].title'),'A');
  h.$('#tasks').listeners.compositionend({target:composing});
  await h.advance(700);assert.equal(h.calls[0].body.title,'Composing text');
  h.calls[0].resolve({});await tick();
  h.input('a','');await h.advance(700);assert.equal(h.calls[1].body.title,'');
  h.calls[1].resolve({});await tick();assert.equal(h.eval('tasks()[0].title'),'');
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

test('Enter creates and syncs a focused blank sibling for tasks and subtasks',async()=>{
  for(const parent of [undefined,'a']){
    const h=harness();await tick();
    if(parent)h.eval("tasks()[1].parent='a'");
    let prevented=false;
    h.$('#tasks').onkeydown({key:'Enter',preventDefault(){prevented=true;},target:{
      value:'B',matches:()=>true,closest:()=>({dataset:{id:'b'}}),
    }});
    await tick();
    const created=h.eval('tasks()[2]');
    assert.equal(prevented,true);assert.equal(created.title,'');
    assert.equal(created.parent,parent);assert.equal(h.eval('selected'),created.id);
    assert.equal(h.calls[0].body.title,'');
    const query=new URLSearchParams(h.calls[0].path.split('?')[1]);
    assert.equal(query.get('previous'),'b');assert.equal(query.get('parent'),parent||null);
    h.calls[0].resolve({id:'blank-task',title:''});await tick();
    assert.equal(h.eval('syncPending()'),false);
  }
});

test('Enter in the focused add field creates the first blank task in an empty list',async()=>{
  const h=harness();await tick();h.eval('data.tasks.L=[];render();focusTaskList()');
  const input=h.$('#quick');input.value='';
  let prevented=false;
  input.onkeydown({key:'Enter',target:input,preventDefault(){prevented=true;}});
  await tick();
  assert.equal(prevented,true);assert.equal(h.eval('tasks().length'),1);
  assert.equal(h.eval('tasks()[0].title'),'');
  assert.equal(h.eval('selected'),h.eval('tasks()[0].id'));
  assert.equal(h.calls[0].body.title,'');
  h.calls[0].resolve({id:'first-task',title:''});await tick();
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

test('saved tasks restore immediately for the same remembered connection, including the selected list',async()=>{
  const h=harness();await tick();
  h.storage.set('taskflow-browser-session-v1',JSON.stringify({accessToken:'remembered',expiresAt:Date.now()+3600000}));
  h.eval("list='Other';saveTaskCache();data={lists:[],tasks:{}};list=null;token=null");
  assert.equal(h.context.restoreTaskCache(),true);
  assert.equal(h.eval('list'),'Other');assert.equal(h.eval('cacheVisible'),true);
  assert.equal(h.eval('data.tasks.L[0].title'),'A');assert.equal(h.calls.length,0);
  assert.equal(h.$('#quick').disabled,true);
  h.eval("list='L';render()");assert.match(h.$('#tasks').innerHTML,/readonly/);
});

test('cached tasks cannot appear for another connection or a signed-out visitor',async()=>{
  const h=harness();await tick();
  const key='taskflow-browser-session-v1';
  h.storage.set(key,JSON.stringify({accessToken:'remembered',expiresAt:Date.now()+3600000}));
  h.context.saveTaskCache();
  h.storage.set(key,JSON.stringify({accessToken:'other-account',expiresAt:Date.now()+3600000}));
  assert.equal(h.context.restoreTaskCache(),false);
  h.storage.delete(key);assert.equal(h.context.restoreTaskCache(),false);
  h.context.clearTaskCache();assert.equal(h.storage.has('taskflow-task-cache-v1'),false);
});

test('an older tab cannot overwrite another remembered connection\'s task cache',async()=>{
  const h=harness();await tick();
  const key='taskflow-browser-session-v1';
  h.storage.set(key,JSON.stringify({accessToken:'remembered',expiresAt:Date.now()+3600000}));
  h.context.saveTaskCache();
  const cached=h.storage.get('taskflow-task-cache-v1');
  h.storage.set(key,JSON.stringify({accessToken:'new-account',cacheOwner:'other-owner',expiresAt:Date.now()+3600000}));
  h.context.saveTaskCache();
  assert.equal(h.storage.get('taskflow-task-cache-v1'),cached);
});

test('cached temporary IDs retain aliases so subsequent edits address Google tasks',async()=>{
  const h=harness();await tick();
  h.storage.set('taskflow-browser-session-v1',JSON.stringify({accessToken:'remembered',expiresAt:Date.now()+3600000}));
  await h.context.add('Created');const task=h.eval("tasks().find(item=>item.title==='Created')");
  h.calls[0].resolve({id:'google-created'});await tick();
  h.eval('syncAliases.clear();data={lists:[],tasks:{}};list=null');
  assert.equal(h.context.restoreTaskCache(),true);
  const restored=h.eval("tasks().find(item=>item.title==='Created')");
  await h.context.patch(restored,{title:'After reloading'});
  assert.match(h.calls[1].path,/google-created$/);assert.equal(restored.id,task.id);
  h.calls[1].resolve({});await tick();
});

test('a restored outbox takes precedence over the cached snapshot and does not resend automatically',async()=>{
  const h=harness();await tick();
  h.storage.set('taskflow-browser-session-v1',JSON.stringify({accessToken:'remembered',expiresAt:Date.now()+3600000}));
  await h.context.patch(h.eval('tasks()[0]'),{title:'Pending edit'});
  h.calls[0].reject(Error('Offline'));await tick();
  const fresh=harness(new Map(h.storage));await tick();
  assert.equal(fresh.context.restoreTaskCache(),true);
  assert.equal(fresh.eval('tasks()[0].title'),'Pending edit');
  assert.equal(fresh.eval('syncPending()'),true);assert.equal(fresh.calls.length,0);
});

test('Google updates a clean focused cached title while preserving focus and caret',async()=>{
  const h=harness();await tick();h.eval('cacheVisible=true');
  const input={value:'A',selectionStart:1,selectionEnd:1,matches:()=>true,
    closest:()=>({dataset:{id:'a'}})};
  let focused=false,caret;
  const refreshedInput={focus(){focused=true;},setSelectionRange(start,end){caret=[start,end];}};
  h.context.document.activeElement=input;
  h.context.document.querySelectorAll=()=>[{dataset:{id:'a'},querySelector:()=>refreshedInput}];
  h.context.all=async path=>path==='/users/@me/lists'?[{id:'L',title:'Real list'}]:[{id:'a',title:'Updated in Google'}];
  await h.context.reload();
  assert.equal(h.eval('tasks()[0].title'),'Updated in Google');assert.equal(h.eval('cacheVisible'),false);
  assert.equal(focused,true);assert.deepEqual(caret,[1,1]);
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

test('deleting inside Deleted permanently removes a task and its completed subtasks without confirmation',async()=>{
  const h=harness();
  h.eval("data.lists[0].title=' Deleted ';tasks().push({id:'child',parent:'a',title:'Finished',status:'completed',hidden:true})");
  h.context.confirm=()=>{throw Error('Deletion must not ask for confirmation');};
  assert.match(h.context.renderTaskRow(h.eval('tasks()[0]')),/aria-label="Permanently delete task"/);
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  assert.equal(h.eval('tasks().length'),1);assert.equal(h.eval('tasks()[0].id'),'b');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'DELETE');
  assert.equal(h.calls[0].path,'/lists/L/tasks/a');
  assert.equal(h.eval('data.lists.length'),2);
  h.calls[0].resolve(null);await tick();assert.equal(h.eval('syncPending()'),false);
});

test('permanently deleting one subtask leaves its parent and siblings intact',async()=>{
  const h=harness();h.eval("data.lists[0].title='Deleted';tasks()[1].parent='a';tasks().push({id:'c',parent:'a',title:'Keep sibling'})");
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[1]')));
  assert.equal(h.eval("tasks().map(task=>task.id).join(',')"),'a,c');
  assert.equal(h.calls[0].method,'DELETE');assert.equal(h.calls[0].path,'/lists/L/tasks/b');
  h.calls[0].resolve(null);await tick();
});

test('a task moved to a newly created Deleted list can be permanently deleted before the move finishes',async()=>{
  const h=harness();await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  h.eval("list=data.lists.find(item=>item.title==='Deleted').id");
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  assert.equal(h.eval('tasks().length'),0);assert.equal(h.calls.length,1);
  h.calls[0].resolve({id:'google-deleted'});await tick();
  assert.match(h.calls[1].path,/destinationTasklist=google-deleted/);
  h.calls[1].resolve({id:'moved-a'});await tick();
  assert.equal(h.calls[2].method,'DELETE');assert.equal(h.calls[2].path,'/lists/google-deleted/tasks/moved-a');
  h.calls[2].resolve(null);await tick();assert.equal(h.eval('syncPending()'),false);
});

test('failed permanent deletes restore from the outbox and accept an already-deleted response on retry',async()=>{
  const h=harness();h.eval("data.lists[0].title='Deleted'");
  await h.context.run(()=>h.context.deleteTask(h.eval('tasks()[0]')));
  h.calls[0].reject(Error('Connection lost'));await tick();
  const restored=harness(new Map(h.storage));
  restored.context.confirm=()=>{throw Error('Delete retry must not ask for confirmation');};
  assert.equal(restored.eval('tasks().length'),1);assert.equal(restored.eval('syncPending()'),true);
  restored.context.retrySync();assert.equal(restored.calls[0].method,'DELETE');
  restored.calls[0].reject(Object.assign(Error('Already deleted'),{status:404}));await tick();
  assert.equal(restored.eval('syncPending()'),false);assert.equal(restored.eval('syncFailure'),null);
});
