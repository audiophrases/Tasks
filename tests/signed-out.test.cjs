const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function harness(restore=false){
  const elements=new Map();let prompts=0;
  const $=selector=>{if(!elements.has(selector))elements.set(selector,{style:{},addEventListener(){}});return elements.get(selector);};
  const context={resizeTaskTitles(){},resizeTaskTitle(){},document:{querySelector:$,addEventListener(){}},crypto:{},
    localStorage:{getItem(){throw Error('Old demo storage must not be read');}},
    connection:async()=>{prompts++;},handleTaskShortcut(){},syncPending:()=>false,updateSyncStatus(){},syncRevision:0,restoreSyncDraft:()=>null,retrySync(){},
    restoreGoogleSession:async()=>{if(restore)vm.runInContext("token='restored';data={lists:[{id:'google',title:'Real list'}],tasks:{google:[]}};list='google';render()",context);},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('docs/task-view.js','utf8'),context);vm.runInContext(fs.readFileSync('docs/app.js','utf8'),context);
  return {context,$,get prompts(){return prompts;}};
}

test('signed-out startup shows sign-in without demo lists or tasks',async()=>{
  const h=harness();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.prompts,1);
  assert.equal(h.$('#tasks').innerHTML,'');assert.equal(h.$('#lists').innerHTML,'');
  assert.equal(h.$('#quick').disabled,true);assert.equal(h.$('#newlist').disabled,true);
  let writes=0;h.context.write=()=>writes++;
  await h.context.run(h.context.write);
  assert.equal(writes,0);assert.equal(h.prompts,2);
});

test('restored Google session skips login and enables the real workspace',async()=>{
  const h=harness(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.prompts,0);assert.match(h.$('#lists').innerHTML,/Real list/);
  assert.equal(h.$('#quick').disabled,false);
  vm.runInContext('token=null;render()',h.context);
  assert.equal(h.$('#lists').innerHTML,'');assert.equal(h.$('#tasks').innerHTML,'');
});

test('parent frames wrap their children and neighboring groups use distinct colors',()=>{
  const h=harness();
  const html=vm.runInContext(`renderTaskGroups([
    {id:'p',title:'Parent'},{id:'c',title:'Child',parent:'p'},
    {id:'q',title:'Next parent'},{id:'r',title:'Third parent'}
  ])`,h.context);
  assert.equal((html.match(/class="task-group /g)||[]).length,3);
  assert.match(html,/task-group group-0/);assert.match(html,/task-group group-1/);assert.match(html,/task-group group-2/);
  assert.ok(html.indexOf('data-id="c"')<html.indexOf('task-group group-1'));
  assert.equal((html.match(/class="row /g)||[]).length,4);
});

test('Tab and Shift+Tab indent anywhere in the title and save pending edits',async()=>{
  const h=harness(true);await new Promise(resolve=>setImmediate(resolve));
  vm.runInContext("data.tasks.google=[{id:'t',title:'Original'}]",h.context);
  const calls=[];
  h.context.run=async fn=>fn();
  h.context.patch=async(task,changes)=>{calls.push(['save',changes.title]);Object.assign(task,changes);};
  h.context.indent=async(task,out)=>calls.push(['indent',task.id,out]);
  const row={dataset:{id:'t'}};
  for(const shiftKey of [false,true]){
    let prevented=false;
    h.$('#tasks').onkeydown({key:'Tab',shiftKey,preventDefault(){prevented=true;},target:{value:'Edited title',selectionStart:7,matches:()=>true,closest:()=>row}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(prevented,true);
  }
  assert.deepEqual(calls,[['save','Edited title'],['indent','t',false],['indent','t',true]]);
});

test('Archive wraps every later project in one grey group and retains completed subtasks',()=>{
  const h=harness();
  const items=[{id:'active',title:'Active'}, {id:'archive',title:' Archive ',status:'completed'},
    {id:'project',title:'Old project'}, {id:'done',title:'Completed child',parent:'project',status:'completed',hidden:true},
    {id:'last',title:'Last project',status:'completed'}];
  const original=JSON.stringify(items);
  h.context.items=items;
  const html=vm.runInContext('renderTaskGroups(items)',h.context);
  assert.equal((html.match(/class="task-group /g)||[]).length,2);
  assert.equal((html.match(/archive-group/g)||[]).length,1);
  assert.match(html,/archive-project/);assert.match(html,/archive-subtask/);
  assert.match(html,/Completed child/);assert.match(html,/Last project/);
  assert.equal(JSON.stringify(items),original);
  const groups=h.context.taskDisplayGroups(items,false);
  assert.equal(groups[0].archived,false);assert.equal(groups[1].archived,true);
  assert.equal(groups[1].tasks.length,4);
});

test('moving a project above Archive returns it to its own colored group',()=>{
  const h=harness();
  const groups=h.context.taskDisplayGroups([{id:'p',title:'Project'}, {id:'a',title:'Archive'},
    {id:'child',parent:'p',title:'Child'}, {id:'q',title:'Old'}],false);
  assert.equal(groups.length,2);assert.equal(groups[0].tasks[1].id,'child');
  assert.equal(groups[1].tasks[1].id,'q');
  assert.equal(groups[0].archived,false);assert.equal(groups[1].archived,true);
});

test('an Archive subtask does not start an archive section',()=>{
  const h=harness();
  const groups=h.context.taskDisplayGroups([{id:'p',title:'Project'}, {id:'a',parent:'p',title:'Archive'}, {id:'q',title:'Next'}],false);
  assert.ok(groups.every(group=>!group.archived));
});

test('both the subtask button and Ctrl+Enter request an empty subtask',async()=>{
  const h=harness(true);await new Promise(resolve=>setImmediate(resolve));
  vm.runInContext("data.tasks.google=[{id:'p',title:'Parent'}]",h.context);
  const calls=[];
  h.context.add=async(...args)=>calls.push(args);
  const row={dataset:{id:'p'}};
  h.$('#tasks').onclick({target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'sub'}}:row}});
  await new Promise(resolve=>setImmediate(resolve));
  h.$('#tasks').onkeydown({key:'Enter',ctrlKey:true,preventDefault(){},target:{value:'Parent',matches:()=>true,closest:()=>row}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2);
  for(const args of calls){assert.equal(args[0],'');assert.equal(args[1],'p');assert.equal(args[3].allowEmpty,true);}
});
