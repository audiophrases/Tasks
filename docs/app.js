const $=s=>document.querySelector(s), uid=()=>crypto.randomUUID();
let data={lists:[],tasks:{}},list=null,selected=null,showCompleted=false,token=null,expires=0,busy=false,drag=null,refreshTimer,cacheVisible=false;
const tasks=()=>data.tasks[list]||[], base=()=>`/lists/${encodeURIComponent(list)}/tasks`, esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(s){$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').style.display='none',4500)}
function ordered(){const t=tasks(),out=[];for(const p of t.filter(x=>!x.parent)){out.push(p);out.push(...t.filter(x=>x.parent===p.id))}out.push(...t.filter(x=>x.parent&&!t.some(p=>p.id===x.parent)));return out}
function renderTaskRow(t,archiveChild=false){const deleteLabel=isDeletedList()?'Permanently delete task':'Move task to Deleted';return `<div class="row ${t.parent||archiveChild?'child':''} ${archiveChild?(t.parent?'archive-subtask':'archive-project'):''} ${selected===t.id?'selected':''} ${t.status==='completed'?'completed':''}" data-id="${esc(t.id)}"><span class="grip" draggable="true" title="Drag to reorder">⠿</span><button class="check ${t.status==='completed'?'done':''}" data-action="check" title="Complete / reopen (Alt + Enter)" aria-label="${t.status==='completed'?'Reopen':'Complete'} task">${t.status==='completed'?'✓':''}</button><textarea class="title" aria-label="Task title" ${!token&&cacheVisible?'readonly':''} rows="1" wrap="soft">${esc(t.title)}</textarea><div class="actions"><button data-action="copy" title="Copy task text (Ctrl/Cmd + C without a selection)" aria-label="Copy task text">⧉</button><button data-action="sub" title="Add subtask (Ctrl/Cmd + Enter)" aria-label="Add subtask">↳</button><button data-action="up" title="Move up (Alt + Up)" aria-label="Move up">↑</button><button data-action="down" title="Move down (Alt + Down)" aria-label="Move down">↓</button><button data-action="delete" title="${deleteLabel} (Ctrl/Cmd + Delete)" aria-label="${deleteLabel}">×</button></div></div>`;}
function renderTaskGroups(items){
  return taskDisplayGroups(items,showCompleted).map((group,index)=>`<div class="task-group group-${index%7} ${group.archived?'archive-group':''}">${group.tasks.map(task=>renderTaskRow(task,group.archived&&task.id!==group.marker)).join('')}</div>`).join('');
}
function render(){if(!token&&!syncPending()&&!cacheVisible){data={lists:[],tasks:{}};list=null;selected=null;}$('#quick').disabled=!token||!list;$('#newlist').disabled=!token;$('#connection').textContent=token?'Google Tasks connected':'Not signed in';$('#connect').innerHTML=token?'Google connection <span>✓</span>':'Connect Google Tasks <span>↗</span>';updateSyncStatus();$('#lists').innerHTML=data.lists.map(l=>`<button data-list="${esc(l.id)}" class="${l.id===list?'active':''}"><span>☷</span>${esc(l.title)}<span>${(data.tasks[l.id]||[]).filter(t=>t.status!=='completed').length}</span></button>`).join('');$('#listtitle').textContent=data.lists.find(l=>l.id===list)?.title||'Tasks';$('#count').textContent=tasks().filter(t=>t.status!=='completed').length;const visible=visibleTasks();$('#empty').hidden=!token||visible.length>0;$('#tasks').innerHTML=renderTaskGroups(tasks());$('#togglecompleted').textContent=showCompleted?'Hide completed':'Show completed';resizeTaskTitles();}
function focus(id){selected=id;render();const input=[...document.querySelectorAll('.row')].find(r=>r.dataset.id===id)?.querySelector('.title');input?.focus()}
function focusTaskList(){
  if(!token||!list||$('#modal').open||$('#listpicker').open||document.activeElement?.matches('input,textarea,[contenteditable="true"]'))return;
  const first=visibleTasks()[0];
  if(first)focus(first.id);
  else $('#quick').focus();
}
async function api(path,method='GET',body){await ensureGoogleSession();const r=await fetch('https://tasks.googleapis.com/tasks/v1'+path,{method,signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(r.status===204)return null;const j=await r.json();if(!r.ok)throw Object.assign(Error(j.error?.message||'Google Tasks request failed'),{status:r.status});return j}
async function all(path){let items=[],page;do{const j=await api(path+(path.includes('?')?'&':'?')+'maxResults=100'+(page?'&pageToken='+encodeURIComponent(page):''));items.push(...(j.items||[]));page=j.nextPageToken}while(page);return items}
let backgroundRead=null;
async function reload(){
  if(backgroundRead)return backgroundRead;
  if(syncPending()){taskCacheRefreshing=false;updateSyncStatus();return;}
  const revision=syncRevision;
  const workspace=data;
  const read=(async()=>{
    const lists=await all('/users/@me/lists');
    const entries=await Promise.all(lists.map(async item=>[item.id,(await all(`/lists/${encodeURIComponent(item.id)}/tasks?showCompleted=true&showHidden=true`)).sort((a,b)=>(a.position||'').localeCompare(b.position||''))]));
    if(syncRevision!==revision||syncPending()||data!==workspace||!token)return;
    // A clean focused title must not block updates to the cached workspace.
    const active=document.activeElement,editing=active?.matches('.title');
    const activeId=editing?active.closest?.('.row')?.dataset.id:null;
    const activeTask=editing?tasks().find(item=>item.id===activeId):null;
    if(editing&&(!activeTask||active.value!==activeTask.title))return;
    const focusId=activeTask?remoteId(activeTask.id):null,start=active?.selectionStart,end=active?.selectionEnd;
    const next={lists,tasks:Object.fromEntries(entries)};
    data=restoreSyncDraft(next)||next;
    if(!data.lists.some(item=>item.id===list))list=data.lists[0]?.id;
    cacheVisible=false;
    render();
    saveTaskCache();
    if(focusId){
      const input=[...document.querySelectorAll('.row')].find(row=>row.dataset.id===focusId)?.querySelector('.title');
      if(input){input.focus();input.setSelectionRange(start,end);}
      else focusTaskList();
    }
  })();
  backgroundRead=read;
  try{await read;}finally{if(backgroundRead===read)backgroundRead=null;taskCacheRefreshing=false;updateSyncStatus();}
}
async function backgroundRefresh(){
  try{await reload();}catch(error){updateSyncStatus();if(!token&&!syncPending()){render();void connection();}else notify('Could not refresh Google Tasks. Your edits are unchanged.');}
}
async function run(fn){
  if(busy)return;
  if(!token){void connection();return;}
  busy=true;
  try{
    await fn();
    const active=document.activeElement,editing=active?.matches('.title'),id=active?.closest('.row')?.dataset.id,start=active?.selectionStart,end=active?.selectionEnd,draft=editing?active.value:null;
    render();
    if(editing&&id){const input=[...document.querySelectorAll('.row')].find(row=>row.dataset.id===id)?.querySelector('.title');if(input){input.value=draft;resizeTaskTitle(input);input.focus();input.setSelectionRange(start,end);}}
  }catch(error){notify(error.message);}
  finally{busy=false;}
}
async function patch(task,changes,options){recordPatchUndo(task,changes);Object.assign(task,changes);if(changes.status==='completed')task.completed=new Date().toISOString();else if(changes.status)delete task.completed;enqueueSync({kind:'patch',listId:list,id:task.id,changes:{...changes}},options);}
function saveTaskTitle(event){
  if(event.isComposing||!token||!event.target.matches('.title'))return;
  const task=tasks().find(item=>item.id===event.target.closest('.row')?.dataset.id);
  if(task&&task.title!==event.target.value)void patch(task,{title:event.target.value},{delay:700});
}
function createList(title,{select=true}={}){
  const item={id:'pending:'+uid(),title};
  data.lists.push(item);data.tasks[item.id]=[];if(select)list=item.id;
  enqueueSync({kind:'createList',id:item.id,title});
  return item;
}
function isDeletedList(id=list){
  return data.lists.find(item=>item.id===id)?.title.trim().toLowerCase()==='deleted';
}
function deleteTask(task){
  const listId=list;
  if(isDeletedList(listId)){
    data.tasks[listId]=tasks().filter(item=>item.id!==task.id&&item.parent!==task.id);
    selected=null;
    recordUndo({kind:'permanentDelete'});
    enqueueSync({kind:'permanentDelete',listId,id:task.id});
    notify('Permanently deleted');return;
  }
  const destination=data.lists.find(item=>item.title.trim().toLowerCase()==='deleted')||createList('Deleted',{select:false});
  recordUndo({kind:'delete',listId,id:task.id,deletedListId:destination.id,parent:task.parent,previous:taskAnchor(task)});
  const family=tasks().filter(item=>item.id===task.id||item.parent===task.id);
  data.tasks[listId]=tasks().filter(item=>item.id!==task.id&&item.parent!==task.id);
  delete task.parent;
  (data.tasks[destination.id]??=[]).unshift(...family);
  selected=null;
  enqueueSync({kind:'moveToList',listId,id:task.id,destinationListId:destination.id});
  notify('Moved to Deleted');
}
function modal(html){$('#modalbody').innerHTML=html;$('#modal').showModal()}
function shortcuts(){modal('<span class="eyebrow">KEEP YOUR HANDS IN FLOW</span><h2>A shortcut to simple.</h2>'+[['Switch list','Alt + L'],['New task','N'],['Add next task','Enter'],['Add subtask','Ctrl / ⌘ + Enter'],['Indent / outdent','Tab / Shift + Tab'],['Reorder task','Alt + ↑ / ↓'],['Navigate tasks','↑ / ↓'],['Complete / reopen task','Alt + Enter'],['Also complete / reopen','Ctrl / ⌘ + Shift + Enter'],['Reopen last completed subtask (or task)','Alt + Shift + Enter'],['Select a task range','Shift + click'],['Add / remove a selected task','Ctrl / ⌘ + click'],['Copy selected tasks / task text','Ctrl / ⌘ + C'],['Delete task / move to Deleted','Ctrl / ⌘ + Delete'],['Undo last action','Ctrl / ⌘ + Z'],['Show shortcuts','?'],['Leave task / close dialog','Esc']].map(([a,b])=>`<div class="shortcut"><span>${a}</span><kbd>${b}</kbd></div>`).join('')+'<p>Task shortcuts work while editing a task. Tab and Shift + Tab change the task’s level from anywhere in its title. In Deleted, the delete action permanently removes the task and its subtasks without confirmation. On Mac, ⌘ + Backspace performs the same action. Undo reverses typing in the field you are editing first, then earlier task changes; permanent deletes can’t be undone. Press Esc to leave the title.</p>')}
$('#connect').onclick=connection;$('#shortcuts').onclick=shortcuts;$('#help').onclick=shortcuts;$('#tipclose').onclick=()=>$('.tip').remove();$('#togglecompleted').onclick=()=>{showCompleted=!showCompleted;render()};$('#refresh').onclick=()=>syncFailure?retrySync():token?backgroundRefresh():connection();$('#retrysync').onclick=retrySync;
$('#quick').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&list){e.preventDefault();const title=e.target.value;run(async()=>{await add(title,null,tasks().filter(t=>!t.parent&&!t.hidden&&!t.deleted).at(-1)?.id,{allowEmpty:true});$('#quick').value=''})}};
$('#lists').onclick=e=>{const b=e.target.closest('[data-list]');if(b&&!busy){list=b.dataset.list;selected=null;render();saveTaskCache()}};
$('#newlist').onclick=()=>{if(!token){void connection();return;}modal('<h2>A fresh list</h2><label for="listname">List name</label><input id="listname" placeholder="What’s on your mind?"><button id="createlist" class="primary">Create list</button>');$('#listname').focus();const create=()=>{const title=$('#listname').value.trim();if(!title)return;$('#modal').close();run(async()=>{createList(title)})};$('#createlist').onclick=create;$('#listname').onkeydown=e=>{if(e.key==='Enter')create()}};
$('#tasks').addEventListener('focusin',e=>{const r=e.target.closest('.row');if(r){selected=r.dataset.id;document.querySelectorAll('.row').forEach(x=>x.classList.toggle('selected',x===r))}});
$('#tasks').addEventListener('input',saveTaskTitle);
$('#tasks').addEventListener('compositionend',saveTaskTitle);
$('#tasks').addEventListener('change',e=>{if(!e.target.matches('.title'))return;const t=tasks().find(t=>t.id===e.target.closest('.row').dataset.id);if(!t)return;flushTitleSync(list,t.id);const title=e.target.value.trim();if(title&&title!==t.title)run(()=>patch(t,{title}));else e.target.value=t.title});
$('#tasks').onclick=e=>{const b=e.target.closest('[data-action]'),r=e.target.closest('.row');if(!b||!r)return;const t=tasks().find(t=>t.id===r.dataset.id);if(b.dataset.action==='copy'){void copyTaskText(r,t);return}run(async()=>{switch(b.dataset.action){case 'check':await patch(t,{status:t.status==='completed'?'needsAction':'completed'});break;case 'sub':await add('',t.parent||t.id,tasks().filter(x=>x.parent===(t.parent||t.id)&&!x.hidden&&!x.deleted).at(-1)?.id,{allowEmpty:true});break;case 'up':await reorder(t,-1);break;case 'down':await reorder(t,1);break;case 'delete':deleteTask(t);break}})};
$('#tasks').onkeydown=e=>{if(handleTaskShortcut(e))return;const r=e.target.closest('.row');if(!r||busy)return;const t=tasks().find(t=>t.id===r.dataset.id),mod=e.ctrlKey||e.metaKey;const isInput=e.target.matches('.title');if(e.key==='Tab'&&isInput&&!mod&&!e.altKey){e.preventDefault();run(async()=>{const title=e.target.value.trim();if(title&&title!==t.title)await patch(t,{title});await indent(t,e.shiftKey)})}else if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();run(async()=>{const title=isInput?e.target.value.trim():'';if(title&&title!==t.title)await patch(t,{title});await reorder(t,e.key==='ArrowUp'?-1:1)})}else if(e.key==='Enter'&&isInput){e.preventDefault();run(async()=>{const title=e.target.value.trim();if(title&&title!==t.title)await patch(t,{title});if(mod&&e.shiftKey)await patch(t,{status:t.status==='completed'?'needsAction':'completed'});else if(mod)await add('',t.parent||t.id,tasks().filter(x=>x.parent===(t.parent||t.id)&&!x.hidden&&!x.deleted).at(-1)?.id,{allowEmpty:true});else await add('',t.parent,t.id,{allowEmpty:true})})}else if(['ArrowUp','ArrowDown'].includes(e.key)&&!mod){e.preventDefault();const a=visibleTasks(),i=a.indexOf(t)+(e.key==='ArrowUp'?-1:1);if(a[i])focus(a[i].id)}else if(e.key==='Escape'){e.target.blur();$('#quick').focus()}};
$('#tasks').ondragstart=e=>{const r=e.target.closest('.row');if(!r||busy)return;drag=r.dataset.id;e.dataTransfer.setData('text/plain',drag);e.dataTransfer.effectAllowed='move'};$('#tasks').ondragover=e=>{if(drag)e.preventDefault()};$('#tasks').ondrop=e=>{e.preventDefault();const r=e.target.closest('.row');if(!r||!drag)return;const t=tasks().find(x=>x.id===drag),target=tasks().find(x=>x.id===r.dataset.id);drag=null;if(t&&target&&t.id!==target.id)run(()=>move(t,target.parent,target.id))};$('#tasks').ondragend=()=>drag=null;
document.addEventListener('keydown',e=>{if(e.key!=='Enter'||!e.altKey||!e.shiftKey||e.ctrlKey||e.metaKey||e.isComposing||e.defaultPrevented||!token||!list||$('#modal').open||$('#listpicker').open||e.target.closest?.('.row'))return;e.preventDefault();if(!e.repeat)run(()=>reopenLastCompleted(null))});
document.addEventListener('keydown',e=>{if($('#modal').open||$('#listpicker').open||e.target.matches('input,textarea')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='?'){e.preventDefault();shortcuts()}if(e.key.toLowerCase()==='n'){e.preventDefault();$('#quick').focus()}});document.addEventListener('visibilitychange',()=>{if((token||savedGoogleSession())&&!busy&&document.visibilityState==='visible')void backgroundRefresh()});render();
async function initialize(){await restoreGoogleSession();if(!token){if(!cacheVisible)await connection();}else focusTaskList();}
void initialize();
