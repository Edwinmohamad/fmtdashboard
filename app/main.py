from __future__ import annotations
from pathlib import Path
from io import BytesIO
from datetime import datetime
import sqlite3
import secrets
from fastapi import FastAPI, Request, Form, UploadFile, File, HTTPException, Body
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse, StreamingResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from .db import init_db, q, execute, now, audit, BASE, connect
from .auth import bootstrap_admin, current_user, verify_password, create_session, delete_session, COOKIE, COOKIE_SECURE, SESSION_HOURS, can, hash_password
from .services import (save_upload, save_image_upload, inventory_import_xlsx, preview_inventory_xlsx, export_inventory_xlsx,
    ALLOWED_IMAGE, ALLOWED_TICKET, TICKET_TRANSITIONS, ATTENDANCE_TRANSITIONS, allowed_attendance_transitions, allowed_ticket_transitions,
    pdf_info, render_pdf_page, sign_pdf, sha256_file, validate_image_file, detect_signature_positions)
from .i18n import get_lang, t as _t, vl as _vl, js_dict as _js_dict, SUPPORTED as LANG_SUPPORTED, COOKIE as LANG_COOKIE
from .notify import notify_event, send_telegram, EVENT_TEMPLATES

app = FastAPI(title="FMT Operations Dashboard — Site TBS", docs_url=None, redoc_url=None)

PAGE_SIZE = 25

def paginate_query(sql: str, params: list, page: int = 1, per_page: int = PAGE_SIZE):
    """Wrap a SELECT (no LIMIT/OFFSET) with pagination. Returns (rows, meta)."""
    total = q(f"SELECT COUNT(*) c FROM ({sql})", params, one=True)['c']
    pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, pages))
    rows = q(sql + " LIMIT ? OFFSET ?", list(params) + [per_page, (page - 1) * per_page])
    return rows, {'page': page, 'pages': pages, 'total': total, 'per_page': per_page}

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith(("/login", "/users", "/settings", "/static/")):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    return response
app.mount("/static", StaticFiles(directory=BASE / "app" / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "app" / "templates")

PERMISSIONS = [
 'dashboard.view',
 'attendance.view','attendance.upload','attendance.review','attendance.sign','attendance.sign_bulk','attendance.finalize','attendance.download','attendance.delete',
 'signature.view','signature.create','signature.edit','signature.delete','signature.use','signature.manage',
 'asset.view','asset.create','asset.edit','asset.delete','asset.import','asset.export',
 'tools.view','tools.create','tools.edit','tools.delete','tools.import','tools.export',
 'consumable.view','consumable.create','consumable.edit','consumable.delete','consumable.stock_in','consumable.stock_out','consumable.adjustment','consumable.export',
 'change.view','change.create','change.edit','change.approve','change.close',
 'incident.view','incident.create','incident.edit','incident.resolve','incident.close',
 'problem.view','problem.create','problem.edit','problem.close',
 'report.view','report.export','audit.view',
 'user.view','user.create','user.edit','user.disable','user.reset_password','role.manage','settings.view','settings.edit','profile.edit'
]

@app.on_event("startup")
def startup():
    init_db(); bootstrap_admin()
    for folder in ["attendance","attendance/signed","assets","tools","consumables","tickets","branding","signatures","profiles","import-temp"]:
        (BASE/"uploads"/folder).mkdir(parents=True, exist_ok=True)
    # Auto-adopt BDX logo if installer copied /uploads/branding/bdx.logo.
    logo = BASE/'uploads'/'branding'/'bdx.logo'
    if logo.is_file():
        execute("INSERT INTO settings(key,value) VALUES('logo',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",('uploads/branding/bdx.logo',))


def page(request: Request, template: str, **ctx):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", 303)
    settings={r['key']:r['value'] for r in q("SELECT * FROM settings")}
    notif = {
      'sign': q("SELECT COUNT(*) c FROM attendance WHERE status IN ('Uploaded','Ready to Sign')",one=True)['c'],
      'low': q("SELECT COUNT(*) c FROM consumables WHERE current_stock<=minimum_stock",one=True)['c'],
      'critical': q("SELECT COUNT(*) c FROM tickets WHERE ticket_type='Incident' AND severity='Critical' AND status NOT IN ('Closed','Cancelled')",one=True)['c'],
    }
    lang = get_lang(request)
    base={"request":request,"user":user,"settings":settings,"notifications":notif,"can":lambda a:can(user,a),
          "lang":lang,"t":lambda k,**kw:_t(lang,k,**kw),"vl":lambda v:_vl(lang,v),"js_i18n":_js_dict(lang)}
    base.update(ctx)
    return templates.TemplateResponse(template, base)

def require_action(request: Request, action: str):
    u=current_user(request)
    if not u: raise HTTPException(401)
    if not can(u, action): raise HTTPException(403, "You do not have permission for this action")
    return u


def remove_uploaded_file(rel_path: str|None):
    if not rel_path: return
    try:
        p=(BASE/rel_path).resolve(); upload_root=(BASE/'uploads').resolve()
        if upload_root in p.parents and p.is_file(): p.unlink(missing_ok=True)
    except Exception:
        pass


def doc_names_map(ids: list[int]) -> dict:
    """id -> original filename for a list of attendance ids. Missing/deleted ids are simply
    absent from the returned dict rather than raising."""
    if not ids: return {}
    placeholders=','.join('?'*len(ids))
    rows=q(f"SELECT a.id,v.original_name FROM attendance a JOIN attendance_versions v ON v.attendance_id=a.id AND v.version=a.current_version WHERE a.id IN ({placeholders})",ids)
    return {r['id']:r['original_name'] for r in rows}


def doc_names(ids: list[int]) -> list[str]:
    """Original filenames for a list of attendance ids, in the same order, for surfacing
    which specific documents need attention (e.g. a mismatched-layout list) instead of a
    bare count. Missing/deleted ids are skipped rather than raising."""
    names=doc_names_map(ids)
    return [names[i] for i in ids if i in names]

def wants_json(request: Request) -> bool:
    return request.headers.get('X-Requested-With','').lower() in {'xmlhttprequest','fetch'} or 'application/json' in request.headers.get('accept','')

def _lang_ctx(request: Request) -> dict:
    lang = get_lang(request)
    return {"lang":lang,"t":lambda k,**kw:_t(lang,k,**kw),"vl":lambda v:_vl(lang,v)}

@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request":request,"error":None, **_lang_ctx(request)})

@app.post("/login")
def login(request: Request, username: str=Form(...), password: str=Form(...)):
    u=q("SELECT * FROM users WHERE username=? AND active=1",(username,),one=True)
    if not u or not verify_password(password,u['password_hash']):
        if u: execute("UPDATE users SET failed_logins=failed_logins+1 WHERE id=?",(u['id'],))
        return templates.TemplateResponse("login.html", {"request":request,"error":_t(get_lang(request),'login.error'), **_lang_ctx(request)}, status_code=401)
    token=create_session(u['id']); execute("UPDATE users SET last_login_at=?,failed_logins=0 WHERE id=?",(now(),u['id'])); audit(u['id'],'Login','Authentication',u['username'])
    r=RedirectResponse("/",303); r.set_cookie(COOKIE,token,httponly=True,samesite='lax',secure=COOKIE_SECURE,max_age=SESSION_HOURS*3600,path='/')
    return r

@app.post("/logout")
def logout(request: Request):
    delete_session(request.cookies.get(COOKIE)); r=RedirectResponse("/login",303); r.delete_cookie(COOKIE); return r

@app.get("/lang/{code}")
def set_lang(request: Request, code: str):
    ref = request.headers.get('referer') or '/'
    r = RedirectResponse(ref, 303)
    r.set_cookie(LANG_COOKIE, code if code in LANG_SUPPORTED else 'en', max_age=365*24*3600, path='/', httponly=False, samesite='lax')
    return r

@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    u=require_action(request,'view')
    att={r['status']:r['c'] for r in q("SELECT status,COUNT(*) c FROM attendance GROUP BY status")}
    inv={
      'assets': q("SELECT COUNT(*) c FROM assets",one=True)['c'],
      'tools': q("SELECT COUNT(*) c FROM tools",one=True)['c'],
      'consumables': q("SELECT COUNT(*) c FROM consumables",one=True)['c'],
      'low': q("SELECT COUNT(*) c FROM consumables WHERE current_stock<=minimum_stock",one=True)['c'],
      'asset_issue': q("SELECT COUNT(*) c FROM assets WHERE condition NOT IN ('Good','Normal') OR status NOT IN ('Active','Available')",one=True)['c'],
    }
    tic={r['status']:r['c'] for r in q("SELECT status,COUNT(*) c FROM tickets GROUP BY status")}
    critical=q("SELECT COUNT(*) c FROM tickets WHERE ticket_type='Incident' AND severity='Critical' AND status NOT IN ('Closed','Cancelled')",one=True)['c']
    overdue=q("SELECT COUNT(*) c FROM tickets WHERE planned_end<>'' AND planned_end IS NOT NULL AND planned_end<? AND status NOT IN ('Closed','Cancelled','Resolved')",(now(),),one=True)['c']
    recent=q("SELECT a.*,u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 10")
    attention=[]
    ready=att.get('Ready to Sign',0)+att.get('Uploaded',0)
    if critical: attention.append(('critical',f'{critical} critical incident(s) require attention','/tickets?type=Incident&severity=Critical'))
    if overdue: attention.append(('warning',f'{overdue} ticket(s) are overdue','/tickets'))
    if ready: attention.append(('info',f'{ready} attendance PDF(s) ready for signing','/attendance/signing'))
    if inv['low']: attention.append(('warning',f"{inv['low']} consumable item(s) are low stock",'/consumables?low=1'))
    pending=tic.get('Waiting Approval',0)
    if pending: attention.append(('info',f'{pending} change/ticket approval(s) waiting','/tickets?status=Waiting Approval'))
    signed=q("SELECT COUNT(*) c FROM attendance WHERE date(signed_at)=date('now','localtime')",one=True)['c']
    final=q("SELECT COUNT(*) c FROM attendance WHERE status IN ('Final','Archived')",one=True)['c']
    # Simple operations health: transparent, action-oriented, not employee scoring.
    penalty=min(60,critical*20+overdue*8+inv['low']*2+ready)
    health=max(0,100-penalty)
    trend=[]
    for d in range(6,-1,-1):
        row=q("SELECT COUNT(*) c FROM attendance WHERE date(signed_at)=date('now','localtime',?)",(f'-{d} day',),one=True)
        trend.append(row['c'])
    # Team activity: who has been doing the Upload/Sign work in the last 7 days (read-only, no new tables).
    team_activity=q("""SELECT u.full_name,COUNT(*) c FROM audit_logs a JOIN users u ON u.id=a.user_id
        WHERE a.action IN ('Upload','Sign PDF') AND a.created_at>=datetime('now','-7 day')
        GROUP BY a.user_id ORDER BY c DESC LIMIT 5""")
    # Documents sitting in the signing pipeline for more than 3 days without progress.
    waiting_long=q("""SELECT id,employee_name,period,status,updated_at,
        CAST(julianday('now')-julianday(updated_at) AS INTEGER) days_waiting
        FROM attendance WHERE status IN ('Uploaded','Checking','Ready to Sign') AND updated_at<datetime('now','-3 day')
        ORDER BY updated_at ASC LIMIT 5""")
    # Open ticket breakdown by priority.
    ticket_priority={r['priority']:r['c'] for r in q("""SELECT priority,COUNT(*) c FROM tickets
        WHERE status NOT IN ('Closed','Cancelled','Resolved') GROUP BY priority""")}
    return page(request,'dashboard.html',att=att,inv=inv,tic=tic,recent=recent,attention=attention,critical=critical,overdue=overdue,ready=ready,signed=signed,final=final,health=health,trend=trend,team_activity=team_activity,waiting_long=waiting_long,ticket_priority=ticket_priority)

# ---------------- Attendance ----------------
@app.get("/attendance", response_class=HTMLResponse)
def attendance_list(request: Request, status: str|None=None, search: str="", pg: int=1):
    sql="SELECT a.*,u.full_name creator FROM attendance a LEFT JOIN users u ON u.id=a.created_by WHERE 1=1"; p=[]
    if status: sql+=" AND a.status=?"; p.append(status)
    if search: sql+=" AND (a.employee_name LIKE ? OR a.nik LIKE ? OR a.period LIKE ? OR a.location LIKE ?)"; p += [f"%{search}%"]*4
    sql+=" ORDER BY a.updated_at DESC"
    rows,pgmeta=paginate_query(sql,p,pg)
    return page(request,"attendance_list.html",rows=rows,status=status,search=search,pgmeta=pgmeta)

@app.get("/attendance/upload", response_class=HTMLResponse)
def attendance_upload_page(request: Request):
    require_action(request,'attendance.upload'); return page(request,"attendance_upload.html")

@app.post("/attendance/upload")
def attendance_upload(request: Request, period:str=Form(...), division:str=Form('FMT'), location:str=Form('TBS'), notes:str=Form(''), pdfs:list[UploadFile]=File(...)):
    u=require_action(request,'attendance.upload')
    if not pdfs: raise HTTPException(400,'Please select at least one PDF')
    token=secrets.token_urlsafe(12); ts=now(); staged=[]
    try:
        # Validate every file before creating database records, so one bad PDF cannot create a half-imported batch.
        for pdf in pdfs:
            if Path(pdf.filename or '').suffix.lower()!='.pdf': raise HTTPException(400,f'{pdf.filename}: attendance file must be PDF')
            rel,orig=save_upload(pdf,'attendance',{'.pdf'})
            try: info=pdf_info(BASE/rel)
            except Exception:
                (BASE/rel).unlink(missing_ok=True); raise
            staged.append((rel,orig,info,sha256_file(BASE/rel)))
        with connect() as con:
            cur=con.execute("INSERT INTO attendance_batches(batch_token,period,site,division,uploaded_by,created_at) VALUES(?,?,?,?,?,?)",(token,period,location or 'TBS',division or 'FMT',u['id'],ts)); batch_id=cur.lastrowid
            created=[]
            for rel,orig,info,checksum in staged:
                employee=Path(orig).stem.replace('_',' ').replace('-',' ').strip() or 'Attendance Document'
                cur=con.execute("INSERT INTO attendance(employee_name,division,location,period,notes,status,current_version,created_by,created_at,updated_at,batch_id,page_count,page_width,page_height) VALUES(?,?,?,?,?,'Uploaded',1,?,?,?,?,?,?,?)",
                    (employee,division or 'FMT',location or 'TBS',period,notes,u['id'],ts,ts,batch_id,info['page_count'],info['width'],info['height'])); aid=cur.lastrowid
                con.execute("INSERT INTO attendance_versions(attendance_id,version,file_path,original_name,notes,status,uploaded_by,uploaded_at,checksum) VALUES(?,?,?,?,?,'Uploaded',?,?,?)",(aid,1,rel,orig,'Original Upload',u['id'],ts,checksum)); created.append((aid,orig))
            con.commit()
        for aid,orig in created: audit(u['id'],'Upload','Attendance',str(aid),None,orig)
        if created:
            notify_event('ready_to_sign',count=len(created),period=period,division=division or 'FMT',location=location or 'TBS')
    except Exception:
        # If database creation did not complete, remove staged files that are not referenced.
        for rel,_,_,_ in staged:
            if not q('SELECT 1 FROM attendance_versions WHERE file_path=?',(rel,),one=True): (BASE/rel).unlink(missing_ok=True)
        raise
    destination=f"/attendance/signing?batch={token}"
    if wants_json(request): return JSONResponse({'ok':True,'uploaded':len(created),'batch':token,'redirect':destination})
    return RedirectResponse(destination,303)

@app.post('/attendance/{aid}/delete')
def attendance_delete(request:Request,aid:int):
    u=require_action(request,'attendance.delete')
    a=q('SELECT * FROM attendance WHERE id=?',(aid,),one=True)
    if not a: raise HTTPException(404,'Attendance document not found')
    files=[r['file_path'] for r in q('SELECT file_path FROM attendance_versions WHERE attendance_id=?',(aid,))]
    if a['signed_file_path']: files.append(a['signed_file_path'])
    audit(u['id'],'Delete','Attendance',str(aid),a['employee_name'],a['status'])
    execute('DELETE FROM attendance WHERE id=?',(aid,))
    for rel in set(files): remove_uploaded_file(rel)
    return RedirectResponse('/attendance?deleted=1',303)

@app.get('/attendance/signing', response_class=HTMLResponse)
def attendance_signing_workspace(request:Request,batch:str|None=None):
    u=require_action(request,'attendance.view')
    sql="SELECT a.*,v.original_name FROM attendance a JOIN attendance_versions v ON v.attendance_id=a.id AND v.version=a.current_version WHERE a.status IN ('Uploaded','Checking','Ready to Sign','Signed')"; p=[]
    if batch:
        sql += " AND a.batch_id=(SELECT id FROM attendance_batches WHERE batch_token=?)"; p.append(batch)
    sql += ' ORDER BY a.id DESC LIMIT 200'
    docs=[dict(r) for r in q(sql,p)]
    sigs=q("SELECT s.*,u.full_name owner_name FROM signatures s JOIN users u ON u.id=s.owner_id WHERE s.active=1 AND (s.owner_id=? OR s.visibility='Shared' OR (s.visibility='Role' AND (s.allowed_role=? OR s.allowed_role IS NULL))) ORDER BY s.is_default DESC,s.id DESC",(u['id'],u['role'])) if can(u,'signature.use') or can(u,'attendance.sign') else []
    placements=q("SELECT p.*,s.name signature_name,s.file_path FROM attendance_signature_placements p JOIN signatures s ON s.id=p.signature_id WHERE p.attendance_id IN (SELECT id FROM attendance WHERE status IN ('Uploaded','Checking','Ready to Sign','Signed')) ORDER BY p.id")
    plmap={}
    for r in placements: plmap.setdefault(r['attendance_id'],[]).append(dict(r))
    return page(request,'attendance_signing.html',docs=docs,signatures=sigs,placements=plmap,batch=batch)

@app.get('/attendance/{aid}/page/{page_no}.png')
def attendance_page_png(request:Request,aid:int,page_no:int):
    require_action(request,'attendance.view')
    v=q("SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1",(aid,),one=True)
    if not v: raise HTTPException(404)
    data=render_pdf_page(BASE/v['file_path'],page_no,zoom=1.4)
    return Response(content=data,media_type='image/png',headers={'Cache-Control':'private, max-age=120'})

@app.get('/attendance/{aid}/signed-preview/{page_no}.png')
def attendance_signed_preview(request:Request,aid:int,page_no:int):
    require_action(request,'attendance.view')
    v=q("SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1",(aid,),one=True)
    if not v: raise HTTPException(404)
    pls=[dict(r) for r in q("SELECT * FROM attendance_signature_placements WHERE attendance_id=?",(aid,))]
    if not pls: raise HTTPException(400,'Save a signature placement first')
    sigpaths={r['id']:BASE/r['file_path'] for r in q("SELECT * FROM signatures WHERE id IN (SELECT signature_id FROM attendance_signature_placements WHERE attendance_id=?)",(aid,))}
    # Generate a temporary signed PDF using the exact same save/reopen pipeline as final signing.
    # This makes Final Preview a faithful representation of output placement, including rotated pages.
    tmp=BASE/'uploads'/'attendance'/f'.preview-{aid}-{secrets.token_hex(6)}.pdf'
    try:
        sign_pdf(BASE/v['file_path'],tmp,pls,sigpaths)
        data=render_pdf_page(tmp,page_no,zoom=1.4)
    finally:
        tmp.unlink(missing_ok=True)
    return Response(content=data,media_type='image/png',headers={'Cache-Control':'no-store'})

def _save_placement_row(aid:int,sid:int,page_no:int,vals:dict,uid:int,placement_id:int|None=None,new_instance:bool=False)->tuple[int,bool,bool]:
    """Writes one placement row and returns (its id, whether it's confirmed, whether it's locked).
    `confirmed` gates signing (see signing_sign) and defaults to true for the ordinary single-
    placement flow so nothing changes for that case. `locked` is a separate, purely human-driven flag
    -- it starts false for every placement, including a brand-new confirmed one, and only ever becomes
    true through an explicit /api/signing/placement/confirm call (the confirm checkbox). Dragging or
    resizing a box never sets it, so a plain reposition-and-autosave never locks the box against
    itself -- confirmed defaulting to true is only about sign-eligibility, not about freezing position.
    A page can hold more than one placement for the same signature (e.g. the same signer stamped in
    two different approval boxes), so this is no longer a plain upsert keyed by
    (attendance_id,signature_id,page):
    - placement_id given: updates that exact row (must belong to aid) -- used whenever the caller
      already knows precisely which instance it's repositioning, which matters once a signature has
      more than one placement on the same page (otherwise an update-by-signature+page would be
      ambiguous about which of several instances to touch). Refuses to move a row that is locked --
      uncheck it first. Repositioning never changes confirmed or locked -- only
      /api/signing/placement/confirm does that.
    - new_instance=True (and no placement_id): always inserts a fresh row, even if this exact
      signature+page combination already has one or more placements -- this is how an extra instance
      of an already-placed signature gets created. Starts UNconfirmed and unlocked: an extra/duplicate
      instance is exactly the case a human should look at before it's trusted for signing (see
      signing_sign).
    - neither given: reproduces the original single-instance-per-signature-per-page behavior, for
      every caller that never needed to know about multiple instances (broadcast/apply-to-selected,
      apply-template, auto-detect, the per-page toggle grid) -- reuses the first existing row for
      (aid,sid,page) if one exists, else creates one at the column defaults (confirmed, unlocked).
    """
    ts=now()
    if placement_id:
        row=q('SELECT id,confirmed,locked FROM attendance_signature_placements WHERE id=? AND attendance_id=?',(placement_id,aid),one=True)
        if not row: raise HTTPException(404,'Signature placement not found')
        if row['locked']: raise HTTPException(400,'This signature placement is locked -- uncheck it before moving it')
        execute("UPDATE attendance_signature_placements SET signature_id=?,page=?,nx=?,ny=?,nw=?,nh=?,updated_at=? WHERE id=?",
                (sid,page_no,vals['nx'],vals['ny'],vals['nw'],vals['nh'],ts,placement_id))
        return placement_id,bool(row['confirmed']),bool(row['locked'])
    if not new_instance:
        existing=q('SELECT id,confirmed,locked FROM attendance_signature_placements WHERE attendance_id=? AND signature_id=? AND page=? ORDER BY id ASC LIMIT 1',(aid,sid,page_no),one=True)
        if existing:
            execute("UPDATE attendance_signature_placements SET nx=?,ny=?,nw=?,nh=?,created_by=?,updated_at=? WHERE id=?",
                    (vals['nx'],vals['ny'],vals['nw'],vals['nh'],uid,ts,existing['id']))
            return existing['id'],bool(existing['confirmed']),bool(existing['locked'])
        new_id=execute("INSERT INTO attendance_signature_placements(attendance_id,signature_id,page,nx,ny,nw,nh,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (aid,sid,page_no,vals['nx'],vals['ny'],vals['nw'],vals['nh'],uid,ts))
        return new_id,True,False
    new_id=execute("INSERT INTO attendance_signature_placements(attendance_id,signature_id,page,nx,ny,nw,nh,confirmed,locked,created_by,updated_at) VALUES(?,?,?,?,?,?,?,0,0,?,?)",
            (aid,sid,page_no,vals['nx'],vals['ny'],vals['nw'],vals['nh'],uid,ts))
    return new_id,False,False

@app.post('/api/signing/placement')
def signing_placement(request:Request,payload:dict=Body(...)):
    u=require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id')); sid=int(payload.get('signature_id')); page_no=int(payload.get('page',1))
    a=q('SELECT * FROM attendance WHERE id=?',(aid,),one=True); sig=q('SELECT * FROM signatures WHERE id=? AND active=1',(sid,),one=True)
    if not a or not sig: raise HTTPException(404,'Document or signature not found')
    if not (sig['owner_id']==u['id'] or sig['visibility']=='Shared' or (sig['visibility']=='Role' and (not sig['allowed_role'] or sig['allowed_role']==u['role'])) or u['role']=='Administrator'):
        raise HTTPException(403,'You are not allowed to use this signature')
    vals={k:float(payload.get(k,0)) for k in ('nx','ny','nw','nh')}
    if vals['nw']<=0 or vals['nh']<=0 or vals['nx']<0 or vals['ny']<0 or vals['nx']+vals['nw']>1.000001 or vals['ny']+vals['nh']>1.000001: raise HTTPException(400,'Signature box is outside the page')
    av=q('SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(aid,),one=True)
    ainfo=pdf_info(BASE/av['file_path'])
    if page_no<1 or page_no>ainfo['page_count']: raise HTTPException(400,'Selected signature page does not exist')
    src_page=ainfo['pages'][page_no-1]; srcw=src_page['width']; srch=src_page['height']
    placement_id_in=payload.get('placement_id')
    placement_id,confirmed,locked=_save_placement_row(aid,sid,page_no,vals,u['id'],placement_id=int(placement_id_in) if placement_id_in else None,new_instance=bool(payload.get('new_instance')))
    if payload.get('remember'):
        execute("INSERT INTO signature_position_templates(signature_id,page_count,page_width,page_height,page,nx,ny,nw,nh,label,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'Saved position',?,?) ON CONFLICT(signature_id,page_count,page_width,page_height,page) DO UPDATE SET nx=excluded.nx,ny=excluded.ny,nw=excluded.nw,nh=excluded.nh,updated_at=excluded.updated_at",
                (sid,ainfo['page_count'],round(srcw,2),round(srch,2),page_no,vals['nx'],vals['ny'],vals['nw'],vals['nh'],u['id'],now()))
    # Apply only when the destination page itself has the same displayed dimensions. A page can
    # hold more than one instance of the SAME signature (the same signer stamped in two different
    # spots), so broadcast targets are matched by ORDINAL rather than blindly reusing whichever
    # instance happens to be found first: this source placement's position among every instance of
    # this signature on this source page (1st, 2nd, ...) is matched to that same ordinal position
    # among the target document's own instances, updating it if one already exists at that ordinal
    # or adding a new one otherwise. Without this, broadcasting a second instance of the same
    # signature (e.g. dragging the top one, then the bottom one, to the same batch of documents)
    # silently overwrote the first instance's row on every target instead of creating a second one
    # there too -- on the target document the two ended up "tertimpa", collapsed into a single
    # placement sitting at whichever position was broadcast most recently.
    source_siblings=[r['id'] for r in q('SELECT id FROM attendance_signature_placements WHERE attendance_id=? AND signature_id=? AND page=? ORDER BY id ASC',(aid,sid,page_no))]
    try: ordinal=source_siblings.index(placement_id)
    except ValueError: ordinal=0
    applied=[aid]; mismatched=[]
    for x in payload.get('apply_ids') or []:
        x=int(x)
        if x==aid: continue
        b=q('SELECT id FROM attendance WHERE id=?',(x,),one=True)
        bv=q('SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(x,),one=True) if b else None
        if not bv: continue
        try: binfo=pdf_info(BASE/bv['file_path'])
        except Exception: mismatched.append(x); continue
        if binfo['page_count']==ainfo['page_count'] and page_no<=binfo['page_count'] and abs(binfo['pages'][page_no-1]['width']-srcw)<1 and abs(binfo['pages'][page_no-1]['height']-srch)<1:
            target_siblings=[r['id'] for r in q('SELECT id FROM attendance_signature_placements WHERE attendance_id=? AND signature_id=? AND page=? ORDER BY id ASC',(x,sid,page_no))]
            try:
                if ordinal<len(target_siblings):
                    _save_placement_row(x,sid,page_no,vals,u['id'],placement_id=target_siblings[ordinal])
                elif target_siblings:
                    # Target already has some instance(s) of this signature on this page, but fewer
                    # than this ordinal -- add a new one instead of colliding with an existing
                    # lower-ordinal instance that belongs to a different source placement.
                    _save_placement_row(x,sid,page_no,vals,u['id'],new_instance=True)
                else:
                    _save_placement_row(x,sid,page_no,vals,u['id'])
                applied.append(x)
            except HTTPException:
                # Most likely the matched target instance is locked -- leave it untouched rather
                # than aborting the whole broadcast for every other selected document.
                mismatched.append(x)
        else: mismatched.append(x)
    mismatched_names=doc_names(mismatched)
    return {'ok':True,'placement_id':placement_id,'confirmed':confirmed,'locked':locked,'applied':applied,'mismatched':mismatched,'mismatched_names':mismatched_names}

@app.post('/api/signing/placement/confirm')
def signing_placement_confirm(request:Request,payload:dict=Body(...)):
    """Toggles the confirm checkbox on one specific placement instance -- the only thing in the app
    that sets `locked` (freezing its position against further dragging) and, together with it,
    `confirmed` (the sign-time eligibility flag -- see signing_sign, which refuses to sign a document
    that still has any unconfirmed placement). The two always move together here: checking the box
    means "this position is reviewed and OK, don't touch it again," so it locks AND confirms in one
    step; unchecking reverses both, freeing it to be dragged again but also pulling it back out of
    signing until it's reviewed and checked again. Plain dragging/resizing never calls this endpoint
    and never changes either flag -- only this explicit, human-initiated action does."""
    u=require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id')); placement_id=int(payload.get('placement_id'))
    row=q('SELECT id FROM attendance_signature_placements WHERE id=? AND attendance_id=?',(placement_id,aid),one=True)
    if not row: raise HTTPException(404,'Signature placement not found')
    flag=1 if payload.get('confirmed') else 0
    execute("UPDATE attendance_signature_placements SET confirmed=?,locked=?,updated_at=? WHERE id=?",(flag,flag,now(),placement_id))
    return {'ok':True,'placement_id':placement_id,'confirmed':bool(flag),'locked':bool(flag)}

@app.post('/api/signing/apply-template')
def apply_signature_template(request:Request,payload:dict=Body(...)):
    u=require_action(request,'attendance.sign'); sid=int(payload.get('signature_id')); ids=[int(x) for x in payload.get('attendance_ids') or []]
    applied=[]; mismatched=[]; applied_placements=[]
    for aid in ids:
        a=q('SELECT id FROM attendance WHERE id=?',(aid,),one=True)
        v=q('SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(aid,),one=True) if a else None
        if not v: continue
        try: info=pdf_info(BASE/v['file_path'])
        except Exception: mismatched.append(aid); continue
        candidates=q("SELECT * FROM signature_position_templates WHERE signature_id=? AND page_count=? ORDER BY updated_at DESC",(sid,info['page_count']))
        t=None
        for cand in candidates:
            pn=int(cand['page'])
            if 1<=pn<=info['page_count'] and abs(info['pages'][pn-1]['width']-cand['page_width'])<1 and abs(info['pages'][pn-1]['height']-cand['page_height'])<1:
                t=cand; break
        if not t: mismatched.append(aid); continue
        vals={'nx':t['nx'],'ny':t['ny'],'nw':t['nw'],'nh':t['nh']}
        _save_placement_row(aid,sid,t['page'],vals,u['id']); applied.append(aid); applied_placements.append({'attendance_id':aid,'signature_id':sid,'page':t['page'],'nx':t['nx'],'ny':t['ny'],'nw':t['nw'],'nh':t['nh']})
    mismatched_names=doc_names(mismatched)
    return {'ok':True,'applied':applied,'mismatched':mismatched,'mismatched_names':mismatched_names,'placements':applied_placements}

@app.post('/api/signing/suggest-position')
def signing_suggest_position(request:Request,payload:dict=Body(...)):
    """Read-only helper for the signing workspace: given a document and a signature, return
    a previously saved position template that matches this document's page layout (same
    matching logic as apply-template), WITHOUT writing anything. Lets the UI pre-fill the
    draggable signature box automatically so a repeat layout doesn't require re-dragging;
    the user still has to click Save Placement to actually persist it."""
    require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id')); sid=int(payload.get('signature_id'))
    v=q('SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(aid,),one=True)
    if not v: raise HTTPException(404,'Document not found')
    try: info=pdf_info(BASE/v['file_path'])
    except Exception: return {'ok':True,'found':False}
    candidates=q("SELECT * FROM signature_position_templates WHERE signature_id=? AND page_count=? ORDER BY updated_at DESC",(sid,info['page_count']))
    for cand in candidates:
        pn=int(cand['page'])
        if 1<=pn<=info['page_count'] and abs(info['pages'][pn-1]['width']-cand['page_width'])<1 and abs(info['pages'][pn-1]['height']-cand['page_height'])<1:
            return {'ok':True,'found':True,'page':pn,'nx':cand['nx'],'ny':cand['ny'],'nw':cand['nw'],'nh':cand['nh']}
    return {'ok':True,'found':False}

@app.post('/api/signing/same-layout')
def signing_same_layout(request:Request,payload:dict=Body(...)):
    """Read-only helper for the signing workspace: given a reference document/page and a
    list of candidate document ids, return which candidates share the exact same page
    layout (page count + width/height within 1px), using the identical tolerance already
    used when applying a placement to multiple selected PDFs. Does not modify any data."""
    require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id')); page_no=int(payload.get('page',1))
    candidate_ids=[int(x) for x in (payload.get('candidate_ids') or [])]
    av=q('SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(aid,),one=True)
    if not av: raise HTTPException(404,'Document not found')
    ainfo=pdf_info(BASE/av['file_path'])
    if page_no<1 or page_no>ainfo['page_count']: raise HTTPException(400,'Selected page does not exist')
    srcw=ainfo['pages'][page_no-1]['width']; srch=ainfo['pages'][page_no-1]['height']
    matches=[]
    for x in candidate_ids:
        if x==aid: matches.append(x); continue
        bv=q('SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(x,),one=True)
        if not bv: continue
        try: binfo=pdf_info(BASE/bv['file_path'])
        except Exception: continue
        if binfo['page_count']==ainfo['page_count'] and page_no<=binfo['page_count'] and abs(binfo['pages'][page_no-1]['width']-srcw)<1 and abs(binfo['pages'][page_no-1]['height']-srch)<1:
            matches.append(x)
    return {'ok':True,'matches':matches}

@app.post('/api/signing/detect-positions')
def signing_detect_positions(request:Request,payload:dict=Body(...)):
    """Read-only helper for the signing workspace: scans every page of a document for the
    given anchor keywords (e.g. 'Menyetujui', 'Mengetahui Atasan Langsung', configurable from
    the UI) and proposes a signature position directly below each confident match. Pages where
    the keyword is missing, appears more than once, or the page has no text layer at all (a
    scanned attachment) come back flagged for manual placement -- nothing is guessed for those.
    This endpoint does not save anything; the caller still saves each accepted page through the
    normal /api/signing/placement endpoint."""
    require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id'))
    keywords=[str(k) for k in (payload.get('keywords') or []) if str(k).strip()][:10]
    if not keywords: raise HTTPException(400,'At least one keyword is required')
    v=q('SELECT file_path FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(aid,),one=True)
    if not v: raise HTTPException(404,'Document not found')
    try: pages=detect_signature_positions(BASE/v['file_path'],keywords)
    except Exception: pages=[]
    return {'ok':True,'pages':pages}

@app.post('/api/signing/placement/remove')
def signing_placement_remove(request:Request,payload:dict=Body(...)):
    """Deletes saved signature placement(s) from a document, so a page that was placed manually,
    via auto-detect, or via apply-to-selected can be individually un-picked before signing. Does not
    touch the source PDF or any other page.
    Pass placement_id to delete exactly one specific instance -- the precise way to remove one of
    several placements of the same signature on the same page. Without placement_id, falls back to
    the legacy signature_id+page addressing and deletes every placement matching that pair (there is
    normally only one; if a page happens to hold more than one instance of that signature, all of
    them are removed, since the caller had no way to name a specific one)."""
    require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id'))
    a=q('SELECT id FROM attendance WHERE id=?',(aid,),one=True)
    if not a: raise HTTPException(404,'Document not found')
    placement_id_in=payload.get('placement_id')
    if placement_id_in:
        row=q('SELECT id FROM attendance_signature_placements WHERE id=? AND attendance_id=?',(int(placement_id_in),aid),one=True)
        if row: execute('DELETE FROM attendance_signature_placements WHERE id=?',(row['id'],))
        return {'ok':True,'removed':bool(row)}
    sid=int(payload.get('signature_id')); page_no=int(payload.get('page',0))
    rows=q('SELECT id FROM attendance_signature_placements WHERE attendance_id=? AND signature_id=? AND page=?',(aid,sid,page_no))
    for r in rows: execute('DELETE FROM attendance_signature_placements WHERE id=?',(r['id'],))
    return {'ok':True,'removed':bool(rows)}

@app.post('/api/signing/prune-pages')
def signing_prune_pages(request:Request,payload:dict=Body(...)):
    """Keeps only the given page numbers signed for a document: deletes every saved placement
    on that document whose page is NOT in the provided list. Lets a batch that only needs, say,
    3 of a 5-page PDF signed be pruned down in one action instead of removing pages one at a
    time. Pages not currently placed are simply ignored (nothing to remove); at least one valid
    page number is required so this can't silently wipe every placement by an empty submit."""
    require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id'))
    a=q('SELECT page_count FROM attendance WHERE id=?',(aid,),one=True)
    if not a: raise HTTPException(404,'Document not found')
    pc=int(a['page_count'] or 1)
    raw_pages=payload.get('pages') or []
    pages=sorted({int(p) for p in raw_pages if isinstance(p,(int,float)) or (isinstance(p,str) and p.strip().lstrip('-').isdigit())})
    invalid=[p for p in pages if p<1 or p>pc]
    if invalid: raise HTTPException(400,f'Page(s) {", ".join(str(p) for p in invalid)} do not exist in this document (1-{pc})')
    if not pages: raise HTTPException(400,'Enter at least one page number to keep')
    existing=[dict(r) for r in q('SELECT page FROM attendance_signature_placements WHERE attendance_id=?',(aid,))]
    existing_pages=sorted({int(r['page']) for r in existing})
    to_remove=[p for p in existing_pages if p not in pages]
    if to_remove:
        placeholders=','.join('?'*len(to_remove))
        execute(f'DELETE FROM attendance_signature_placements WHERE attendance_id=? AND page IN ({placeholders})',(aid,*to_remove))
    remaining=[p for p in existing_pages if p in pages]
    return {'ok':True,'kept':pages,'removed_pages':to_remove,'remaining_pages':remaining}

@app.post('/api/signing/apply-page-range')
def signing_apply_page_range(request:Request,payload:dict=Body(...)):
    """Copies EVERY placement currently on one page of a document (source_page) onto a set of
    OTHER pages of the same document (target_pages), each at its own already-saved position.
    Fixes a real gap in the per-signature page grid above this control: that grid only ever
    adds/removes whichever ONE signature is currently selected in the dropdown, so a page holding
    two different signatures (e.g. "Menyetujui" + "Mengetahui Atasan Langsung") only ever got one
    of them carried across a page range -- the other silently stayed behind on the source page.
    This endpoint instead looks at every placement actually on source_page and replicates each one.
    Purely additive: an existing placement is left completely untouched (never overwritten, resized,
    or removed) -- nothing is ever removed by this action, unlike prune-pages above.
    A target page is only ever skipped for one specific source placement when that EXACT
    signature+position combination already sits there -- not merely because the signature appears
    somewhere on that page. This matters because a page can hold more than one instance of the SAME
    signature (e.g. the same person signing two separate sections stacked on one page, one placement
    near the top and another near the bottom): keying "already has this signature" by signature_id
    alone would treat the second instance as a duplicate of the first the moment the first one was
    copied, silently dropping it from every target page instead of carrying both positions across."""
    u=require_action(request,'attendance.sign')
    aid=int(payload.get('attendance_id'))
    a=q('SELECT page_count FROM attendance WHERE id=?',(aid,),one=True)
    if not a: raise HTTPException(404,'Document not found')
    pc=int(a['page_count'] or 1)
    source_page=int(payload.get('source_page',0))
    if source_page<1 or source_page>pc: raise HTTPException(400,f'Source page does not exist in this document (1-{pc})')
    raw_targets=payload.get('target_pages') or []
    targets=sorted({int(p) for p in raw_targets if isinstance(p,(int,float)) or (isinstance(p,str) and p.strip().lstrip('-').isdigit())})
    targets=[p for p in targets if p!=source_page]
    invalid=[p for p in targets if p<1 or p>pc]
    if invalid: raise HTTPException(400,f'Page(s) {", ".join(str(p) for p in invalid)} do not exist in this document (1-{pc})')
    if not targets: raise HTTPException(400,'Enter at least one target page other than the source page')
    source_rows=[dict(r) for r in q('SELECT * FROM attendance_signature_placements WHERE attendance_id=? AND page=?',(aid,source_page))]
    if not source_rows: raise HTTPException(400,'The source page has no signature placements to copy')
    def poskey(sid,pg,nx,ny,nw,nh): return (int(sid),int(pg),round(float(nx),4),round(float(ny),4),round(float(nw),4),round(float(nh),4))
    existing_keys={poskey(r['signature_id'],r['page'],r['nx'],r['ny'],r['nw'],r['nh']) for r in q('SELECT signature_id,page,nx,ny,nw,nh FROM attendance_signature_placements WHERE attendance_id=?',(aid,))}
    ts=now(); copied=[]; skipped=0
    for p in targets:
        for row in source_rows:
            sid=int(row['signature_id'])
            key=poskey(sid,p,row['nx'],row['ny'],row['nw'],row['nh'])
            if key in existing_keys:
                skipped+=1; continue
            new_id=execute("INSERT INTO attendance_signature_placements(attendance_id,signature_id,page,nx,ny,nw,nh,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (aid,sid,p,row['nx'],row['ny'],row['nw'],row['nh'],u['id'],ts))
            existing_keys.add(key)
            copied.append({'id':new_id,'signature_id':sid,'page':p,'nx':row['nx'],'ny':row['ny'],'nw':row['nw'],'nh':row['nh'],'confirmed':1,'locked':0})
    return {'ok':True,'source_page':source_page,'target_pages':targets,'signatures_on_source':len(source_rows),'copied':copied,'skipped':skipped}

@app.post('/api/signing/sign')
def signing_sign(request:Request,payload:dict=Body(...)):
    u=require_action(request,'attendance.sign_bulk'); ids=[int(x) for x in payload.get('attendance_ids') or []]
    if not ids: raise HTTPException(400,'Select at least one PDF')
    name_by_id=doc_names_map(ids)
    results=[]
    for aid in ids:
        try:
            a=q('SELECT * FROM attendance WHERE id=?',(aid,),one=True)
            if not a: raise HTTPException(404,'Document not found')
            if a['status'] in ('Final','Archived'): raise HTTPException(400,'Final document is locked')
            v=q('SELECT * FROM attendance_versions WHERE attendance_id=? ORDER BY version DESC LIMIT 1',(aid,),one=True)
            pls=[dict(r) for r in q('SELECT * FROM attendance_signature_placements WHERE attendance_id=? ORDER BY page,id',(aid,))]
            if not pls: raise HTTPException(400,'Signature position is not configured')
            unconfirmed=[p for p in pls if not p['confirmed']]
            if unconfirmed: raise HTTPException(400,f"{len(unconfirmed)} signature placement(s) are not yet confirmed -- check them in the workspace before signing this document")
            sigpaths={r['id']:BASE/r['file_path'] for r in q("SELECT * FROM signatures WHERE id IN (SELECT signature_id FROM attendance_signature_placements WHERE attendance_id=?)",(aid,))}
            out_rel=f"uploads/attendance/signed/{aid}-{secrets.token_hex(6)}.pdf"; out=BASE/out_rel
            verify=sign_pdf(BASE/v['file_path'],out,pls,sigpaths)
            ver=int(a['current_version'])+1; ts=now()
            execute("INSERT INTO attendance_versions(attendance_id,version,file_path,original_name,notes,status,uploaded_by,uploaded_at,checksum) VALUES(?,?,?,?,?,'Signed',?,?,?)",
                    (aid,ver,out_rel,f"SIGNED-{v['original_name']}",'Signed from visual placement workspace',u['id'],ts,verify['checksum']))
            execute("UPDATE attendance SET current_version=?,status='Signed',signed_file_path=?,final_checksum=?,signed_by=?,signed_at=?,updated_at=? WHERE id=?",(ver,out_rel,verify['checksum'],u['id'],ts,ts,aid))
            for pl in pls:
                execute("INSERT INTO attendance_sign_events(attendance_id,version,signature_id,page,nx,ny,nw,nh,signed_by,signed_at,checksum) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(aid,ver,pl['signature_id'],pl['page'],pl['nx'],pl['ny'],pl['nw'],pl['nh'],u['id'],ts,verify['checksum']))
            execute("DELETE FROM attendance_signature_placements WHERE attendance_id=?",(aid,))
            audit(u['id'],'Sign PDF','Attendance',str(aid),None,verify['checksum']); results.append({'id':aid,'name':name_by_id.get(aid),'ok':True,'checksum':verify['checksum']})
        except Exception as exc:
            detail=exc.detail if isinstance(exc,HTTPException) else str(exc)
            results.append({'id':aid,'name':name_by_id.get(aid),'ok':False,'error':detail})
    ok=sum(1 for r in results if r['ok'])
    return {'ok':ok==len(results),'signed':ok,'failed':len(results)-ok,'results':results}

@app.post('/attendance/{aid}/finalize')
def attendance_finalize(request:Request,aid:int):
    u=require_action(request,'attendance.finalize'); a=q('SELECT * FROM attendance WHERE id=?',(aid,),one=True)
    if not a: raise HTTPException(404)
    if a['status']!='Signed' or not a['signed_file_path'] or not a['final_checksum']: raise HTTPException(400,'Only a verified Signed PDF can be finalized')
    if sha256_file(BASE/a['signed_file_path'])!=a['final_checksum']: raise HTTPException(409,'Signed PDF integrity check failed')
    execute("UPDATE attendance SET status='Final',updated_at=? WHERE id=?",(now(),aid)); execute("UPDATE attendance_versions SET status='Final' WHERE attendance_id=? AND version=?",(aid,a['current_version']))
    audit(u['id'],'Finalize','Attendance',str(aid),'Signed','Final'); return RedirectResponse(f'/attendance/{aid}',303)

@app.get("/attendance/{aid}", response_class=HTMLResponse)
def attendance_detail(request: Request, aid:int):
    u=current_user(request)
    if not u: return RedirectResponse("/login", 303)
    a=q("SELECT a.*,cr.full_name creator,rv.full_name reviewer,ap.full_name approver FROM attendance a LEFT JOIN users cr ON cr.id=a.created_by LEFT JOIN users rv ON rv.id=a.reviewer_id LEFT JOIN users ap ON ap.id=a.approver_id WHERE a.id=?",(aid,),one=True)
    if not a: raise HTTPException(404)
    versions=q("SELECT v.*,u.full_name uploader FROM attendance_versions v LEFT JOIN users u ON u.id=v.uploaded_by WHERE attendance_id=? ORDER BY version DESC",(aid,))
    findings=q("SELECT f.*,u.full_name creator FROM attendance_findings f LEFT JOIN users u ON u.id=f.created_by WHERE attendance_id=? ORDER BY resolved,page,id",(aid,))
    critical=q("SELECT COUNT(*) c FROM attendance_findings WHERE attendance_id=? AND severity='Critical' AND resolved=0",(aid,),one=True)['c']
    return page(request,"attendance_detail.html",a=a,versions=versions,findings=findings,critical=critical,transitions=allowed_attendance_transitions(u, a['status']))

@app.post("/attendance/{aid}/finding")
def add_finding(request:Request, aid:int, page_no:int=Form(...), category:str=Form(...), severity:str=Form(...), description:str=Form(...), comment:str=Form('')):
    u=require_action(request,'edit'); a=q("SELECT status FROM attendance WHERE id=?",(aid,),one=True)
    if not a: raise HTTPException(404)
    if a['status'] != 'Checking': raise HTTPException(400,'Findings can only be added while attendance is in Checking')
    execute("INSERT INTO attendance_findings(attendance_id,page,category,severity,description,comment,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",(aid,page_no,category,severity,description,comment,u['id'],now())); audit(u['id'],'Create Finding','Attendance',str(aid),None,f"p{page_no} {severity} {category}"); return RedirectResponse(f"/attendance/{aid}",303)

@app.post("/attendance/{aid}/finding/{fid}/resolve")
def resolve_finding(request:Request, aid:int, fid:int):
    u=require_action(request,'edit'); a=q("SELECT status FROM attendance WHERE id=?",(aid,),one=True)
    if not a: raise HTTPException(404)
    if a['status'] != 'Checking': raise HTTPException(400,'Findings can only be resolved while attendance is in Checking')
    f=q("SELECT id FROM attendance_findings WHERE id=? AND attendance_id=? AND resolved=0",(fid,aid),one=True)
    if not f: raise HTTPException(404,'Finding not found or already resolved')
    execute("UPDATE attendance_findings SET resolved=1,resolved_at=? WHERE id=? AND attendance_id=?",(now(),fid,aid)); audit(u['id'],'Resolve Finding','Attendance',str(aid),str(fid),'resolved'); return RedirectResponse(f"/attendance/{aid}",303)

@app.post("/attendance/{aid}/revision")
def attendance_revision(request:Request, aid:int, notes:str=Form(''), pdf:UploadFile=File(...)):
    u=require_action(request,'edit'); a=q("SELECT * FROM attendance WHERE id=?",(aid,),one=True)
    if not a: raise HTTPException(404)
    if a['status'] != 'Need Revision': raise HTTPException(400,'A new revision can only be uploaded when status is Need Revision')
    if Path(pdf.filename or '').suffix.lower()!='.pdf': raise HTTPException(400,'Revision must be PDF')
    rel,orig=save_upload(pdf,'attendance',{'.pdf'}); ver=a['current_version']+1; ts=now()
    execute("INSERT INTO attendance_versions(attendance_id,version,file_path,original_name,notes,status,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?)",(aid,ver,rel,orig,notes,'Checking',u['id'],ts))
    execute("UPDATE attendance SET current_version=?,status='Checking',updated_at=? WHERE id=?",(ver,ts,aid)); audit(u['id'],'Upload Revision','Attendance',str(aid),str(a['current_version']),str(ver)); return RedirectResponse(f"/attendance/{aid}",303)

@app.post("/attendance/{aid}/status")
def attendance_status(request:Request, aid:int, status:str=Form(...), note:str=Form('')):
    a=q("SELECT * FROM attendance WHERE id=?",(aid,),one=True)
    if not a: raise HTTPException(404)
    u=current_user(request)
    if not u: raise HTTPException(401)
    if status not in allowed_attendance_transitions(u, a['status']): raise HTTPException(403,'This role cannot perform that workflow transition')
    if status not in ATTENDANCE_TRANSITIONS.get(a['status'],set()): raise HTTPException(400,'Invalid workflow transition')
    if status in ('Need Revision','Rejected') and not note.strip(): raise HTTPException(400,'A note is required when requesting revision or rejecting')
    if status in ('Ready for Approval','Waiting Approval'):
        crit=q("SELECT COUNT(*) c FROM attendance_findings WHERE attendance_id=? AND severity='Critical' AND resolved=0",(aid,),one=True)['c']
        if crit: raise HTTPException(400,'Resolve all critical findings first')
    extra=""; vals=[status,now()]
    if status=='Approved': extra=",approver_id=?,approved_at=?"; vals += [u['id'],now()]
    elif status in ('Ready for Approval','Waiting Approval'): extra=",reviewer_id=?"; vals += [u['id']]
    vals.append(aid); execute(f"UPDATE attendance SET status=?,updated_at=?{extra} WHERE id=?",vals)
    execute("UPDATE attendance_versions SET status=? WHERE attendance_id=? AND version=?",(status,aid,a['current_version']))
    audit(u['id'],'Status Change','Attendance',str(aid),a['status'],status+(f" | {note}" if note else '')); return RedirectResponse(f"/attendance/{aid}",303)

# ---------------- Inventory helpers ----------------
INV = {
 'assets': dict(id='asset_id',name='asset_name',title='Asset FMT',photo_table='asset_photos',photo_fk='asset_id',folder='assets'),
 'tools': dict(id='tool_id',name='tool_name',title='Tools Inventory',photo_table='tool_photos',photo_fk='tool_id',folder='tools'),
}
@app.get("/inventory/{kind}", response_class=HTMLResponse)
def inventory_list(request:Request, kind:str, search:str='', pg:int=1):
    if kind not in INV: raise HTTPException(404)
    m=INV[kind]; sql=f"SELECT * FROM {kind} WHERE 1=1"; p=[]
    if search: sql += f" AND ({m['id']} LIKE ? OR {m['name']} LIKE ? OR category LIKE ? OR brand LIKE ? OR serial_number LIKE ? OR location LIKE ? OR pic LIKE ? OR notes LIKE ?)"; p += [f"%{search}%"]*8
    sql += " ORDER BY id DESC"
    rows,pgmeta=paginate_query(sql,p,pg)
    # attach main photo
    out=[]
    for r in rows:
        d=dict(r); ph=q(f"SELECT file_path FROM {m['photo_table']} WHERE {m['photo_fk']}=? ORDER BY is_main DESC,id DESC LIMIT 1",(r['id'],),one=True); d['photo']=ph['file_path'] if ph else None; out.append(d)
    return page(request,"inventory_list.html",kind=kind,m=m,rows=out,search=search,pgmeta=pgmeta)

@app.post("/inventory/{kind}/save")
def inventory_save(request:Request, kind:str, ident:str=Form(...), name:str=Form(...), category:str=Form(''), brand:str=Form(''), serial_number:str=Form(''), location:str=Form(''), pic:str=Form(''), condition:str=Form('Good'), status:str=Form('Active'), notes:str=Form('')):
    if kind not in INV: raise HTTPException(404)
    m=INV[kind]; ts=now(); ident=ident.strip(); name=name.strip(); old=q(f"SELECT * FROM {kind} WHERE {m['id']}=?",(ident,),one=True)
    u=require_action(request,'edit' if old else 'create')
    if not ident or not name: raise HTTPException(400,'ID and name are required')
    if old:
        execute(f"UPDATE {kind} SET {m['name']}=?,category=?,brand=?,serial_number=?,location=?,pic=?,condition=?,status=?,notes=?,updated_at=? WHERE {m['id']}=?",(name,category,brand,serial_number,location,pic,condition,status,notes,ts,ident)); action='Update'
    else:
        execute(f"INSERT INTO {kind}({m['id']},{m['name']},category,brand,serial_number,location,pic,condition,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(ident,name,category,brand,serial_number,location,pic,condition,status,notes,ts,ts)); action='Create'
    audit(u['id'],action,m['title'],ident,None,name); return RedirectResponse(f"/inventory/{kind}",303)

@app.post("/inventory/{kind}/{rid}/photo")
def inventory_photo(request:Request, kind:str, rid:int, photo:UploadFile=File(...)):
    u=require_action(request,'edit');
    if kind not in INV: raise HTTPException(404)
    m=INV[kind]
    if not q(f"SELECT id FROM {kind} WHERE id=?",(rid,),one=True): raise HTTPException(404)
    rel,orig,_=save_image_upload(photo,m['folder']); has=q(f"SELECT id FROM {m['photo_table']} WHERE {m['photo_fk']}=? LIMIT 1",(rid,),one=True)
    execute(f"INSERT INTO {m['photo_table']}({m['photo_fk']},file_path,original_name,is_main,uploaded_at) VALUES(?,?,?,?,?)",(rid,rel,orig,0 if has else 1,now())); audit(u['id'],'Upload Photo',m['title'],str(rid),None,orig); return RedirectResponse(f"/inventory/{kind}",303)

@app.post('/inventory/{kind}/{rid}/delete')
def inventory_delete(request:Request,kind:str,rid:int):
    if kind not in INV: raise HTTPException(404)
    perm='asset.delete' if kind=='assets' else 'tools.delete'
    u=require_action(request,perm)
    m=INV[kind]; row=q(f'SELECT * FROM {kind} WHERE id=?',(rid,),one=True)
    if not row: raise HTTPException(404,f"{m['title']} record not found")
    photos=[r['file_path'] for r in q(f"SELECT file_path FROM {m['photo_table']} WHERE {m['photo_fk']}=?",(rid,))]
    audit(u['id'],'Delete',m['title'],row[m['id']],row[m['name']],None)
    execute(f'DELETE FROM {kind} WHERE id=?',(rid,))
    for rel in photos: remove_uploaded_file(rel)
    return RedirectResponse(f'/inventory/{kind}?deleted=1',303)

@app.post("/inventory/{kind}/import-preview", response_class=HTMLResponse)
def inventory_import_preview(request:Request, kind:str, excel:UploadFile=File(...)):
    u=require_action(request,'import')
    if kind not in INV: raise HTTPException(404)
    ext=Path(excel.filename or '').suffix.lower()
    if ext not in {'.xlsx','.xlsm'}: raise HTTPException(400,'Please upload XLSX/XLSM')
    rel,orig=save_upload(excel,'import-temp',{'.xlsx','.xlsm'}); path=BASE/rel
    try: preview=preview_inventory_xlsx(path)
    except Exception:
        path.unlink(missing_ok=True); raise
    token=secrets.token_urlsafe(24)
    execute("INSERT INTO import_jobs(token,user_id,kind,file_path,original_name,created_at) VALUES(?,?,?,?,?,?)",(token,u['id'],kind,rel,orig,now()))
    m=INV[kind]; fields=[m['id'],m['name'],'category','brand','serial_number','location','pic','condition','status','notes']
    return page(request,'import_preview.html',token=token,kind=kind,title=m['title'],fields=fields,preview=preview)

@app.get("/inventory/{kind}/export")
def inventory_export(request:Request, kind:str):
    require_action(request,'export');
    if kind not in INV: raise HTTPException(404)
    m=INV[kind]; fields=[m['id'],m['name'],'category','brand','serial_number','location','pic','condition','status','notes']; wb=export_inventory_xlsx(kind,fields,[f.replace('_',' ').title() for f in fields]); bio=BytesIO(); wb.save(bio); bio.seek(0)
    return StreamingResponse(bio,media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers={'Content-Disposition':f'attachment; filename="FMT-{kind}.xlsx"'})

# ---------------- Consumables ----------------
@app.get("/consumables", response_class=HTMLResponse)
def consumables(request:Request, search:str='', low:int=0, pg:int=1):
    sql="SELECT * FROM consumables WHERE 1=1"; p=[]
    if search: sql += " AND (item_id LIKE ? OR item_name LIKE ? OR category LIKE ? OR location LIKE ?)"; p += [f"%{search}%"]*4
    if low: sql += " AND current_stock<=minimum_stock"
    sql += " ORDER BY (current_stock<=minimum_stock) DESC,id DESC"
    rows,pgmeta=paginate_query(sql,p,pg)
    return page(request,"consumables.html",rows=rows,search=search,low=low,pgmeta=pgmeta)

@app.post("/consumables/save")
def consumable_save(request:Request, item_id:str=Form(...), item_name:str=Form(...), category:str=Form(''), unit:str=Form(''), location:str=Form(''), current_stock:float=Form(0), minimum_stock:float=Form(0), notes:str=Form('')):
    item_id=item_id.strip(); item_name=item_name.strip(); old=q("SELECT * FROM consumables WHERE item_id=?",(item_id,),one=True); u=require_action(request,'edit' if old else 'create'); ts=now()
    if not item_id or not item_name: raise HTTPException(400,'Item ID and item name are required')
    if current_stock < 0 or minimum_stock < 0: raise HTTPException(400,'Stock values cannot be negative')
    if old: execute("UPDATE consumables SET item_name=?,category=?,unit=?,location=?,minimum_stock=?,notes=?,updated_at=? WHERE item_id=?",(item_name,category,unit,location,minimum_stock,notes,ts,item_id)); action='Update'
    else: execute("INSERT INTO consumables(item_id,item_name,category,unit,location,current_stock,minimum_stock,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",(item_id,item_name,category,unit,location,current_stock,minimum_stock,notes,ts,ts)); action='Create'
    audit(u['id'],action,'Consumables',item_id,None,item_name); return RedirectResponse('/consumables',303)

@app.post("/consumables/{cid}/stock")
def stock_tx(request:Request,cid:int,transaction_type:str=Form(...),quantity:float=Form(...),notes:str=Form('')):
    u=require_action(request,'edit'); qty=float(quantity); ts=now()
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        c=con.execute("SELECT * FROM consumables WHERE id=?",(cid,)).fetchone()
        if not c: raise HTTPException(404)
        before=float(c['current_stock'])
        if transaction_type=='Stock In': after=before+abs(qty)
        elif transaction_type=='Stock Out':
            after=before-abs(qty)
            if after<0: raise HTTPException(400,'Stock cannot be negative')
        elif transaction_type=='Adjustment':
            if qty < 0: raise HTTPException(400,'Adjusted stock cannot be negative')
            after=qty
        else: raise HTTPException(400,'Invalid stock transaction')
        con.execute("UPDATE consumables SET current_stock=?,updated_at=? WHERE id=?",(after,ts,cid))
        con.execute("INSERT INTO stock_transactions(consumable_id,transaction_type,quantity,before_stock,after_stock,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",(cid,transaction_type,qty,before,after,notes,u['id'],ts))
    audit(u['id'],transaction_type,'Consumables',c['item_id'],str(before),str(after))
    minimum=float(c['minimum_stock'])
    if after<=minimum and before>minimum:
        notify_event('low_stock',item_name=c['item_name'],item_id=c['item_id'],current_stock=after,unit=c['unit'] or '',minimum_stock=minimum)
    return RedirectResponse('/consumables',303)

@app.post("/consumables/{cid}/photo")
def consumable_photo(request:Request,cid:int,photo:UploadFile=File(...)):
    u=require_action(request,'edit')
    if not q("SELECT id FROM consumables WHERE id=?",(cid,),one=True): raise HTTPException(404)
    rel,orig,_=save_image_upload(photo,'consumables'); execute("UPDATE consumables SET photo_path=?,updated_at=? WHERE id=?",(rel,now(),cid)); audit(u['id'],'Upload Photo','Consumables',str(cid),None,orig); return RedirectResponse('/consumables',303)

@app.post('/consumables/{cid}/delete')
def consumable_delete(request:Request,cid:int):
    u=require_action(request,'consumable.delete')
    row=q('SELECT * FROM consumables WHERE id=?',(cid,),one=True)
    if not row: raise HTTPException(404,'Consumable not found')
    audit(u['id'],'Delete','Consumables',row['item_id'],row['item_name'],None)
    execute('DELETE FROM consumables WHERE id=?',(cid,))
    remove_uploaded_file(row['photo_path'])
    return RedirectResponse('/consumables?deleted=1',303)

@app.post("/consumables/import-preview", response_class=HTMLResponse)
def consumables_import_preview(request:Request,excel:UploadFile=File(...)):
    u=require_action(request,'import'); ext=Path(excel.filename or '').suffix.lower()
    if ext not in {'.xlsx','.xlsm'}: raise HTTPException(400,'Please upload XLSX/XLSM')
    rel,orig=save_upload(excel,'import-temp',{'.xlsx','.xlsm'}); path=BASE/rel
    try: preview=preview_inventory_xlsx(path)
    except Exception:
        path.unlink(missing_ok=True); raise
    token=secrets.token_urlsafe(24)
    execute("INSERT INTO import_jobs(token,user_id,kind,file_path,original_name,created_at) VALUES(?,?,?,?,?,?)",(token,u['id'],'consumables',rel,orig,now()))
    fields=['item_id','item_name','category','unit','location','current_stock','minimum_stock','notes']
    return page(request,'import_preview.html',token=token,kind='consumables',title='Tools Consumable',fields=fields,preview=preview)

@app.get("/consumables/export")
def consumables_export(request:Request):
    require_action(request,'export'); fields=['item_id','item_name','category','unit','location','current_stock','minimum_stock','notes']; wb=export_inventory_xlsx('consumables',fields,[f.replace('_',' ').title() for f in fields]); bio=BytesIO(); wb.save(bio); bio.seek(0); return StreamingResponse(bio,media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers={'Content-Disposition':'attachment; filename="FMT-consumables.xlsx"'})

@app.post("/imports/{token}/commit", response_class=HTMLResponse)
async def import_commit(request:Request,token:str):
    u=require_action(request,'import')
    job=q("SELECT * FROM import_jobs WHERE token=?",(token,),one=True)
    if not job: raise HTTPException(404,'Import preview expired or not found')
    if job['user_id'] != u['id'] and not can(u,'admin'): raise HTTPException(403)
    path=BASE/job['file_path']
    if not path.is_file(): raise HTTPException(404,'Staged import file is missing')
    form=await request.form(); kind=job['kind']
    if kind in INV:
        m=INV[kind]; id_col,name_col=m['id'],m['name']; title=m['title']; fields=[id_col,name_col,'category','brand','serial_number','location','pic','condition','status','notes']
    elif kind=='consumables':
        id_col,name_col='item_id','item_name'; title='Tools Consumable'; fields=['item_id','item_name','category','unit','location','current_stock','minimum_stock','notes']
    else: raise HTTPException(400,'Invalid import type')
    mapping={f:str(form.get('map_'+f,'')).strip() for f in fields if str(form.get('map_'+f,'')).strip()}
    if not mapping.get(id_col) or not mapping.get(name_col): raise HTTPException(400,'ID and Name columns must be mapped')
    try:
        result=inventory_import_xlsx(path,kind,id_col,name_col,mapping)
    finally:
        path.unlink(missing_ok=True); execute("DELETE FROM import_jobs WHERE token=?",(token,))
    audit(u['id'],'Import Excel',title,None,None,str(result))
    return page(request,'import_result.html',title=title,result=result,back_url='/consumables' if kind=='consumables' else f'/inventory/{kind}')

# ---------------- Tickets ----------------
def next_ticket_id(ticket_type:str):
    prefix={'Change':'CHG','Incident':'INC','Problem':'PRB'}[ticket_type]; year=datetime.now().year; row=q("SELECT ticket_id FROM tickets WHERE ticket_id LIKE ? ORDER BY id DESC LIMIT 1",(f"{prefix}-{year}-%",),one=True); n=int(row['ticket_id'].split('-')[-1])+1 if row else 1; return f"{prefix}-{year}-{n:04d}"

@app.get("/tickets", response_class=HTMLResponse)
def tickets(request:Request,type:str|None=None,status:str|None=None,severity:str|None=None,search:str='',pg:int=1):
    sql="SELECT * FROM tickets WHERE 1=1"; p=[]
    for col,val in [('ticket_type',type),('status',status),('severity',severity)]:
        if val: sql+=f" AND {col}=?"; p.append(val)
    if search: sql += " AND (ticket_id LIKE ? OR title LIKE ? OR site LIKE ? OR location LIKE ? OR assigned_to LIKE ?)"; p += [f"%{search}%"]*5
    sql += " ORDER BY updated_at DESC"
    rows,pgmeta=paginate_query(sql,p,pg)
    return page(request,"tickets.html",rows=rows,type=type,status=status,severity=severity,search=search,pgmeta=pgmeta)

@app.post("/tickets/create")
def ticket_create(request:Request,ticket_type:str=Form(...),title:str=Form(...),category:str=Form(''),site:str=Form(''),location:str=Form(''),requested_by:str=Form(''),assigned_to:str=Form(''),priority:str=Form('Medium'),severity:str=Form(''),risk:str=Form(''),impact:str=Form(''),planned_start:str=Form(''),planned_end:str=Form(''),implementation_plan:str=Form(''),rollback_plan:str=Form(''),root_cause:str=Form(''),action_taken:str=Form(''),temporary_solution:str=Form(''),permanent_solution:str=Form(''),corrective_action:str=Form(''),preventive_action:str=Form(''),related_ticket:str=Form('')):
    u=require_action(request,'create')
    if ticket_type not in ('Change','Incident','Problem'): raise HTTPException(400,'Invalid ticket type')
    title=title.strip()
    if not title: raise HTTPException(400,'Ticket title is required')
    related_ticket=related_ticket.strip()
    if related_ticket and not q("SELECT id FROM tickets WHERE ticket_id=?",(related_ticket,),one=True): raise HTTPException(400,'Related ticket was not found')
    ts=now(); rid=None; tid=None
    for _ in range(5):
        tid=next_ticket_id(ticket_type)
        try:
            rid=execute("INSERT INTO tickets(ticket_id,ticket_type,title,category,site,location,requested_by,assigned_to,priority,severity,risk,impact,planned_start,planned_end,implementation_plan,rollback_plan,root_cause,action_taken,temporary_solution,permanent_solution,corrective_action,preventive_action,related_ticket,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(tid,ticket_type,title,category,site,location,requested_by,assigned_to,priority,severity,risk,impact,planned_start,planned_end,implementation_plan,rollback_plan,root_cause,action_taken,temporary_solution,permanent_solution,corrective_action,preventive_action,related_ticket,'Open',u['id'],ts,ts))
            break
        except sqlite3.IntegrityError:
            continue
    if rid is None: raise HTTPException(409,'Could not allocate a unique Ticket ID. Please try again')
    execute("INSERT INTO ticket_activity(ticket_id,action,note,actor_id,created_at) VALUES(?,?,?,?,?)",(rid,'Ticket Created','',u['id'],ts)); audit(u['id'],'Create',f'{ticket_type} Ticket',tid,None,title)
    if ticket_type=='Incident' and severity=='Critical':
        notify_event('critical_incident',ticket_id=tid,title=title,site=site or '-')
    return RedirectResponse(f'/tickets/{rid}',303)

@app.get("/tickets/{rid}", response_class=HTMLResponse)
def ticket_detail(request:Request,rid:int):
    u=current_user(request)
    if not u: return RedirectResponse("/login", 303)
    t=q("SELECT t.*,u.full_name creator FROM tickets t LEFT JOIN users u ON u.id=t.created_by WHERE t.id=?",(rid,),one=True)
    if not t: raise HTTPException(404)
    acts=q("SELECT a.*,u.full_name actor FROM ticket_activity a LEFT JOIN users u ON u.id=a.actor_id WHERE ticket_id=? ORDER BY a.id DESC",(rid,)); atts=q("SELECT a.*,u.full_name uploader FROM ticket_attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE ticket_id=? ORDER BY a.id DESC",(rid,))
    return page(request,"ticket_detail.html",ticket=t,acts=acts,atts=atts,transitions=allowed_ticket_transitions(u, t['status']))

@app.post("/tickets/{rid}/status")
def ticket_status(request:Request,rid:int,status:str=Form(...),note:str=Form('')):
    t=q("SELECT * FROM tickets WHERE id=?",(rid,),one=True)
    if not t: raise HTTPException(404)
    u=current_user(request)
    if not u: raise HTTPException(401)
    if status not in allowed_ticket_transitions(u, t['status']): raise HTTPException(403,'This role cannot perform that workflow transition')
    if status not in TICKET_TRANSITIONS.get(t['status'],set()): raise HTTPException(400,'Invalid workflow transition')
    if status in ('Rejected','Revision Required','Cancelled') and not note.strip(): raise HTTPException(400,'A note is required for this status')
    ts=now(); execute("UPDATE tickets SET status=?,updated_at=? WHERE id=?",(status,ts,rid)); execute("INSERT INTO ticket_activity(ticket_id,action,note,actor_id,created_at) VALUES(?,?,?,?,?)",(rid,status,note,u['id'],ts)); audit(u['id'],'Status Change',f"{t['ticket_type']} Ticket",t['ticket_id'],t['status'],status)
    if status=='Waiting Approval':
        notify_event('approval_waiting',ticket_id=t['ticket_id'],title=t['title'])
    return RedirectResponse(f'/tickets/{rid}',303)

@app.post("/tickets/{rid}/attachment")
def ticket_attachment(request:Request,rid:int,description:str=Form(''),attachment:UploadFile=File(...)):
    u=require_action(request,'edit'); t=q("SELECT * FROM tickets WHERE id=?",(rid,),one=True)
    if not t: raise HTTPException(404)
    if t['status'] in ('Closed','Cancelled'): raise HTTPException(400,'Closed or cancelled tickets cannot receive new attachments')
    rel,orig=save_upload(attachment,'tickets',ALLOWED_TICKET); ts=now(); execute("INSERT INTO ticket_attachments(ticket_id,file_path,original_name,description,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?)",(rid,rel,orig,description,u['id'],ts)); execute("INSERT INTO ticket_activity(ticket_id,action,note,actor_id,created_at) VALUES(?,?,?,?,?)",(rid,'Attachment Uploaded',orig,u['id'],ts)); audit(u['id'],'Attachment',f"{t['ticket_type']} Ticket",t['ticket_id'],None,orig); return RedirectResponse(f'/tickets/{rid}',303)


@app.post('/tickets/{rid}/delete')
def ticket_delete(request:Request,rid:int):
    u=current_user(request)
    if not u: raise HTTPException(401)
    t=q('SELECT * FROM tickets WHERE id=?',(rid,),one=True)
    if not t: raise HTTPException(404,'Ticket not found')
    permission={'Change':'change.close','Incident':'incident.close','Problem':'problem.close'}.get(t['ticket_type'],'admin')
    require_action(request,permission)
    if u['role']!='Administrator' and t['status'] not in ('Draft','Open','Cancelled','Closed'):
        raise HTTPException(400,'Only an Administrator can delete a ticket that is inside an active controlled workflow')
    files=[r['file_path'] for r in q('SELECT file_path FROM ticket_attachments WHERE ticket_id=?',(rid,))]
    audit(u['id'],'Delete',f"{t['ticket_type']} Ticket",t['ticket_id'],t['title'],t['status'])
    execute('DELETE FROM tickets WHERE id=?',(rid,))
    for rel in files: remove_uploaded_file(rel)
    return RedirectResponse(f"/tickets?type={t['ticket_type']}&deleted=1",303)

@app.get("/reports", response_class=HTMLResponse)
def reports(request:Request, date_from:str='', date_to:str=''):
    import datetime as _dt
    stats={
      'attendance_total':q("SELECT COUNT(*) c FROM attendance",one=True)['c'],
      'attendance_approved':q("SELECT COUNT(*) c FROM attendance WHERE status='Approved'",one=True)['c'],
      'assets':q("SELECT COUNT(*) c FROM assets",one=True)['c'],
      'tools':q("SELECT COUNT(*) c FROM tools",one=True)['c'],
      'consumables':q("SELECT COUNT(*) c FROM consumables",one=True)['c'],
      'low':q("SELECT COUNT(*) c FROM consumables WHERE current_stock<=minimum_stock",one=True)['c'],
      'open_tickets':q("SELECT COUNT(*) c FROM tickets WHERE status NOT IN ('Closed','Cancelled')",one=True)['c'],
      'closed_tickets':q("SELECT COUNT(*) c FROM tickets WHERE status='Closed'",one=True)['c'],
    }
    today=_dt.date.today()
    try: d_to=_dt.date.fromisoformat(date_to) if date_to else today
    except ValueError: d_to=today
    try: d_from=_dt.date.fromisoformat(date_from) if date_from else (d_to-_dt.timedelta(days=29))
    except ValueError: d_from=d_to-_dt.timedelta(days=29)
    if d_from>d_to: d_from,d_to=d_to,d_from
    span=(d_to-d_from).days+1
    span=min(span,180)
    rows=q("SELECT substr(signed_at,1,10) d, COUNT(*) c FROM attendance WHERE signed_at IS NOT NULL AND substr(signed_at,1,10)>=? AND substr(signed_at,1,10)<=? GROUP BY d",(d_from.isoformat(),d_to.isoformat()))
    by_day={r['d']:r['c'] for r in rows}
    trend=[]
    for i in range(span):
        d=(d_from+_dt.timedelta(days=i)).isoformat()
        trend.append({'date':d,'count':by_day.get(d,0)})
    by_site=q("""
      SELECT site, SUM(signed) signed, SUM(tickets) tickets FROM (
        SELECT COALESCE(location,'-') site, COUNT(*) signed, 0 tickets FROM attendance WHERE signed_at IS NOT NULL AND substr(signed_at,1,10)>=? AND substr(signed_at,1,10)<=? GROUP BY location
        UNION ALL
        SELECT COALESCE(site,'-') site, 0 signed, COUNT(*) tickets FROM tickets WHERE substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? GROUP BY site
      ) GROUP BY site ORDER BY (signed+tickets) DESC
    """,(d_from.isoformat(),d_to.isoformat(),d_from.isoformat(),d_to.isoformat()))
    return page(request,'reports.html',stats=stats,trend=trend,by_site=by_site,date_from=d_from.isoformat(),date_to=d_to.isoformat())

@app.get("/users", response_class=HTMLResponse)
def users_page(request:Request, search:str='', role:str|None=None, status:str|None=None):
    require_action(request,'admin')
    sql="SELECT id,username,full_name,role,active,email,position,division,site,photo_path,last_login_at,created_at FROM users WHERE 1=1"; p=[]
    if search: sql+=" AND (full_name LIKE ? OR username LIKE ? OR email LIKE ? OR position LIKE ?)"; p += [f"%{search}%"]*4
    if role: sql+=" AND role=?"; p.append(role)
    if status=='Active': sql+=" AND active=1"
    elif status=='Disabled': sql+=" AND active=0"
    sql+=" ORDER BY id"
    return page(request,'users.html',rows=q(sql,p),search=search,role=role,status=status)

@app.post("/users/create")
def users_create(request:Request,username:str=Form(...),full_name:str=Form(...),password:str=Form(...),role:str=Form(...),email:str=Form(''),position:str=Form(''),division:str=Form('FMT'),site:str=Form('TBS')):
    u=require_action(request,'admin')
    if role not in ('Administrator','Staff','Approver','Viewer'): raise HTTPException(400,'Invalid role')
    if len(password)<5: raise HTTPException(400,'Password must contain at least 5 characters')
    try:
        execute("INSERT INTO users(username,full_name,password_hash,role,active,email,position,division,site,created_at) VALUES(?,?,?,?,1,?,?,?,?,?)",(username.strip(),full_name.strip(),hash_password(password),role,email.strip(),position.strip(),division.strip() or 'FMT',site.strip() or 'TBS',now()))
    except sqlite3.IntegrityError:
        raise HTTPException(400,'Username already exists')
    audit(u['id'],'Create User','Administration',username,None,role); return RedirectResponse('/users',303)

@app.post("/users/{uid}/toggle")
def users_toggle(request:Request,uid:int):
    u=require_action(request,'admin')
    if uid==u['id']: raise HTTPException(400,'You cannot disable your own account')
    target=q("SELECT * FROM users WHERE id=?",(uid,),one=True)
    if not target: raise HTTPException(404)
    new=0 if target['active'] else 1; execute("UPDATE users SET active=? WHERE id=?",(new,uid)); audit(u['id'],'Enable User' if new else 'Disable User','Administration',target['username'],str(target['active']),str(new)); return RedirectResponse('/users',303)

# ---------------- Admin / logs / files ----------------
@app.get("/activity", response_class=HTMLResponse)
def activity(request:Request,search:str='',pg:int=1):
    require_action(request,'audit.view') if not can(current_user(request),'admin') else require_action(request,'admin')
    sql="SELECT a.*,u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1"; p=[]
    if search: sql+=" AND (a.action LIKE ? OR a.module LIKE ? OR a.record_ref LIKE ? OR u.full_name LIKE ?)"; p += [f"%{search}%"]*4
    sql+=" ORDER BY a.id DESC"
    rows,pgmeta=paginate_query(sql,p,pg)
    return page(request,"activity.html",rows=rows,search=search,pgmeta=pgmeta)

@app.get("/profile", response_class=HTMLResponse)
def profile_page(request:Request):
    return page(request,"profile.html")

@app.post("/profile/password")
def change_password(request:Request,current_password:str=Form(...),new_password:str=Form(...),confirm_password:str=Form(...)):
    u=require_action(request,'view')
    if not verify_password(current_password,u['password_hash']): raise HTTPException(400,'Current password is incorrect')
    if len(new_password)<8: raise HTTPException(400,'New password must contain at least 8 characters')
    if new_password!=confirm_password: raise HTTPException(400,'Password confirmation does not match')
    execute("UPDATE users SET password_hash=? WHERE id=?",(hash_password(new_password),u['id']))
    execute("DELETE FROM sessions WHERE user_id=? AND token<>?",(u['id'],request.cookies.get(COOKIE,'')))
    audit(u['id'],'Change Password','Authentication',u['username'])
    return RedirectResponse('/profile?password=changed',303)

@app.post('/profile/update')
def profile_update(request:Request,full_name:str=Form(...),email:str=Form(''),phone:str=Form(''),position:str=Form(''),division:str=Form('FMT'),site:str=Form('TBS')):
    u=require_action(request,'profile.edit')
    execute("UPDATE users SET full_name=?,email=?,phone=?,position=?,division=?,site=? WHERE id=?",(full_name.strip(),email.strip(),phone.strip(),position.strip(),division.strip() or 'FMT',site.strip() or 'TBS',u['id']))
    audit(u['id'],'Update Profile','Administration',u['username']); return RedirectResponse('/profile?updated=1',303)

@app.post('/profile/photo')
def profile_photo(request:Request,photo:UploadFile=File(...)):
    u=require_action(request,'profile.edit'); rel,orig,_=save_image_upload(photo,'profiles')
    execute('UPDATE users SET photo_path=? WHERE id=?',(rel,u['id'])); audit(u['id'],'Update Profile Photo','Administration',u['username'],None,orig)
    return RedirectResponse('/profile?photo=updated',303)

@app.get('/users/{uid}',response_class=HTMLResponse)
def user_detail(request:Request,uid:int):
    require_action(request,'admin'); target=q('SELECT * FROM users WHERE id=?',(uid,),one=True)
    if not target: raise HTTPException(404)
    overrides={r['permission']:r['allowed'] for r in q('SELECT permission,allowed FROM user_permissions WHERE user_id=?',(uid,))}
    roleperms={r['permission'] for r in q('SELECT permission FROM role_permissions WHERE role=?',(target['role'],))}
    return page(request,'user_detail.html',target=target,permissions=PERMISSIONS,overrides=overrides,roleperms=roleperms)

@app.post('/users/{uid}/permissions')
async def user_permissions_save(request:Request,uid:int):
    u=require_action(request,'admin'); target=q('SELECT * FROM users WHERE id=?',(uid,),one=True)
    if not target: raise HTTPException(404)
    form=await request.form(); execute('DELETE FROM user_permissions WHERE user_id=?',(uid,))
    for perm in PERMISSIONS:
        mode=str(form.get('perm_'+perm,'inherit'))
        if mode in ('allow','deny'): execute('INSERT INTO user_permissions(user_id,permission,allowed) VALUES(?,?,?)',(uid,perm,1 if mode=='allow' else 0))
    audit(u['id'],'Update Permissions','Administration',target['username']); return RedirectResponse(f'/users/{uid}',303)

@app.post('/users/{uid}/update')
def user_update(request:Request,uid:int,full_name:str=Form(...),email:str=Form(''),position:str=Form(''),division:str=Form('FMT'),site:str=Form('TBS'),role:str=Form(...)):
    u=require_action(request,'admin')
    if role not in ('Administrator','Staff','Approver','Viewer'): raise HTTPException(400,'Invalid role')
    target=q('SELECT * FROM users WHERE id=?',(uid,),one=True)
    if not target: raise HTTPException(404)
    execute('UPDATE users SET full_name=?,email=?,position=?,division=?,site=?,role=? WHERE id=?',(full_name.strip(),email.strip(),position.strip(),division.strip(),site.strip(),role,uid))
    audit(u['id'],'Update User','Administration',target['username'],target['role'],role); return RedirectResponse(f'/users/{uid}',303)

@app.post('/users/{uid}/photo')
def user_photo(request:Request,uid:int,photo:UploadFile=File(...)):
    u=require_action(request,'admin'); target=q('SELECT * FROM users WHERE id=?',(uid,),one=True)
    if not target: raise HTTPException(404)
    rel,orig,_=save_image_upload(photo,'profiles'); execute('UPDATE users SET photo_path=? WHERE id=?',(rel,uid)); audit(u['id'],'Update User Photo','Administration',target['username'],None,orig)
    return RedirectResponse(f'/users/{uid}',303)

@app.post('/users/{uid}/reset-password')
def reset_user_password(request:Request,uid:int,password:str=Form(...)):
    u=require_action(request,'admin')
    if len(password)<5: raise HTTPException(400,'Password must contain at least 5 characters')
    target=q('SELECT * FROM users WHERE id=?',(uid,),one=True)
    if not target: raise HTTPException(404)
    execute('UPDATE users SET password_hash=? WHERE id=?',(hash_password(password),uid)); execute('DELETE FROM sessions WHERE user_id=?',(uid,)); audit(u['id'],'Reset Password','Administration',target['username'])
    return RedirectResponse(f'/users/{uid}',303)

@app.get('/roles',response_class=HTMLResponse)
def roles_page(request:Request):
    require_action(request,'admin'); matrix={}
    for role in ('Staff','Approver','Viewer'):
        matrix[role]={r['permission'] for r in q('SELECT permission FROM role_permissions WHERE role=?',(role,))}
    return page(request,'roles.html',permissions=PERMISSIONS,matrix=matrix,roles=['Staff','Approver','Viewer'])

@app.post('/roles')
async def roles_save(request:Request):
    u=require_action(request,'admin'); form=await request.form()
    with connect() as con:
        for role in ('Staff','Approver','Viewer'):
            con.execute('DELETE FROM role_permissions WHERE role=?',(role,))
            for perm in PERMISSIONS:
                if form.get(f'{role}:{perm}')=='on': con.execute('INSERT OR IGNORE INTO role_permissions(role,permission) VALUES(?,?)',(role,perm))
        con.commit()
    audit(u['id'],'Update Role Permissions','Administration','roles'); return RedirectResponse('/roles?saved=1',303)

@app.get('/signatures',response_class=HTMLResponse)
def signatures_page(request:Request, search:str='', status:str|None=None):
    u=require_action(request,'signature.view')
    sql=("SELECT s.*,usr.full_name owner_name FROM signatures s JOIN users usr ON usr.id=s.owner_id "
         "WHERE (s.owner_id=? OR s.visibility='Shared' OR (s.visibility='Role' AND (s.allowed_role=? OR s.allowed_role IS NULL)) OR ?='Administrator')")
    p=[u['id'],u['role'],u['role']]
    if search: sql+=" AND (s.name LIKE ? OR s.signer_name LIKE ? OR usr.full_name LIKE ?)"; p += [f"%{search}%"]*3
    if status=='Active': sql+=" AND s.active=1"
    elif status=='Disabled': sql+=" AND s.active=0"
    sql+=" ORDER BY s.is_default DESC,s.id DESC"
    rows=q(sql,p)
    return page(request,'signatures.html',rows=rows,search=search,status=status)

@app.post('/signatures/create')
def signature_create(request:Request,name:str=Form(...),signer_name:str=Form(...),visibility:str=Form('Private'),allowed_role:str=Form(''),is_default:int=Form(0),image:UploadFile=File(...)):
    u=require_action(request,'signature.create') if can(current_user(request),'signature.create') else require_action(request,'attendance.sign')
    if visibility not in ('Private','Role','Shared'): raise HTTPException(400,'Invalid signature visibility')
    rel,orig,_=save_image_upload(image,'signatures')
    if is_default: execute('UPDATE signatures SET is_default=0 WHERE owner_id=?',(u['id'],))
    sid=execute('INSERT INTO signatures(name,signer_name,owner_id,visibility,allowed_role,file_path,active,is_default,created_at) VALUES(?,?,?,?,?,?,1,?,?)',(name.strip(),signer_name.strip(),u['id'],visibility,allowed_role or None,rel,1 if is_default else 0,now()))
    audit(u['id'],'Create Signature','Signature',str(sid),None,orig); return RedirectResponse('/signatures',303)

@app.post('/signatures/{sid}/toggle')
def signature_toggle(request:Request,sid:int):
    u=require_action(request,'signature.manage') if can(current_user(request),'signature.manage') else require_action(request,'attendance.sign')
    sig=q('SELECT * FROM signatures WHERE id=?',(sid,),one=True)
    if not sig or (sig['owner_id']!=u['id'] and u['role']!='Administrator'): raise HTTPException(404)
    execute('UPDATE signatures SET active=? WHERE id=?',(0 if sig['active'] else 1,sid)); audit(u['id'],'Toggle Signature','Signature',str(sid)); return RedirectResponse('/signatures',303)

@app.post('/signatures/{sid}/delete')
def signature_delete(request:Request,sid:int):
    u=current_user(request)
    sig=q('SELECT * FROM signatures WHERE id=?',(sid,),one=True)
    if not sig: raise HTTPException(404,'Signature not found')
    if not (u and (u['role']=='Administrator' or (sig['owner_id']==u['id'] and (can(u,'signature.delete') or can(u,'signature.manage'))))):
        raise HTTPException(403,'You are not allowed to delete this signature')
    used=q('SELECT COUNT(*) c FROM attendance_sign_events WHERE signature_id=?',(sid,),one=True)['c']
    if used:
        raise HTTPException(409,'This signature is part of signed document history. Disable it instead so the audit trail remains intact.')
    audit(u['id'],'Delete','Signature',str(sid),sig['name'],None)
    execute('DELETE FROM signatures WHERE id=?',(sid,)); remove_uploaded_file(sig['file_path'])
    return RedirectResponse('/signatures?deleted=1',303)

@app.get('/brand/logo')
def brand_logo():
    row=q("SELECT value FROM settings WHERE key='logo'",one=True)
    candidates=[]
    if row and row['value']: candidates.append(BASE/row['value'])
    candidates.append(BASE/'uploads'/'branding'/'bdx.logo')
    # Bundled default BDX identity mark, used when no custom branding has been configured.
    candidates.append(BASE/'app'/'static'/'bdx-logo.png')
    for pth in candidates:
        if pth.is_file():
            try: mt=validate_image_file(pth)
            except Exception: mt='image/png' if pth.suffix.lower()=='.png' else 'application/octet-stream'
            return FileResponse(pth,media_type=mt,headers={'Cache-Control':'public, max-age=300'})
    raise HTTPException(404)

@app.get('/api/global-search')
def global_search(request:Request,qtext:str=''):
    u=require_action(request,'view'); term=(qtext or '').strip()
    if len(term)<2: return {'results':[]}
    like=f'%{term}%'; out=[]
    for r in q("SELECT id,employee_name,period,status FROM attendance WHERE employee_name LIKE ? OR period LIKE ? ORDER BY id DESC LIMIT 5",(like,like)):
        out.append({'type':'Attendance','title':r['employee_name'],'meta':f"{r['period']} • {r['status']}",'url':f"/attendance/{r['id']}"})
    for r in q("SELECT id,asset_id,asset_name,location FROM assets WHERE asset_id LIKE ? OR asset_name LIKE ? OR location LIKE ? ORDER BY id DESC LIMIT 5",(like,like,like)):
        out.append({'type':'Asset','title':f"{r['asset_id']} — {r['asset_name']}",'meta':r['location'] or '', 'url':'/inventory/assets?search='+term})
    for r in q("SELECT id,ticket_id,title,status FROM tickets WHERE ticket_id LIKE ? OR title LIKE ? ORDER BY id DESC LIMIT 5",(like,like)):
        out.append({'type':'Ticket','title':f"{r['ticket_id']} — {r['title']}",'meta':r['status'],'url':f"/tickets/{r['id']}"})
    if can(u,'admin'):
        for r in q("SELECT id,full_name,username,role FROM users WHERE full_name LIKE ? OR username LIKE ? LIMIT 5",(like,like)):
            out.append({'type':'User','title':r['full_name'],'meta':f"@{r['username']} • {r['role']}",'url':f"/users/{r['id']}"})
    return {'results':out[:15]}

@app.get("/health")
def health():
    try:
        q("SELECT 1",one=True)
        return {"status":"ok","service":"fmt-tbs-dashboard"}
    except Exception:
        return JSONResponse({"status":"error"},status_code=503)

@app.get("/settings", response_class=HTMLResponse)
def settings_page(request:Request):
    require_action(request,'admin'); return page(request,"settings.html")

@app.post("/settings/branding")
def branding(request:Request,title:str=Form(...),subtitle:str=Form(...),footer:str=Form(...),division:str=Form('FMT'),site:str=Form('TBS'),environment:str=Form('PRODUCTION'),logo:UploadFile|None=File(None)):
    u=require_action(request,'admin'); vals={'title':title,'subtitle':subtitle,'footer':footer,'division':division,'site':site,'environment':environment}
    for k,v in vals.items(): execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(k,v))
    if logo and logo.filename:
        rel,orig,_=save_image_upload(logo,'branding'); execute("INSERT INTO settings(key,value) VALUES('logo',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(rel,)); audit(u['id'],'Update Logo','Settings','branding',None,orig)
    audit(u['id'],'Update','Settings','branding',None,str(vals)); return RedirectResponse('/settings',303)

@app.post("/settings/telegram")
def settings_telegram(request:Request,telegram_enabled:str=Form('0'),telegram_token:str=Form(''),telegram_chat:str=Form('')):
    u=require_action(request,'admin')
    vals={'telegram_enabled':'1' if telegram_enabled in ('1','on','true') else '0','telegram_token':telegram_token.strip(),'telegram_chat':telegram_chat.strip()}
    for k,v in vals.items(): execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(k,v))
    audit(u['id'],'Update','Settings','telegram',None,'enabled' if vals['telegram_enabled']=='1' else 'disabled')
    return RedirectResponse('/settings?telegram=saved',303)

@app.post("/settings/telegram/test")
def settings_telegram_test(request:Request):
    require_action(request,'admin')
    ok,detail=send_telegram(EVENT_TEMPLATES['test'])
    return {'ok':ok,'detail':'sent' if ok else detail}

@app.get("/files/{path:path}")
def files(request:Request,path:str):
    if not current_user(request): raise HTTPException(401)
    p=(BASE/path).resolve(); root=(BASE/'uploads').resolve()
    if root not in p.parents or not p.is_file(): raise HTTPException(404)
    u=current_user(request)
    if '/signatures/' in p.as_posix() and not (can(u,'signature.view') or can(u,'signature.use') or can(u,'attendance.sign')): raise HTTPException(403)
    return FileResponse(p)

@app.exception_handler(HTTPException)
def http_error(request:Request,exc:HTTPException):
    if wants_json(request): return JSONResponse({'ok':False,'detail':str(exc.detail)},status_code=exc.status_code)
    if exc.status_code==401: return RedirectResponse('/login',303)
    return templates.TemplateResponse('error.html',{'request':request,'status':exc.status_code,'message':exc.detail,**_lang_ctx(request)},status_code=exc.status_code)
