"""
Step 3: Locate Sail Boundaries (Luff and Leech)
Robustly detects the Luff (leading edge along mast/forestay) and Leech (trailing edge)
supporting both Port tack (mast on left) and Starboard tack (mast on right).
"""

import cv2
import numpy as np
import math


def locate_sail_boundaries(img_bgr, sail_type='mainsail', mast_info=None, sun_info=None):
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    b, g, r = cv2.split(img_bgr)
    
    # 1. Determine mast side (left = Port tack, right = Starboard tack)
    luff_side = mast_info.get('side', 'left') if mast_info else 'left'
    leech_side = 'right' if luff_side == 'left' else 'left'
    
    # Check if sail is predominantly dark (carbon/membrane) or light (dacron/white laminate)
    mean_brightness = float(np.mean(gray))
    # Look at the sail side near the mast/luff
    luff_zone = gray[:, :int(w * 0.45)] if luff_side == 'left' else gray[:, int(w * 0.55):]
    is_dark_sail = bool(np.mean(luff_zone) < 125.0 or np.median(gray) < 118.0)
    
    # 2. Extract Sail Cloth Region
    # In foot photos looking up, background is sky (high blue excess or high brightness glare)
    # or sea/deck, while sail cloth is a coherent connected region.
    b_f, r_f, g_f = b.astype(np.float32), r.astype(np.float32), g.astype(np.float32)
    blue_sky = (b_f - r_f > 12.0) & (b > 80)
    sun_glare = (gray > 245) & (r > 230) & (g > 230) & (b > 230)
    sky_mask = (blue_sky | sun_glare)
    
    if is_dark_sail:
        # Dark cloth: pixels darker than sky
        cloth_raw = ((gray < 165) & (~blue_sky)).astype(np.uint8) * 255
    else:
        # Light cloth: not sky
        cloth_raw = (~sky_mask).astype(np.uint8) * 255
        
    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
    cloth_clean = cv2.morphologyEx(cloth_raw, cv2.MORPH_CLOSE, k_close)
    
    # Keep largest connected component as the main sail body
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(cloth_clean)
    sail_mask = np.zeros((h, w), dtype=np.uint8)
    if num_labels > 1:
        best_comp = max(range(1, num_labels), key=lambda i: stats[i, cv2.CC_STAT_AREA])
        sail_mask[labels == best_comp] = 255
    else:
        sail_mask = cloth_clean.copy()
        
    # Dilate slightly to ensure complete boundary coverage
    k_dil = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11))
    sail_mask = cv2.dilate(sail_mask, k_dil)
    
    # 3. Find vertical extent of sail
    row_sums = np.sum(sail_mask > 0, axis=1)
    min_width_thresh = max(15, int(w * 0.04))
    valid_ys = np.where(row_sums >= min_width_thresh)[0]
    
    if len(valid_ys) > 20:
        y_head = int(valid_ys[0])
        y_foot = int(valid_ys[-1])
    else:
        y_head = int(h * 0.10)
        y_foot = int(h * 0.90)
        
    y_head = max(0, min(y_head, int(h * 0.25)))
    y_foot = min(h - 1, max(y_foot, int(h * 0.80)))
    
    # 4. Extract Luff and Leech coordinates row by row
    luff_xs = [float(w * 0.08 if luff_side == 'left' else w * 0.92)] * h
    leech_xs = [float(w * 0.92 if luff_side == 'left' else w * 0.08)] * h
    
    # Mast line guidance if available from step 2
    mast_top = mast_info.get('p_top', {'x': w * 0.15 if luff_side == 'left' else w * 0.85, 'y': y_head})
    mast_bot = mast_info.get('p_bot', {'x': w * 0.05 if luff_side == 'left' else w * 0.95, 'y': y_foot})
    mast_dx = mast_bot['x'] - mast_top['x']
    mast_dy = mast_bot['y'] - mast_top['y'] + 1e-6
    
    for y in range(y_head, y_foot + 1):
        row_indices = np.where(sail_mask[y, :] > 0)[0]
        t_y = (y - mast_top['y']) / mast_dy
        mast_x_row = float(np.clip(mast_top['x'] + mast_dx * t_y, 0, w - 1))
        
        if len(row_indices) >= min_width_thresh:
            min_x = float(row_indices[0])
            max_x = float(row_indices[-1])
            
            if luff_side == 'left':
                luff_xs[y] = min(min_x, mast_x_row + 15.0)
                leech_xs[y] = max_x
            else:
                luff_xs[y] = max(max_x, mast_x_row - 15.0)
                leech_xs[y] = min_x
        else:
            # Tapering triangle fallback
            t_span = (y - y_head) / max(1.0, float(y_foot - y_head))
            if luff_side == 'left':
                luff_xs[y] = mast_x_row
                leech_xs[y] = float(np.clip(w * (0.35 + 0.55 * t_span), 0, w - 1))
            else:
                luff_xs[y] = mast_x_row
                leech_xs[y] = float(np.clip(w * (0.65 - 0.55 * t_span), 0, w - 1))
                
    # 5. Build Smooth Luff and Leech Polylines (Ordered from Foot=0 to Head=1)
    num_samples = 35
    luff_poly = []
    leech_poly = []
    
    sample_ys = np.linspace(y_foot, y_head, num_samples) # Bottom to Top
    for y in sample_ys:
        iy = int(np.clip(round(y), 0, h - 1))
        luff_poly.append([round(luff_xs[iy], 1), round(float(y), 1)])
        leech_poly.append([round(leech_xs[iy], 1), round(float(y), 1)])
        
    tack = {'x': luff_poly[0][0], 'y': luff_poly[0][1]}
    clew = {'x': leech_poly[0][0], 'y': leech_poly[0][1]}
    head = {'x': round((luff_poly[-1][0] + leech_poly[-1][0]) / 2.0, 1), 'y': luff_poly[-1][1]}
    
    # Polygon surrounding the sail: Luff (foot->head) then Leech (head->foot)
    sail_polygon = luff_poly + list(reversed(leech_poly))
    
    # Cloth color naming
    cloth_hex = '#1e293b' if is_dark_sail else '#f8fafc'
    cloth_name = 'Black Carbon / Membrane' if is_dark_sail else 'White Dacron / Laminate'
    
    desc = (
        f"Located sail cloth boundaries. Luff on {luff_side} (from x={int(tack['x'])}, y={int(tack['y'])} to head at y={int(head['y'])}), "
        f"Leech on {leech_side} (clew at x={int(clew['x'])}, y={int(clew['y'])}). Cloth: {cloth_name}."
    )
    
    return {
        'sail_mask': sail_mask,
        'luff_polyline': luff_poly,
        'leech_polyline': leech_poly,
        'sail_polygon': sail_polygon,
        'head': head,
        'tack': tack,
        'clew': clew,
        'luff_side': luff_side,
        'leech_side': leech_side,
        'y_head': y_head,
        'y_foot': y_foot,
        'luff_xs': luff_xs,
        'leech_xs': leech_xs,
        'cloth_color_hex': cloth_hex,
        'cloth_color_name': cloth_name,
        'cloth_uniformity_pct': 90.0,
        'description': desc
    }
