const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness(options={}){
  const items=[{id:'p',title:'Project'}, {id:'c1',title:'First child',parent:'p'},
    {id:'hidden',title:'Hidden',parent:'p',hidden:true},
    {id:'done',title:'Done',parent:'p',status:'completed'},
    {id:'c2',title:'Second child',parent:'p'}, {id:'q',title:'Next project'}, {id:'r',title:'Last project'}];
  const elements=new Map(),rows=new Map(),listeners={},copied=[],messages=[];
  let observer,nativeText='';
  const board={addEventListener(name,fn){(listeners[name]??=[]).push(fn);},
    querySelectorAll(){return context.visibleTasks().map(task=>rows.get(task.id));},
    contains(target){return [...rows.values()].some(row=>target===row||target===row.input);}};
  elements.set('#tasks',board);
  const context={list:'L',selected:'p',busy:false,showCompleted:false,tasks:()=>items,
    $:selector=>{if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);},
    document:{body:{},addEventListener(name,fn){listeners['document:'+name]=fn;}},
    window:{getSelection:()=>({toString:()=>nativeText,removeAllRanges(){nativeText='';}})},
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}},
    navigator:{clipboard:{async writeText(text){if(options.blockCopy)throw Error('Blocked');copied.push(text);}}},
    notify:message=>messages.push(message),
  };
  for(const task of items){
    const classes=new Set();
    const row={dataset:{id:task.id},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
      classes,querySelector(){return this.input;}};
    const input={value:task.title,selectionStart:0,selectionEnd:0,closest:()=>row,
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
      focus(){context.selected=task.id;context.document.activeElement=this;for(const fn of listeners.focusin||[])fn({target:this});}};
    row.input=input;rows.set(task.id,row);
  }
  vm.createContext(context);
  for(const file of ['task-view','task-actions','task-selection'])vm.runInContext(fs.readFileSync('docs/'+file+'.js','utf8'),context);
  const event=(target,overrides={})=>({target,button:0,key:'c',ctrlKey:false,metaKey:false,shiftKey:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...overrides});
  return {context,items,rows,copied,messages,elements,
    mouse(id,modifiers={}){const input=rows.get(id).input,e=event(input,modifiers);for(const fn of listeners.mousedown)fn(e);if(!e.defaultPrevented)input.focus();return e;},
    key(overrides={}){const e=event(context.document.activeElement||context.document.body,{ctrlKey:true,...overrides});listeners['document:keydown'](e);return e;},
    click(id,modifiers){const e=event(rows.get(id).input,modifiers);for(const fn of listeners.click)fn(e);return e;},
    ids:()=>Array.from(context.selectedTaskItems(),task=>task.id),
    repaint:()=>observer(),nativeSelection(text){nativeText=text;},
  };
}

test('Shift-click selects a visible range across tasks and subtasks, in either direction',()=>{
  const h=harness();h.mouse('p');h.mouse('q',{shiftKey:true});
  assert.deepEqual(h.ids(),['p','c1','c2','q']);
  h.mouse('r',{shiftKey:true});assert.deepEqual(h.ids(),['p','c1','c2','q','r']);
  h.mouse('q');h.mouse('c1',{shiftKey:true});assert.deepEqual(h.ids(),['c1','c2','q']);
  assert.ok(h.rows.get('c1').classes.has('multi-selected'));
});

test('Ctrl-click toggles individual rows and Copy follows display order rather than click order',async()=>{
  const h=harness();h.mouse('p');h.mouse('r',{ctrlKey:true});h.mouse('c1',{ctrlKey:true});
  h.mouse('p',{ctrlKey:true});
  assert.deepEqual(h.ids(),['c1','r']);
  const event=h.key();await Promise.resolve();
  assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);
  assert.deepEqual(h.copied,['First child\nLast project']);
});

test('Cmd-click and Cmd+C support the same nonconsecutive selection',async()=>{
  const h=harness();h.mouse('p');h.mouse('q',{metaKey:true});h.key({ctrlKey:false,metaKey:true});
  await Promise.resolve();assert.deepEqual(h.copied,['Project\nNext project']);
});

test('Copy reads current editor values and includes only explicitly selected rows',async()=>{
  const h=harness();h.mouse('p');h.mouse('q',{ctrlKey:true});
  h.rows.get('p').input.value='Unsaved project title';h.key();await Promise.resolve();
  assert.deepEqual(h.copied,['Unsaved project title\nNext project']);
  assert.equal(h.items[0].title,'Project');
});

test('toggling to one selected row copies it even when focus is on a deselected row',async()=>{
  const h=harness();h.mouse('p');h.mouse('q',{ctrlKey:true});h.mouse('q',{ctrlKey:true});
  h.key();await Promise.resolve();assert.deepEqual(h.copied,['Project']);
  h.mouse('p',{ctrlKey:true});h.key();assert.equal(h.copied.length,1);
});

test('selection survives restoring focus after a render, including a toggled-off row',()=>{
  const h=harness();h.mouse('p');h.mouse('q',{shiftKey:true});h.mouse('c2',{ctrlKey:true});
  assert.deepEqual(h.ids(),['p','c1','q']);
  h.rows.get('c2').input.focus();h.repaint();
  assert.deepEqual(h.ids(),['p','c1','q']);
  h.rows.get('r').input.focus();assert.deepEqual(h.ids(),['r']);
});

test('Ctrl+Shift-click adds a range without dropping other selected rows',()=>{
  const h=harness();h.mouse('p');h.mouse('r',{ctrlKey:true});h.mouse('c2',{ctrlKey:true,shiftKey:true});
  assert.deepEqual(h.ids(),['p','c2','q','r']);
});

test('plain clicks and Escape leave multiple selection mode',()=>{
  const h=harness();h.mouse('p');h.mouse('q',{shiftKey:true});h.mouse('c1');
  assert.deepEqual(h.ids(),['c1']);assert.equal(h.key().defaultPrevented,undefined);
  h.mouse('q',{ctrlKey:true});
  assert.equal(h.key({key:'Escape',ctrlKey:false}).stopped,true);
  assert.deepEqual(h.ids(),[]);assert.equal(h.elements.get('#selectionstatus').hidden,true);
});

test('selected text, unrelated inputs, open dialogs and composition preserve native Copy',()=>{
  const h=harness();h.mouse('p');h.mouse('q',{ctrlKey:true});
  h.rows.get('q').input.selectionEnd=4;assert.equal(h.key().defaultPrevented,undefined);
  h.rows.get('q').input.selectionEnd=0;
  h.nativeSelection('Highlighted page text');assert.equal(h.key().defaultPrevented,undefined);
  h.nativeSelection('');assert.equal(h.key({target:{}}).defaultPrevented,undefined);
  for(const selector of ['#modal','#listpicker']){
    h.context.$(selector).open=true;assert.equal(h.key().defaultPrevented,undefined);h.context.$(selector).open=false;
  }
  assert.equal(h.key({isComposing:true}).defaultPrevented,undefined);
  assert.equal(h.copied.length,0);
});

test('refresh prunes hidden or removed tasks and switching lists clears the selection',()=>{
  const h=harness();h.mouse('p');h.mouse('q',{shiftKey:true});
  h.items.find(task=>task.id==='c1').status='completed';
  h.items.splice(h.items.findIndex(task=>task.id==='q'),1);h.repaint();
  assert.deepEqual(h.ids(),['p','c2']);
  h.context.list='Other';h.repaint();assert.deepEqual(h.ids(),[]);
  assert.equal(h.elements.get('#selectionstatus').hidden,true);
});

test('modified clicks suppress task actions and clipboard failures report failure',async()=>{
  const h=harness({blockCopy:true});h.mouse('p');h.mouse('q',{ctrlKey:true});
  const event=h.click('q',{ctrlKey:true});assert.equal(event.stopped,true);assert.equal(event.defaultPrevented,true);
  h.key();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.copied,[]);assert.match(h.messages[0],/Copy was blocked/);
});
