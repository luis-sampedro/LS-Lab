"""
Verification Test for Cognitive Sail Recognition Pipeline
Tests Steps 1 through 5 on user images and gallery test images.
"""

import os
import sys
import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from engine.step1_light_sun import locate_sun_and_light
from engine.step2_mast_detector import locate_mast
from engine.step3_sail_boundaries import locate_sail_boundaries
from engine.step4_height_sectors import compute_height_sectors
from engine.step5_camber_stripes import detect_camber_stripes


def test_image(img_path, sail_type='mainsail'):
    print(f"\n==========================================")
    print(f"Testing Cognitive Pipeline on: {os.path.basename(img_path)}")
    print(f"==========================================")
    
    if not os.path.exists(img_path):
        print(f"SKIPPED: File does not exist: {img_path}")
        return False
        
    img = cv2.imread(img_path)
    if img is None:
        print(f"ERROR: Could not read image: {img_path}")
        return False
        
    h, w = img.shape[:2]
    print(f"Image Resolution: {w}x{h}")
    
    # Step 1: Sun & Light Source
    sun = locate_sun_and_light(img)
    print(f"[Step 1 - Sun/Light]: {sun['description']}")
    assert sun['is_top_illumination'], "Step 1 Failed: Light not detected in top half!"
    
    # Step 2: Mast Detector
    mast = locate_mast(img, sail_type=sail_type, sun_info=sun)
    print(f"[Step 2 - Mast]: {mast['description']}")
    assert mast['side'] in ['left', 'right'], "Step 2 Failed: Mast side not identified!"
    
    # Step 3: Sail Cloth & Boundaries
    bounds = locate_sail_boundaries(img, sail_type=sail_type, mast_info=mast, sun_info=sun)
    print(f"[Step 3 - Boundaries]: {bounds['description']}")
    assert len(bounds['luff_polyline']) > 5, "Step 3 Failed: Luff polyline too short!"
    assert len(bounds['leech_polyline']) > 5, "Step 3 Failed: Leech polyline too short!"
    assert bounds['head']['y'] < bounds['tack']['y'], "Step 3 Failed: Head is below tack!"
    
    # Step 4: Height Sectors
    sectors = compute_height_sectors(img, bounds, mast_info=mast)
    print(f"[Step 4 - Sectors]: {sectors['description']}")
    assert len(sectors['sectors']) == 3, "Step 4 Failed: Exactly 3 sectors required!"
    
    # Step 5: Camber Stripes
    stripes_res = detect_camber_stripes(img, bounds, sectors, mast_info=mast)
    print(f"[Step 5 - Camber]: {stripes_res['description']}")
    assert len(stripes_res['stripes']) == 3, "Step 5 Failed: Exactly 3 stripes required!"
    
    for s in stripes_res['stripes']:
        m = s['metrics']
        print(f"   -> {s['name']}: Camber={m['camber']}%, Draft={m['draft_pos']}%, Twist={m['twist']}deg, Chord={m['chord_len']}px, Bowl={m['bowl_valid']}")
        assert 7.0 <= m['camber'] <= 15.0, f"Camber out of range: {m['camber']}%"
        assert 30.0 <= m['draft_pos'] <= 50.0, f"Draft pos out of range: {m['draft_pos']}%"
        assert m['bowl_valid'], "Bowl orientation not verified!"
        
    print(">>> ALL TESTS PASSED FOR THIS IMAGE! <<<")
    return True


if __name__ == '__main__':
    images = [
        (r'autodetect-workbench/uploads/Port1.jpg', 'mainsail'),
        (r'camber-images/test1.jpg', 'mainsail'),
        (r'camber-images/test2.jpg', 'mainsail')
    ]
    
    all_ok = True
    for p, st in images:
        ok = test_image(p, sail_type=st)
        if not ok:
            all_ok = False
            
    if all_ok:
        print("\n==========================================")
        print("ALL IMAGES SUCCESSFULLY PROCESSED & VERIFIED!")
        print("==========================================")
    else:
        print("\nSOME TESTS FAILED!")
        sys.exit(1)
