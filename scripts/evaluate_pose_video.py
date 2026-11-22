"""Optional local full-frame smoke evaluation; no ground-truth accuracy claim."""
import argparse
import hashlib
import json
from pathlib import Path

def main():
    import cv2
    import numpy as np
    from rtmlib import RTMPose
    parser=argparse.ArgumentParser()
    parser.add_argument('video',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    manifest=json.loads((root/'assets/model.json').read_text())
    model=b''.join((root/'assets'/part['file']).read_bytes() for part in manifest['parts'])
    if hashlib.sha256(model).hexdigest()!=manifest['sha256']:raise SystemExit('Model hash mismatch; run prepare_web.py')
    output=root/'outputs/evaluation-model.onnx';output.parent.mkdir(exist_ok=True);output.write_bytes(model)
    pose=RTMPose(str(output),model_input_size=(192,256),backend='onnxruntime',device='cpu',to_openpose=False)
    cap=cv2.VideoCapture(str(args.video));fps=cap.get(cv2.CAP_PROP_FPS)
    if fps<=0:raise SystemExit('Video cannot be decoded')
    raw={'times':[],'xy':[],'scores':[]}
    while True:
        ok,frame=cap.read()
        if not ok:break
        h,w=frame.shape[:2];xy,scores=pose(frame,[[0,0,w,h]])
        raw['times'].append(len(raw['times'])/fps);raw['xy'].append(xy[0].tolist());raw['scores'].append(scores[0].tolist())
    cap.release();args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(raw,allow_nan=False))
    score=np.asarray(raw['scores']);valid=np.isfinite(np.asarray(raw['xy'])).all(axis=2)
    print(json.dumps({'frames':len(score),'fps':fps,'minimum_score':float(score.min()),'rates':{str(t):float(np.mean((score>=t)&valid)*100) for t in [.4,.2,.1]}}))

if __name__=='__main__':main()
