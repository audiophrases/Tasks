// A quiet list picker: only list names, with keyboard and pointer navigation.
function openListPicker(){
  if(busy||$('#modal').open||$('#listpicker').open)return;
  if(!token){void connection();return;}
  if(!data.lists.length)return;
  const dialog=$('#listpicker');
  $('#listchoices').innerHTML=data.lists.map((item,index)=>`<button type="button" class="list-choice task-group group-${index%7}" data-list="${esc(item.id)}" aria-current="${item.id===list}" tabindex="${item.id===list?0:-1}">${esc(item.title)}</button>`).join('');
  dialog.showModal();
  const choices=[...dialog.querySelectorAll('[data-list]')];
  (choices.find(button=>button.dataset.list===list)||choices[0]).focus();
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
  if(event.key==='ArrowDown'||event.key==='ArrowRight')next=(index+1)%choices.length;
  if(event.key==='ArrowUp'||event.key==='ArrowLeft')next=(index-1+choices.length)%choices.length;
  if(event.key==='Home')next=0;
  if(event.key==='End')next=choices.length-1;
  if(next!==undefined&&choices.length){
    event.preventDefault();
    choices.forEach((choice,i)=>choice.tabIndex=i===next?0:-1);
    choices[next].focus();
    choices[next].scrollIntoView({block:'nearest'});
  }
  if(event.key==='Enter'&&index>=0){event.preventDefault();choosePickerList(choices[index].dataset.list);}
});
