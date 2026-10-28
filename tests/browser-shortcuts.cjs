// Standalone browser regression: node --test tests/browser-shortcuts.cjs
// Requires Playwright and Chromium. TASKFLOW_TEST_URL can target a deployed app;
// TASKFLOW_BROWSER_CHANNELS=chrome,msedge selects installed Chrome and Edge.
// Test data and Google responses are isolated from the user's account.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');

test('task shortcuts in a browser',async t=>{
  let server;
  let url=process.env.TASKFLOW_TEST_URL;
  if(!url){
    server=http.createServer(async(req,res)=>{
      const file=path.basename(new URL(req.url,'http://localhost').pathname)||'index.html';
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
      try{
        const body=await fs.readFile(path.join(__dirname,'../docs',file));
        res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(body);
      }catch{res.writeHead(404);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    url=`http://127.0.0.1:${server.address().port}/`;
    t.after(()=>new Promise(resolve=>server.close(resolve)));
  }
  for(const channel of (process.env.TASKFLOW_BROWSER_CHANNELS||'chromium').split(',')){
    await t.test(channel,async t=>{
      const browser=await chromium.launch({headless:true,...(channel==='chromium'?{}:{channel})});
      t.after(()=>browser.close());
      const page=await browser.newPage();
      const writes=[],errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://api.pinplay.win/**',route=>route.fulfill({json:{persistentSessions:false}}));
      await page.route('https://accounts.google.com/**',route=>route.abort());
      await page.route('https://tasks.googleapis.com/**',async route=>{
        const request=route.request();
        writes.push({method:request.method(),url:request.url(),body:request.postDataJSON()});
        await route.fulfill({json:{}});
      });
      await page.goto(url,{waitUntil:'networkidle'});
      const cases=[
        {id:'task',status:'needsAction'},
        {id:'subtask',status:'needsAction'},
        {id:'cleared-task',status:'needsAction'},
        {id:'cleared-subtask',status:'needsAction'},
        {id:'cleared-subtask',status:'needsAction',key:'Alt+Shift+Enter'},
        {id:'unfinished',status:'needsAction',noWrite:true},
        {id:'cleared-subtask',status:'needsAction',key:'Alt+Enter'},
        {id:'quick',noWrite:true},
      ];
      for(const scenario of cases){
        await t.test(`${scenario.key||'Shift+Alt+Enter'} on ${scenario.id}`,async()=>{
          writes.length=0;
          await page.evaluate(()=>{
            token='browser-test-only';expires=Date.now()+3600000;list='L';busy=false;showCompleted=true;selected=null;
            data={lists:[{id:'L',title:'Browser test'}],tasks:{L:[
              {id:'task',title:'Completed task',status:'completed'},
              {id:'subtask',title:'Completed subtask',status:'completed',parent:'task'},
              {id:'other',title:'Other completed subtask',status:'completed',parent:'task'},
              {id:'unfinished',title:'Unfinished task',status:'needsAction'},
              {id:'archive',title:'Archive',status:'needsAction'},
              {id:'cleared-task',title:'Cleared archived task',status:'completed',hidden:true},
              {id:'cleared-subtask',title:'Cleared archived subtask',status:'completed',hidden:true,parent:'cleared-task'},
            ]}};
            $('#modal').close();render();
            window.shortcutEvents=[];
            document.onkeydown=event=>{if(event.key==='Enter')window.shortcutEvents.push({alt:event.altKey,shift:event.shiftKey,trusted:event.isTrusted});};
          });
          const selector=scenario.id==='quick'?'#quick':`.row[data-id="${scenario.id}"] .title`;
          await page.locator(selector).focus();
          await page.evaluate(()=>document.activeElement.setSelectionRange(2,5));
          await page.keyboard.press(scenario.key||'Shift+Alt+Enter');
          await page.waitForFunction(()=>!busy&&!syncPending());
          const actual=await page.evaluate(id=>({
            status:tasks().find(task=>task.id===id)?.status,
            active:document.activeElement.closest('.row')?.dataset.id||document.activeElement.id,
            caret:[document.activeElement.selectionStart,document.activeElement.selectionEnd],
            others:tasks().filter(task=>task.id!==id&&task.status==='needsAction').map(task=>task.id),
            count:tasks().length,keys:window.shortcutEvents,
          }),scenario.id);
          assert.equal(actual.status,scenario.status);
          assert.equal(actual.active,scenario.id);
          if(scenario.id!=='quick')assert.deepEqual(actual.caret,[2,5]);
          assert.equal(actual.count,7);
          assert.deepEqual(actual.others,scenario.id==='unfinished'?['archive']:['unfinished','archive']);
          assert.equal(actual.keys.length,1);assert.equal(actual.keys[0].trusted,true);
          assert.equal(actual.keys[0].alt,true);assert.equal(actual.keys[0].shift,scenario.key!=='Alt+Enter');
          if(scenario.noWrite)assert.deepEqual(writes,[]);
          else{
            assert.equal(writes.length,1);assert.equal(writes[0].method,'PATCH');
            assert.ok(writes[0].url.endsWith(`/tasks/${scenario.id}`));
            assert.deepEqual(writes[0].body,{status:'needsAction'});
          }
          assert.deepEqual(errors,[]);
        });
      }
    });
  }
});
