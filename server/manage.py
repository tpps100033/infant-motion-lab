"""Local operator commands: initialization, backup restore, and secure startup."""
import argparse
import getpass
import os
import secrets
from pathlib import Path
from .store import Store, password_hash


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['init','serve','check'])
    parser.add_argument('--data-dir',default=os.environ.get('MOTIONLAB_DATA_DIR',str(Path.home() / 'AppData' / 'Local' / 'MotionLabResearch') if os.name=='nt' else str(Path.home() / '.local' / 'share' / 'MotionLabResearch')))
    parser.add_argument('--username',default='admin')
    parser.add_argument('--write-credentials',action='store_true')
    parser.add_argument('--port',type=int,default=8050)
    args=parser.parse_args()
    store=Store(args.data_dir)
    if args.command=='init':
        with store.db() as db:
            if db.execute('SELECT count(*) FROM users').fetchone()[0]:
                print('Already initialized. Existing users and data retained.');return
            password=secrets.token_urlsafe(24) if args.write_credentials else getpass.getpass('Admin password (12+ characters): ')
            if len(password)<12: raise SystemExit('Password must have at least 12 characters.')
            if not args.write_credentials and password!=getpass.getpass('Repeat password: '): raise SystemExit('Passwords do not match.')
            db.execute('INSERT INTO users(id,username,password,role) VALUES(?,?,?,?)',(secrets.token_hex(16),args.username,password_hash(password),'admin'))
        if args.write_credentials:
            path=store.directory/'initial-login.txt'
            path.write_text(f'URL: http://127.0.0.1:{args.port}/research.html\nUsername: {args.username}\nPassword: {password}\nChange password after login, then delete this file.\n',encoding='utf8')
            os.chmod(path,0o600);print(f'Initial credentials saved outside the repository: {path}')
        else: print('Administrator initialized.')
    elif args.command=='check':
        with store.db() as db:
            print('SQLite:',db.execute('PRAGMA integrity_check').fetchone()[0])
        for kind in ['study','subject','visit','clinical','analysis','file']:
            print(kind,len(store.list(kind)))
        for value in store.list('file'):
            import hashlib
            raw=(store.files/(value['id']+'.enc')).read_bytes()
            data=store.cipher.decrypt(raw[:12],raw[12:],value['id'].encode())
            if hashlib.sha256(data).hexdigest()!=value['sha256']:raise SystemExit('File hash mismatch')
        print('Encrypted records and media verified.')
    else:
        with store.db() as db:
            if not db.execute('SELECT 1 FROM users LIMIT 1').fetchone():raise SystemExit('Run init before serve.')
        from .app import create_app
        import uvicorn
        # Externally reachable binds are deliberately configured by an operator separately.
        uvicorn.run(create_app(args.data_dir),host='127.0.0.1',port=args.port,access_log=False)


if __name__=='__main__':main()
