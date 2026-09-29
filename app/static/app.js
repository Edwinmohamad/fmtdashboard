(function(){
  'use strict';
  const root=document.documentElement;
  const I18N=window.FMT_I18N||{};
  function jt(key,vars){
    let s=I18N[key];if(s==null)return key;
    if(vars)for(const k in vars)s=s.split('{'+k+'}').join(String(vars[k]));
    return s;
  }
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
  // Generic cross-page flash message: a redirect can append ?flash=<text>&flash_type=good|bad to its
  // destination URL, and the first page load there shows it as a toast and then strips both params
  // from the address bar (so refreshing or copying the link doesn't repeat/carry the message).
  function showFlashFromQuery(){
    try{
      const params=new URLSearchParams(location.search);
      const msg=params.get('flash');if(!msg)return;
      toast(msg,params.get('flash_type')||'good');
      params.delete('flash');params.delete('flash_type');
      const qs=params.toString();
      history.replaceState(null,'',location.pathname+(qs?('?'+qs):'')+location.hash);
    }catch(_e){}
  }
  function initCommon(){
    showFlashFromQuery();
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
    document.querySelectorAll('.nav-link').forEach(a=>{try{const u=new URL(a.href,location.origin),cur=new URL(location.href);let active=u.pathname===cur.pathname;if(active&&u.pathname==='/tickets'&&u.searchParams.get('type'))active=u.searchParams.get('type')===cur.searchParams.get('type');if(active)a.classList.add('active')}catch(_e){}});
    document.querySelectorAll('form[data-confirm]').forEach(f=>f.addEventListener('submit',e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}));
    const modal=document.getElementById('commandModal'),btn=document.getElementById('commandBtn'),search=document.getElementById('commandSearch'),hints=modal?.querySelector('.command-hints');
    function openCmd(){if(!modal)return;modal.hidden=false;setTimeout(()=>search?.focus(),30)}function closeCmd(){if(modal)modal.hidden=true}
    btn?.addEventListener('click',openCmd);modal?.addEventListener('click',e=>{if(e.target===modal)closeCmd()});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCmd()}if(e.key==='Escape')closeCmd()});
    let st;search?.addEventListener('input',()=>{clearTimeout(st);st=setTimeout(async()=>{const q=search.value.trim();if(q.length<2)return;try{const r=await fetch('/api/global-search?qtext='+encodeURIComponent(q),{cache:'no-store'});const j=await r.json();if(hints)hints.innerHTML=(j.results||[]).map(x=>`<a href="${x.url}"><b>${x.type}</b> ${x.title}<small>${x.meta||''}</small></a>`).join('')||'<span class="muted">No results</span>'}catch(_e){}},180)});
    const clock=document.getElementById('liveClock');if(clock){const tick=()=>{clock.textContent=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())};tick();setInterval(tick,1000);}
    document.querySelectorAll('.sparkline').forEach(el=>{
      const vals=(el.dataset.values||'').split(',').filter(Boolean).map(Number);if(!vals.length)return;
      const max=Math.max(1,...vals),n=vals.length,gap=4,barW=(160-(gap*(n-1)))/n;
      const bars=vals.map((v,i)=>{const h=Math.max(1.5,v/max*27),x=i*(barW+gap),y=32-h;return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="currentColor"><title>${v}</title></rect>`}).join('');
      el.innerHTML='<svg viewBox="0 0 160 35" preserveAspectRatio="none">'+bars+'</svg>';
    });
    initToolbarReset();
  }

  // Any toolbar (search/filter form) that currently has an active search term, dropdown filter, or checked
  // filter checkbox gets an auto-appended Reset control that clears back to the bare list URL (no query string).
  function initToolbarReset(){
    document.querySelectorAll('form.toolbar').forEach(form=>{
      if(form.querySelector('.toolbar-reset'))return;
      const controls=[...form.querySelectorAll('input[name],select[name]')];
      const active=controls.some(el=>{
        if(el.type==='checkbox'||el.type==='radio')return el.checked;
        return (el.value||'').trim()!=='';
      });
      if(!active)return;
      const a=document.createElement('a');
      a.className='btn toolbar-reset';
      a.textContent=jt('common.reset');
      a.href=location.pathname;
      form.appendChild(a);
    });
  }

  function initAttendanceUpload(){
    const form=document.getElementById('attendanceUploadForm');if(!form)return;
    const input=document.getElementById('attendancePdfInput'),drop=document.getElementById('attendanceDropzone'),list=document.getElementById('uploadFileList'),err=document.getElementById('uploadError'),btn=document.getElementById('attendanceUploadBtn'),progress=document.getElementById('uploadProgress'),bar=document.getElementById('uploadProgressBar'),txt=document.getElementById('uploadProgressText');
    const MAX=50*1024*1024;
    function human(n){if(n<1024*1024)return Math.max(1,Math.round(n/1024))+' KB';return (n/1024/1024).toFixed(1)+' MB'}
    function validate(files){const errors=[];for(const f of files){if(!/\.pdf$/i.test(f.name)||!['application/pdf','application/octet-stream',''].includes(f.type))errors.push(jt('js.pdf_only',{name:f.name}));if(f.size===0)errors.push(jt('js.file_empty',{name:f.name}));if(f.size>MAX)errors.push(jt('js.exceeds_size',{name:f.name}))}return errors}
    function render(){const files=[...(input.files||[])];const errors=validate(files);if(err){err.hidden=!errors.length;err.textContent=errors.join(' • ')}if(list){list.hidden=!files.length;list.innerHTML=files.map(f=>`<div class="upload-file-item"><span class="file-icon">PDF</span><div><b title="${f.name.replace(/"/g,'&quot;')}">${f.name}</b><small>${human(f.size)}</small></div><span class="file-ok">${errors.some(e=>e.indexOf(f.name)===0)?jt('js.check_file'):jt('js.ready')}</span></div>`).join('')}if(btn)btn.disabled=!files.length||!!errors.length}
    input?.addEventListener('change',render);
    ['dragenter','dragover'].forEach(ev=>drop?.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('dragover')}));['dragleave','drop'].forEach(ev=>drop?.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('dragover')}));
    drop?.addEventListener('drop',e=>{if(!e.dataTransfer?.files?.length)return;const dt=new DataTransfer();[...e.dataTransfer.files].forEach(f=>dt.items.add(f));input.files=dt.files;render()});
    form.addEventListener('submit',e=>{
      e.preventDefault();const files=[...(input.files||[])],errors=validate(files);if(!files.length||errors.length){render();return}
      btn.disabled=true;btn.textContent=jt('js.uploading');progress.hidden=false;bar.style.width='2%';txt.textContent=jt('js.uploading_n',{n:files.length,plural:files.length>1?'s':''});
      const xhr=new XMLHttpRequest();xhr.open('POST',form.action,true);xhr.setRequestHeader('X-Requested-With','XMLHttpRequest');xhr.setRequestHeader('Accept','application/json');
      xhr.upload.onprogress=ev=>{if(ev.lengthComputable){const pct=Math.max(2,Math.min(96,Math.round(ev.loaded/ev.total*96)));bar.style.width=pct+'%';txt.textContent=jt('js.uploading_pct',{pct})}};
      xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText||'{}')}catch(_e){}if(xhr.status>=200&&xhr.status<300&&data.redirect){bar.style.width='100%';txt.textContent=jt('js.uploaded_success',{n:data.uploaded||files.length});setTimeout(()=>location.href=data.redirect,250);return}let msg=data.detail||data.message||jt('js.upload_failed');if(xhr.status===401)msg=jt('js.session_expired');err.hidden=false;err.textContent=msg;progress.hidden=true;btn.disabled=false;btn.textContent=jt('js.upload_submit');toast(msg,'bad')};
      xhr.onerror=()=>{err.hidden=false;err.textContent=jt('js.network_error');progress.hidden=true;btn.disabled=false;btn.textContent=jt('js.upload_submit');toast(err.textContent,'bad')};
      xhr.send(new FormData(form));
    });
    render();
  }

  function initSigning(){
    const ws=document.getElementById('signWorkspace');if(!ws)return;
    const pageImg=document.getElementById('pdfPageImage'),wrap=document.getElementById('pageWrap'),box=document.getElementById('signatureBox'),sigImg=document.getElementById('signatureImage'),sigSel=document.getElementById('signatureSelect');
    const prevBtns=[...document.querySelectorAll('[data-page-nav="prev"]')],nextBtns=[...document.querySelectorAll('[data-page-nav="next"]')],previewBtn=document.getElementById('previewExact');
    let current=null,page=1,pages=1,drag=null,resize=null;
    // activePlacementId identifies the exact saved placement row currently shown in the box (or null
    // when the box shows a not-yet-saved position: a suggested spot, a reset default, or a freshly
    // started "add signature" instance). A signature can now have more than one placement on the
    // same page, so "the placement for the active signature on this page" is no longer unambiguous --
    // whichever specific row this id points to is what dragging/saving/removing acts on.
    let activePlacementId=null;
    // Whether the placement the box currently shows is confirmed -- i.e. eligible to be included
    // when the document is actually signed (see the server-side check in signing_sign). An unconfirmed
    // placement is a position nobody has signed off on yet -- most importantly a fresh "+ Add
    // signature" extra instance. This is INTENTIONALLY separate from whether the box can be dragged
    // (see activeLocked below) -- confirmed defaults to true for the ordinary single-placement flow so
    // signing keeps working without the user ever touching the checkbox, and mixing that default in
    // with drag-locking used to mean the very first drag-and-autosave locked the box against itself.
    let activeConfirmed=false;
    // Whether the placement the box currently shows has been explicitly locked by the user via the
    // confirm checkbox (see toggleConfirm). Starts false for every placement, new or old, confirmed
    // or not -- it is set true ONLY by that explicit action, never by a plain drag/resize autosave --
    // so repositioning a signature never locks it out from being repositioned again. A locked box
    // can't be dragged/resized/reset until unchecked again.
    let activeLocked=false;
    // Set for exactly one upcoming save: forces the server to insert a brand-new row instead of
    // reusing an existing one for the same signature+page, for the case where the signature chosen
    // via "+ Add signature" already has a placement here and the user wants another instance of it.
    let forceNewInstance=false;
    // Treats a placement as confirmed unless explicitly marked otherwise -- covers cached placement
    // objects from code paths that never set the field (apply-template, auto-detect, the per-page
    // toggle grid), all of which use the same always-confirmed default path server-side.
    function isConfirmed(pl){return !(pl&&(pl.confirmed===0||pl.confirmed===false))}
    // Treats a placement as NOT locked unless explicitly marked otherwise -- safe for cached objects
    // (any code path predating this flag, or that never locks) that never set the field.
    function isLocked(pl){return !!(pl&&(pl.locked===1||pl.locked===true))}
    const selectChecks=()=>[...document.querySelectorAll('.doc-check:checked')].map(x=>Number(x.value));
    function updateCount(){const n=selectChecks().length,c=document.getElementById('selectedCount'),q=document.getElementById('selectedQueueBadge');if(c)c.textContent=String(n);if(q)q.textContent=n+' selected';updateProgress()}
    document.querySelectorAll('.doc-check').forEach(c=>c.addEventListener('change',updateCount));
    document.getElementById('selectAllDocs')?.addEventListener('change',e=>{document.querySelectorAll('.queue-item:not([hidden]) .doc-check').forEach(c=>c.checked=e.target.checked);updateCount()});

    function applyQueueFilter(){
      const qv=(document.getElementById('queueSearch')?.value||'').trim().toLowerCase();
      const sv=document.getElementById('queueStatusFilter')?.value||'';
      let anyVisible=false;
      document.querySelectorAll('.queue-item').forEach(item=>{
        const name=(item.querySelector('.doc-open')?.dataset.name||'').toLowerCase();
        const meta=(item.querySelector('.doc-meta small')?.textContent||'').toLowerCase();
        const status=item.dataset.status||'';
        const show=(!qv||name.includes(qv)||meta.includes(qv))&&(!sv||status===sv);
        item.hidden=!show;if(show)anyVisible=true;
      });
      const active=!!(qv||sv);
      const noMatch=document.getElementById('queueNoMatch');if(noMatch)noMatch.hidden=anyVisible||!active;
      const resetBtn=document.getElementById('queueReset');if(resetBtn)resetBtn.hidden=!active;
    }
    document.getElementById('queueSearch')?.addEventListener('input',applyQueueFilter);
    document.getElementById('queueStatusFilter')?.addEventListener('change',applyQueueFilter);
    document.getElementById('queueReset')?.addEventListener('click',()=>{const s=document.getElementById('queueSearch'),f=document.getElementById('queueStatusFilter');if(s)s.value='';if(f)f.value='';applyQueueFilter()});

    function currentSig(){const o=sigSel?.selectedOptions?.[0];return o&&o.value?{id:Number(o.value),src:o.dataset.src}:null}
    function setSigImage(){const s=currentSig();if(s&&current){sigImg.src=s.src;box.hidden=false}else{box.hidden=true}}
    let sigStepForcedOpen=false;
    function updateSigStepSummary(){
      const sig=currentSig();
      const body=document.getElementById('stepSigBody'),summary=document.getElementById('stepSigSummary'),text=document.getElementById('stepSigSummaryText');
      const collapse=!!sig&&!sigStepForcedOpen;
      if(text&&sig)text.textContent=jt('js.sig_selected_summary',{name:(sigSel.selectedOptions[0]?.textContent||'').trim()});
      if(summary)summary.hidden=!collapse;
      if(body)body.hidden=collapse;
    }
    document.getElementById('stepSigChange')?.addEventListener('click',()=>{sigStepForcedOpen=true;updateSigStepSummary()});
    sigSel?.addEventListener('change',()=>{sigStepForcedOpen=false;setSigImage();if(current){if(placementFor()){applyPlacement(placementFor());setPositionHint(false)}else{suggestPosition()}renderPageGrid()}updateProgress();updateSigStepSummary()});

    function placementFor(){
      const sid=currentSig()?.id;if(!sid||!current)return null;
      const all=window.FMT_SIGNING?.placements||{};const arr=all[String(current)]||all[current]||[];
      return arr.find(x=>Number(x.signature_id)===sid&&Number(x.page)===page)||null;
    }
    function applyPlacement(pl){
      // A real saved placement row carries an id; a merely suggested position (from
      // /api/signing/suggest-position) does not, so this also doubles as the single place that
      // keeps activePlacementId in sync with whatever the box is currently showing.
      activePlacementId=(pl&&pl.id!=null)?Number(pl.id):null;
      activeConfirmed=pl?isConfirmed(pl):false;
      activeLocked=pl?isLocked(pl):false;
      updateBoxLockUI();
      if(!box||!wrap)return;
      if(!pl){box.style.left='39%';box.style.top='45%';box.style.width='22%';box.style.height='10%';return}
      box.style.left=(Number(pl.nx)*100)+'%';box.style.top=(Number(pl.ny)*100)+'%';box.style.width=(Number(pl.nw)*100)+'%';box.style.height=(Number(pl.nh)*100)+'%';
    }
    // Keeps the active box's own toolbar (the confirm checkbox, delete button, and the locked/
    // draggable visual state) in sync with activePlacementId/activeLocked. Called whenever either
    // changes -- from applyPlacement, from savePlacement's response, and from toggling the checkbox.
    // The checkbox reflects activeLocked (not activeConfirmed) -- ticking it is what actually freezes
    // the box, whereas confirmed alone (true by default for the ordinary flow) shouldn't visually read
    // as "locked" when nobody has touched the checkbox yet.
    function updateBoxLockUI(){
      const chk=document.getElementById('boxConfirmChk'),del=document.getElementById('boxDeleteBtn');
      if(chk)chk.checked=activeLocked;
      if(box)box.classList.toggle('locked',activeLocked);
      if(del)del.disabled=!activePlacementId;
    }
    function sigSrc(sid){const o=[...(sigSel?.options||[])].find(x=>Number(x.value)===Number(sid));return o?o.dataset.src:''}
    function setNavState(){prevBtns.forEach(b=>b.disabled=!current||page<=1);nextBtns.forEach(b=>b.disabled=!current||page>=pages);if(previewBtn)previewBtn.disabled=!current||!currentSig();const sl=document.getElementById('selectSameLayout');if(sl)sl.disabled=!current}
    let zoom=1;
    function applyZoom(){if(wrap)wrap.style.transform='scale('+zoom+')';const z=document.getElementById('zoomLevel');if(z)z.textContent=Math.round(zoom*100)+'%'}
    document.getElementById('zoomIn')?.addEventListener('click',()=>{zoom=Math.min(2.5,Math.round((zoom+0.25)*100)/100);applyZoom()});
    document.getElementById('zoomOut')?.addEventListener('click',()=>{zoom=Math.max(0.5,Math.round((zoom-0.25)*100)/100);applyZoom()});
    function parsePageRange(str,maxPages){
      const set=new Set();
      for(const part of (str||'').split(',').map(s=>s.trim()).filter(Boolean)){
        const m=part.match(/^(\d+)(?:-(\d+))?$/);if(!m)continue;
        const a=parseInt(m[1],10),b=m[2]?parseInt(m[2],10):a,lo=Math.min(a,b),hi=Math.max(a,b);
        for(let i=lo;i<=hi;i++)if(i>=1&&(!maxPages||i<=maxPages))set.add(i);
      }
      return [...set].sort((x,y)=>x-y);
    }
    function docPlacements(id){return ((window.FMT_SIGNING?.placements||{})[String(id)]||[]).slice()}
    function refreshQueueBadge(id){
      const item=document.querySelector(`.queue-item[data-doc-id="${id}"]`);if(!item)return;
      const arr=docPlacements(id);
      const placedBadge=item.querySelector('[data-placed-badge]');if(placedBadge)placedBadge.hidden=!arr.length;
      if(!arr.length){
        const autoBadge=item.querySelector('[data-auto-badge]');if(autoBadge){autoBadge.hidden=true;autoBadge.classList.remove('ready','review')}
        const cb=item.querySelector('.doc-check');if(cb&&cb.checked){cb.checked=false;updateCount()}
      }
    }
    let gridAnchor=null;
    function renderPageGrid(){
      const host=document.getElementById('pageGrid');if(!host||!current)return;
      const sig=currentSig();
      const placedPages=new Set(docPlacements(current).filter(x=>!sig||Number(x.signature_id)===sig.id).map(x=>Number(x.page)));
      let html='';
      for(let p=1;p<=pages;p++)html+=`<button type="button" class="page-grid-btn${placedPages.has(p)?' active':''}" data-grid-page="${p}" title="${jt('js.page_chip',{n:p})}">${p}</button>`;
      host.innerHTML=html;
      renderInstanceBoxes();
    }
    // Lists every individual placement ROW on the CURRENTLY VIEWED page (unlike renderPageGrid's
    // per-signature page list, this is scoped to one page but across ALL signatures AND every
    // instance of each -- the same signature can appear here more than once, e.g. the same signer
    // stamped in two different approval boxes on one page). Clicking a chip brings that exact
    // instance's box back for repositioning; its × deletes just that one instance. "+ Add signature"
    // is never limited by how many are already placed -- it always offers every registered signature,
    // including ones already on this page, and always starts a brand-new instance.
    function allSignatureOptions(){return [...(sigSel?.options||[])].filter(o=>o.value).map(o=>({id:Number(o.value),label:o.textContent.trim()}))}
    function pageSignatureIds(){return new Set(docPlacements(current).filter(x=>Number(x.page)===page).map(x=>Number(x.signature_id)))}
    function pageInstances(){return docPlacements(current).filter(x=>Number(x.page)===page)}
    function labelForSig(sid){const o=allSignatureOptions().find(s=>s.id===sid);return o?o.label:('#'+sid)}
    // Renders every OTHER placement instance on the current page (i.e. every one except whichever is
    // "active" and shown via the shared draggable #signatureBox) as its own box, at its own saved
    // position, directly on top of the PDF -- so nothing placed earlier is ever hidden just because a
    // new signature was added or a different one became active (the original complaint: adding a
    // signature that already had a placement made the older one seem to vanish). Each box carries its
    // own mini toolbar: + adds another signature to the page, the checkbox confirms/locks that one
    // instance in place, and × removes just that instance. Clicking the box itself (not its toolbar)
    // promotes it to be the active, draggable box -- the same thing the old chip row's click used to do.
    function renderInstanceBoxes(){
      const host=document.getElementById('instanceBoxesLayer'),addBtn=document.getElementById('pageSigAddBtn');
      if(!host)return;
      if(!current){host.innerHTML='';if(addBtn)addBtn.hidden=true;return}
      const others=pageInstances().filter(x=>Number(x.id)!==activePlacementId);
      host.innerHTML=others.map(inst=>{
        const sid=Number(inst.signature_id),pid=Number(inst.id),locked=isLocked(inst),src=(sigSrc(sid)||'').replace(/"/g,'&quot;');
        return `<div class="sig-instance-box${locked?' locked':''}" data-placement-id="${pid}" style="left:${Number(inst.nx)*100}%;top:${Number(inst.ny)*100}%;width:${Number(inst.nw)*100}%;height:${Number(inst.nh)*100}%">`+
          `<div class="sig-box-toolbar">`+
          `<button type="button" class="sig-box-btn sig-box-add" data-inst-add title="${jt('sign.controls.add_signature')}">+</button>`+
          `<label class="sig-box-confirm" title="${jt('js.confirm_position')}"><input type="checkbox" data-inst-confirm ${locked?'checked':''}><span></span></label>`+
          `<button type="button" class="sig-box-btn sig-box-del" data-inst-del title="${jt('sign.controls.remove_from_page')}">&times;</button>`+
          `</div><img src="${src}" alt="Signature">`+
          `</div>`;
      }).join('');
      // The "+ Add signature" button stays visible whenever a document is open -- it never hides
      // just because every configured signature already has a placement here (switching the active
      // signature, or placing the last one, used to make it disappear, which was confusing), and it
      // no longer refuses to add a signature just because it's already on the page -- the same
      // signer can be stamped more than once.
      if(addBtn)addBtn.hidden=false;
    }
    document.getElementById('instanceBoxesLayer')?.addEventListener('click',async e=>{
      const inst_el=e.target.closest('.sig-instance-box');if(!inst_el)return;
      const pid=Number(inst_el.dataset.placementId);
      if(e.target.closest('[data-inst-del]')){await removeSignatureFromPage(pid);return}
      if(e.target.closest('[data-inst-confirm]'))return;
      if(e.target.closest('[data-inst-add]')){document.getElementById('pageSigAddBtn')?.click();return}
      const inst=pageInstances().find(x=>Number(x.id)===pid);if(!inst||!sigSel)return;
      const sid=String(inst.signature_id);
      if(sigSel.value!==sid){sigSel.value=sid;sigStepForcedOpen=false;setSigImage();updateSigStepSummary()}
      applyPlacement(inst);setPositionHint(false);
      renderPageGrid();updateProgress();
    });
    document.getElementById('instanceBoxesLayer')?.addEventListener('change',async e=>{
      const chk=e.target.closest('[data-inst-confirm]');if(!chk)return;
      const inst_el=e.target.closest('.sig-instance-box'),pid=Number(inst_el.dataset.placementId),wantConfirmed=chk.checked;
      try{await toggleConfirm(pid,wantConfirmed);inst_el.classList.toggle('locked',wantConfirmed)}
      catch(err){chk.checked=!wantConfirmed;showApplyNote(err.message,'error')}
    });
    async function toggleConfirm(placementId,confirmed){
      const r=await jsonPost('/api/signing/placement/confirm',{attendance_id:current,placement_id:placementId,confirmed});
      window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
      const key=String(current);
      window.FMT_SIGNING.placements[key]=(window.FMT_SIGNING.placements[key]||[]).map(x=>Number(x.id)===placementId?{...x,confirmed:confirmed?1:0,locked:confirmed?1:0}:x);
      if(activePlacementId===placementId){activeConfirmed=confirmed;activeLocked=confirmed;updateBoxLockUI()}
      return r;
    }
    document.getElementById('boxAddBtn')?.addEventListener('click',()=>{document.getElementById('pageSigAddBtn')?.click()});
    document.getElementById('boxDeleteBtn')?.addEventListener('click',()=>{if(activePlacementId)removeSignatureFromPage(activePlacementId)});
    document.getElementById('boxConfirmChk')?.addEventListener('change',async e=>{
      const wantConfirmed=e.target.checked;
      try{
        if(!activePlacementId){
          if(!wantConfirmed){e.target.checked=false;return}
          await savePlacement({silent:true});
        }
        if(!activePlacementId){e.target.checked=false;return}
        await toggleConfirm(activePlacementId,wantConfirmed);
      }catch(err){e.target.checked=!wantConfirmed;showApplyNote(err.message,'error')}
    });
    async function removeSignatureFromPage(placementId){
      try{
        await jsonPost('/api/signing/placement/remove',{attendance_id:current,placement_id:placementId});
        window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
        const key=String(current);
        window.FMT_SIGNING.placements[key]=(window.FMT_SIGNING.placements[key]||[]).filter(x=>Number(x.id)!==placementId);
        if(activePlacementId===placementId){
          // Fall back to another instance of the currently active signature on this page, if one
          // still exists; otherwise show the usual suggestion for an unplaced signature.
          const sig=currentSig();
          const remaining=sig?pageInstances().find(x=>Number(x.signature_id)===sig.id):null;
          if(remaining)applyPlacement(remaining);else suggestPosition();
        }
        renderPageGrid();refreshQueueBadge(current);refreshPageScopeInput();
        showApplyNote(jt('js.signature_removed_from_page'),'success');updateProgress();
      }catch(err){showApplyNote(err.message,'error')}
    }
    function addSignatureInstance(sid){
      // Always starts a brand-new, not-yet-saved instance for this signature -- even when it
      // already has one or more placements on this page -- so the same signer can be stamped again
      // in a different spot. forceNewInstance tells the next save to insert a fresh row instead of
      // reusing an existing one only when this signature is already present here; otherwise the
      // ordinary single-instance path already does the right thing (creates the first one).
      if(sigSel)sigSel.value=String(sid);
      sigStepForcedOpen=false;setSigImage();updateSigStepSummary();
      forceNewInstance=pageSignatureIds().has(sid);
      applyPlacement(null);
      // Nudge the default box a little for each instance already on this page so a newly added one
      // doesn't land exactly on top of another, making it obvious there's something new to drag.
      const n=Math.min(4,pageInstances().length);
      if(box&&n>0){box.style.left=(39+n*6)+'%';box.style.top=(45+n*6)+'%'}
      setPositionHint(false);renderPageGrid();updateProgress();
    }
    document.getElementById('pageSigAddBtn')?.addEventListener('click',()=>{
      if(!current)return;
      const all=allSignatureOptions();
      if(!all.length){toast(jt('js.select_sig_first'),'bad');return}
      if(all.length===1){addSignatureInstance(all[0].id);return}
      const picker=document.getElementById('pageSigAddSelect'),addBtn=document.getElementById('pageSigAddBtn');
      picker.innerHTML=`<option value="">${jt('js.pick_signature')}</option>`+all.map(s=>`<option value="${s.id}">${s.label}</option>`).join('');
      picker.hidden=false;if(addBtn)addBtn.hidden=true;picker.focus();
    });
    document.getElementById('pageSigAddSelect')?.addEventListener('change',e=>{
      const v=e.target.value,picker=e.target,addBtn=document.getElementById('pageSigAddBtn');
      picker.hidden=true;if(addBtn)addBtn.hidden=false;
      if(!v)return;
      addSignatureInstance(Number(v));
    });
    function refreshPageScopeInput(){
      const input=document.getElementById('pageScopeInput'),hint=document.getElementById('pageScopeHint');
      if(hint)hint.hidden=true;
      if(!input||!current)return;
      const arr=[...new Set(docPlacements(current).map(x=>x.page))].sort((a,b)=>a-b);
      input.value=arr.join(',');
    }
    // Was previously its own small, easy-to-miss text note tucked inside the scrolling side panel,
    // shown ALONGSIDE the center banner below for the same event -- two notification layers for one
    // action. Folded into a single alias so every existing call site (still named showApplyNote for
    // minimal churn) now shows just the one prominent, fixed-position banner.
    function showApplyNote(msg,kind){showCenterNotice(msg,kind)}
    // A prominent confirmation fixed to the viewport (not the panel) for actions easy to miss inside
    // the scrolling controls panel -- most importantly, dragging/resizing a signature box auto-saves
    // (see clearPointer below). Visible no matter which panel is scrolled or how the PDF is zoomed.
    // Together with the bottom-right toast (used for standalone/global actions), this is the app's
    // one other notification layer -- deliberately just the two, not three.
    let centerNoticeTimer=null;
    function showCenterNotice(msg,kind){
      const el=document.getElementById('centerNotice');if(!el)return;
      el.textContent=msg;el.classList.remove('success','error');if(kind)el.classList.add(kind);
      el.hidden=false;requestAnimationFrame(()=>el.classList.add('show'));
      clearTimeout(centerNoticeTimer);
      centerNoticeTimer=setTimeout(()=>{el.classList.remove('show');setTimeout(()=>{el.hidden=true},220)},1800);
    }
    document.getElementById('pageScopeApply')?.addEventListener('click',async()=>{
      try{
        if(!current)throw new Error(jt('js.select_pdf_first'));
        const input=document.getElementById('pageScopeInput'),list=parsePageRange(input?.value,pages);
        if(!list.length)throw new Error(jt('js.pages_required'));
        const r=await jsonPost('/api/signing/prune-pages',{attendance_id:current,pages:list});
        window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
        const key=String(current);
        window.FMT_SIGNING.placements[key]=(window.FMT_SIGNING.placements[key]||[]).filter(x=>(r.remaining_pages||[]).includes(Number(x.page)));
        renderPageGrid();refreshQueueBadge(current);
        showApplyNote((r.removed_pages&&r.removed_pages.length)?jt('js.pages_pruned',{removed:r.removed_pages.join(', '),kept:r.remaining_pages.join(', ')||'-'}):jt('js.pages_kept_all',{kept:r.kept.join(', ')}),'success');
        const pl=placementFor();if(pl){applyPlacement(pl);setPositionHint(false)}else{applyPlacement(null)}
        updateProgress();
      }catch(e){showApplyNote(e.message,'error');toast(e.message,'bad')}
    });
    // Copies EVERY placement on the page currently being viewed to a list of other pages, in one
    // action -- unlike the page grid below (which only ever adds/removes whichever ONE signature
    // is currently selected in the dropdown), this replicates all of them together. Fixes the
    // reported gap where a page holding two different signatures only ever got one of them carried
    // across a range: the page grid's shift-click always operates on a single active signature, so
    // the other signature already on the source page silently never made it onto the target pages.
    document.getElementById('pageCopyApply')?.addEventListener('click',async()=>{
      try{
        if(!current)throw new Error(jt('js.select_pdf_first'));
        if(!pageInstances().length)throw new Error(jt('js.page_range_no_source'));
        const input=document.getElementById('pageCopyInput'),list=parsePageRange(input?.value,pages).filter(p=>p!==page);
        if(!list.length)throw new Error(jt('js.pages_required'));
        const r=await jsonPost('/api/signing/apply-page-range',{attendance_id:current,source_page:page,target_pages:list});
        window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
        const key=String(current);
        let arr=window.FMT_SIGNING.placements[key]||[];
        for(const row of (r.copied||[])){arr=arr.filter(x=>Number(x.id)!==Number(row.id));arr.push({attendance_id:current,...row})}
        window.FMT_SIGNING.placements[key]=arr;
        renderPageGrid();refreshQueueBadge(current);refreshPageScopeInput();
        showApplyNote((r.copied&&r.copied.length)?jt('js.page_range_applied',{n:r.copied.length,pages:r.target_pages.join(', ')}):jt('js.page_range_none_copied'),'success');
        updateProgress();
      }catch(e){showApplyNote(e.message,'error');toast(e.message,'bad')}
    });
    document.getElementById('pageGrid')?.addEventListener('click',async e=>{
      const host=e.currentTarget;
      const btn=e.target.closest('[data-grid-page]');if(!btn||!current)return;
      const sig=currentSig();if(!sig){toast(jt('js.select_sig_first'),'bad');return}
      const targetPage=Number(btn.dataset.gridPage);
      const already=new Set(docPlacements(current).filter(x=>Number(x.signature_id)===sig.id).map(x=>Number(x.page)));
      let range=[targetPage];
      if(e.shiftKey&&gridAnchor){const lo=Math.min(gridAnchor,targetPage),hi=Math.max(gridAnchor,targetPage);range=[];for(let p=lo;p<=hi;p++)range.push(p)}
      gridAnchor=targetPage;
      // A single click toggles that one page; a shift-click range always turns every page in it
      // ON (like file-explorer shift-select) rather than toggling each one individually.
      const turningOn=!(range.length===1&&already.has(targetPage));
      let n=null;
      if(turningOn){try{n=normFromBox()}catch(err){toast(err.message,'bad');return}}
      const btns=[...host.querySelectorAll('[data-grid-page]')];btns.forEach(b=>b.disabled=true);
      try{
        for(const p of range){
          const has=already.has(p);
          if(turningOn&&!has){
            await jsonPost('/api/signing/placement',{attendance_id:current,signature_id:sig.id,page:p,...n,remember:false,apply_ids:[]});
            window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
            const key=String(current),arr=(window.FMT_SIGNING.placements[key]||[]).filter(x=>!(Number(x.signature_id)===sig.id&&Number(x.page)===p));
            arr.push({attendance_id:current,signature_id:sig.id,page:p,...n});window.FMT_SIGNING.placements[key]=arr;
          }else if(!turningOn&&has){
            await jsonPost('/api/signing/placement/remove',{attendance_id:current,signature_id:sig.id,page:p});
            window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
            const key=String(current);
            window.FMT_SIGNING.placements[key]=(window.FMT_SIGNING.placements[key]||[]).filter(x=>!(Number(x.signature_id)===sig.id&&Number(x.page)===p));
          }
        }
        renderPageGrid();refreshQueueBadge(current);refreshPageScopeInput();
        const list=range.join(', ');
        showApplyNote(turningOn?jt('js.pages_applied',{pages:list}):jt('js.pages_unapplied',{pages:list}),'success');
        if(placementFor()){applyPlacement(placementFor());setPositionHint(false)}else if(range.includes(page)){applyPlacement(null)}
        updateProgress();
      }catch(err){showApplyNote(err.message,'error');toast(err.message,'bad')}
      finally{btns.forEach(b=>b.disabled=false)}
    });
    function findNextUnplaced(){
      const items=[...document.querySelectorAll('.queue-item:not([hidden])')];
      const idx=items.findIndex(x=>Number(x.dataset.docId)===current);
      for(let i=idx+1;i<items.length;i++){
        const id=Number(items[i].dataset.docId),status=items[i].dataset.status;
        const arr=(window.FMT_SIGNING?.placements||{})[String(id)]||[];
        if(status!=='Signed'&&arr.length===0)return items[i].querySelector('.doc-open');
      }
      return null;
    }
    function namesSuffix(names){return (names&&names.length)?' ('+names.slice(0,4).join(', ')+(names.length>4?jt('js.and_more',{n:names.length-4}):'')+')':''}
    function setPositionHint(show){const h=document.getElementById('positionHint');if(h)h.hidden=!show}
    function updateProgress(){
      const prog=document.getElementById('signingProgress');if(!prog)return;
      const hasSig=!!currentSig(),hasPlacement=!!placementFor(),anyChecked=selectChecks().length>0;
      let step=1;if(hasSig)step=2;if(hasSig&&hasPlacement)step=3;if(hasSig&&hasPlacement&&anyChecked)step=4;
      prog.querySelectorAll('[data-step]').forEach(el=>el.classList.toggle('active',Number(el.dataset.step)<=step));
    }
    async function suggestPosition(){
      const sig=currentSig();if(!current||!sig){setPositionHint(false);return}
      if(placementFor()){setPositionHint(false);return}
      try{
        const r=await jsonPost('/api/signing/suggest-position',{attendance_id:current,signature_id:sig.id});
        if(r.found&&Number(r.page)===page){applyPlacement(r);setPositionHint(true)}else{applyPlacement(null);setPositionHint(false)}
      }catch(e){setPositionHint(false)}
    }
    function loadDoc(btn){
      if(!btn)return;current=Number(btn.dataset.id);pages=Math.max(1,Number(btn.dataset.pages||1));page=1;
      document.querySelectorAll('.queue-item').forEach(x=>x.classList.remove('active'));btn.closest('.queue-item')?.classList.add('active');
      const n=document.getElementById('currentDocName');if(n)n.textContent=btn.dataset.name||'Attendance PDF';
      setPositionHint(false);
      renderPageGrid();refreshPageScopeInput();
      wrap.hidden=false;document.getElementById('pdfEmpty').hidden=true;loadPage();
    }
    function loadPage(){
      if(!current)return;document.getElementById('previewBanner').hidden=true;setNavState();
      const loading=document.getElementById('pdfLoading');if(loading)loading.hidden=false;pageImg.style.opacity='.15';
      pageImg.onload=()=>{if(loading)loading.hidden=true;pageImg.style.opacity='1';setSigImage();const pl=placementFor();if(pl){applyPlacement(pl);setPositionHint(false)}else{suggestPosition()}setNavState();updateProgress();renderInstanceBoxes()};
      pageImg.onerror=()=>{if(loading)loading.hidden=true;pageImg.style.opacity='1';toast(jt('js.preview_load_failed'),'bad');wrap.hidden=true;document.getElementById('pdfEmpty').hidden=false};
      pageImg.src=`/attendance/${current}/page/${page}.png?v=${Date.now()}`;
      const pageText=`Page ${page} / ${pages}`;
      const p=document.getElementById('pageInfo');if(p)p.textContent=pageText;
      document.querySelectorAll('.page-nav-mini-label').forEach(el=>el.textContent=pageText);
    }
    document.querySelectorAll('.doc-open').forEach(b=>b.addEventListener('click',()=>loadDoc(b)));
    prevBtns.forEach(b=>b.addEventListener('click',()=>{if(current&&page>1){page--;loadPage()}}));nextBtns.forEach(b=>b.addEventListener('click',()=>{if(current&&page<pages){page++;loadPage()}}));

    function normFromBox(){
      if(!current||wrap.hidden||box.hidden)throw new Error(jt('js.select_pdf_and_sig'));
      const r=wrap.getBoundingClientRect(),b=box.getBoundingClientRect();if(r.width<=0||r.height<=0)throw new Error(jt('js.preview_not_ready'));
      const out={nx:(b.left-r.left)/r.width,ny:(b.top-r.top)/r.height,nw:b.width/r.width,nh:b.height/r.height};
      for(const k of Object.keys(out))out[k]=Math.max(0,Math.min(1,out[k]));return out;
    }
    let posMoved=false;
    // A locked instance can't be dragged or resized -- uncheck its confirm box first. This is
    // deliberately activeLocked, not activeConfirmed -- confirmed defaults to true for the ordinary
    // single-placement flow, and gating dragging on that instead used to lock a box against itself
    // the moment its very first drag auto-saved.
    box?.addEventListener('pointerdown',e=>{if(activeLocked)return;if(e.target.classList.contains('resize-handle')||e.target.closest('.sig-box-toolbar'))return;drag={x:e.clientX,y:e.clientY,left:box.offsetLeft,top:box.offsetTop};posMoved=false;box.setPointerCapture(e.pointerId);e.preventDefault()});
    box?.querySelector('.resize-handle')?.addEventListener('pointerdown',e=>{if(activeLocked)return;resize={x:e.clientX,y:e.clientY,w:box.offsetWidth,h:box.offsetHeight};posMoved=false;box.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault()});
    box?.addEventListener('pointermove',e=>{
      // Raw pointer deltas are in real screen pixels; #pageWrap may be CSS-scaled by the zoom
      // controls, so deltas are divided by the current zoom so the box tracks the cursor 1:1
      // at any zoom level instead of moving faster/slower than the mouse.
      if(drag){const maxX=Math.max(0,wrap.clientWidth-box.offsetWidth),maxY=Math.max(0,wrap.clientHeight-box.offsetHeight);box.style.left=Math.max(0,Math.min(maxX,drag.left+(e.clientX-drag.x)/zoom))+'px';box.style.top=Math.max(0,Math.min(maxY,drag.top+(e.clientY-drag.y)/zoom))+'px';posMoved=true}
      if(resize){const w=Math.max(36,Math.min(wrap.clientWidth-box.offsetLeft,resize.w+(e.clientX-resize.x)/zoom)),h=Math.max(22,Math.min(wrap.clientHeight-box.offsetTop,resize.h+(e.clientY-resize.y)/zoom));box.style.width=w+'px';box.style.height=h+'px';posMoved=true}
    });
    // A drag or resize that actually moved the box auto-saves the placement as soon as the
    // pointer is released, so repositioning the signature no longer requires a manual "Save
    // Placement" click every time — the button is still there for the batch/"apply to selected"
    // action and for confirming a position that was never dragged (e.g. accepting the suggested spot).
    function clearPointer(){
      const wasActive=!!(drag||resize);drag=null;resize=null;
      if(wasActive&&posMoved){posMoved=false;savePlacement({silent:true}).catch(e=>{showApplyNote(e.message,'error')})}
    }
    box?.addEventListener('pointerup',clearPointer);
    box?.addEventListener('pointercancel',()=>{drag=null;resize=null;posMoved=false});

    async function savePlacement(opts){
      opts=opts||{};
      if(!current)throw new Error(jt('js.select_pdf_first'));const sig=currentSig();if(!sig)throw new Error(jt('js.select_sig_first'));const n=normFromBox();
      const selected=document.getElementById('applySelected')?.checked?selectChecks():[];
      const body={attendance_id:current,signature_id:sig.id,page,...n,remember:!!document.getElementById('rememberPosition')?.checked,apply_ids:selected};
      // activePlacementId (when set) names the exact row being repositioned -- required once a
      // signature can have more than one placement on the same page, since matching by
      // signature+page alone would be ambiguous about which instance to update. forceNewInstance is
      // only set right after "+ Add signature" chose a signature that already has a placement here,
      // so this one save creates another instance instead of silently reusing the first one.
      if(activePlacementId)body.placement_id=activePlacementId;
      else if(forceNewInstance)body.new_instance=true;
      const res=await jsonPost('/api/signing/placement',body);
      forceNewInstance=false;
      const savedId=res.placement_id!=null?Number(res.placement_id):activePlacementId;
      activePlacementId=savedId;
      activeConfirmed=!!res.confirmed;
      activeLocked=!!res.locked;
      updateBoxLockUI();
      window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
      for(const id of (res.applied||[current])){
        const key=String(id);
        let existing=window.FMT_SIGNING.placements[key]||[];
        if(id===current&&savedId){
          // Replace just this one instance's cached row -- filtering by signature+page here would
          // also wipe out any OTHER instance of the same signature already placed on this page.
          existing=existing.filter(x=>Number(x.id)!==savedId);
          existing.push({attendance_id:id,signature_id:sig.id,page,...n,id:savedId,confirmed:res.confirmed?1:0,locked:res.locked?1:0});
        }else{
          existing=existing.filter(x=>!(Number(x.signature_id)===sig.id&&Number(x.page)===page));
          existing.push({attendance_id:id,signature_id:sig.id,page,...n,confirmed:1,locked:0});
        }
        window.FMT_SIGNING.placements[key]=existing;refreshQueueBadge(id);
      }
      renderPageGrid();refreshPageScopeInput();
      setPositionHint(false);updateProgress();
      const suffix=res.mismatched?.length?jt('js.need_adjustment_suffix',{n:res.mismatched.length})+namesSuffix(res.mismatched_names):'';
      if(opts.silent){showApplyNote(jt('js.position_autosaved')+suffix,'success')}
      else toast(jt('js.placement_saved')+suffix);
      return res;
    }
    document.getElementById('savePlacement')?.addEventListener('click',async()=>{
      try{await savePlacement();const next=findNextUnplaced();if(next)loadDoc(next)}catch(e){toast(e.message,'bad')}
    });
    document.getElementById('resetPosition')?.addEventListener('click',()=>{
      // Visual-only: moves the box back to the plain default spot without forgetting which saved
      // instance (if any) is still active, so dragging it afterwards updates that same instance
      // instead of the ambiguity that would come from clearing activePlacementId here. A locked
      // instance can't be moved this way either -- uncheck it first.
      if(activeLocked)return;
      if(box&&wrap){box.style.left='39%';box.style.top='45%';box.style.width='22%';box.style.height='10%'}
      setPositionHint(false);
    });
    document.getElementById('useTemplate')?.addEventListener('click',async()=>{try{const sig=currentSig();if(!sig)throw new Error(jt('js.select_sig_first'));let ids=selectChecks();if(current&&!ids.includes(current))ids.unshift(current);if(!ids.length)throw new Error(jt('js.select_pdfs'));const r=await jsonPost('/api/signing/apply-template',{signature_id:sig.id,attendance_ids:ids});window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};for(const pl of (r.placements||[])){const key=String(pl.attendance_id),arr=(window.FMT_SIGNING.placements[key]||[]).filter(x=>!(Number(x.signature_id)===Number(pl.signature_id)&&Number(x.page)===Number(pl.page)));arr.push(pl);window.FMT_SIGNING.placements[key]=arr}if(current&&r.applied.includes(current))applyPlacement(placementFor());toast(jt('js.matched_needadjust',{matched:r.applied.length,mismatched:r.mismatched.length})+namesSuffix(r.mismatched_names))}catch(e){toast(e.message,'bad')}});
    document.getElementById('selectSameLayout')?.addEventListener('click',async()=>{
      try{
        if(!current)throw new Error(jt('js.select_pdf_first'));
        const candidates=[...document.querySelectorAll('.doc-check')].map(x=>Number(x.value));
        const r=await jsonPost('/api/signing/same-layout',{attendance_id:current,page,candidate_ids:candidates});
        document.querySelectorAll('.doc-check').forEach(c=>{c.checked=r.matches.includes(Number(c.value))});
        const apply=document.getElementById('applySelected');if(apply&&r.matches.length>1)apply.checked=true;
        updateCount();
        toast(jt('js.same_layout_selected',{n:r.matches.length}));
      }catch(e){toast(e.message,'bad')}
    });
    previewBtn?.addEventListener('click',async()=>{try{if(current&&activePlacementId)await savePlacement();const img=document.getElementById('exactPreviewImg');img.onload=()=>{document.getElementById('previewModal').hidden=false};img.onerror=()=>toast(jt('js.final_preview_failed'),'bad');img.src=`/attendance/${current}/signed-preview/${page}.png?v=${Date.now()}`}catch(e){toast(e.message,'bad')}});
    document.getElementById('closePreview')?.addEventListener('click',()=>document.getElementById('previewModal').hidden=true);
    document.getElementById('previewModal')?.addEventListener('click',e=>{if(e.target.id==='previewModal')e.currentTarget.hidden=true});
    function docNameFor(id){const item=document.querySelector(`.queue-item[data-doc-id="${id}"]`);return item?.querySelector('.doc-open')?.dataset.name||('#'+id)}
    function confirmRow(id){return document.querySelector(`#confirmDocList .confirm-doc-row[data-id="${id}"]`)}
    function setRowStatus(id,text,cls){const row=confirmRow(id);if(!row)return;const s=row.querySelector('.confirm-doc-status');if(s){s.textContent=text;s.className='confirm-doc-status'+(cls?(' '+cls):'')}}
    function openSignConfirm(ids){
      const modal=document.getElementById('signConfirmModal'),list=document.getElementById('confirmDocList');
      if(!modal||!list)return;
      list.innerHTML='';
      ids.forEach(id=>{
        const row=document.createElement('div');row.className='confirm-doc-row';row.dataset.id=id;
        const name=document.createElement('span');name.className='confirm-doc-name';name.textContent=docNameFor(id);
        const status=document.createElement('span');status.className='confirm-doc-status';
        // Surface unconfirmed placements up front (before Sign is even clicked) rather than only
        // after the server rejects it -- same check the server makes in signing_sign.
        const unconfirmed=docPlacements(id).filter(x=>!isConfirmed(x)).length;
        if(unconfirmed){status.textContent=jt('js.unconfirmed_count',{n:unconfirmed});status.classList.add('fail')}
        else status.textContent=jt('js.sign_confirm_pending');
        row.appendChild(name);row.appendChild(status);list.appendChild(row);
      });
      const confirmBtn=document.getElementById('confirmSignBtn');if(confirmBtn){confirmBtn.disabled=false;confirmBtn.textContent=jt('js.sign_confirm_btn')}
      modal.hidden=false;
    }
    function closeSignConfirm(){const m=document.getElementById('signConfirmModal');if(m)m.hidden=true}
    document.getElementById('closeSignConfirm')?.addEventListener('click',closeSignConfirm);
    document.getElementById('cancelSignConfirm')?.addEventListener('click',closeSignConfirm);
    document.getElementById('signConfirmModal')?.addEventListener('click',e=>{if(e.target.id==='signConfirmModal')closeSignConfirm()});

    document.getElementById('signSelected')?.addEventListener('click',()=>{
      const ids=selectChecks();if(!ids.length){toast(jt('js.select_atleast_one_pdf'),'bad');return}
      openSignConfirm(ids);
    });

    document.getElementById('confirmSignBtn')?.addEventListener('click',async()=>{
      const ids=[...document.querySelectorAll('#confirmDocList .confirm-doc-row')].map(r=>Number(r.dataset.id));
      const confirmBtn=document.getElementById('confirmSignBtn');confirmBtn.disabled=true;
      const signBtn=document.getElementById('signSelected');
      try{
        // Only resave the box's CURRENT position if it's showing an already-saved instance
        // (activePlacementId set) -- a merely suggested-but-never-confirmed position, a freshly
        // reset default, or a just-started "+ Add signature" box that was never dragged into place
        // must not be silently saved just because Sign was clicked.
        if(current&&activePlacementId)await savePlacement();
      }catch(e){toast(e.message,'bad');confirmBtn.disabled=false;return}
      signBtn.disabled=true;let signed=0,failed=0;const signedIds=[];
      for(const id of ids){
        setRowStatus(id,jt('js.sign_confirm_signing'),'pending');
        try{
          const r=await jsonPost('/api/signing/sign',{attendance_ids:[id]});
          const res=(r.results||[])[0];
          if(res&&res.ok){setRowStatus(id,jt('js.sign_confirm_done'),'ok');signed++;signedIds.push(id)}
          else{setRowStatus(id,(res&&res.error)||jt('js.sign_unknown_error'),'fail');failed++}
        }catch(e){setRowStatus(id,e.message,'fail');failed++}
      }
      confirmBtn.textContent=jt('js.sign_confirm_finished',{signed,failed});
      toast(jt('js.signed_success',{n:signed})+(failed?jt('js.failed_suffix',{n:failed}):''),failed?'bad':'good');
      signBtn.disabled=false;signBtn.textContent=jt('js.sign_selected');
      // Once every document in the queue is signed (nothing left unsigned besides what this batch
      // just finished, and none of it failed), the workspace has nothing left to do -- so go
      // straight back to the attendance list instead of reloading this now-empty workspace, and
      // carry a flash message across the redirect so the completion is still clearly announced.
      const stillUnsigned=[...document.querySelectorAll('.queue-item')].some(item=>{
        const id=Number(item.dataset.docId);
        if(signedIds.includes(id))return false;
        return item.dataset.status!=='Signed';
      });
      if(!failed&&!stillUnsigned){
        setTimeout(()=>{location.href='/attendance?flash='+encodeURIComponent(jt('js.workspace_complete_flash'))+'&flash_type=good'},900);
      }else{
        setTimeout(()=>location.reload(),1100);
      }
    });

    async function runAutoDetect(){
      // Reads each not-yet-placed document's own text for the configured anchor keywords and, when a
      // page has exactly one confident match, saves a placement there automatically (via the normal,
      // already-validated /api/signing/placement endpoint -- this function never writes anything itself).
      // Documents where every relevant page came back confident are auto-checked as "ready to sign";
      // documents with any ambiguous page are left unchecked and flagged for manual review instead of guessed.
      const statusEl=document.getElementById('autoDetectStatus'),scanBtn=document.getElementById('autoDetectScan');
      // The keyword field was removed from the UI to keep the queue panel simple -- these anchor
      // phrases matched the app's own standard attendance-sheet wording and never needed changing
      // from document to document, so a fixed default is scanned for automatically instead.
      const keywords=['Menyetujui','Mengetahui Atasan Langsung'];
      const sigId=currentSig()?.id;
      if(statusEl)statusEl.hidden=false;
      if(!sigId){if(statusEl)statusEl.textContent=jt('js.autodetect_no_signature');return}
      if(scanBtn)scanBtn.disabled=true;
      if(statusEl)statusEl.textContent=jt('js.autodetect_running');
      let ready=0,review=0,none=0;
      for(const item of [...document.querySelectorAll('.queue-item')]){
        const id=Number(item.dataset.docId);
        if(item.dataset.status==='Signed')continue;
        const already=(window.FMT_SIGNING?.placements||{})[String(id)]||[];
        if(already.length)continue;
        const badge=item.querySelector('[data-auto-badge]');
        let pages=[];
        try{pages=(await jsonPost('/api/signing/detect-positions',{attendance_id:id,keywords})).pages||[]}catch(e){pages=[]}
        const foundPages=pages.filter(p=>p.status==='found'),ambiguous=pages.some(p=>p.status==='ambiguous');
        if(!foundPages.length){none++;continue}
        let allOk=true;
        for(const p of foundPages){
          try{
            await jsonPost('/api/signing/placement',{attendance_id:id,signature_id:sigId,page:p.page,nx:p.nx,ny:p.ny,nw:p.nw,nh:p.nh,remember:false,apply_ids:[]});
            window.FMT_SIGNING.placements=window.FMT_SIGNING.placements||{};
            const key=String(id),arr=(window.FMT_SIGNING.placements[key]||[]).filter(x=>!(Number(x.signature_id)===sigId&&Number(x.page)===p.page));
            arr.push({attendance_id:id,signature_id:sigId,page:p.page,nx:p.nx,ny:p.ny,nw:p.nw,nh:p.nh});
            window.FMT_SIGNING.placements[key]=arr;
          }catch(e){allOk=false}
        }
        if(ambiguous||!allOk){
          review++;
          if(badge){badge.hidden=false;badge.textContent=jt('js.autodetect_review');badge.classList.remove('ready');badge.classList.add('review')}
        }else{
          ready++;
          if(badge){badge.hidden=false;badge.textContent=jt('js.autodetect_ready');badge.classList.remove('review');badge.classList.add('ready')}
          const cb=item.querySelector('.doc-check');if(cb)cb.checked=true;
        }
        refreshQueueBadge(id);
      }
      updateCount();
      if(scanBtn)scanBtn.disabled=false;
      if(statusEl)statusEl.textContent=jt('js.autodetect_summary',{ready,review,none});
      renderPageGrid();refreshPageScopeInput();
      if(current&&placementFor()){applyPlacement(placementFor());setPositionHint(false)}
    }
    document.getElementById('autoDetectScan')?.addEventListener('click',runAutoDetect);

    updateCount();setNavState();updateSigStepSummary();
    const first=document.querySelector('.doc-open');if(first)loadDoc(first);
    if(document.querySelectorAll('.queue-item').length)runAutoDetect();
  }

  document.addEventListener('DOMContentLoaded',()=>{try{initCommon();initAttendanceUpload();initSigning()}catch(e){console.error(e);toast(jt('js.init_failed'),'bad')}});
  window.fmtToast=toast;
})();
