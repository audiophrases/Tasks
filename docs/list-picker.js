// Preview every list as a column; Left/Right cycle between lists.
function listTaskPreview(id){
  const items=(data.tasks[id]||[]).filter(task=>!task.hidden&&!task.deleted&&(showCompleted||task.status!=='completed'));
  const groups=new Map();
  for(const task of items){const root=task.parent||task.id;if(!groups.has(root))groups.set(root,[]);groups.get(root).push(task);}
  return [...groups.values()].map((group,index)=>`<div class="preview-group task-group group-${index%7}">${group.sort((a,b)=>Number(Boolean(a.parent))-Number(Boolean(b.parent))).map(task=>`<div class="preview-task ${task.parent?'preview-child':''} ${task.status==='completed'?'preview-completed':''}"><span class="preview-check" aria-hidden="true">${task.status==='completed'?'✓':''}</span><span>${esc(task.title)}</span></div>`).join('')}</div>`).join('');
}
function openListPicker(){
  if(busy||$('#modal').open||$('#listpicker').open)return;
  if(!token){void connection();return;}
  if(!data.lists.length)return;
  const dialog=$('#listpicker');
  $('#listchoices').innerHTML=data.lists.map((item,index)=>`<div role="button" aria-label="${esc(item.title)}" class="list-choice task-group group-${index%7}" data-list="${esc(item.id)}" aria-current="${item.id===list}" tabindex="${item.id===list?0:-1}"><div class="preview-heading">${esc(item.title)}</div><div class="preview-tasks">${listTaskPreview(item.id)}</div></div>`).join('');
  dialog.showModal();
  const choices=[...dialog.querySelectorAll('[data-list]')];
  const current=choices.find(button=>button.dataset.list===list)||choices[0];
  current.focus();
  current.scrollIntoView({block:'nearest',inline:'center'});
}
function choosePickerList(id){
  if(busy||!token||!data.lists.some(item=>item.id===id))return;
  list=id;selected=null;
  $('#listpicker').close();
  render();
  const first=document.querySelector('.row .title');
  (first||$('#quick')).focus();
}
$('#picklist').onclick=openListPicker;
$('#listpicker').onclick=event=>{
  const button=event.target.closest('[data-list]');
  if(button)choosePickerList(button.dataset.list);
  else if(event.target===$('#listpicker')){
    const rect=event.target.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();
  }
};
document.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.key.toLowerCase()==='l'){
    event.preventDefault();
    if(!event.repeat)openListPicker();
    return;
  }
  const dialog=$('#listpicker');
  if(!dialog.open)return;
  const choices=[...dialog.querySelectorAll('[data-list]')];
  const index=choices.indexOf(document.activeElement);
  let next;
  if(event.key==='ArrowRight')next=(index+1)%choices.length;
  if(event.key==='ArrowLeft')next=(index-1+choices.length)%choices.length;
  if(event.key==='Home')next=0;
  if(event.key==='End')next=choices.length-1;
  if(next!==undefined&&choices.length){
    event.preventDefault();
    choices.forEach((choice,i)=>choice.tabIndex=i===next?0:-1);
    choices[next].focus();
    choices[next].scrollIntoView({block:'nearest',inline:'center'});
  }
  if((event.key==='ArrowDown'||event.key==='ArrowUp')&&index>=0){
    event.preventDefault();
    choices[index].querySelector('.preview-tasks').scrollBy({top:event.key==='ArrowDown'?120:-120,behavior:'smooth'});
  }
  if((event.key==='Enter'||event.key===' ')&&index>=0){event.preventDefault();choosePickerList(choices[index].dataset.list);}
});
