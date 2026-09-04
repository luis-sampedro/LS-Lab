import cv2
import sys
sys.path.insert(0, 'autodetect-workbench')
from engine import run_autodetect_pipeline

im = cv2.imread('autodetect-workbench/uploads/Port1.jpg')
res = run_autodetect_pipeline(im, enforce_bowl=True)
print('Execution time:', res['elapsed_ms'], 'ms')
print('Detected sail:', res['detected_sail']['name'])
print('Detected stripe:', res['detected_stripe']['name'])
print('Stripes found:', len(res['stripes']))

for s in res['stripes']:
    m = s['metrics']
    lbl = s['label']
    c = s['color']
    p0x, p0y = s['p0']['x'], s['p0']['y']
    p3x, p3y = s['p3']['x'], s['p3']['y']
    camb = m['camber']
    dr = m['draft_pos']
    bowl = m['bowl_orientation']
    print(f"{lbl} [{c}]:")
    print(f"   P0: ({p0x:.1f}, {p0y:.1f}) -> P3: ({p3x:.1f}, {p3y:.1f})")
    print(f"   Camber: {camb:.1f}% | Draft: {dr:.1f}% | Bowl: {bowl}")
