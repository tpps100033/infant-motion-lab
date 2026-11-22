"""Check deployable paths and model integrity using Python's standard library."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT


def main():
    required = ['research.html', 'research.mjs', 'research-core.mjs', 'research.css', 'report.css', 'audio.mjs', 'index.html', 'app.mjs', 'metrics.mjs', 'pose.mjs', 'worker.mjs', 'thresholds.mjs', 'style.css', 'controls.css', 'LICENSE',
                'icon.svg', '.nojekyll', 'assets/model.json', 'vendor/ort.wasm.min.mjs',
                'vendor/ort-wasm-simd-threaded.mjs', 'vendor/ort-wasm-simd-threaded.wasm',
                'vendor/ONNXRUNTIME-LICENSE.txt', 'vendor/MMPose-LICENSE.txt', 'NOTICE.txt', 'DEPLOY.md']
    for name in required:
        assert (WEB / name).is_file(), f'Missing static asset: {name}'
    manifest = json.loads((WEB / 'assets/model.json').read_text(encoding='utf-8'))
    combined = hashlib.sha256()
    total = 0
    for part in manifest['parts']:
        data = (WEB / 'assets' / part['file']).read_bytes()
        assert len(data) == part['bytes']
        assert hashlib.sha256(data).hexdigest() == part['sha256']
        combined.update(data)
        total += len(data)
    assert total == manifest['bytes'] and combined.hexdigest() == manifest['sha256']
    deployment_files = [WEB / name for name in required if '/' not in name]
    for directory in ['assets', 'vendor']:
        deployment_files.extend((WEB / directory).rglob('*'))
    for file in deployment_files:
        if file.is_file():
            assert file.stat().st_size < 25 * 1024 * 1024, f'File exceeds GitHub browser upload limit: {file.name}'
            assert file.suffix.lower() not in ['.mp4', '.mov', '.npz', '.csv'], 'Patient-like runtime artifact in static assets'
    text = (WEB / 'index.html').read_text(encoding='utf-8')
    for path in re.findall(r'(?:src|href)="\./([^"]+)"', text):
        path = path.split('?')[0]
        assert (WEB / path).exists(), f'Broken relative link: {path}'
    print(f'Static assets valid. Model {total:,} bytes, SHA256 {combined.hexdigest()}')


if __name__ == '__main__':
    main()
