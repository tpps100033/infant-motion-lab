"""Package only website assets, excluding Git metadata and research artifacts."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public'
# Rebuild only the verified generated output directory, never carry stale files.
assert DEST.resolve().parent == ROOT.resolve() and DEST.name == 'public'
assert not DEST.is_symlink() and not (hasattr(DEST, 'is_junction') and DEST.is_junction())
if DEST.exists():
    shutil.rmtree(DEST)
DEST.mkdir(exist_ok=True)
for name in ['index.html', 'app.mjs', 'metrics.mjs', 'pose.mjs', 'worker.mjs', 'thresholds.mjs',
             'research.html', 'research.mjs', 'research-core.mjs', 'research.css', 'report.css', 'audio.mjs',
             'style.css', 'controls.css', 'icon.svg', 'LICENSE', 'NOTICE.txt', 'DEPLOY.md', '.nojekyll']:
    shutil.copyfile(ROOT / name, DEST / name)
for directory in ['assets', 'vendor']:
    shutil.copytree(ROOT / directory, DEST / directory, dirs_exist_ok=True)
print('Packaged static site in public/')
