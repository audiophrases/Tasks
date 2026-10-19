const sidebarToggle=document.querySelector('#sidebar-toggle');
sidebarToggle.onclick=()=>{
  const sidebar=document.querySelector('#sidebar');
  const expanded=sidebar.hidden;
  sidebar.hidden=!expanded;
  document.body.classList.toggle('sidebar-collapsed',!expanded);
  sidebarToggle.setAttribute('aria-expanded',String(expanded));
  sidebarToggle.setAttribute('aria-label',expanded?'Hide sidebar':'Show sidebar');
  sidebarToggle.title=expanded?'Hide sidebar':'Show sidebar';
};
