const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(items, options = {}) {
  const calls = [];
  const context = {
    tasks:()=>items,token:options.connected !== false,showCompleted:false,
    uid:()=> 'new',URLSearchParams,base:()=>'/lists/list/tasks',focus(){},
    api:async(path,method,body)=>{
      calls.push({path,method,body});
      if(options.fail)throw Error('Previous task id not found');
      return body ? {id:'new',title:body.title,status:'needsAction',...(new URLSearchParams(path.split('?')[1]).get('parent')?{parent:new URLSearchParams(path.split('?')[1]).get('parent')}:{})} : {position:'updated-position'};
    },
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/task-order.js','utf8'),context);
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
test('reorder uses visible sibling order and updates provider position',async()=>{
  const h=harness([task('a'),task('hidden',{hidden:true,status:'completed'}),task('done',{status:'completed'}),task('b')]);
  await h.context.reorder(h.items[0],1);
  assert.equal(new URLSearchParams(h.calls[0].path.split('?')[1]).get('previous'),'b');
  assert.equal(h.items.find(t=>t.id==='a').position,'updated-position');
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
test('a failed Google move preserves local order and is never automatically replayed',async()=>{
  const h=harness([task('a'),task('b')],{fail:true});
  await assert.rejects(h.context.reorder(h.items[0],1),/Previous task/);
  assert.deepEqual(h.items.map(t=>t.id),['a','b']);assert.equal(h.calls.length,1);
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
