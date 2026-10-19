const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function harness(){
  const listeners={};const context={token:'access',busy:false,list:'b',selected:null,showCompleted:false,data:{tasks:{},lists:[{id:'a',title:'First'},{id:'b',title:'Second'}]},esc:s=>s,render(){context.rendered=true;}};
  const choices=['a','b'].map(id=>({dataset:{list:id},focus(){context.document.activeElement=this;},scrollIntoView(){}}));
  const dialog={open:false,querySelectorAll:()=>choices,showModal(){this.open=true;},close(){this.open=false;}};
  const first={focus(){context.focusedTask=true;}};
  const elements={'#listpicker':dialog,'#listchoices':{},'#picklist':{},'#modal':{open:false}};
  context.$=s=>elements[s];
  context.document={activeElement:null,querySelector:()=>first,addEventListener:(name,fn)=>listeners[name]=fn};
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/task-view.js','utf8'),context);vm.runInContext(fs.readFileSync('docs/list-picker.js','utf8'),context);
  const key=(key,extra={})=>{let prevented=false;listeners.keydown({key,preventDefault(){prevented=true;},...extra});return prevented;};
  return {context,dialog,choices,elements,key};
}
test('Alt+L opens at the current list; arrows wrap and Enter opens and focuses the selection',()=>{
  const h=harness();assert.equal(h.key('l',{altKey:true}),true);
  assert.equal(h.dialog.open,true);assert.equal(h.context.document.activeElement,h.choices[1]);
  assert.equal(h.key('ArrowRight'),true);assert.equal(h.context.document.activeElement,h.choices[0]);
  h.key('ArrowLeft');assert.equal(h.context.document.activeElement,h.choices[1]);
  h.key('ArrowLeft');assert.equal(h.context.document.activeElement,h.choices[0]);
  h.key('Enter');assert.equal(h.context.list,'a');assert.equal(h.dialog.open,false);
  assert.equal(h.context.rendered,true);assert.equal(h.context.focusedTask,true);
});
test('picker does not interrupt another dialog or an in-flight task change',()=>{
  const h=harness();h.context.busy=true;h.key('l',{altKey:true});assert.equal(h.dialog.open,false);
  h.context.busy=false;h.elements['#modal'].open=true;h.key('l',{altKey:true});assert.equal(h.dialog.open,false);
});

test('columns preview real tasks and subtasks, excluding cleared and hidden completed tasks',()=>{
  const h=harness();
  h.context.data.tasks.a=[{id:'c',parent:'p',title:'Child'},{id:'p',title:'Parent'},
    {id:'x',title:'Cleared',hidden:true},{id:'d',title:'Finished',status:'completed'}];
  const html=h.context.listTaskPreview('a');
  assert.ok(html.indexOf('Parent')<html.indexOf('Child'));
  assert.match(html,/preview-child/);assert.equal(html.includes('Cleared'),false);
  assert.equal(html.includes('Finished'),false);assert.equal(h.context.listTaskPreview('b'),'');
  h.context.showCompleted=true;
  assert.match(h.context.listTaskPreview('a'),/preview-completed/);
  h.key('l',{altKey:true});
  assert.match(h.elements['#listchoices'].innerHTML,/preview-heading/);
  assert.match(h.elements['#listchoices'].innerHTML,/Parent/);
});

test('previews use the same grey archive boundary and show completed archived subtasks',()=>{
  const h=harness();
  h.context.data.tasks.a=[{id:'p',title:'Active'}, {id:'a',title:'Archive'}, {id:'q',title:'Archived project'},
    {id:'c',title:'Archived completed child',parent:'q',status:'completed',hidden:true}];
  const html=h.context.listTaskPreview('a');
  assert.equal((html.match(/archive-group/g)||[]).length,1);
  assert.match(html,/preview-archive-subtask/);assert.match(html,/Archived completed child/);
  assert.ok(html.indexOf('Active')<html.indexOf('archive-group'));
});
