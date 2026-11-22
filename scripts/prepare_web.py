"""Prepare static GitHub Pages assets. No patient files are copied."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT
ORT_VERSION = '1.23.2'
MODEL_NAME = 'rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504'


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'InfantMotionResearch/0.2'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main():
    assets, vendor = WEB / 'assets', WEB / 'vendor'
    assets.mkdir(parents=True, exist_ok=True)
    vendor.mkdir(parents=True, exist_ok=True)
    local = list((ROOT / 'models').glob(MODEL_NAME + '*.onnx'))
    if local:
        model = local[0].read_bytes()
    else:
        archive = fetch('https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/' + MODEL_NAME + '.zip')
        if hashlib.sha256(archive).hexdigest() != 'f7fbb6c5c11a1bb70f3d445e4ddec5d144ea89ad5649c081ef976f9b24a0b741':
            raise ValueError('Official model archive checksum mismatch')
        with zipfile.ZipFile(io.BytesIO(archive)) as source:
            names = [n for n in source.namelist() if n.endswith('.onnx')]
            if len(names) != 1:
                raise ValueError('Expected one ONNX model')
            model = source.read(names[0])
    if hashlib.sha256(model).hexdigest() != '5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c':
        raise ValueError('RTMPose-M ONNX checksum mismatch')
    parts = []
    for i, start in enumerate(range(0, len(model), 16 * 1024 * 1024)):
        name = f'rtmpose-m.part{i:02d}'
        chunk = model[start:start + 16 * 1024 * 1024]
        (assets / name).write_bytes(chunk)
        parts.append({'file': name, 'bytes': len(chunk), 'sha256': hashlib.sha256(chunk).hexdigest()})
    manifest = {'name': MODEL_NAME, 'input': [1, 3, 256, 192], 'joint_count': 17,
                'bytes': len(model), 'sha256': hashlib.sha256(model).hexdigest(), 'parts': parts,
                'source': 'https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose',
                'runtime': f'onnxruntime-web@{ORT_VERSION}'}
    (assets / 'model.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    runtime_path = vendor / 'ort.wasm.min.mjs'
    if not runtime_path.exists():
        package = fetch(f'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-{ORT_VERSION}.tgz')
        with tarfile.open(fileobj=io.BytesIO(package), mode='r:gz') as source:
            for name in ['dist/ort.wasm.min.mjs', 'dist/ort-wasm-simd-threaded.mjs',
                         'dist/ort-wasm-simd-threaded.wasm']:
                member = source.extractfile('package/' + name)
                if member is None:
                    raise ValueError(f'Missing runtime asset: {name}')
                destination = vendor / (Path(name).name if name != 'LICENSE' else 'ONNXRUNTIME-LICENSE.txt')
                destination.write_bytes(member.read())
    for target, url in {
        vendor / 'MMPose-LICENSE.txt': 'https://raw.githubusercontent.com/open-mmlab/mmpose/main/LICENSE',
    }.items():
        if not target.exists():
            target.write_bytes(fetch(url))
    (WEB / '.nojekyll').touch()
    print(json.dumps({'model_bytes': len(model), 'model_parts': len(parts), 'runtime': ORT_VERSION}))


if __name__ == '__main__':
    main()
