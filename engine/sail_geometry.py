"""
Sail Geometry & Boundary Envelope Module
Identifies sail cloth vs sky/sun glare, computes Luff (leading edge) and Leech (trailing edge)
envelopes, and estimates the sky direction vector for the aerodynamic bowl constraint.
"""

import cv2
import numpy as np


def analyze_sail_geometry(img_bgr):
    """
    Analyzes sail boundaries, cloth region, and orientation.
    Returns:
        dict: {
            'sail_mask': np.ndarray (uint8 binary mask),
            'sky_mask': np.ndarray (uint8 binary mask),
            'luff_xs': np.ndarray (x coordinates of luff per row),
            'leech_xs': np.ndarray (x coordinates of leech per row),
            'y_min': int,
            'y_max': int,
            'sail_height': int,
            'is_dark_sail': bool,
            'mean_brightness': float,
            'sail_color_name': str,
            'sail_color_hex': str,
            'sky_direction': dict ({'dx': float, 'dy': float} vector pointing towards sky/masthead)
        }
    """
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    b, g, r = cv2.split(img_bgr)
    
    # 1. Sky & Sun Glare Detection
    b_f = b.astype(np.float32)
    r_f = r.astype(np.float32)
    g_f = g.astype(np.float32)
    
    blue_dom = (b_f - r_f > 12.0) & (b > 115) & (gray > 75)
    sun_glare = (gray > 248) & (r > 240) & (g > 240) & (b > 240)
    sky_mask = (blue_dom | sun_glare)
    
    # Sail cloth is everything inside the frame that is not sky/glare
    sail_mask = (~sky_mask).astype(np.uint8)
    
    # Morphological closing to seal seams and interior holes
    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    sail_mask = cv2.morphologyEx(sail_mask, cv2.MORPH_CLOSE, k_close)
    
    # Remove small specks
    k_open = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    sail_mask = cv2.morphologyEx(sail_mask, cv2.MORPH_OPEN, k_open)
    
    # 2. Sail Cloth Properties
    sail_pixels_gray = gray[sail_mask > 0]
    sail_pixels_bgr = img_bgr[sail_mask > 0]
    
    mean_b = float(np.mean(sail_pixels_gray)) if len(sail_pixels_gray) > 0 else 128.0
    is_dark = (mean_b < 125.0)
    
    if len(sail_pixels_bgr) > 0:
        avg_b = int(np.mean(sail_pixels_bgr[:, 0]))
        avg_g = int(np.mean(sail_pixels_bgr[:, 1]))
        avg_r = int(np.mean(sail_pixels_bgr[:, 2]))
        color_hex = f"#{avg_r:02x}{avg_g:02x}{avg_b:02x}"
        if mean_b < 90:
            color_name = "Black Carbon / Dark Laminate"
        elif mean_b > 155:
            color_name = "White Dacron / Membrane"
        else:
            color_name = "Gray / Translucent 3Di"
    else:
        color_hex = "#1e293b" if is_dark else "#f8fafc"
        color_name = "Black Carbon" if is_dark else "White Dacron"
        
    # 3. Sail Boundary Envelopes (Luff and Leech per row)
    luff_xs = np.zeros(h, dtype=np.float32)
    leech_xs = np.zeros(h, dtype=np.float32)
    valid_rows = []
    
    min_row_width = max(15, int(w * 0.08))
    for y in range(h):
        row_indices = np.where(sail_mask[y, :] > 0)[0]
        if len(row_indices) >= min_row_width:
            luff_xs[y] = float(row_indices[0])
            leech_xs[y] = float(row_indices[-1])
            valid_rows.append(y)
            
    if len(valid_rows) < 20:
        y_min, y_max = int(h * 0.08), int(h * 0.92)
        luff_xs[:] = float(w * 0.08)
        leech_xs[:] = float(w * 0.92)
    else:
        y_min = min(valid_rows)
        y_max = max(valid_rows)
        valid_set = set(valid_rows)
        # Interpolate rows outside valid set
        for y in range(h):
            if y not in valid_set:
                luff_xs[y] = float(w * 0.08)
                leech_xs[y] = float(w * 0.92)
                
    sail_height = max(50, y_max - y_min)
    
    # 4. Sky Direction Vector (direction pointing towards the sky / masthead)
    sky_ys = np.where(sky_mask > 0)[0]
    if len(sky_ys) > 50:
        mean_sky_y = float(np.mean(sky_ys))
        mean_sail_y = float(np.mean(np.where(sail_mask > 0)[0]))
        dy = -1.0 if mean_sky_y < mean_sail_y else 1.0
    else:
        dy = -1.0  # default upwards towards image top
        
    sky_direction = {'dx': 0.0, 'dy': dy}
    
    return {
        'sail_mask': sail_mask,
        'sky_mask': sky_mask.astype(np.uint8) * 255,
        'luff_xs': luff_xs,
        'leech_xs': leech_xs,
        'y_min': y_min,
        'y_max': y_max,
        'sail_height': sail_height,
        'is_dark_sail': is_dark,
        'mean_brightness': mean_b,
        'sail_color_name': color_name,
        'sail_color_hex': color_hex,
        'sky_direction': sky_direction
    }
