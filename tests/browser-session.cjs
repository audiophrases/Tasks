// Standalone, mocked browser regression: node --test tests/browser-session.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');

test('remembered sessions recover in the browser without another Google login',async t=>{
  const server=http.createServer(async(req,res)=>{
    const file=path.basename(new URL(req.url,'http://localhost').pathname)||'index.html';
    try {
      const body=await fs.readFile(path.join(__dirname,'../docs',file));
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(body);
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const channel=process.env.TASKFLOW_BROWSER_CHANNELS?.split(',')[0]||'chromium';
  const browser=await chromium.launch({headless:true,...(channel==='chromium'?{}:{channel})});
  t.after(()=>browser.close());

  for(const initialStatus of [200,503,401])await t.test(`saved session returns ${initialStatus}`,async t=>{
    const context=await browser.newContext();t.after(()=>context.close());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const expiresAt=Date.now()+90*86400000;
    let sessionStatus=initialStatus,sessionRequests=0;
    await context.addInitScript(()=>{
      localStorage.setItem('taskflow-google-session-v1',JSON.stringify({handle:'s'.repeat(43),expiresAt:Date.now()+86400000,cacheOwner:'workspace'}));
    });
    await page.route('**/*',route=>{
      const requestUrl=route.request().url();
      if(requestUrl.startsWith(url))return route.continue();
      if(requestUrl.endsWith('/api/taskflow/session')) {
        sessionRequests++;
        return route.fulfill({status:sessionStatus,json:sessionStatus===200
          ?{access_token:'mock-access',expires_at:Date.now()+3600000,session_expires_at:expiresAt}
          :{error:sessionStatus===401?'Session revoked':'Temporary outage'}});
      }
      if(requestUrl.endsWith('/api/taskflow/config'))return route.fulfill({json:{persistentSessions:true}});
      if(requestUrl.endsWith('/api/student/config'))return route.fulfill({json:{loginEnabled:true,googleClientId:'mock.apps.googleusercontent.com'}});
      if(requestUrl==='https://accounts.google.com/gsi/client')return route.fulfill({contentType:'text/javascript',body:'window.google={accounts:{oauth2:{initTokenClient(){return {}},initCodeClient(){return {}}}}};'});
      if(requestUrl.startsWith('https://tasks.googleapis.com/tasks/v1/users/@me/lists'))return route.fulfill({json:{items:[{id:'L',title:'My tasks'}]}});
      if(requestUrl.startsWith('https://tasks.googleapis.com/tasks/v1/lists/L/tasks'))return route.fulfill({json:{items:[{id:'task',title:'Restored task',status:'needsAction'}]}});
      return route.fulfill({body:''});
    });
    await page.goto(url);
    if(initialStatus===503) {
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('retrying automatically'));
      assert.equal(await page.locator('#modal').evaluate(dialog=>dialog.open),false);
      assert.ok(await page.evaluate(()=>localStorage.getItem('taskflow-google-session-v1')));
      sessionStatus=200;
      await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    }
    if(initialStatus===401) {
      await page.waitForFunction(()=>document.querySelector('#modal').open);
      assert.equal(await page.evaluate(()=>localStorage.getItem('taskflow-google-session-v1')),null);
    } else {
      await page.waitForFunction(()=>document.querySelector('.title')?.value==='Restored task');
      assert.equal(await page.locator('#modal').evaluate(dialog=>dialog.open),false);
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('taskflow-google-session-v1')));
      assert.equal(saved.expiresAt,expiresAt);assert.equal(saved.cacheOwner,'workspace');
      assert.equal(saved.access_token,undefined);
      assert.equal(sessionRequests,initialStatus===503?2:1);
    }
    assert.deepEqual(errors,[]);
  });
});
