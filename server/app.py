"""Same-origin private research API; default deployment is loopback only."""
import csv
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import time
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .store import Store, password_hash, password_ok

ROOT = Path(__file__).resolve().parents[1]
GROUPS = ['typical', 'high_risk', 'developmental_concern']
def now(): return datetime.now(timezone.utc).isoformat()
def fail(message, status=400): raise HTTPException(status, message)

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Login(Model):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)

class UserIn(Model):
    username: str = Field(pattern=r'^[a-zA-Z0-9_.-]{3,40}$')
    password: str = Field(min_length=12, max_length=200)
    role: str = Field(pattern=r'^(admin|researcher|reviewer)$')

class Study(Model):
    title: str = Field(default='早期神經發育數位生物標記研究', max_length=120)
    irb_number: str = Field(default='', max_length=80)
    consent_version: str = Field(default='', max_length=80)
    approved: bool = False
    end_date: date | None = None
    target_year1: int = Field(default=300, ge=1, le=10000)
    target_typical: int = Field(default=200, ge=0, le=10000)
    target_high_risk: int = Field(default=80, ge=0, le=10000)
    target_concern: int = Field(default=20, ge=0, le=10000)

class Subject(Model):
    code: str = Field(pattern=r'^[A-Za-z0-9_-]{3,40}$')
    enrolled_on: date
    age_months: float = Field(ge=0, lt=72)
    gestational_weeks: float | None = Field(default=None, ge=20, le=44)
    birth_weight_g: int | None = Field(default=None, ge=200, le=7000)
    sex: str = Field(default='unknown', pattern=r'^(female|male|unknown)$')
    group: str = Field(pattern=r'^(typical|high_risk|developmental_concern)$')
    study_year: int = Field(default=1, ge=1, le=3)
    site_code: str = Field(default='LOCAL', pattern=r'^[A-Za-z0-9_-]{1,30}$')
    risk_factors: list[str] = Field(default_factory=list, max_length=20)
    consent_version: str = Field(min_length=1, max_length=80)
    consent_on: date
    guardian_confirmed: bool

class Visit(Model):
    visited_on: date
    group: str = Field(pattern=r'^(typical|high_risk|developmental_concern)$')
    posture: str = Field(default='supine', pattern=r'^(supine|prone|sitting|rolling|standing|walking|other)$')
    setting: str = Field(default='clinic', pattern=r'^(clinic|home|other)$')
    assessor_code: str = Field(default='', max_length=40)
    full_body: bool = False
    stable_camera: bool = False
    adequate_light: bool = False
    natural_activity: bool = False
    no_unrelated_speech: bool = False
    usable_video_seconds: float = Field(default=0, ge=0, le=3600)
    note: str = Field(default='', max_length=1000)

class Clinical(Model):
    tool: str = Field(pattern=r'^(Bayley|GMA|MCDI)$')
    version: str = Field(min_length=1, max_length=80)
    assessed_on: date
    assessor_code: str = Field(min_length=1, max_length=40)
    scores: dict[str, float] = Field(default_factory=dict, max_length=30)
    classification: str = Field(default='', max_length=80)
    note: str = Field(default='', max_length=1000)

class Analysis(Model):
    kind: str = Field(pattern=r'^(motion|audio)$')
    result: dict

class Review(Model):
    status: str = Field(pattern=r'^(pending|accepted|rejected|needs_repeat)$')
    note: str = Field(default='', max_length=1000)

class Withdraw(Model):
    reason: str = Field(min_length=1, max_length=300)

class Usability(Model):
    tester_code: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    role: str = Field(pattern=r'^(clinician|caregiver)$')
    answers: list[int] = Field(min_length=10, max_length=10)
    feedback: str = Field(default='', max_length=1000)

class Purge(Model):
    confirm_code: str
    reason: str = Field(min_length=1, max_length=300)

class PasswordChange(Model):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=200)

def create_app(data_dir=None):
    default = (Path.home() / 'AppData' / 'Local' / 'MotionLabResearch') if os.name == 'nt' else (Path.home() / '.local' / 'share' / 'MotionLabResearch')
    store = Store(data_dir or os.environ.get('MOTIONLAB_DATA_DIR', str(default)))
    app = FastAPI(title='Motion Lab Private Research API', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    origin = os.environ.get('MOTIONLAB_ORIGIN', '')
    if origin and not origin.startswith('https://'):
        raise RuntimeError('Remote deployment requires an HTTPS MOTIONLAB_ORIGIN.')
    from urllib.parse import urlparse
    hosts = ['localhost', '127.0.0.1', '[::1]']
    if origin: hosts.append(urlparse(origin).hostname)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

    @app.middleware('http')
    async def security(request, call_next):
        if request.url.path.startswith('/api/'):
            if request.method not in ['GET', 'HEAD']:
                expected = origin or f'{request.url.scheme}://{request.headers.get("host", "")}'
                if request.headers.get('origin') not in [None, expected]:
                    return Response('Origin rejected', status_code=403)
                if request.headers.get('x-motionlab-request') != '1':
                    return Response('Request header required', status_code=403)
            limit = 256 * 1024 * 1024 if request.url.path.endswith('/files') else 64 * 1024 * 1024
            if int(request.headers.get('content-length', '0')) > limit:
                return Response('Request too large', status_code=413)
            # Bound streaming/chunked requests too, before FastAPI parses JSON.
            if request.method in ['POST', 'PUT', 'PATCH']:
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > limit:
                        return Response('Request too large', status_code=413)
                    body.extend(chunk)
                request._body = bytes(body)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://raw.githubusercontent.com; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
        response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api/') else 'no-cache'
        return response

    def user(request: Request):
        token = request.cookies.get('motionlab_session', '')
        digest = hashlib.sha256(token.encode()).hexdigest()
        with store.db() as db:
            row = db.execute('SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1', (digest, time.time())).fetchone()
        if not row: fail('請先登入私人研究資料庫', 401)
        return dict(row)

    def editor(actor=Depends(user)):
        if actor['role'] not in ['admin', 'researcher']: fail('此帳號僅可審閱', 403)
        return actor

    def admin(actor=Depends(user)):
        if actor['role'] != 'admin': fail('需要管理員權限', 403)
        return actor

    def study(): return store.get('study', 'settings') or Study().model_dump(mode='json')
    def subject(sid, active=False):
        value = store.get('subject', sid)
        if not value: fail('找不到受試者', 404)
        if active and value.get('withdrawn_at'): fail('此受試者已退出，停止新增研究資料', 409)
        return value
    def visit(vid, active=False):
        value = store.get('visit', vid)
        if not value: fail('找不到訪視', 404)
        subject(value['subject_id'], active)
        return value

    @app.get('/api/health')
    def health(): return {'private_server': True, 'version': '0.4.0'}

    @app.post('/api/login')
    def login(body: Login, request: Request):
        key = hashlib.sha256(((request.client.host if request.client else '') + ':' + body.username.lower()).encode()).hexdigest()
        with store.db() as db:
            attempt = db.execute('SELECT * FROM attempts WHERE key=?', (key,)).fetchone()
            if attempt and attempt['count'] >= 5 and attempt['until'] > time.time(): fail('登入失敗次數過多，請於 15 分鐘後重試', 429)
            row = db.execute('SELECT * FROM users WHERE username=? AND active=1', (body.username,)).fetchone()
            saved = row['password'] if row else '00'*16 + ':' + '00'*64
            if not password_ok(body.password, saved):
                count = attempt['count'] + 1 if attempt and attempt['until'] > time.time() else 1
                db.execute('INSERT OR REPLACE INTO attempts VALUES(?,?,?)', (key, count, time.time()+900))
                # Commit failure count before raising outside this transaction.
                actor = None
            else:
                db.execute('DELETE FROM attempts WHERE key=?', (key,)); actor = dict(row)
        if not actor: fail('帳號或密碼錯誤', 401)
        token = secrets.token_urlsafe(48)
        with store.db() as db:
            db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), actor['id'], time.time()+8*3600))
        store.audit(actor['id'], 'login')
        response = Response(json.dumps({'username': actor['username'], 'role': actor['role']}), media_type='application/json')
        response.set_cookie('motionlab_session', token, httponly=True, secure=bool(origin), samesite='strict', max_age=8*3600, path='/')
        return response

    @app.get('/api/me')
    def me(actor=Depends(user)): return {'username': actor['username'], 'role': actor['role']}

    @app.post('/api/logout')
    def logout(request: Request, actor=Depends(user)):
        with store.db() as db: db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(request.cookies.get('motionlab_session', '').encode()).hexdigest(),))
        response = Response(status_code=204); response.delete_cookie('motionlab_session'); return response

    @app.get('/api/study')
    def get_study(actor=Depends(user)): return study()

    @app.put('/api/study')
    def set_study(body: Study, actor=Depends(admin)):
        if body.approved and (not body.irb_number or not body.consent_version or not body.end_date): fail('請填 IRB 編號、同意版本與計畫結束日')
        result = store.put('study', body.model_dump(mode='json'), record_id='settings'); store.audit(actor['id'], 'study.update'); return result

    @app.get('/api/users')
    def users(actor=Depends(admin)):
        with store.db() as db: return [dict(r) for r in db.execute('SELECT id,username,role,active FROM users')]

    @app.post('/api/users')
    def add_user(body: UserIn, actor=Depends(admin)):
        import sqlite3
        uid = secrets.token_hex(16)
        try:
            with store.db() as db: db.execute('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)', (uid, body.username, password_hash(body.password), body.role))
        except sqlite3.IntegrityError: fail('帳號已存在', 409)
        store.audit(actor['id'], 'user.create', uid); return {'id': uid}

    @app.post('/api/password')
    def change_password(body: PasswordChange, actor=Depends(user)):
        if not password_ok(body.current_password, actor['password']): fail('目前密碼不正確', 403)
        with store.db() as db:
            db.execute('UPDATE users SET password=? WHERE id=?', (password_hash(body.new_password), actor['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?', (actor['id'],))
        store.audit(actor['id'], 'password.change'); return {'ok': True}

    @app.post('/api/users/{uid}/disable')
    def disable_user(uid: str, actor=Depends(admin)):
        if uid == actor['id']: fail('無法停用目前登入的帳號')
        with store.db() as db:
            db.execute('UPDATE users SET active=0 WHERE id=?', (uid,)); db.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
        store.audit(actor['id'], 'user.disable', uid); return {'ok': True}

    @app.get('/api/subjects')
    def subjects(actor=Depends(user)):
        store.audit(actor['id'], 'subjects.read'); return store.list('subject')

    @app.post('/api/subjects')
    def add_subject(body: Subject, actor=Depends(editor)):
        settings = study()
        if not settings['approved']: fail('請先由管理員登錄已核准的 IRB 資訊', 409)
        if not body.guardian_confirmed or body.consent_version != settings['consent_version']: fail('需完成目前 IRB 核准版本的監護人書面同意')
        if body.consent_on > body.enrolled_on: fail('同意日期不得晚於收案日期')
        if any(s['code'].lower() == body.code.lower() for s in store.list('subject')): fail('研究代碼已存在', 409)
        try:
            value = store.put('subject', {**body.model_dump(mode='json'), 'created_at': now(), 'cohort': 'external' if body.study_year == 3 else 'development', 'withdrawn_at': None})
        except (ValueError, __import__('sqlite3').IntegrityError): fail('研究代碼已存在',409)
        store.audit(actor['id'], 'subject.create', value['id']); return value

    @app.get('/api/subjects/{sid}')
    def subject_detail(sid: str, actor=Depends(user)):
        value = subject(sid); visits = store.list('visit', sid)
        store.audit(actor['id'], 'subject.read', sid)
        parents=[v['id'] for v in visits]
        return {'subject': value, 'visits': visits, 'clinical': store.children('clinical',parents),
                'analyses': [{**r,'id':r['analysis_id']} for r in store.list('analysis_meta',sid)],
                'files': store.children('file',parents)}

    @app.post('/api/subjects/{sid}/withdraw')
    def withdraw(sid: str, body: Withdraw, actor=Depends(editor)):
        value = subject(sid); value.update(withdrawn_at=now(), withdrawal_reason=body.reason)
        store.put('subject', value, record_id=sid); store.audit(actor['id'], 'subject.withdraw', sid); return value

    @app.post('/api/subjects/{sid}/purge')
    def purge(sid: str, body: Purge, actor=Depends(admin)):
        value=subject(sid)
        if body.confirm_code!=value['code']: fail('確認代碼不符，資料未刪除')
        if not value.get('withdrawn_at'): fail('請先登錄退出／保存期到期原因，再執行清除')
        ids=[sid];paths=[]
        for kind in ['visit','clinical','analysis','analysis_meta','file']:
            for record in store.list(kind):
                if record.get('subject_id')==sid:
                    ids.append(record['id'])
                    if kind=='file': paths.append(store.files/(record['id']+'.enc'))
        # Record the operator and affected opaque ID, never the deleted clinical payload.
        store.audit(actor['id'],'subject.purge',sid)
        with store.db() as db:
            db.executemany('DELETE FROM records WHERE id=?',[(record_id,) for record_id in ids])
            db.execute('DELETE FROM subject_codes WHERE record_id=?',(sid,))
        for path in paths:path.unlink(missing_ok=True)
        return {'deleted_records':len(ids),'backup_copies_require_separate_retention_procedure':True}

    @app.post('/api/subjects/{sid}/visits')
    def add_visit(sid: str, body: Visit, actor=Depends(editor)):
        s = subject(sid, True)
        if body.visited_on < date.fromisoformat(s['enrolled_on']): fail('訪視不得早於收案日期')
        if any(v['visited_on'] == body.visited_on.isoformat() for v in store.list('visit', sid)): fail('同一日訪視已存在', 409)
        age = s['age_months'] + (body.visited_on-date.fromisoformat(s['enrolled_on'])).days/30.4375
        corrected = max(0, age - max(0,40-(s['gestational_weeks'] or 40))*7/30.4375) if age < 24 else age
        value = store.put('visit', {**body.model_dump(mode='json'), 'subject_id': sid, 'age_months': age, 'corrected_age_months': corrected, 'created_at': now()}, sid)
        store.audit(actor['id'], 'visit.create', value['id']); return value

    @app.post('/api/visits/{vid}/clinical')
    def add_clinical(vid: str, body: Clinical, actor=Depends(editor)):
        v = visit(vid, True)
        if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,60}', key) for key in body.scores): fail('分數欄位代碼需為英數或底線')
        if any(not isinstance(x, (int,float)) or not __import__('math').isfinite(x) for x in body.scores.values()): fail('分數須為有限數值')
        value = store.put('clinical', {**body.model_dump(mode='json'), 'subject_id': v['subject_id'], 'visit_id': vid, 'created_at': now()}, vid)
        store.audit(actor['id'], 'clinical.create', value['id']); return value

    @app.post('/api/visits/{vid}/analyses')
    def save_analysis(vid: str, body: Analysis, actor=Depends(editor)):
        v = visit(vid, True); result = body.result
        if body.kind == 'motion':
            summary = result.get('summary', {})
            if result.get('demo') or summary.get('inference', {}).get('model', {}).get('weights') == 'synthetic_ground_truth': fail('合成示範不可歸檔為受試者分析')
            if not isinstance(summary.get('features'), list) or not isinstance(summary.get('symmetry'), list) or not isinstance(summary.get('frames'), int): fail('需完整動作分析 JSON')
            # Source filenames can contain patient names. Retain a generated source label instead.
            if 'inference' in summary: summary['inference']['source_name'] = 'research-video'
        else:
            summary = result.get('summary', {})
            if result.get('format') != 'infant-audio/v1': fail('需語音分析 JSON')
        value = store.put_analysis({'kind': body.kind, 'result': result, 'subject_id': v['subject_id'], 'visit_id': vid,
                  'created_at': now(), 'created_by': actor['id'], 'review': 'pending', 'summary': summary})
        store.audit(actor['id'], 'analysis.create', value['id']); return {'id': value['id'], 'review': value['review']}

    @app.get('/api/analyses/{aid}')
    def analysis(aid: str, actor=Depends(user)):
        value = store.get('analysis', aid)
        if not value: fail('找不到分析', 404)
        store.audit(actor['id'], 'analysis.read', aid); return value

    @app.post('/api/analyses/{aid}/review')
    def review(aid: str, body: Review, actor=Depends(user)):
        if actor['role'] not in ['admin', 'reviewer']: fail('需要審閱者或管理員權限', 403)
        value = store.get('analysis', aid)
        if not value: fail('找不到分析', 404)
        if body.status=='accepted':
            v=visit(value['visit_id'],True)
            if value['kind']=='motion':
                quality=all(v.get(k) for k in ['full_body','stable_camera','adequate_light','natural_activity'])
                if not quality or v['usable_video_seconds']<180 or value['summary'].get('duration_s',0)<179:
                    fail('研究納入需連續至少 3 分鐘可用動作影片，並完成拍攝品質檢核')
                if value['summary'].get('inference',{}).get('partial') or value['summary'].get('measurement_error'):
                    fail('部分分析或無法量測的結果不可標記研究通過')
            elif not v.get('no_unrelated_speech'):
                fail('語音納入前需確認無非預期家庭對話')
        value.update(review=body.status, review_note=body.note, reviewed_by=actor['id'], reviewed_at=now())
        store.put_analysis(value, aid)
        store.audit(actor['id'], 'analysis.review', aid); return {'ok': True}

    @app.post('/api/visits/{vid}/files')
    async def upload(vid: str, request: Request, kind: str, duration: float = 0, actor=Depends(editor)):
        v = visit(vid, True)
        if kind not in ['video','audio','consent_reference']: fail('不支援的檔案類別')
        if kind == 'consent_reference': fail('簽名同意書由院方獨立保存，此平台只記錄版本與完成狀態')
        if not 0 <= duration <= 3600: fail('片長無效')
        data = await request.body()
        if not data: fail('檔案為空')
        mime = request.headers.get('content-type', '').split(';')[0]
        allowed = {'video': ['video/mp4','video/webm','video/quicktime'], 'audio': ['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/webm','audio/ogg']}
        if mime not in allowed[kind]: fail('請選擇支援的影片或語音格式')
        fid = secrets.token_hex(16); nonce = secrets.token_bytes(12)
        encrypted = nonce + store.cipher.encrypt(nonce, data, fid.encode())
        path = store.files / (fid + '.enc'); path.write_bytes(encrypted)
        try:
            value = store.put('file', {'subject_id': v['subject_id'], 'visit_id': vid, 'kind': kind, 'mime': mime, 'duration_s': duration,
                'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'created_at': now()}, vid, fid)
        except Exception:
            path.unlink(missing_ok=True); raise
        store.audit(actor['id'], 'file.upload', fid); return value

    @app.get('/api/files/{fid}')
    def download(fid: str, actor=Depends(editor)):
        value = store.get('file', fid)
        if not value: fail('找不到檔案', 404)
        raw = (store.files / (value['id']+'.enc')).read_bytes()
        data = store.cipher.decrypt(raw[:12], raw[12:], fid.encode())
        if hashlib.sha256(data).hexdigest() != value['sha256']: fail('檔案完整性驗證失敗', 500)
        store.audit(actor['id'], 'file.download', fid)
        return Response(data, media_type=value['mime'], headers={'Content-Disposition': 'attachment; filename="research-media' + (mimetypes.guess_extension(value['mime']) or '.bin') + '"'})

    @app.get('/api/export')
    def export(actor=Depends(editor)):
        ss = {s['id']:s for s in store.list('subject') if not s.get('withdrawn_at')}
        vv = {v['id']:v for v in store.list('visit') if v['subject_id'] in ss}
        # No unreviewed or rejected analysis enters the research extract.
        rows = []
        for a in store.list('analysis_meta'):
            if a['review'] != 'accepted' or a['visit_id'] not in vv: continue
            v=vv[a['visit_id']];s=ss[v['subject_id']]
            base={'subject_code':s['code'],'site_code':s['site_code'],'cohort':s['cohort'],'visit_id':v['id'],'visited_on':v['visited_on'],
                  'age_months':v['age_months'],'corrected_age_months':v['corrected_age_months'],'group_at_visit':v['group'], 'analysis_id':a['analysis_id'], 'modality':a['kind']}
            if a['kind']=='motion':
                for section in ['features','symmetry','coordination','angles']:
                    for row in a['summary'].get(section, []): rows.append({**base,'section':section,'schema_version':a['summary'].get('schema_version'), 'config_json':json.dumps(a['summary'].get('config',{})),**row})
            else: rows.append({**base,'section':'audio',**{k:v for k,v in a['summary'].items() if not isinstance(v,(list,dict))}})
        fields=list(dict.fromkeys(k for row in rows for k in row)) or ['subject_code','analysis_id']
        stream=io.StringIO();writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
        for row in rows:
            # Prevent spreadsheet formula execution in text fields.
            writer.writerow({k: ("'"+v if isinstance(v,str) and v[:1] in ['=','+','-','@','\t','\r'] else v) for k,v in row.items()})
        store.audit(actor['id'],'research.export')
        return Response('\ufeff'+stream.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="research.csv"'})

    @app.post('/api/usability')
    def save_usability(body: Usability, actor=Depends(editor)):
        if any(not 1 <= n <= 5 for n in body.answers): fail('SUS 各題需介於 1–5')
        score=sum((n-1 if i%2==0 else 5-n) for i,n in enumerate(body.answers))*2.5
        value=store.put('usability',{**body.model_dump(),'sus_score':score,'created_at':now()})
        store.audit(actor['id'],'usability.create',value['id']);return {'id':value['id'],'sus_score':score}

    @app.get('/api/usability')
    def list_usability(actor=Depends(user)): return store.list('usability')

    @app.get('/api/audit')
    def audit(actor=Depends(admin)):
        with store.db() as db: rows=db.execute('SELECT payload FROM audit ORDER BY id DESC LIMIT 500').fetchall()
        return [store.open(row['payload'],'audit') for row in rows]

    @app.get('/api/backup')
    def backup(actor=Depends(admin)):
        import zipfile, tempfile
        from starlette.background import BackgroundTask
        handle=tempfile.NamedTemporaryFile(prefix='motionlab-backup-',suffix='.zip',delete=False)
        output_path=Path(handle.name);handle.close()
        snapshot_file=tempfile.NamedTemporaryFile(prefix='motionlab-snapshot-',suffix='.sqlite3',delete=False)
        snapshot_path=Path(snapshot_file.name);snapshot_file.close()
        with store.db() as db:
            snapshot=__import__('sqlite3').connect(snapshot_path); db.backup(snapshot);snapshot.close()
        with zipfile.ZipFile(output_path,'w',compression=zipfile.ZIP_STORED) as archive:
            archive.write(snapshot_path,'research.sqlite3')
            for path in store.files.glob('*.enc'): archive.write(path,'files/'+path.name)
            archive.writestr('RESTORE.txt','Restore the database and files into an empty data directory. Restore master.key separately. Never put the key in this archive.')
        snapshot_path.unlink(missing_ok=True)
        store.audit(actor['id'],'backup.export')
        return FileResponse(output_path,media_type='application/zip',filename='motionlab-encrypted-backup.zip',background=BackgroundTask(output_path.unlink,missing_ok=True))

    @app.get('/{path:path}')
    def static(path: str):
        path = path or 'research.html'
        allowed={'index.html','research.html','app.mjs','research.mjs','research.css','research-core.mjs','report.css','audio.mjs','metrics.mjs','pose.mjs','worker.mjs','thresholds.mjs','style.css','controls.css','icon.svg','LICENSE','NOTICE.txt','DEPLOY.md'}
        asset = re.fullmatch(r'(assets/[A-Za-z0-9_.-]+|vendor/[A-Za-z0-9_.-]+)',path)
        if path not in allowed and not asset: fail('Not found',404)
        file = ROOT / path
        if not file.is_file(): fail('Not found',404)
        mime = 'text/javascript' if file.suffix=='.mjs' else 'application/wasm' if file.suffix=='.wasm' else None
        return FileResponse(file,media_type=mime)

    return app
