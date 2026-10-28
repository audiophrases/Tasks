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
        {id:'task',reopen:['latest']},
        {id:'subtask',reopen:['latest']},
        {id:'task',reopen:['latest'],cleared:true},
        {id:'subtask',reopen:['latest'],cleared:true},
        {id:'subtask',reopen:['latest','older'],cleared:true,draft:true},
        {id:'subtask',reopen:['latest'],key:'Alt+Shift+Enter'},
        {id:'empty',reopen:[]},
        {id:'quick',reopen:['standalone'],cleared:true},
      ];
      for(const scenario of cases){
        await t.test((scenario.key||'Shift+Alt+Enter')+' from '+scenario.id+(scenario.cleared?' with cleared completions':'')+(scenario.draft?' while editing, twice':''),async()=>{
          writes.length=0;
          await page.evaluate(cleared=>{
            token='browser-test-only';expires=Date.now()+3600000;list='L';busy=false;showCompleted=false;selected=null;
            data={lists:[{id:'L',title:'Browser test'}],tasks:{L:[
              {id:'task',title:'Current task',status:'needsAction'},
              {id:'subtask',title:'Current subtask',status:'needsAction',parent:'task'},
              {id:'older',title:'Older completed subtask',status:'completed',completed:'2026-10-28T09:00:00Z',parent:'task'},
              {id:'latest',title:'Latest completed subtask',status:'completed',completed:'2026-10-28T10:00:00Z',parent:'task',hidden:cleared},
              {id:'empty',title:'Group without completed tasks',status:'needsAction'},
              {id:'other-project',title:'Another task group',status:'needsAction'},
              {id:'foreign',title:'Newer completion in another group',status:'completed',completed:'2026-10-28T11:00:00Z',parent:'other-project'},
              {id:'standalone',title:'Newest top-level completion',status:'completed',completed:'2026-10-28T12:00:00Z',hidden:cleared},
            ]}};
            $('#modal').close();render();
            window.shortcutEvents=[];
            document.onkeydown=event=>{if(event.key==='Enter')window.shortcutEvents.push({alt:event.altKey,shift:event.shiftKey,trusted:event.isTrusted});};
          },Boolean(scenario.cleared));
          const selector=scenario.id==='quick'?'#quick':'.row[data-id="'+scenario.id+'"] .title';
          const input=page.locator(selector);
          await input.click();
          if(scenario.draft||scenario.id==='quick')await input.fill('Draft being edited');
          const draft=await input.inputValue();
          await page.evaluate(()=>document.activeElement.setSelectionRange(2,5));
          for(const [index,id] of (scenario.reopen.length?scenario.reopen:[null]).entries()){
            if(id)assert.equal(await page.locator('.row[data-id="'+id+'"]').count(),0);
            await page.keyboard.press(scenario.key||'Shift+Alt+Enter');
            await page.waitForFunction(()=>!busy&&!syncPending());
            const actual=await page.evaluate(()=>({
              active:document.activeElement.closest('.row')?.dataset.id||document.activeElement.id,
              caret:[document.activeElement.selectionStart,document.activeElement.selectionEnd],
              reopened:tasks().filter(task=>task.status==='needsAction'&&!['task','subtask','empty','other-project'].includes(task.id)).map(task=>task.id),
              count:tasks().length,showCompleted,keys:window.shortcutEvents,
            }));
            assert.equal(actual.active,scenario.id);assert.deepEqual(actual.caret,[2,5]);
            assert.equal(await input.inputValue(),draft);assert.equal(actual.count,8);assert.equal(actual.showCompleted,false);
            assert.deepEqual(actual.reopened.sort(),scenario.reopen.slice(0,index+1).sort());
            assert.equal(actual.keys.length,index+1);assert.equal(actual.keys[index].trusted,true);
            assert.equal(actual.keys[index].alt,true);assert.equal(actual.keys[index].shift,true);
            const reopenWrites=writes.filter(write=>write.body?.status==='needsAction');
            if(!id){assert.deepEqual(reopenWrites,[]);assert.match(await page.locator('#toast').innerText(),/No completed tasks.*group/);}
            else{
              assert.equal(reopenWrites.length,index+1);assert.equal(reopenWrites[index].method,'PATCH');
              assert.ok(reopenWrites[index].url.endsWith('/tasks/'+id));
              assert.deepEqual(reopenWrites[index].body,{status:'needsAction'});
              assert.equal(await page.locator('.row[data-id="'+id+'"]').isVisible(),true);
            }
            assert.deepEqual(errors,[]);
          }
        });
      }
    });
  }
});
