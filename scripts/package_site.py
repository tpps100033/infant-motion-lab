"""Package only website assets, excluding Git metadata and research artifacts."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public'
DEST.mkdir(exist_ok=True)
for name in ['index.html', 'app.mjs', 'metrics.mjs', 'pose.mjs', 'worker.mjs',
             'style.css', 'icon.svg', 'NOTICE.txt', 'DEPLOY.md', '.nojekyll']:
    shutil.copyfile(ROOT / name, DEST / name)
for directory in ['assets', 'vendor']:
    shutil.copytree(ROOT / directory, DEST / directory, dirs_exist_ok=True)
print('Packaged static site in public/')
