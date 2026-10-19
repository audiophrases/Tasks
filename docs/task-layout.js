function resizeTaskTitle(field){
  field.style.height='auto';
  field.style.height=field.scrollHeight+'px';
}
function resizeTaskTitles(){
  document.querySelectorAll('textarea.title').forEach(resizeTaskTitle);
}
document.querySelector('#tasks').addEventListener('input',event=>{
  if(event.target.matches('textarea.title'))resizeTaskTitle(event.target);
});
// Sidebar and viewport changes can alter line wrapping without changing text.
let taskLayoutWidth=-1;
const taskLayoutObserver=new ResizeObserver(entries=>{
  const width=entries[0].contentRect.width;
  if(width===taskLayoutWidth)return;
  taskLayoutWidth=width;
  requestAnimationFrame(resizeTaskTitles);
});
taskLayoutObserver.observe(document.querySelector('#tasks'));
