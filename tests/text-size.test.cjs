const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness(stored, blocked=false) {
  const controls = new Map();let value,css;
  const context = {document:{querySelector(id){if(!controls.has(id))controls.set(id,{});return controls.get(id);},documentElement:{style:{setProperty(name,v){css=v;}}}},localStorage:{getItem(){if(blocked)throw Error();return stored;},setItem(key,v){if(blocked)throw Error();value=v;}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('docs/text-size.js','utf8'),context);
  return {context,controls,get value(){return value;},get css(){return css;}};
}
test('font controls adjust size and save the preference',()=>{
  const h=harness(null);h.controls.get('#fontplus').onclick();assert.equal(h.css,'14px');assert.equal(h.value,'14');
  h.controls.get('#fontminus').onclick();assert.equal(h.css,'13px');
});
test('saved size is restored and upper/lower limits disable appropriate buttons',()=>{
  const h=harness('26');assert.equal(h.css,'26px');assert.equal(h.controls.get('#fontplus').disabled,true);
  h.context.setTextSize(1);assert.equal(h.css,'12px');assert.equal(h.controls.get('#fontminus').disabled,true);
  h.context.setTextSize('invalid');assert.equal(h.css,'13px');
});
test('font controls remain usable with browser storage blocked',()=>{
  const h=harness(undefined,true);h.controls.get('#fontplus').onclick();assert.equal(h.css,'14px');
});
