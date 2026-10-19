const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(items, options = {}) {
  const calls = [];
  const context = {
    tasks:()=>items,token:options.connected !== false,showCompleted:false,
    list:'list',uid:()=> 'new',URLSearchParams,base:()=>'/lists/list/tasks',focus(){},
    enqueueSync(op){
      const query=new URLSearchParams();
      if(op.parent)query.set('parent',op.parent);
      if(op.previous)query.set('previous',op.previous);
      calls.push({path:'/lists/list/tasks'+(op.kind==='move'?'/'+op.id+'/move':'')+'?'+query,op});
    },
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/task-view.js','utf8'),context);vm.runInContext(fs.readFileSync('docs/task-order.js','utf8'),context);
  return {context,calls,items};
}
const task=(id,extra={})=>({id,title:id,status:'needsAction',...extra});

test('adding a subtask skips cleared Google tasks when choosing previous',async()=>{
  const h=harness([task('parent'),task('child',{parent:'parent'}),task('cleared',{parent:'parent',hidden:true,status:'completed'})]);
  await h.context.add('New child','parent','cleared');
  const query=new URLSearchParams(h.calls[0].path.split('?')[1]);
  assert.equal(query.get('previous'),'child');assert.equal(query.get('parent'),'parent');
});
test('hidden-only siblings omit previous instead of sending an invalid Google id',async()=>{
  const h=harness([task('parent'),task('cleared',{parent:'parent',hidden:true,status:'completed'})]);
  await h.context.add('New child','parent','cleared');
  assert.equal(new URLSearchParams(h.calls[0].path.split('?')[1]).has('previous'),false);
});
test('reorder uses visible sibling order and queues a provider move',async()=>{
  const h=harness([task('a'),task('hidden',{hidden:true,status:'completed'}),task('done',{status:'completed'}),task('b')]);
  await h.context.reorder(h.items[0],1);
  assert.equal(new URLSearchParams(h.calls[0].path.split('?')[1]).get('previous'),'b');
  assert.equal(h.calls[0].op.kind,'move');
});
test('moving a parent keeps children attached in rendered order',async()=>{
  const h=harness([task('a'),task('child',{parent:'a'}),task('b')],{connected:false});
  await h.context.reorder(h.items[0],1);
  const roots=h.items.filter(t=>!t.parent);
  assert.deepEqual(roots.map(t=>t.id),['b','a']);
  assert.equal(h.items.find(t=>t.id==='child').parent,'a');
});
test('outdent and indent use non-hidden parent and sibling references',async()=>{
  const h=harness([task('a'),task('child',{parent:'a'}),task('hidden-child',{parent:'a',hidden:true,status:'completed'}),task('b')]);
  await h.context.indent(h.items.find(t=>t.id==='b'));
  let query=new URLSearchParams(h.calls[0].path.split('?')[1]);
  assert.equal(query.get('parent'),'a');assert.equal(query.get('previous'),'child');
  await h.context.indent(h.items.find(t=>t.id==='b'),true);
  query=new URLSearchParams(h.calls[1].path.split('?')[1]);
  assert.equal(query.has('parent'),false);assert.equal(query.get('previous'),'a');
});
test('unknown or wrong-parent anchors are rejected before a Google write',async()=>{
  const h=harness([task('a'),task('b'),task('child',{parent:'a'})]);
  await assert.rejects(h.context.move(h.items[1],undefined,'child'),/order changed/);
  await assert.rejects(h.context.add('New',undefined,'deleted-id'),/order changed/);
  assert.equal(h.calls.length,0);
});
test('reorder applies locally before background acknowledgement',async()=>{
  const h=harness([task('a'),task('b')]);
  await h.context.reorder(h.items[0],1);
  assert.deepEqual(h.items.map(t=>t.id),['b','a']);assert.equal(h.calls.length,1);
});

test('cleared parents cannot be used for new subtasks',async()=>{
  const h=harness([task('hidden',{hidden:true,status:'completed'})]);
  await assert.rejects(h.context.add('New','hidden'),/parent task/);
  assert.equal(h.calls.length,0);
});

test('subtasks reorder both directions with Google sibling anchors',async()=>{
  const h=harness([task('p'),task('a',{parent:'p'}),task('b',{parent:'p'}),task('c',{parent:'p'})]);
  const b=h.items.find(t=>t.id==='b');
  await h.context.reorder(b,-1);
  let query=new URLSearchParams(h.calls[0].path.split('?')[1]);
  assert.equal(query.get('parent'),'p');assert.equal(query.has('previous'),false);
  assert.deepEqual(h.items.filter(t=>t.parent==='p').map(t=>t.id),['b','a','c']);
  await h.context.reorder(b,1);
  query=new URLSearchParams(h.calls[1].path.split('?')[1]);
  assert.equal(query.get('parent'),'p');assert.equal(query.get('previous'),'a');
  assert.deepEqual(h.items.filter(t=>t.parent==='p').map(t=>t.id),['a','b','c']);
});

test('subtasks cross group boundaries while remaining subtasks',async()=>{
  const h=harness([task('p'),task('a',{parent:'p'}),task('q'),task('b',{parent:'q'})]);
  const a=h.items.find(t=>t.id==='a');
  await h.context.reorder(a,1);
  assert.equal(a.parent,'q');
  let query=new URLSearchParams(h.calls[0].path.split('?')[1]);
  assert.equal(query.get('parent'),'q');assert.equal(query.has('previous'),false);
  await h.context.reorder(a,-1);
  assert.equal(a.parent,'p');
  query=new URLSearchParams(h.calls[1].path.split('?')[1]);
  assert.equal(query.get('parent'),'p');
  await h.context.reorder(a,-1);
  assert.equal(h.calls.length,2);
});

test('Alt+Up can reach the previous parent when loaded children precede their parent',async()=>{
  const h=harness([
    task('remote',{parent:'omarchy'}),task('pinplay'),task('omarchy'),
    task('notebook',{parent:'omarchy'}),task('caps',{parent:'omarchy'}),
  ]);
  const notebook=h.items.find(item=>item.id==='notebook');
  await h.context.reorder(notebook,-1);
  assert.deepEqual(Array.from(h.context.visibleTasks(),item=>item.id),['pinplay','omarchy','notebook','remote','caps']);
  assert.equal(h.calls[0].op.parent,'omarchy');assert.equal(h.calls[0].op.previous,undefined);
  await h.context.reorder(notebook,-1);
  assert.deepEqual(Array.from(h.context.visibleTasks(),item=>item.id),['pinplay','notebook','omarchy','remote','caps']);
  assert.equal(notebook.parent,'pinplay');assert.equal(h.calls[1].op.parent,'pinplay');
});

test('moving down into a group and back up respects interleaved Google task order',async()=>{
  const h=harness([
    task('remote',{parent:'omarchy'}),task('pinplay'),
    task('notebook',{parent:'pinplay'}),task('omarchy'),task('caps',{parent:'omarchy'}),
  ]);
  const notebook=h.items.find(item=>item.id==='notebook');
  await h.context.reorder(notebook,1);
  assert.deepEqual(Array.from(h.context.visibleTasks(),item=>item.id),['pinplay','omarchy','notebook','remote','caps']);
  assert.equal(notebook.parent,'omarchy');
  await h.context.reorder(notebook,-1);
  assert.deepEqual(Array.from(h.context.visibleTasks(),item=>item.id),['pinplay','notebook','omarchy','remote','caps']);
  assert.equal(notebook.parent,'pinplay');
});

test('new subtasks insert before the first sibling even when it precedes the parent',async()=>{
  const h=harness([task('child',{parent:'parent'}),task('parent')]);
  await h.context.add('First child','parent');
  assert.deepEqual(Array.from(h.context.visibleTasks(),item=>item.title),['parent','First child','child']);
  assert.equal(h.calls[0].op.previous,undefined);
});

test('a new subtask can be blank while accidental empty quick-adds are ignored',async()=>{
  const h=harness([task('parent')]);
  await h.context.add('','parent',undefined,{allowEmpty:true});
  assert.equal(h.items[1].title,'');assert.equal(h.items[1].parent,'parent');
  assert.equal(h.calls[0].op.title,'');
  await h.context.add('  ');
  assert.equal(h.items.length,2);assert.equal(h.calls.length,1);
});

test('archived completed roots participate in visible reorder without changing their children',async()=>{
  const h=harness([task('archive',{title:'Archive'}),task('a'),task('c',{parent:'a',status:'completed'}),task('b',{status:'completed'})]);
  await h.context.reorder(h.items.find(item=>item.id==='a'),1);
  assert.equal(h.calls[0].op.previous,'b');
  assert.equal(h.items.find(item=>item.id==='c').parent,'a');
});
