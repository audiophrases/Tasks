// Apply edits locally; serialize Google writes without blocking the task view.
let syncQueue=[],syncRunning=false,syncFailure=null,syncRevision=0,syncScope=null,syncTimer=null;
const syncAliases=new Map();
const syncPending=()=>syncQueue.length>0;
const TASK_CACHE_KEY='taskflow-task-cache-v1';
let taskCacheRefreshing=false,taskCacheOwner=null;
function taskCacheConnection(){
  for(const key of ['taskflow-google-session-v1','taskflow-browser-session-v1']){
    const value=JSON.parse(localStorage.getItem(key)||'null');
    if(!value||!(value.expiresAt>Date.now()))continue;
    if(key==='taskflow-google-session-v1'?!/^[A-Za-z0-9_-]{43}$/.test(value.handle):typeof value.accessToken!=='string'||!value.accessToken)continue;
    return {key,value};
  }
  return null;
}
function saveTaskCache(){
  if(!token||!data.lists.length)return;
  try{
    const connection=taskCacheConnection();
    if(!connection)return;
    if(taskCacheOwner&&connection.value.cacheOwner!==taskCacheOwner)return;
    const owner=connection.value.cacheOwner||crypto.randomUUID();
    if(!connection.value.cacheOwner)localStorage.setItem(connection.key,JSON.stringify({...connection.value,cacheOwner:owner}));
    localStorage.setItem(TASK_CACHE_KEY,JSON.stringify({owner,data,list,aliases:[...syncAliases]}));
    taskCacheOwner=owner;
  }catch{ /* Caching is optional when browser storage is unavailable. */ }
}
function restoreTaskCache(){
  try{
    const connection=taskCacheConnection(),cached=JSON.parse(localStorage.getItem(TASK_CACHE_KEY)||'null');
    if(!connection?.value.cacheOwner||cached?.owner!==connection.value.cacheOwner||!Array.isArray(cached.data?.lists)||!cached.data?.tasks)return false;
    if(!cached.data.lists.every(item=>typeof item.id==='string'&&typeof item.title==='string'&&Array.isArray(cached.data.tasks[item.id])&&cached.data.tasks[item.id].every(task=>task&&typeof task.id==='string'&&typeof task.title==='string')))return false;
    syncAliases.clear();
    for(const [id,value] of cached.aliases||[])syncAliases.set(id,value);
    data=restoreSyncDraft(cached.data)||cached.data;
    list=data.lists.some(item=>item.id===cached.list)?cached.list:data.lists[0]?.id;
    cacheVisible=true;taskCacheRefreshing=true;taskCacheOwner=cached.owner;
    render();
    return true;
  }catch{return false;}
}
function clearTaskCache(){
  cacheVisible=false;taskCacheRefreshing=false;taskCacheOwner=null;
  try{localStorage.removeItem(TASK_CACHE_KEY);}catch{}
}
function remoteId(id){
  const seen=new Set();
  while(syncAliases.has(id)&&!seen.has(id)){seen.add(id);id=syncAliases.get(id);}
  return id;
}
function updateSyncStatus(){
  const status=document.querySelector('#status'),retry=document.querySelector('#retrysync');
  if(status)status.textContent=syncFailure?'Changes waiting to sync':syncPending()?'Syncing…':taskCacheRefreshing?'Showing saved tasks · checking Google…':token?'Synced with Google Tasks':cacheVisible?'Showing saved tasks · reconnect to sync':'Sign in to view your tasks';
  if(retry){retry.hidden=!syncFailure;retry.textContent=token?'Retry sync':'Reconnect';}
}
function saveSyncDraft(){
  if(!syncScope)return;
  try{
    const key='taskflow-outbox:'+syncScope;
    if(syncPending())localStorage.setItem(key,JSON.stringify({data,queue:syncQueue,aliases:[...syncAliases]}));
    else localStorage.removeItem(key);
  }catch{ /* The tab still retains the outbox; beforeunload protects outstanding changes. */ }
  saveTaskCache();
}
function restoreSyncDraft(remote){
  if(syncPending())return null;
  syncScope=remote.lists[0]?.id||null;
  for(const item of remote.lists){
    try{
      const draft=JSON.parse(localStorage.getItem('taskflow-outbox:'+item.id)||'null');
      if(!draft||!Array.isArray(draft.queue)||!draft.queue.length||!draft.data?.lists||!draft.data?.tasks)continue;
      syncScope=item.id;syncQueue=draft.queue;syncAliases.clear();
      for(const [key,value] of draft.aliases||[])syncAliases.set(key,value);
      syncFailure=Error('Unfinished changes were restored. Retry sync to continue.');
      notify(syncFailure.message);
      return draft.data;
    }catch{}
  }
  return null;
}
function titleSyncOperation(operation){
  return operation.kind==='patch'&&Object.keys(operation.changes).length===1&&Object.hasOwn(operation.changes,'title');
}
function enqueueSync(operation,{delay=0}={}){
  syncRevision++;
  const previous=syncQueue.at(-1);
  // Collapse typing bursts, but never change a request already sent to Google.
  if(previous&&!previous.inFlight&&titleSyncOperation(operation)&&titleSyncOperation(previous)&&previous.id===operation.id&&previous.listId===operation.listId){
    previous.changes={...operation.changes};
    previous.readyAt=delay?Date.now()+delay:0;
  }else syncQueue.push({...operation,...(delay?{readyAt:Date.now()+delay}:{})});
  saveSyncDraft();updateSyncStatus();
  void flushSync();
}
function flushTitleSync(listId,id){
  for(const operation of syncQueue){
    if(titleSyncOperation(operation)&&(!listId||operation.listId===listId)&&(!id||operation.id===id))delete operation.readyAt;
  }
  void flushSync();
}
async function sendSyncOperation(op){
  if(op.kind==='createList')return api('/users/@me/lists','POST',{title:op.title});
  const path='/lists/'+encodeURIComponent(remoteId(op.listId))+'/tasks';
  const query=new URLSearchParams();
  if(op.parent)query.set('parent',remoteId(op.parent));
  if(op.previous)query.set('previous',remoteId(op.previous));
  if(op.kind==='create')return api(path+'?'+query,'POST',{title:op.title});
  const taskPath=path+'/'+encodeURIComponent(remoteId(op.id));
  if(op.kind==='moveToList'){
    query.set('destinationTasklist',remoteId(op.destinationListId));
    try{return await api(taskPath+'/move?'+query,'POST');}
    catch(error){
      if(error.status!==404)throw error;
      // A previous attempt may have moved it before the connection dropped.
      return api('/lists/'+encodeURIComponent(remoteId(op.destinationListId))+'/tasks/'+encodeURIComponent(remoteId(op.id)));
    }
  }
  if(op.kind==='move')return api(taskPath+'/move?'+query,'POST');
  if(op.kind==='patch')return api(taskPath,'PATCH',op.changes);
  if(op.kind==='permanentDelete'){
    try{return await api(taskPath,'DELETE');}
    catch(error){if(error.status!==404)throw error;}
    return;
  }
  if(op.kind==='delete'){
    // Old browser outboxes must also use the new, recoverable behavior.
    let destination=data.lists.find(item=>item.title.trim().toLowerCase()==='deleted');
    if(!destination){
      destination=await api('/users/@me/lists','POST',{title:'Deleted'});
      data.lists.push(destination);data.tasks[destination.id]=[];
    }
    op.kind='moveToList';op.destinationListId=destination.id;saveSyncDraft();
    return sendSyncOperation(op);
  }
}
async function flushSync(){
  if(syncTimer){clearTimeout(syncTimer);syncTimer=null;}
  if(syncRunning||syncFailure||!token||!syncPending())return;
  syncRunning=true;
  try{
    while(syncPending()&&token){
      const op=syncQueue[0];
      const delay=(op.readyAt||0)-Date.now();
      if(delay>0){syncTimer=setTimeout(()=>{syncTimer=null;void flushSync();},delay);break;}
      op.inFlight=true;saveSyncDraft();
      const result=await sendSyncOperation(op);
      if(op.kind==='create'||op.kind==='createList'){
        if(!result?.id)throw Error('Google did not return an ID for the new item.');
        syncAliases.set(op.id,result.id);
      }
      if(op.kind==='moveToList'&&result?.id&&result.id!==remoteId(op.id)){
        syncAliases.set(remoteId(op.id),result.id);
        syncAliases.set(op.id,result.id);
      }
      // Responses acknowledge writes; they must not replace newer local edits.
      syncQueue.shift();saveSyncDraft();updateSyncStatus();
    }
  }catch(error){
    syncFailure=error;
    const op=syncQueue[0];
    if(op&&error.status>=400&&error.status<500&&error.status!==408)op.inFlight=false; // Server timeouts and 5xx responses can leave creation uncertain.
    saveSyncDraft();
    notify('Google sync paused. Your changes are kept in this tab. '+error.message);
  }finally{syncRunning=false;updateSyncStatus();}
}
function retrySync(){
  if(!token){void connection();return;}
  const op=syncQueue[0];
  if(op?.inFlight&&(op.kind==='create'||op.kind==='createList')&&!confirm('Google may already have created this item before the connection was interrupted. Check Google Tasks first. Retry creating it?'))return;
  syncFailure=null;updateSyncStatus();void flushSync();
}
window.addEventListener('beforeunload',event=>{
  flushTitleSync();
  if(syncPending()){saveSyncDraft();event.preventDefault();event.returnValue='';}
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')flushTitleSync();
});
