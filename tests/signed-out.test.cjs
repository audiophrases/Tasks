const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function harness(restore=false){
  const elements=new Map();let prompts=0;
  const $=selector=>{if(!elements.has(selector))elements.set(selector,{style:{},addEventListener(){}});return elements.get(selector);};
  const context={document:{querySelector:$,addEventListener(){}},crypto:{},
    localStorage:{getItem(){throw Error('Old demo storage must not be read');}},
    connection:async()=>{prompts++;},handleTaskShortcut(){},
    restoreGoogleSession:async()=>{if(restore)vm.runInContext("token='restored';data={lists:[{id:'google',title:'Real list'}],tasks:{google:[]}};list='google';render()",context);},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('docs/app.js','utf8'),context);
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
