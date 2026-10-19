const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness(options = {}) {
  const task = {id:'a',title:'Saved title',status:'needsAction'};
  const input = {value:'Current full task text',selectionStart:4,selectionEnd:4};
  const row = {dataset:{id:'a'},querySelector(){return input;}};
  const target = {closest(){return row;},selectionStart:4,selectionEnd:4};
  const copied=[],messages=[],patches=[];
  let prevented=false,work;
  const context = {
    navigator:{clipboard:{async writeText(value){if(options.blockCopy)throw Error('Blocked');copied.push(value);}}},
    window:{getSelection(){return {toString(){return '';}};}},
    notify(message){messages.push(message);},tasks(){return [task];},
    busy:options.busy||false,showCompleted:false,
    run(fn){work=fn();return work;},
    async patch(value,changes){patches.push(changes);Object.assign(value,changes);},
    ordered(){return [task];},focus(){},$(){return {focus(){}};},
    visibleTasks(){return options.archived || task.status!=='completed' ? [task] : [];},
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/task-actions.js','utf8'),context);
  return {context,task,input,target,copied,messages,patches,
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
