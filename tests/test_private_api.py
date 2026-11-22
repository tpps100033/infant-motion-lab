import hashlib
import io
import json
import secrets
import sqlite3
import zipfile
import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server.store import password_hash, Store

HEADERS={'X-MotionLab-Request':'1'}
PASSWORD='test-only-strong-password'

@pytest.fixture
def setup(tmp_path):
    app=create_app(tmp_path/'private');store=app.state.store
    with store.db() as db:
        for name,role in [('admin','admin'),('analyst','researcher'),('reviewer','reviewer')]:
            db.execute('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)',(name,name,password_hash(PASSWORD),role))
    client=TestClient(app,headers=HEADERS,base_url="http://localhost")
    assert client.post('/api/login',json={'username':'admin','password':PASSWORD}).status_code==200
    study={'approved':True,'irb_number':'TEST-IRB','consent_version':'v1','end_date':'2030-01-01'}
    assert client.put('/api/study',json=study).status_code==200
    yield app,store,client

def enroll(client,code='TEST-001',year=1):
    return client.post('/api/subjects',json={'code':code,'enrolled_on':'2026-11-01','age_months':3,'gestational_weeks':32,'group':'high_risk','study_year':year,'consent_version':'v1','consent_on':'2026-10-31','guardian_confirmed':True})

def visit(client,sid,on='2026-11-01',group='high_risk'):
    return client.post(f'/api/subjects/{sid}/visits',json={'visited_on':on,'group':group,'usable_video_seconds':180,'full_body':True,'stable_camera':True,'adequate_light':True,'natural_activity':True})

def test_auth_origin_static_and_rate_limit(setup):
    app,store,client=setup
    anonymous=TestClient(app,headers=HEADERS,base_url="http://localhost")
    assert anonymous.get('/api/subjects').status_code==401
    assert client.post('/api/subjects',headers={'Origin':'https://evil.example'},json={}).status_code==403
    assert client.get('/server/store.py').status_code==404
    assert client.get('/.git/config').status_code==404
    assert client.get('/research.html').status_code==200
    for _ in range(5):assert anonymous.post('/api/login',json={'username':'unknown','password':'bad'}).status_code==401
    assert anonymous.post('/api/login',json={'username':'unknown','password':'bad'}).status_code==429

def test_consent_age_duplicate_and_cohort(setup):
    _,_,client=setup
    assert client.put('/api/study',json={'approved':False}).status_code==200
    assert enroll(client).status_code==409
    client.put('/api/study',json={'approved':True,'irb_number':'TEST','consent_version':'v1','end_date':'2030-01-01'})
    result=enroll(client);assert result.status_code==200
    assert enroll(client).status_code==409
    assert enroll(client,'test-001').status_code==409
    assert enroll(client,'TEST-EXT',3).json()['cohort']=='external'
    sid=result.json()['id'];v=visit(client,sid).json()
    assert v['corrected_age_months']<v['age_months']
    visit(client,sid,'2026-12-01','developmental_concern')
    data=client.get('/api/subjects/'+sid).json()
    assert [r['group'] for r in data['visits']]==['high_risk','developmental_concern']
    assert visit(client,sid).status_code==409

def test_encryption_media_access_review_and_export(setup):
    app,store,client=setup
    sid=enroll(client).json()['id'];vid=visit(client,sid).json()['id']
    canary=b'private-video-canary-DO-NOT-PUBLISH'
    upload=client.post(f'/api/visits/{vid}/files?kind=video&duration=180',content=canary,headers={'Content-Type':'video/mp4'})
    assert upload.status_code==200;fid=upload.json()['id']
    assert canary not in (store.files/(fid+'.enc')).read_bytes()
    assert client.get('/api/files/'+fid).content==canary
    result={'format':'infant-motion-web/v1','summary':{'frames':5400,'duration_s':180,'schema_version':'2.0','inference':{'source_name':'private-person-name.mp4'},'config':{'confidence':.2},'features':[{'joint':'left_wrist','speed_mean':1,'status':'ok'}],'symmetry':[]}}
    save=client.post(f'/api/visits/{vid}/analyses',json={'kind':'motion','result':result});assert save.status_code==200;aid=save.json()['id']
    assert 'left_wrist' not in client.get('/api/export').text
    reviewer=TestClient(app,headers=HEADERS,base_url="http://localhost");reviewer.post('/api/login',json={'username':'reviewer','password':PASSWORD})
    assert reviewer.get('/api/files/'+fid).status_code==403
    assert reviewer.post('/api/subjects',json={}).status_code==403
    assert reviewer.post('/api/analyses/'+aid+'/review',json={'status':'accepted'}).status_code==200
    assert 'left_wrist' in client.get('/api/export').text
    assert 'private-person-name' not in client.get('/api/analyses/'+aid).text
    with store.db() as db:
        rows=db.execute('SELECT payload FROM records').fetchall()
    assert all(b'TEST-001' not in row['payload'] for row in rows)
    assert client.post('/api/subjects/'+sid+'/withdraw',json={'reason':'guardian request'}).status_code==200
    assert client.post(f'/api/visits/{vid}/analyses',json={'kind':'motion','result':result}).status_code==409
    assert 'left_wrist' not in client.get('/api/export').text

def test_backup_restores_encrypted_records_and_missing_key_fails(setup,tmp_path):
    _,store,client=setup
    sid=enroll(client).json()['id'];backup=client.get('/api/backup');assert backup.status_code==200
    with zipfile.ZipFile(io.BytesIO(backup.content)) as z:
        assert 'master.key' not in z.namelist()
        target=tmp_path/'restore';target.mkdir();z.extractall(target)
    (target/'master.key').write_bytes((store.directory/'master.key').read_bytes())
    restored=Store(target);assert restored.get('subject',sid)['code']=='TEST-001'
    (target/'master.key').unlink()
    with pytest.raises(RuntimeError):Store(target)

def test_roles_password_and_sus(setup):
    app,_,client=setup
    researcher=TestClient(app,headers=HEADERS,base_url="http://localhost");researcher.post('/api/login',json={'username':'analyst','password':PASSWORD})
    assert researcher.put('/api/study',json={}).status_code==403
    assert researcher.get('/api/backup').status_code==403
    assert client.post('/api/usability',json={'tester_code':'TESTER-1','role':'clinician','answers':[5,1]*5}).json()['sus_score']==100
    assert client.post('/api/password',json={'current_password':PASSWORD,'new_password':'new-test-password-123'}).status_code==200
    assert client.get('/api/me').status_code==401
    assert client.post('/api/login',json={'username':'admin','password':'new-test-password-123'}).status_code==200

def test_purge_requires_withdrawal_exact_confirmation_and_admin(setup):
    app,store,client=setup
    sid=enroll(client).json()['id'];vid=visit(client,sid).json()['id']
    body={'confirm_code':'TEST-001','reason':'test retention procedure'}
    assert client.post('/api/subjects/'+sid+'/purge',json=body).status_code==400
    client.post('/api/subjects/'+sid+'/withdraw',json={'reason':'test exit'})
    assert client.post('/api/subjects/'+sid+'/purge',json={**body,'confirm_code':'WRONG'}).status_code==400
    analyst=TestClient(app,headers=HEADERS,base_url='http://localhost');analyst.post('/api/login',json={'username':'analyst','password':PASSWORD})
    assert analyst.post('/api/subjects/'+sid+'/purge',json=body).status_code==403
    assert client.post('/api/subjects/'+sid+'/purge',json=body).status_code==200
    assert client.get('/api/subjects/'+sid).status_code==404
    assert store.get('visit',vid) is None
    assert enroll(client).status_code==200

def test_short_clip_stays_draft_and_summary_endpoint_excludes_raw_arrays(setup):
    _,store,client=setup
    sid=enroll(client).json()['id'];vid=visit(client,sid).json()['id']
    result={'summary':{'frames':270,'duration_s':11.26,'features':[],'symmetry':[]},'raw':{'private_large_array':'only-full-record'}}
    aid=client.post(f'/api/visits/{vid}/analyses',json={'kind':'motion','result':result}).json()['id']
    assert client.post('/api/analyses/'+aid+'/review',json={'status':'accepted'}).status_code==400
    listing=client.get('/api/subjects/'+sid).json()['analyses']
    assert listing[0]['id']==aid
    assert 'only-full-record' not in json.dumps(listing)
    assert store.get('analysis',aid)['review']=='pending'
