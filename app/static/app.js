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
    const pageImg=document.getElementById('pdfPageImage'),wrap=document.getElementById('pageWrap'),layer=document.getElementById('signatureLayer'),sigSel=document.getElementById('signatureSelect'),viewport=document.getElementById('pdfViewport');
    const prevBtn=document.getElementById('prevPage'),nextBtn=document.getElementById('nextPage'),previewBtn=document.getElementById('previewExact'),signBtn=document.getElementById('signSelected'),pageJump=document.getElementById('pageJump'),pageTotal=document.getElementById('pageTotal');
    let current=null,page=1,pages=1,previewVerified=false,dirty=false,navBusy=false,zoomMode='fit',zoomScale=.82,autoSaveTimer=null,selectedBox=null,saveInFlight=null,changeRevision=0;
    const targetPages=new Set(),copiedFrom={},history=new Map(),future=new Map();
    window.FMT_SIGNING=window.FMT_SIGNING||{placements:{}};window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};

    const selectChecks=()=>[...document.querySelectorAll('.doc-check:checked')].map(x=>Number(x.value));
    const sigById=id=>{const o=[...sigSel?.options||[]].find(x=>Number(x.value)===Number(id));return o&&o.value?{id:Number(o.value),src:o.dataset.src,name:o.dataset.name||o.textContent}:null};
    const currentSig=()=>sigById(sigSel?.value);
    const stateArr=(doc=current)=>window.FMT_SIGNING.placements[String(doc)]||window.FMT_SIGNING.placements[doc]||[];
    const pagePlacements=(pn=page,doc=current)=>stateArr(doc).filter(x=>Number(x.page)===Number(pn));
    const setStateForDoc=(doc,arr)=>{window.FMT_SIGNING.placements[String(doc)]=arr};
    const pageHasSignature=pn=>pagePlacements(pn).length>0;
    const unsignedPages=()=>current?Array.from({length:pages},(_,i)=>i+1).filter(p=>!pageHasSignature(p)):[];
    const historyKey=()=>`${current}:${page}`;
    const clone=v=>JSON.parse(JSON.stringify(v));
    const isTyping=e=>['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)||e.target?.isContentEditable;

    function setSaveState(state,text){const el=document.getElementById('saveState'),t=document.getElementById('saveStateText');if(el)el.dataset.state=state;if(t)t.textContent=text||({idle:'Ready',dirty:'Unsaved',saving:'Saving…',saved:'Saved',error:'Save failed'}[state]||state)}
    function updateCount(){const n=selectChecks().length,c=document.getElementById('selectedCount'),q=document.getElementById('selectedQueueBadge');if(c)c.textContent=String(n);if(q)q.textContent=n+' selected';setNavState()}
    document.querySelectorAll('.doc-check').forEach(c=>c.addEventListener('change',updateCount));
    document.getElementById('selectAllDocs')?.addEventListener('change',e=>{document.querySelectorAll('.doc-check').forEach(c=>c.checked=e.target.checked);updateCount()});
    sigSel?.addEventListener('change',()=>{previewVerified=false;setNavState()});

    function nextSlot(sigId){const slots=pagePlacements().filter(x=>Number(x.signature_id)===Number(sigId)).map(x=>Number(x.placement_slot||1));layer.querySelectorAll('.signature-box').forEach(b=>{if(Number(b.dataset.signatureId)===Number(sigId))slots.push(Number(b.dataset.slot||1))});return Math.max(0,...slots)+1}
    function defaultPlacement(offset=0){return {nx:.36+Math.min(.12,offset*.025),ny:.42+Math.min(.12,offset*.02),nw:.22,nh:.10}}
    function normFromEl(el){const r=wrap.getBoundingClientRect(),b=el.getBoundingClientRect();if(r.width<=0||r.height<=0)throw new Error('PDF preview is not ready');const out={nx:(b.left-r.left)/r.width,ny:(b.top-r.top)/r.height,nw:b.width/r.width,nh:b.height/r.height};for(const k of Object.keys(out))out[k]=Math.max(0,Math.min(1,out[k]));return out}
    function placementFromEl(el){return {attendance_id:current,signature_id:Number(el.dataset.signatureId),page,placement_slot:Number(el.dataset.slot||1),...normFromEl(el)}}
    function allBoxPlacements(){return [...layer.querySelectorAll('.signature-box')].map(placementFromEl)}
    function snapshot(){return clone(allBoxPlacements())}
    function pushHistory(){if(!current)return;const key=historyKey(),h=history.get(key)||[];h.push(snapshot());if(h.length>40)h.shift();history.set(key,h);future.set(key,[]);updateUndoRedo()}
    function updateUndoRedo(){const key=historyKey();const u=document.getElementById('undoPlacement'),r=document.getElementById('redoPlacement');if(u)u.disabled=!current||!(history.get(key)||[]).length;if(r)r.disabled=!current||!(future.get(key)||[]).length}
    function scheduleAutoSave(){clearTimeout(autoSaveTimer);autoSaveTimer=setTimeout(async()=>{if(!dirty||navBusy||!current)return;try{await saveCurrentPage({silent:true,auto:true})}catch(e){setSaveState('error','Save failed');toast('Auto-save failed: '+e.message,'bad')}},750)}
    function markDirty(){dirty=true;changeRevision++;previewVerified=false;document.getElementById('previewBanner').hidden=true;setSaveState('dirty','Unsaved changes');updatePageUI();setNavState();scheduleAutoSave()}
    function selectSignatureBox(el){selectedBox?.classList.remove('selected');selectedBox=el||null;selectedBox?.classList.add('selected')}

    function createBox(pl,focus=false){
      const sig=sigById(pl.signature_id);if(!sig)return null;
      const el=document.createElement('div');el.className='signature-box';el.tabIndex=0;el.dataset.signatureId=String(sig.id);el.dataset.slot=String(pl.placement_slot||1);
      el.innerHTML=`<div class="signature-box-toolbar"><span class="sig-grip" title="Drag signature">⋮⋮</span><span class="sig-box-label"></span><button type="button" data-act="duplicate" title="Duplicate signature">＋</button><button type="button" data-act="delete" title="Remove signature">×</button></div><img alt="Signature"><span class="resize-handle" title="Resize"></span>`;
      el.querySelector('img').src=sig.src;el.querySelector('.sig-box-label').textContent=sig.name||'Signature';
      el.style.left=(Number(pl.nx)*100)+'%';el.style.top=(Number(pl.ny)*100)+'%';el.style.width=(Number(pl.nw)*100)+'%';el.style.height=(Number(pl.nh)*100)+'%';layer.appendChild(el);
      let drag=null,resize=null,historyCaptured=false;
      el.addEventListener('pointerdown',e=>{selectSignatureBox(el);if(e.target.closest('button')||e.target.classList.contains('resize-handle'))return;if(!historyCaptured){pushHistory();historyCaptured=true}drag={x:e.clientX,y:e.clientY,left:el.offsetLeft,top:el.offsetTop};el.setPointerCapture(e.pointerId);e.preventDefault()});
      el.querySelector('.resize-handle').addEventListener('pointerdown',e=>{selectSignatureBox(el);if(!historyCaptured){pushHistory();historyCaptured=true}resize={x:e.clientX,y:e.clientY,w:el.offsetWidth,h:el.offsetHeight};el.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault()});
      el.addEventListener('pointermove',e=>{if(drag){const maxX=Math.max(0,wrap.clientWidth-el.offsetWidth),maxY=Math.max(0,wrap.clientHeight-el.offsetHeight);el.style.left=Math.max(0,Math.min(maxX,drag.left+e.clientX-drag.x))+'px';el.style.top=Math.max(0,Math.min(maxY,drag.top+e.clientY-drag.y))+'px';markDirty()}if(resize){const w=Math.max(42,Math.min(wrap.clientWidth-el.offsetLeft,resize.w+e.clientX-resize.x)),h=Math.max(24,Math.min(wrap.clientHeight-el.offsetTop,resize.h+e.clientY-resize.y));el.style.width=w+'px';el.style.height=h+'px';markDirty()}});
      const clear=()=>{drag=null;resize=null;historyCaptured=false};el.addEventListener('pointerup',clear);el.addEventListener('pointercancel',clear);el.addEventListener('click',()=>selectSignatureBox(el));
      el.querySelector('[data-act="delete"]').addEventListener('click',()=>{pushHistory();if(selectedBox===el)selectedBox=null;el.remove();markDirty();toast('Signature removed','good')});
      el.querySelector('[data-act="duplicate"]').addEventListener('click',()=>{pushHistory();const base=placementFromEl(el),slot=nextSlot(base.signature_id);base.placement_slot=slot;base.nx=Math.min(.78,base.nx+.025);base.ny=Math.min(.88,base.ny+.025);createBox(base,true);markDirty();toast('Signature duplicated','good')});
      if(focus){selectSignatureBox(el);el.classList.add('pulse-focus');setTimeout(()=>el.classList.remove('pulse-focus'),650)}return el;
    }
    function renderBoxes(){layer.innerHTML='';selectedBox=null;for(const pl of pagePlacements())createBox(pl);dirty=false;setSaveState('saved','Saved');updatePageUI();setNavState();updateUndoRedo()}
    function addCurrentSignature(){if(!current){toast('Select a PDF first','bad');return}const sig=currentSig();if(!sig){toast('Select a signature first','bad');return}pushHistory();const slot=nextSlot(sig.id),pl={attendance_id:current,signature_id:sig.id,page,placement_slot:slot,...defaultPlacement(layer.children.length)};createBox(pl,true);markDirty()}
    document.getElementById('addSignatureBox')?.addEventListener('click',addCurrentSignature);

    function applyZoom(){if(!wrap||wrap.hidden||!pageImg.naturalWidth)return;const avail=Math.max(320,(viewport?.clientWidth||760)-24);let w;if(zoomMode==='fit')w=Math.min(pageImg.naturalWidth,avail);else w=Math.min(pageImg.naturalWidth*1.5,Math.max(320,pageImg.naturalWidth*zoomScale));wrap.style.width=Math.round(w)+'px';const z=document.getElementById('zoomLabel');if(z)z.textContent=zoomMode==='fit'?'Fit':Math.round(zoomScale*100)+'%'}
    document.getElementById('zoomOut')?.addEventListener('click',()=>{const base=zoomMode==='fit'?.82:zoomScale;zoomMode='custom';zoomScale=Math.max(.45,base-.1);applyZoom()});
    document.getElementById('zoomIn')?.addEventListener('click',()=>{const base=zoomMode==='fit'?.82:zoomScale;zoomMode='custom';zoomScale=Math.min(1.35,base+.1);applyZoom()});
    document.getElementById('zoomLabel')?.addEventListener('click',()=>{zoomMode='fit';applyZoom()});
    window.addEventListener('resize',()=>{if(zoomMode==='fit')applyZoom()});

    async function saveCurrentPage({silent=false,auto=false,remember=null}={}){
      if(!current)return null;clearTimeout(autoSaveTimer);
      if(saveInFlight){await saveInFlight;if(!dirty)return null}
      const saveDoc=current,savePage=page,saveRevision=changeRevision,placements=allBoxPlacements();setSaveState('saving','Saving…');
      const run=(async()=>{
        const res=await jsonPost('/api/signing/page-placements',{attendance_id:saveDoc,page:savePage,placements,remember:remember??!!document.getElementById('rememberPosition')?.checked,apply_ids:[]});
        const arr=stateArr(saveDoc).filter(x=>Number(x.page)!==savePage);for(const pl of placements)arr.push({...pl,attendance_id:saveDoc,page:savePage});setStateForDoc(saveDoc,arr);
        if(current===saveDoc&&page===savePage&&changeRevision===saveRevision){dirty=false;setSaveState('saved','Saved')}
        else if(current===saveDoc&&page===savePage&&dirty){setSaveState('dirty','Unsaved changes');scheduleAutoSave()}
        updatePageUI();if(!silent)toast(`Page ${savePage} saved`,'good');return res;
      })();
      saveInFlight=run;try{return await run}catch(e){setSaveState('error','Save failed');throw e}finally{if(saveInFlight===run)saveInFlight=null}
    }
    document.getElementById('saveCurrentPage')?.addEventListener('click',async()=>{try{await saveCurrentPage()}catch(e){toast(e.message,'bad')}});

    async function goPage(target){if(!current||target<1||target>pages||target===page)return;const old=page;try{navBusy=true;setNavState();if(dirty)await saveCurrentPage({silent:true,remember:false});page=target;targetPages.delete(page);loadPage()}catch(e){page=old;toast(`Could not save page ${old}: ${e.message}`,'bad')}finally{navBusy=false;setNavState()}}
    prevBtn?.addEventListener('click',()=>goPage(page-1));nextBtn?.addEventListener('click',()=>goPage(page+1));pageJump?.addEventListener('change',()=>goPage(Math.max(1,Math.min(pages,Number(pageJump.value||page)))));

    function nextUnsignedPage(){const list=unsignedPages();if(!list.length){toast('All pages already contain a signature','good');return}const after=list.find(p=>p>page)??list[0];goPage(after)}
    document.getElementById('nextUnsigned')?.addEventListener('click',nextUnsignedPage);document.getElementById('goFirstUnsigned')?.addEventListener('click',()=>{const p=unsignedPages()[0];if(p)goPage(p);else toast('All pages contain a signature','good')});

    function renderPageNavigator(){const nav=document.getElementById('pageNavigator');if(!nav)return;nav.innerHTML='';if(!current)return;for(let pn=1;pn<=pages;pn++){const b=document.createElement('button');b.type='button';b.className='page-number-box'+(pn===page?' current':'')+(pageHasSignature(pn)?' signed':' unsigned');b.dataset.page=String(pn);b.innerHTML=`<span>${pn}</span>${pageHasSignature(pn)?'<i>✓</i>':''}`;b.title=pageHasSignature(pn)?`Page ${pn} • signature placed`:`Page ${pn} • no signature`;b.addEventListener('click',()=>goPage(pn));nav.appendChild(b)}}
    function renderTargetGrid(){const grid=document.getElementById('targetPageGrid');if(!grid)return;grid.innerHTML='';if(!current){grid.innerHTML='<span class="muted">Open a document to select target pages.</span>';return}for(let pn=1;pn<=pages;pn++){const b=document.createElement('button');b.type='button';b.className='page-number-box target'+(targetPages.has(pn)?' selected':'')+(pn===page?' source':'');b.disabled=pn===page;b.innerHTML=`<span>${pn}</span>${pn===page?'<small>Source</small>':targetPages.has(pn)?'<i>✓</i>':''}`;b.addEventListener('click',()=>{if(targetPages.has(pn))targetPages.delete(pn);else targetPages.add(pn);renderTargetGrid();updateTargetSelection()});grid.appendChild(b)}updateTargetSelection()}
    function updateTargetSelection(){const txt=document.getElementById('targetSelectionText'),btn=document.getElementById('applyToPages');const n=targetPages.size;if(txt)txt.textContent=`${n} page${n===1?'':'s'} selected`;if(btn)btn.disabled=!current||!layer.children.length||n===0||navBusy}
    document.getElementById('clearTargetPages')?.addEventListener('click',()=>{targetPages.clear();renderTargetGrid()});
    document.getElementById('selectRemainingPages')?.addEventListener('click',()=>{targetPages.clear();for(let pn=page+1;pn<=pages;pn++)targetPages.add(pn);renderTargetGrid()});
    document.getElementById('selectNextFourPages')?.addEventListener('click',()=>{targetPages.clear();for(let pn=page+1;pn<=Math.min(pages,page+4);pn++)targetPages.add(pn);renderTargetGrid()});

    async function applyToPages(){if(!current)throw new Error('Select a PDF first');if(!layer.children.length)throw new Error('Add at least one signature on the source page');if(!targetPages.size)throw new Error('Select at least one target page');await saveCurrentPage({silent:true,remember:false});const targets=[...targetPages].sort((a,b)=>a-b);const r=await jsonPost('/api/signing/copy-page',{attendance_id:current,source_page:page,target_pages:targets});setStateForDoc(current,r.placements||[]);for(const pn of (r.copied||[]))copiedFrom[`${current}:${pn}`]=page;previewVerified=false;targetPages.clear();renderTargetGrid();updatePageUI();setNavState();const skipped=(r.skipped||[]).length;toast(`${r.copied.length} page(s) updated${skipped?` • ${skipped} skipped because the page layout differs`:''}`,skipped?'bad':'good')}
    document.getElementById('applyToPages')?.addEventListener('click',async()=>{try{await applyToPages()}catch(e){toast(e.message,'bad')}});

    function updateProgress(){const p=document.getElementById('documentProgress'),bar=document.getElementById('progressBar'),label=document.getElementById('progressLabel'),hint=document.getElementById('progressHint');if(!p)return;if(!current){p.hidden=true;return}p.hidden=false;const signed=Array.from({length:pages},(_,i)=>i+1).filter(pageHasSignature).length,left=pages-signed,pct=pages?Math.round(signed/pages*100):0;if(bar)bar.style.width=pct+'%';if(label)label.textContent=`${signed} / ${pages} pages with signature`;if(hint)hint.textContent=left?`${left} page${left===1?'':'s'} still need attention`:'All pages contain a signature'}
    function updateCurrentStatus(){const title=document.getElementById('currentPageStatusTitle'),text=document.getElementById('currentPageStatusText'),icon=document.querySelector('#currentPageStatus .page-status-icon'),card=document.getElementById('currentPageStatus');if(!current){if(title)title.textContent='No page open';if(text)text.textContent='Select a PDF from the queue.';return}const count=pagePlacements().length,source=copiedFrom[`${current}:${page}`];card?.classList.toggle('has-signature',count>0);if(icon)icon.textContent=count?'✓':'!';if(title)title.textContent=`Page ${page} • ${count?`${count} signature${count===1?'':'s'}`:'No signature'}`;if(text)text.textContent=source?`Copied from page ${source} • editable independently`:count?'Placement saved for this page. You can still move, resize, add or remove.':'Add a signature or apply a placement from another page.'}
    function updatePageUI(){if(!current)return;renderPageNavigator();updateProgress();updateCurrentStatus();const summary=document.getElementById('pageSummary'),source=document.getElementById('sourcePagePill'),validation=document.getElementById('finalValidationText'),panel=document.getElementById('pageNavPanel');if(panel)panel.hidden=false;const unsigned=unsignedPages();if(summary)summary.textContent=unsigned.length?`${unsigned.length} unsigned • click any page to jump`:'All pages have signatures';if(source)source.textContent=`Source ${page}`;if(validation)validation.textContent=unsigned.length?`${unsigned.length} page${unsigned.length===1?'':'s'} currently have no signature. Review them before final signing.`:'All pages contain a signature. Run Final Preview to verify output.';const n=document.getElementById('nextUnsigned'),g=document.getElementById('goFirstUnsigned');if(n)n.disabled=!current||!unsigned.length;if(g)g.disabled=!unsigned.length;updateTargetSelection()}

    function setNavState(){const ready=!!current&&layer.children.length>0;if(prevBtn)prevBtn.disabled=navBusy||!current||page<=1;if(nextBtn)nextBtn.disabled=navBusy||!current||page>=pages;if(previewBtn)previewBtn.disabled=navBusy||!ready;if(signBtn)signBtn.disabled=navBusy||!ready||!previewVerified||selectChecks().length===0;if(pageJump){pageJump.max=String(pages);pageJump.value=String(page);pageJump.disabled=!current}if(pageTotal)pageTotal.textContent=`/ ${current?pages:'—'}`;['addSignatureBox','saveCurrentPage','useTemplate'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=navBusy||!current});updateTargetSelection();updateUndoRedo()}

    function loadDoc(btn){if(!btn)return;const open=async()=>{if(current&&dirty){try{await saveCurrentPage({silent:true,remember:false})}catch(e){toast(e.message,'bad');return}}current=Number(btn.dataset.id);pages=Math.max(1,Number(btn.dataset.pages||1));page=1;previewVerified=false;targetPages.clear();selectedBox=null;document.querySelectorAll('.queue-item').forEach(x=>x.classList.remove('active'));btn.closest('.queue-item')?.classList.add('active');const n=document.getElementById('currentDocName');if(n)n.textContent=btn.dataset.name||'Attendance PDF';wrap.hidden=false;document.getElementById('pdfEmpty').hidden=true;renderTargetGrid();loadPage()};open()}
    function loadPage(){if(!current)return;previewVerified=false;dirty=false;clearTimeout(autoSaveTimer);document.getElementById('previewBanner').hidden=true;setSaveState('idle','Loading…');setNavState();const loading=document.getElementById('pdfLoading');if(loading)loading.hidden=false;pageImg.style.opacity='.15';layer.innerHTML='';pageImg.onload=()=>{if(loading)loading.hidden=true;pageImg.style.opacity='1';applyZoom();renderBoxes();renderTargetGrid();updatePageUI();setNavState()};pageImg.onerror=()=>{if(loading)loading.hidden=true;pageImg.style.opacity='1';setSaveState('error','Preview failed');toast('PDF preview could not be loaded. Please reopen the document.','bad');wrap.hidden=true;document.getElementById('pdfEmpty').hidden=false};pageImg.src=`/attendance/${current}/page/${page}.png?v=${Date.now()}`;const p=document.getElementById('pageInfo');if(p)p.textContent=`Page ${page} / ${pages}`}
    document.querySelectorAll('.doc-open').forEach(b=>b.addEventListener('click',()=>loadDoc(b)));

    async function restoreSnapshot(data,{pushFuture=false}={}){if(pushFuture){const key=historyKey(),f=future.get(key)||[];f.push(snapshot());future.set(key,f)}layer.innerHTML='';selectedBox=null;for(const pl of data)createBox({...pl,attendance_id:current,page});markDirty();updateUndoRedo()}
    async function undo(){const key=historyKey(),h=history.get(key)||[];if(!h.length)return;const prev=h.pop();history.set(key,h);await restoreSnapshot(prev,{pushFuture:true});toast('Placement restored','good')}
    async function redo(){const key=historyKey(),f=future.get(key)||[];if(!f.length)return;const next=f.pop();future.set(key,f);const h=history.get(key)||[];h.push(snapshot());history.set(key,h);await restoreSnapshot(next);toast('Placement redone','good')}
    document.getElementById('undoPlacement')?.addEventListener('click',undo);document.getElementById('redoPlacement')?.addEventListener('click',redo);

    document.getElementById('useTemplate')?.addEventListener('click',async()=>{try{previewVerified=false;const sig=currentSig();if(!sig)throw new Error('Select a signature first');let ids=selectChecks();if(current&&!ids.includes(current))ids.unshift(current);if(!ids.length)throw new Error('Select PDF(s)');const r=await jsonPost('/api/signing/apply-template',{signature_id:sig.id,attendance_ids:ids});for(const pl of (r.placements||[])){const key=String(pl.attendance_id),arr=(window.FMT_SIGNING.placements[key]||[]).filter(x=>!(Number(x.signature_id)===Number(pl.signature_id)&&Number(x.page)===Number(pl.page)&&Number(x.placement_slot||1)===Number(pl.placement_slot||1)));arr.push(pl);window.FMT_SIGNING.placements[key]=arr}if(current&&r.applied.includes(current))renderBoxes();updatePageUI();setNavState();toast(`${r.applied.length} matched • ${r.mismatched.length} need adjustment`,r.mismatched.length?'bad':'good')}catch(e){toast(e.message,'bad')}});

    previewBtn?.addEventListener('click',async()=>{try{previewVerified=false;setNavState();await saveCurrentPage({silent:true});const missing=unsignedPages();if(missing.length&&!confirm(`Pages without signatures: ${missing.join(', ')}. Continue with preview anyway?`)){const p=missing[0];if(p&&p!==page)await goPage(p);return}const img=document.getElementById('exactPreviewImg');img.onload=()=>{previewVerified=true;document.getElementById('previewBanner').hidden=false;document.getElementById('previewModal').hidden=false;setNavState();toast('Final preview verified','good')};img.onerror=()=>{previewVerified=false;setNavState();toast('Final preview could not be generated.','bad')};img.src=`/attendance/${current}/signed-preview/${page}.png?v=${Date.now()}`}catch(e){previewVerified=false;setNavState();toast(e.message,'bad')}});
    document.getElementById('closePreview')?.addEventListener('click',()=>document.getElementById('previewModal').hidden=true);document.getElementById('previewModal')?.addEventListener('click',e=>{if(e.target.id==='previewModal')e.currentTarget.hidden=true});
    function showSigningComplete(result){const modal=document.getElementById('signCompleteModal'),summary=document.getElementById('signCompleteSummary'),files=document.getElementById('signCompleteFiles'),primary=document.getElementById('primaryDownloadSigned');if(!modal||!summary||!files)return;const ok=(result.results||[]).filter(x=>x.ok),failed=(result.results||[]).filter(x=>!x.ok);summary.innerHTML=`<div><b>${ok.length}</b><span>PDF saved</span></div><div><b>${failed.length}</b><span>Failed</span></div>`;files.innerHTML='';for(const item of ok){const row=document.createElement('div');row.className='sign-complete-file';const name=document.createElement('div');name.className='sign-complete-file-name';name.innerHTML=`<span class="file-ico">PDF</span><span><b></b><small>Verified signed version</small></span>`;name.querySelector('b').textContent=item.name||`Attendance #${item.id}`;const actions=document.createElement('div');actions.className='sign-complete-file-actions';const open=document.createElement('a');open.className='btn small';open.href=item.detail_url||`/attendance/${item.id}`;open.textContent='Open';const dl=document.createElement('a');dl.className='btn small primary';dl.href=item.download_url||`/attendance/${item.id}/download`;dl.setAttribute('download','');dl.textContent='Download';actions.append(open,dl);row.append(name,actions);files.append(row)}for(const item of failed){const row=document.createElement('div');row.className='sign-complete-file error';row.innerHTML=`<div class="sign-complete-file-name"><span class="file-ico">!</span><span><b>Signing failed</b><small></small></span></div>`;row.querySelector('small').textContent=item.error||`Attendance #${item.id}`;files.append(row)}if(primary){if(ok.length===1){primary.hidden=false;primary.href=ok[0].download_url||`/attendance/${ok[0].id}/download`;primary.textContent='Download Signed PDF'}else if(ok.length>1){primary.hidden=true}else primary.hidden=true}modal.hidden=false}
    document.getElementById('continueSigning')?.addEventListener('click',()=>location.reload());document.getElementById('signCompleteModal')?.addEventListener('click',e=>{if(e.target.id==='signCompleteModal')location.reload()});
    signBtn?.addEventListener('click',async()=>{const ids=selectChecks();if(!ids.length){toast('Select at least one PDF','bad');return}if(!previewVerified){toast('Run Final Preview before signing.','bad');return}const missing=current?unsignedPages():[];const warning=missing.length?`\n\nCurrent PDF still has unsigned pages: ${missing.join(', ')}.`:'';if(!confirm(`Sign ${ids.length} selected PDF(s)? Original files will be preserved.${warning}`))return;const btn=signBtn;try{if(dirty)await saveCurrentPage({silent:true});btn.disabled=true;btn.textContent='Signing & saving...';const r=await jsonPost('/api/signing/sign',{attendance_ids:ids});toast(`${r.signed} signed PDF(s) saved${r.failed?` • ${r.failed} failed`:''}`,r.failed?'bad':'good');if(r.failed)console.error('Signing failures',r.results);showSigningComplete(r)}catch(e){toast(e.message,'bad')}finally{btn.textContent='Sign Selected PDFs';setNavState()}});

    document.addEventListener('keydown',e=>{if(!current||isTyping(e))return;const k=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&k==='s'){e.preventDefault();saveCurrentPage().catch(err=>toast(err.message,'bad'));return}if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return}if(e.shiftKey&&e.key==='ArrowRight'){e.preventDefault();nextUnsignedPage();return}if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();goPage(page+1);return}if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();goPage(page-1);return}if(k==='a'){e.preventDefault();addCurrentSignature();return}if(k==='p'){e.preventDefault();previewBtn?.click();return}if(e.key==='Delete'&&selectedBox){e.preventDefault();pushHistory();selectedBox.remove();selectedBox=null;markDirty();toast('Signature removed','good')}});

    updateCount();setNavState();setSaveState('idle','Ready');const requested=new URLSearchParams(location.search).get('doc');const first=(requested&&document.querySelector(`.doc-open[data-id="${CSS.escape(requested)}"]`))||document.querySelector('.doc-open');if(first)loadDoc(first);
  }

  document.addEventListener('DOMContentLoaded',()=>{try{initCommon();initAttendanceUpload();initSigning()}catch(e){console.error(e);toast('Interface initialization failed. Please refresh the page.','bad')}});
  window.fmtToast=toast;
})();
