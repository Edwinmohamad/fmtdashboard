(function(){
  'use strict';
  const root=document.documentElement;
  function systemDark(){return !!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)}
  function applyTheme(pref){
    const dark=pref==='dark'||(pref==='system'&&systemDark());
    root.dataset.theme=dark?'dark':'light';root.dataset.themePreference=pref;localStorage.setItem('fmt-theme',pref);
    const l=document.getElementById('themeLabel'),i=document.getElementById('themeIcon');
    if(l)l.textContent=pref==='system'?'System':pref[0].toUpperCase()+pref.slice(1);
    if(i)i.textContent=pref==='dark'?'☾':pref==='light'?'☀':'◐';
  }
  function toast(msg,type='good'){
    const h=document.getElementById('toastHost');if(!h)return;
    const x=document.createElement('div');x.className='toast '+type;x.textContent=msg;h.appendChild(x);setTimeout(()=>x.remove(),4200);
  }
  async function jsonPost(url,data){
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'fetch'},body:JSON.stringify(data)});
    let j={};try{j=await r.json()}catch(_e){}
    if(!r.ok)throw new Error(j.detail||j.message||('Request failed '+r.status));return j;
  }
  function initCommon(){
    let pref=localStorage.getItem('fmt-theme')||'system';applyTheme(pref);
    document.getElementById('themeToggle')?.addEventListener('click',()=>{const a=['system','light','dark'];pref=a[(a.indexOf(pref)+1)%a.length];applyTheme(pref)});
    if(window.matchMedia)matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(pref==='system')applyTheme('system')});
    const sidebar=document.getElementById('sidebar'),overlay=document.getElementById('sidebarOverlay'),sideBtn=document.getElementById('sidebarToggle');
    const mobileSidebar=()=>window.matchMedia('(max-width:1024px)').matches;
    function toggleSidebar(){
      if(mobileSidebar()){sidebar?.classList.toggle('open');overlay?.classList.toggle('show');return}
      document.body.classList.toggle('sidebar-collapsed');
      const collapsed=document.body.classList.contains('sidebar-collapsed');
      localStorage.setItem('fmt-sidebar',collapsed?'collapsed':'expanded');
      root.classList.toggle('sidebar-precollapsed',collapsed);
    }
    if(!mobileSidebar()&&localStorage.getItem('fmt-sidebar')==='collapsed')document.body.classList.add('sidebar-collapsed');
    sideBtn?.addEventListener('click',toggleSidebar);overlay?.addEventListener('click',toggleSidebar);
    window.addEventListener('resize',()=>{if(!mobileSidebar()){sidebar?.classList.remove('open');overlay?.classList.remove('show')}});
    const profileBtn=document.getElementById('profileMenuBtn'),profileMenu=document.getElementById('profileMenu');
    profileBtn?.addEventListener('click',e=>{e.stopPropagation();const open=!profileMenu.hidden;profileMenu.hidden=open;profileBtn.setAttribute('aria-expanded',String(!open))});
    document.addEventListener('click',e=>{if(profileMenu&&!profileMenu.hidden&&!profileMenu.contains(e.target)&&e.target!==profileBtn){profileMenu.hidden=true;profileBtn?.setAttribute('aria-expanded','false')}});
    const notifyBtn=document.getElementById('notifyBtn'),notifyPanel=document.getElementById('notifyPanel');
    notifyBtn?.addEventListener('click',e=>{e.stopPropagation();const open=!notifyPanel.hidden;notifyPanel.hidden=open;notifyBtn.setAttribute('aria-expanded',String(!open));if(profileMenu&&!profileMenu.hidden){profileMenu.hidden=true;profileBtn?.setAttribute('aria-expanded','false')}});
    document.addEventListener('click',e=>{if(notifyPanel&&!notifyPanel.hidden&&!notifyPanel.contains(e.target)&&e.target!==notifyBtn){notifyPanel.hidden=true;notifyBtn?.setAttribute('aria-expanded','false')}});
    document.querySelectorAll('.nav-link').forEach(a=>{try{const u=new URL(a.href,location.origin),cur=new URL(location.href);let active=u.pathname===cur.pathname;if(active&&u.pathname==='/tickets'&&u.searchParams.get('type'))active=u.searchParams.get('type')===cur.searchParams.get('type');if(active)a.classList.add('active')}catch(_e){}});
    document.querySelectorAll('form[data-confirm]').forEach(f=>f.addEventListener('submit',e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}));
    const modal=document.getElementById('commandModal'),btn=document.getElementById('commandBtn'),search=document.getElementById('commandSearch'),hints=modal?.querySelector('.command-hints');
    function openCmd(){if(!modal)return;modal.hidden=false;setTimeout(()=>search?.focus(),30)}function closeCmd(){if(modal)modal.hidden=true}
    btn?.addEventListener('click',openCmd);modal?.addEventListener('click',e=>{if(e.target===modal)closeCmd()});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCmd()}if(e.key==='Escape')closeCmd()});
    let st;search?.addEventListener('input',()=>{clearTimeout(st);st=setTimeout(async()=>{const q=search.value.trim();if(q.length<2)return;try{const r=await fetch('/api/global-search?qtext='+encodeURIComponent(q),{cache:'no-store'});const j=await r.json();if(hints)hints.innerHTML=(j.results||[]).map(x=>`<a href="${x.url}"><b>${x.type}</b> ${x.title}<small>${x.meta||''}</small></a>`).join('')||'<span class="muted">No results</span>'}catch(_e){}},180)});
    const clock=document.getElementById('liveClock');if(clock){const tick=()=>{clock.textContent=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())};tick();setInterval(tick,1000);}
    document.querySelectorAll('.sparkline').forEach(el=>{const vals=(el.dataset.values||'').split(',').filter(Boolean).map(Number);if(!vals.length)return;const max=Math.max(1,...vals);el.innerHTML='<svg viewBox="0 0 160 35" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="2" points="'+vals.map((v,i)=>`${i*(160/(vals.length-1||1))},${32-v/max*27}`).join(' ')+'"/></svg>'});
  }

  function initAttendanceUpload(){
    const form=document.getElementById('attendanceUploadForm');if(!form)return;
    const input=document.getElementById('attendancePdfInput'),drop=document.getElementById('attendanceDropzone'),list=document.getElementById('uploadFileList'),err=document.getElementById('uploadError'),btn=document.getElementById('attendanceUploadBtn'),progress=document.getElementById('uploadProgress'),bar=document.getElementById('uploadProgressBar'),txt=document.getElementById('uploadProgressText');
    const MAX=50*1024*1024;
    function human(n){if(n<1024*1024)return Math.max(1,Math.round(n/1024))+' KB';return (n/1024/1024).toFixed(1)+' MB'}
    function validate(files){const errors=[];for(const f of files){if(!/\.pdf$/i.test(f.name)||!['application/pdf','application/octet-stream',''].includes(f.type))errors.push(`${f.name}: PDF only`);if(f.size===0)errors.push(`${f.name}: file is empty`);if(f.size>MAX)errors.push(`${f.name}: exceeds 50 MB`)}return errors}
    function render(){const files=[...(input.files||[])];const errors=validate(files);if(err){err.hidden=!errors.length;err.textContent=errors.join(' • ')}if(list){list.hidden=!files.length;list.innerHTML=files.map(f=>`<div class="upload-file-item"><span class="file-icon">PDF</span><div><b title="${f.name.replace(/"/g,'&quot;')}">${f.name}</b><small>${human(f.size)}</small></div><span class="file-ok">${errors.some(e=>e.startsWith(f.name+':'))?'Check file':'Ready'}</span></div>`).join('')}if(btn)btn.disabled=!files.length||!!errors.length}
    input?.addEventListener('change',render);
    ['dragenter','dragover'].forEach(ev=>drop?.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('dragover')}));['dragleave','drop'].forEach(ev=>drop?.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('dragover')}));
    drop?.addEventListener('drop',e=>{if(!e.dataTransfer?.files?.length)return;const dt=new DataTransfer();[...e.dataTransfer.files].forEach(f=>dt.items.add(f));input.files=dt.files;render()});
    form.addEventListener('submit',e=>{
      e.preventDefault();const files=[...(input.files||[])],errors=validate(files);if(!files.length||errors.length){render();return}
      btn.disabled=true;btn.textContent='Uploading...';progress.hidden=false;bar.style.width='2%';txt.textContent=`Uploading ${files.length} PDF${files.length>1?'s':''}...`;
      const xhr=new XMLHttpRequest();xhr.open('POST',form.action,true);xhr.setRequestHeader('X-Requested-With','XMLHttpRequest');xhr.setRequestHeader('Accept','application/json');
      xhr.upload.onprogress=ev=>{if(ev.lengthComputable){const pct=Math.max(2,Math.min(96,Math.round(ev.loaded/ev.total*96)));bar.style.width=pct+'%';txt.textContent=`Uploading... ${pct}%`}};
      xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText||'{}')}catch(_e){}if(xhr.status>=200&&xhr.status<300&&data.redirect){bar.style.width='100%';txt.textContent=`${data.uploaded||files.length} PDF(s) uploaded. Opening signing workspace...`;setTimeout(()=>location.href=data.redirect,250);return}let msg=data.detail||data.message||'Upload failed. Please check the PDF files and try again.';if(xhr.status===401)msg='Session expired. Please sign in again.';err.hidden=false;err.textContent=msg;progress.hidden=true;btn.disabled=false;btn.textContent='Upload & Open Signing Workspace';toast(msg,'bad')};
      xhr.onerror=()=>{err.hidden=false;err.textContent='Network error while uploading. Check the connection to the server and try again.';progress.hidden=true;btn.disabled=false;btn.textContent='Upload & Open Signing Workspace';toast(err.textContent,'bad')};
      xhr.send(new FormData(form));
    });
    render();
  }

  function initSigning(){
    const ws=document.getElementById('signWorkspace');if(!ws)return;
    const pageImg=document.getElementById('pdfPageImage'),wrap=document.getElementById('pageWrap'),box=document.getElementById('signatureBox'),sigImg=document.getElementById('signatureImage'),sigSel=document.getElementById('signatureSelect');
    const prevBtn=document.getElementById('prevPage'),nextBtn=document.getElementById('nextPage'),previewBtn=document.getElementById('previewExact'),signBtn=document.getElementById('signSelected');
    let current=null,page=1,pages=1,drag=null,resize=null,previewVerified=false;
    const selectChecks=()=>[...document.querySelectorAll('.doc-check:checked')].map(x=>Number(x.value));
    function updateCount(){const n=selectChecks().length,c=document.getElementById('selectedCount'),q=document.getElementById('selectedQueueBadge');if(c)c.textContent=String(n);if(q)q.textContent=n+' selected';setNavState()}
    document.querySelectorAll('.doc-check').forEach(c=>c.addEventListener('change',updateCount));
    document.getElementById('selectAllDocs')?.addEventListener('change',e=>{document.querySelectorAll('.doc-check').forEach(c=>c.checked=e.target.checked);updateCount()});

    function currentSig(){const o=sigSel?.selectedOptions?.[0];return o&&o.value?{id:Number(o.value),src:o.dataset.src}:null}
    function setSigImage(){const s=currentSig();if(s&&current){sigImg.src=s.src;box.hidden=false}else{box.hidden=true}}
    sigSel?.addEventListener('change',()=>{previewVerified=false;setSigImage();if(current)applyPlacement(placementFor());setNavState()});

    function placementFor(){
      const sid=currentSig()?.id;if(!sid||!current)return null;
      const all=window.FMT_SIGNING?.placements||{};const arr=all[String(current)]||all[current]||[];
      return arr.find(x=>Number(x.signature_id)===sid&&Number(x.page)===page)||null;
    }
    function applyPlacement(pl){
      if(!box||!wrap)return;
      if(!pl){box.style.left='39%';box.style.top='45%';box.style.width='22%';box.style.height='10%';return}
      box.style.left=(Number(pl.nx)*100)+'%';box.style.top=(Number(pl.ny)*100)+'%';box.style.width=(Number(pl.nw)*100)+'%';box.style.height=(Number(pl.nh)*100)+'%';
    }
    function setNavState(){const ready=!!current&&!!currentSig();if(prevBtn)prevBtn.disabled=!current||page<=1;if(nextBtn)nextBtn.disabled=!current||page>=pages;if(previewBtn)previewBtn.disabled=!ready;if(signBtn)signBtn.disabled=!ready||!previewVerified||selectChecks().length===0;document.querySelectorAll('.signing-progress>div').forEach((el,i)=>el.classList.toggle('active',i===0?selectChecks().length>0:i===1?ready:i===2?previewVerified:false))}
    function loadDoc(btn){
      if(!btn)return;current=Number(btn.dataset.id);pages=Math.max(1,Number(btn.dataset.pages||1));page=1;previewVerified=false;
      document.querySelectorAll('.queue-item').forEach(x=>x.classList.remove('active'));btn.closest('.queue-item')?.classList.add('active');
      const n=document.getElementById('currentDocName');if(n)n.textContent=btn.dataset.name||'Attendance PDF';
      wrap.hidden=false;document.getElementById('pdfEmpty').hidden=true;loadPage();
    }
    function loadPage(){
      if(!current)return;previewVerified=false;document.getElementById('previewBanner').hidden=true;setNavState();
      const loading=document.getElementById('pdfLoading');if(loading)loading.hidden=false;pageImg.style.opacity='.15';
      pageImg.onload=()=>{if(loading)loading.hidden=true;pageImg.style.opacity='1';setSigImage();applyPlacement(placementFor());setNavState()};
      pageImg.onerror=()=>{if(loading)loading.hidden=true;pageImg.style.opacity='1';toast('PDF preview could not be loaded. Please reopen the document.','bad');wrap.hidden=true;document.getElementById('pdfEmpty').hidden=false};
      pageImg.src=`/attendance/${current}/page/${page}.png?v=${Date.now()}`;
      const p=document.getElementById('pageInfo');if(p)p.textContent=`Page ${page} / ${pages}`;
    }
    document.querySelectorAll('.doc-open').forEach(b=>b.addEventListener('click',()=>loadDoc(b)));
    prevBtn?.addEventListener('click',()=>{if(current&&page>1){page--;loadPage()}});nextBtn?.addEventListener('click',()=>{if(current&&page<pages){page++;loadPage()}});

    function normFromBox(){
      if(!current||wrap.hidden||box.hidden)throw new Error('Select a PDF and signature first');
      const r=wrap.getBoundingClientRect(),b=box.getBoundingClientRect();if(r.width<=0||r.height<=0)throw new Error('PDF preview is not ready');
      const out={nx:(b.left-r.left)/r.width,ny:(b.top-r.top)/r.height,nw:b.width/r.width,nh:b.height/r.height};
      for(const k of Object.keys(out))out[k]=Math.max(0,Math.min(1,out[k]));return out;
    }
    box?.addEventListener('pointerdown',e=>{if(e.target.classList.contains('resize-handle'))return;drag={x:e.clientX,y:e.clientY,left:box.offsetLeft,top:box.offsetTop};box.setPointerCapture(e.pointerId);e.preventDefault()});
    box?.querySelector('.resize-handle')?.addEventListener('pointerdown',e=>{resize={x:e.clientX,y:e.clientY,w:box.offsetWidth,h:box.offsetHeight};box.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault()});
    box?.addEventListener('pointermove',e=>{
      if(drag){previewVerified=false;const maxX=Math.max(0,wrap.clientWidth-box.offsetWidth),maxY=Math.max(0,wrap.clientHeight-box.offsetHeight);box.style.left=Math.max(0,Math.min(maxX,drag.left+e.clientX-drag.x))+'px';box.style.top=Math.max(0,Math.min(maxY,drag.top+e.clientY-drag.y))+'px'}
      if(resize){previewVerified=false;const w=Math.max(36,Math.min(wrap.clientWidth-box.offsetLeft,resize.w+e.clientX-resize.x)),h=Math.max(22,Math.min(wrap.clientHeight-box.offsetTop,resize.h+e.clientY-resize.y));box.style.width=w+'px';box.style.height=h+'px'}
    });
    function clearPointer(){drag=null;resize=null}box?.addEventListener('pointerup',clearPointer);box?.addEventListener('pointercancel',clearPointer);

    async function savePlacement(){
      if(!current)throw new Error('Select a PDF first');const sig=currentSig();if(!sig)throw new Error('Select a signature first');const n=normFromBox();
      const selected=document.getElementById('applySelected')?.checked?selectChecks():[];
      const res=await jsonPost('/api/signing/placement',{attendance_id:current,signature_id:sig.id,page,...n,remember:!!document.getElementById('rememberPosition')?.checked,apply_ids:selected});
      window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
      for(const id of (res.applied||[current])){const key=String(id),existing=(window.FMT_SIGNING.placements[key]||[]).filter(x=>!(Number(x.signature_id)===sig.id&&Number(x.page)===page));existing.push({attendance_id:id,signature_id:sig.id,page,...n});window.FMT_SIGNING.placements[key]=existing}
      toast(`Placement saved${res.mismatched?.length?` • ${res.mismatched.length} PDF(s) need adjustment`:''}`);return res;
    }
    document.getElementById('useTemplate')?.addEventListener('click',async()=>{try{previewVerified=false;const sig=currentSig();if(!sig)throw new Error('Select a signature first');let ids=selectChecks();if(current&&!ids.includes(current))ids.unshift(current);if(!ids.length)throw new Error('Select PDF(s)');const r=await jsonPost('/api/signing/apply-template',{signature_id:sig.id,attendance_ids:ids});window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};for(const pl of (r.placements||[])){const key=String(pl.attendance_id),arr=(window.FMT_SIGNING.placements[key]||[]).filter(x=>!(Number(x.signature_id)===Number(pl.signature_id)&&Number(x.page)===Number(pl.page)));arr.push(pl);window.FMT_SIGNING.placements[key]=arr}if(current&&r.applied.includes(current))applyPlacement(placementFor());setNavState();toast(`${r.applied.length} matched • ${r.mismatched.length} need adjustment`)}catch(e){toast(e.message,'bad')}});
    previewBtn?.addEventListener('click',async()=>{try{previewVerified=false;setNavState();await savePlacement();const img=document.getElementById('exactPreviewImg');img.onload=()=>{previewVerified=true;document.getElementById('previewBanner').hidden=false;document.getElementById('previewModal').hidden=false;setNavState();toast('Final preview verified','good')};img.onerror=()=>{previewVerified=false;setNavState();toast('Final preview could not be generated.','bad')};img.src=`/attendance/${current}/signed-preview/${page}.png?v=${Date.now()}`}catch(e){previewVerified=false;setNavState();toast(e.message,'bad')}});
    document.getElementById('closePreview')?.addEventListener('click',()=>document.getElementById('previewModal').hidden=true);
    document.getElementById('previewModal')?.addEventListener('click',e=>{if(e.target.id==='previewModal')e.currentTarget.hidden=true});
    signBtn?.addEventListener('click',async()=>{
      const ids=selectChecks();if(!ids.length){toast('Select at least one PDF','bad');return}if(!previewVerified){toast('Run Final Preview before signing.','bad');return}if(!confirm(`Sign ${ids.length} selected PDF(s)? Original files will be preserved.`))return;
      const btn=signBtn;try{btn.disabled=true;btn.textContent='Signing & verifying...';const r=await jsonPost('/api/signing/sign',{attendance_ids:ids});toast(`${r.signed} signed successfully${r.failed?` • ${r.failed} failed`:''}`,r.failed?'bad':'good');if(r.failed){console.error('Signing failures',r.results)}setTimeout(()=>location.reload(),900)}catch(e){toast(e.message,'bad')}finally{btn.textContent='Sign Selected PDFs';setNavState()}
    });

    updateCount();setNavState();
    const requested=new URLSearchParams(location.search).get('doc');const first=(requested&&document.querySelector(`.doc-open[data-id="${CSS.escape(requested)}"]`))||document.querySelector('.doc-open');if(first)loadDoc(first);
  }

  document.addEventListener('DOMContentLoaded',()=>{try{initCommon();initAttendanceUpload();initSigning()}catch(e){console.error(e);toast('Interface initialization failed. Please refresh the page.','bad')}});
  window.fmtToast=toast;
})();
