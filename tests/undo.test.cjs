const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function harness(){
  const elements=new Map(),messages=[],calls=[],listeners={keydown:[],input:[]},timers=new Map();let serial=0,timerId=0;
  const $=selector=>{if(!elements.has(selector))elements.set(selector,{style:{},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},focus(){context.document.activeElement=this;}});return elements.get(selector);};
  const body={matches:()=>false,closest:()=>null};
  const context={resizeTaskTitles(){},resizeTaskTitle(){},URLSearchParams,console,crypto:{randomUUID:()=>String(++serial)},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    window:{addEventListener(){}},
    document:{querySelector:$,querySelectorAll:()=>[],addEventListener(name,fn){listeners[name]?.push(fn);},body,activeElement:body},
    connection:async()=>{},restoreGoogleSession:async()=>{},handleTaskShortcut(){},
    setTimeout(fn,delay=0){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),confirm:()=>true,
  };
  vm.createContext(context);
  for(const name of ['sync','task-view','task-order','app','undo'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),context);
  context.notify=message=>messages.push(message);
  // Google returns IDs for created items; moves and patches acknowledge without changing IDs.
  context.api=async(path,method,body)=>{calls.push({path,method,body});return method==='POST'&&!path.includes('/move')?{id:'google-'+calls.length}:{};};
  vm.runInContext(`token='access';data={lists:[{id:'L',title:'Work'},{id:'Other',title:'Other'}],tasks:{L:[
    {id:'a',title:'A',status:'needsAction'},{id:'child',title:'Child',status:'needsAction',parent:'a'},{id:'b',title:'B',status:'needsAction'}],Other:[]}};list='L';render()`,context);
  await tick();
  const evaluate=source=>vm.runInContext(source,context);
  return {context,calls,messages,$,eval:evaluate,
    task:id=>evaluate(`Object.values(data.tasks).flat().find(task=>task.id===${JSON.stringify(id)})`),
    ids:source=>Array.from(evaluate(source),task=>task.id),
    query:call=>new URLSearchParams(call.path.split('?')[1]),
    keydown(overrides={}){
      const event={key:'z',ctrlKey:true,target:context.document.activeElement,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...overrides};
      for(const listener of listeners.keydown)listener(event);
      return event;
    },
    type(id,value,extra={},field={matches:()=>true,closest:()=>({dataset:{id}})}){
      Object.assign(field,{value,selectionStart:value.length,selectionEnd:value.length});
      context.document.activeElement=field;
      const event={target:field,...extra};
      for(const listener of listeners.input)listener(event);
      $('#tasks').listeners.input(event);
      return field;
    },
    runTimers(){for(const [id,timer] of timers)if(!timer.delay){timers.delete(id);timer.fn();}},
  };
}

test('Ctrl+Z reopens a completed task and syncs the reversal after the original write',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.patch(h.task('a'),{status:'completed'}));
  const event=h.keydown();await tick();
  assert.equal(event.defaultPrevented,true);
  assert.equal(h.task('a').status,'needsAction');assert.equal(h.eval('selected'),'a');
  assert.deepEqual(h.calls.map(call=>call.body?.status),['completed','needsAction']);
  assert.equal(h.messages.at(-1),'Task reopened');
});

test('undo returns reordered and indented tasks to their previous parent and position',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.reorder(h.task('a'),1));
  assert.deepEqual(h.ids('tasks().filter(task=>!task.parent)'),['b','a']);
  h.keydown();await tick();
  assert.deepEqual(h.ids('tasks().filter(task=>!task.parent)'),['a','b']);
  assert.equal(h.task('child').parent,'a');
  let query=h.query(h.calls.at(-1));
  assert.match(h.calls.at(-1).path,/\/tasks\/a\/move\?/);assert.equal(query.has('previous'),false);assert.equal(query.has('parent'),false);
  await h.context.run(()=>h.context.indent(h.task('b')));
  assert.equal(h.task('b').parent,'a');
  h.keydown();await tick();
  assert.equal(h.task('b').parent,undefined);
  query=h.query(h.calls.at(-1));
  assert.equal(query.get('previous'),'a');assert.equal(query.has('parent'),false);
  assert.equal(h.messages.at(-1),'Task moved back');
});

test('dropping a task where it already is leaves nothing to undo',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.move(h.task('b'),undefined,'a'));
  h.keydown();await tick();
  assert.equal(h.messages.at(-1),'Nothing to undo');
});

test('undo restores tasks with their subtasks, or subtasks under their parent, from Deleted',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.deleteTask(h.task('a')));
  const deleted=h.eval("data.lists.find(item=>item.title==='Deleted').id");
  assert.deepEqual(h.ids('tasks()'),['b']);
  h.eval("list='Other';render()");
  h.keydown();await tick();
  assert.equal(h.eval('list'),'L');assert.equal(h.eval('selected'),'a');
  assert.deepEqual(h.ids('tasks()'),['a','child','b']);assert.equal(h.task('child').parent,'a');
  assert.deepEqual(h.ids(`data.tasks[${JSON.stringify(deleted)}]`),[]);
  // The Deleted list was created first, so the restore uses its Google ID.
  assert.match(h.calls.at(-1).path,/^\/lists\/google-1\/tasks\/a\/move\?/);
  assert.equal(h.query(h.calls.at(-1)).get('destinationTasklist'),'L');
  assert.equal(h.messages.at(-1),'Task restored');

  await h.context.run(()=>h.context.deleteTask(h.task('child')));
  assert.equal(h.task('child').parent,undefined);
  h.keydown();await tick();
  assert.equal(h.task('child').parent,'a');assert.deepEqual(h.ids('tasks()'),['a','child','b']);
  const query=h.query(h.calls.at(-1));
  assert.equal(query.get('parent'),'a');assert.equal(query.get('destinationTasklist'),'L');
});

test('undo removes a newly added task and focuses the task above it',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.add('',undefined,'a',{allowEmpty:true}));
  assert.equal(h.eval('tasks().length'),4);
  h.keydown();await tick();
  assert.deepEqual(h.ids('tasks()'),['a','child','b']);assert.equal(h.eval('selected'),'child');
  assert.equal(h.calls.at(-1).method,'DELETE');assert.match(h.calls.at(-1).path,/\/tasks\/google-1$/);
  assert.equal(h.messages.at(-1),'New task removed');
});

test('typing is one undo step, and typing the original title back leaves nothing to undo',async()=>{
  const h=await harness();
  h.type('a','A plus');h.type('a','A plus more');
  h.context.document.activeElement=h.context.document.body;
  h.keydown();await tick();
  assert.equal(h.task('a').title,'A');assert.equal(h.calls.at(-1).body.title,'A');
  assert.equal(h.messages.at(-1),'Title restored');
  h.type('b','Bx');h.type('b','B');
  h.context.document.activeElement=h.context.document.body;
  h.keydown();await tick();
  assert.equal(h.messages.at(-1),'Nothing to undo');
});

test('Ctrl+Z in the field being typed leaves text undo to the browser, then undoes actions',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.patch(h.task('b'),{status:'completed'}));
  const field=h.type('a','A typed');
  let event=h.keydown();
  assert.equal(event.defaultPrevented,false);
  // The browser undoes the typing and reports it as an input event.
  h.type('a','A',{inputType:'historyUndo'},field);
  h.runTimers();await tick();
  assert.equal(h.task('a').title,'A');assert.equal(h.task('b').status,'completed');
  // With no typing left, the browser does nothing and the action is undone.
  event=h.keydown();
  assert.equal(event.defaultPrevented,false);
  h.runTimers();await tick();
  assert.equal(h.task('b').status,'needsAction');
});

test('permanent deletes report that they cannot be undone, and earlier actions stay undoable',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.patch(h.task('b'),{status:'completed'}));
  h.eval("data.lists.push({id:'D',title:'Deleted'});data.tasks.D=[{id:'gone',title:'Gone',status:'needsAction'}];list='D';render()");
  await h.context.run(()=>h.context.deleteTask(h.task('gone')));
  h.keydown();await tick();
  assert.equal(h.messages.at(-1),'Permanently deleted tasks can’t be restored.');assert.equal(h.eval('list'),'D');
  h.keydown();await tick();
  assert.equal(h.task('b').status,'needsAction');assert.equal(h.eval('list'),'L');
});

test('undo of a task changed elsewhere reports it and keeps the current list',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.patch(h.task('b'),{status:'completed'}));
  h.eval("data.tasks.L=data.tasks.L.filter(task=>task.id!=='b');list='Other';render()");
  h.keydown();await tick();
  assert.equal(h.messages.at(-1),'Can’t undo: those tasks have changed since.');
  assert.equal(h.eval('list'),'Other');
  h.keydown();await tick();
  assert.equal(h.messages.at(-1),'Nothing to undo');
});

test('undo ignores held keys, open dialogs, IME composition and other shortcuts; Cmd+Z works',async()=>{
  const h=await harness();
  await h.context.run(()=>h.context.patch(h.task('a'),{status:'completed'}));
  for(const overrides of [{repeat:true},{isComposing:true},{shiftKey:true},{altKey:true},{ctrlKey:false}])h.keydown(overrides);
  h.$('#modal').open=true;h.keydown();h.$('#modal').open=false;
  await tick();
  assert.equal(h.task('a').status,'completed');
  h.keydown({ctrlKey:false,metaKey:true,key:'Z'});await tick();
  assert.equal(h.task('a').status,'needsAction');
});
