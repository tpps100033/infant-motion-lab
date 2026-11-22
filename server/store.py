"""SQLite indexes with authenticated encryption for record payloads and files."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class Store:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.files = self.directory / 'files'
        self.files.mkdir(exist_ok=True)
        key_path = self.directory / 'master.key'
        if not key_path.exists():
            if (self.directory / 'research.sqlite3').exists():
                raise RuntimeError('Master key is missing; restore it from the separate key backup.')
            with key_path.open('xb') as stream:
                stream.write(AESGCM.generate_key(bit_length=256))
            os.chmod(key_path, 0o600)
        key = key_path.read_bytes()
        self.cipher = AESGCM(key)
        self.index_key = hashlib.sha256(key + b'code-index-v1').digest()
        self.path = self.directory / 'research.sqlite3'
        with self.db() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE,
                    password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
                CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT,
                    expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL,
                    parent TEXT, payload BLOB NOT NULL);
                CREATE INDEX IF NOT EXISTS record_parent ON records(kind,parent);
                CREATE TABLE IF NOT EXISTS subject_codes(code_hash TEXT PRIMARY KEY, record_id TEXT UNIQUE);
                CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, payload BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER, until REAL);
            ''')

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.path, timeout=20)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def seal(self, value, aad):
        nonce = secrets.token_bytes(12)
        return nonce + self.cipher.encrypt(nonce, json.dumps(value, ensure_ascii=False, allow_nan=False).encode(), aad.encode())

    def open(self, data, aad):
        return json.loads(self.cipher.decrypt(data[:12], data[12:], aad.encode()))

    def put(self, kind, value, parent=None, record_id=None):
        record_id = record_id or secrets.token_hex(16)
        value = {**value, 'id': record_id}
        with self.db() as db:
            if kind == 'subject':
                code_hash=hmac.new(self.index_key,value['code'].lower().encode(),hashlib.sha256).hexdigest()
                exists=db.execute('SELECT record_id FROM subject_codes WHERE code_hash=?',(code_hash,)).fetchone()
                if exists and exists['record_id'] != record_id:
                    raise ValueError('Duplicate subject code')
                db.execute('INSERT OR IGNORE INTO subject_codes VALUES(?,?)',(code_hash,record_id))
            db.execute('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                       (record_id, kind, parent, self.seal(value, kind + ':' + record_id)))
        return value

    def get(self, kind, record_id):
        with self.db() as db:
            row = db.execute('SELECT payload FROM records WHERE kind=? AND id=?', (kind, record_id)).fetchone()
        return self.open(row['payload'], kind + ':' + record_id) if row else None

    def list(self, kind, parent=None):
        with self.db() as db:
            rows = db.execute('SELECT id,payload FROM records WHERE kind=?' + (' AND parent=?' if parent else ''),
                              (kind, parent) if parent else (kind,)).fetchall()
        return [self.open(row['payload'], kind + ':' + row['id']) for row in rows]

    def children(self, kind, parents):
        if not parents:return []
        with self.db() as db:
            rows=db.execute('SELECT id,payload FROM records WHERE kind=? AND parent IN ('+','.join('?' for _ in parents)+')',(kind,*parents)).fetchall()
        return [self.open(row['payload'],kind+':'+row['id']) for row in rows]

    def put_analysis(self, value, record_id=None):
        record_id=record_id or secrets.token_hex(16)
        value={**value,'id':record_id}
        metadata={**{k:v for k,v in value.items() if k not in ['id','result']},'id':'meta-'+record_id,'analysis_id':record_id}
        records=[(record_id,'analysis',value['visit_id'],self.seal(value,'analysis:'+record_id)),
                 ('meta-'+record_id,'analysis_meta',value['subject_id'],self.seal(metadata,'analysis_meta:meta-'+record_id))]
        with self.db() as db:
            db.executemany('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',records)
        return value

    def audit(self, actor, action, record_id=''):
        from datetime import datetime, timezone
        value = {'at': datetime.now(timezone.utc).isoformat(), 'actor': actor, 'action': action, 'record_id': record_id}
        with self.db() as db:
            db.execute('INSERT INTO audit(payload) VALUES(?)', (self.seal(value, 'audit'),))


def password_hash(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return salt.hex() + ':' + digest.hex()


def password_ok(password, saved):
    salt, digest = saved.split(':')
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return secrets.compare_digest(actual.hex(), digest)
