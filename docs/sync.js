// Apply edits locally; serialize Google writes without blocking the task view.
let syncQueue=[],syncRunning=false,syncFailure=null,syncRevision=0,syncScope=null;
const syncAliases=new Map();
const syncPending=()=>syncQueue.length>0;
function remoteId(id){
  const seen=new Set();
  while(syncAliases.has(id)&&!seen.has(id)){seen.add(id);id=syncAliases.get(id);}
  return id;
}
function updateSyncStatus(){
  const status=document.querySelector('#status'),retry=document.querySelector('#retrysync');
  if(status)status.textContent=syncFailure?'Changes waiting to sync':syncPending()?'Syncing…':token?'Synced with Google Tasks':'Sign in to view your tasks';
  if(retry){retry.hidden=!syncFailure;retry.textContent=token?'Retry sync':'Reconnect';}
}
function saveSyncDraft(){
  if(!syncScope)return;
  try{
    const key='taskflow-outbox:'+syncScope;
    if(syncPending())localStorage.setItem(key,JSON.stringify({data,queue:syncQueue,aliases:[...syncAliases]}));
    else localStorage.removeItem(key);
  }catch{ /* The tab still retains the outbox; beforeunload protects outstanding changes. */ }
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
function enqueueSync(operation){
  syncRevision++;
  syncQueue.push({...operation});
  saveSyncDraft();updateSyncStatus();
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
  if(syncRunning||syncFailure||!token||!syncPending())return;
  syncRunning=true;
  try{
    while(syncPending()&&token){
      const op=syncQueue[0];
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
  if(syncPending()){saveSyncDraft();event.preventDefault();event.returnValue='';}
});
