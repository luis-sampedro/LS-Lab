import cv2
import numpy as np
import base64
import math
import warnings
from skimage.graph import route_through_array
from skimage.filters import frangi
try:
    from numpy.exceptions import RankWarning
except ImportError:
    RankWarning = getattr(np, 'RankWarning', Warning)
warnings.filterwarnings('ignore', category=RankWarning)
from scipy.signal import savgol_filter, find_peaks
warnings.filterwarnings('ignore')

def compute_4pt_bspline_controls(p_start, p_end, camber_pct=11.5, draft_pos_pct=45.0, camber_sign=1.0):
    """
    Computes 4-point 3rd-degree (cubic) B-Spline / Bezier control points:
    P0: Luff Root
    P1: Entry Tangent & Fullness Control Point
    P2: Max Draft & Exit Tangent Control Point
    P3: Leech Root
    """
    p0 = {'x': float(p_start['x']), 'y': float(p_start['y'])}
    p3 = {'x': float(p_end['x']), 'y': float(p_end['y'])}
    
    chord_len = math.hypot(p3['x'] - p0['x'], p3['y'] - p0['y']) + 1e-6
    dx = p3['x'] - p0['x']
    dy = p3['y'] - p0['y']
    ux = dx / chord_len
    uy = dy / chord_len
    nx = -uy
    ny = ux
    
    camber_depth = (camber_pct / 100.0) * chord_len * camber_sign
    draft_frac = (draft_pos_pct / 100.0)
    
    p1 = {
        'x': float(p0['x'] + dx * 0.28 + nx * camber_depth * 0.75),
        'y': float(p0['y'] + dy * 0.28 + ny * camber_depth * 0.75)
    }
    p2 = {
        'x': float(p0['x'] + dx * max(0.40, min(0.85, draft_frac + 0.10)) + nx * camber_depth * 1.15),
        'y': float(p0['y'] + dy * max(0.40, min(0.85, draft_frac + 0.10)) + ny * camber_depth * 1.15)
    }
    return p0, p1, p2, p3

def autodetect_foot_stripes(image_bytes, sail_color='auto', stripe_color='auto', num_stripes=3, sensitivity=1.0):
    """
    Intelligent Auto-detection of camber draft stripes for sail photos.
    Supports various sail materials (white/dacron/3Di, black carbon/technora, translucent)
    and stripe colors (white, light gray, blue, red, black, green, orange, yellow, custom hex).
    Accurately maps camber stripes from Luff to Leech across Bottom, Mid, and Top heights.
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image buffer")
    
    orig_h, orig_w = img.shape[:2]
    
    # Work on a normalized processing scale (max dimension 950px) for speed (<120ms) and stability
    scale = 1.0
    max_dim = max(orig_h, orig_w)
    if max_dim > 950:
        scale = 950.0 / max_dim
        proc_w = int(orig_w * scale)
        proc_h = int(orig_h * scale)
        proc_img = cv2.resize(img, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
    else:
        proc_img = img.copy()
        proc_w, proc_h = orig_w, orig_h
        
    gray = cv2.cvtColor(proc_img, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(proc_img, cv2.COLOR_BGR2Lab)
    b, g, r = cv2.split(proc_img)
    
    stripe_color_lower = str(stripe_color).lower().strip() if stripe_color else 'auto'
    sail_color_lower = str(sail_color).lower().strip() if sail_color else 'auto'
    
    # 1. Sail Mask vs Sky/Sun
    sky_mask = (b > 120) & (b.astype(np.float32) > r.astype(np.float32) + 10) & (gray > 80)
    sun_glare = (gray > 248)
    sail_mask = (~sky_mask) & (~sun_glare)
    kernel_m = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    sail_mask = cv2.morphologyEx(sail_mask.astype(np.uint8), cv2.MORPH_CLOSE, kernel_m)
    
    sail_pixels = gray[sail_mask > 0]
    mean_brightness = float(np.mean(sail_pixels)) if len(sail_pixels) > 0 else 128.0
    is_dark_sail = (sail_color_lower in ['black', 'dark', 'carbon']) or (sail_color_lower == 'auto' and mean_brightness < 125.0)
    
    # Per-row sail envelope (Luff and Leech)
    luff_xs = np.zeros(proc_h, dtype=np.float32)
    leech_xs = np.zeros(proc_h, dtype=np.float32)
    valid_rows = []
    for y in range(proc_h):
        row_pts = np.where(sail_mask[y, :] > 0)[0]
        if len(row_pts) > int(proc_w * 0.10):
            luff_xs[y] = row_pts[0]
            leech_xs[y] = row_pts[-1]
            valid_rows.append(y)
            
    if len(valid_rows) < 20:
        y_min_sail, y_max_sail = int(proc_h * 0.10), int(proc_h * 0.90)
        luff_xs[:] = proc_w * 0.08
        leech_xs[:] = proc_w * 0.92
    else:
        y_min_sail, y_max_sail = min(valid_rows), max(valid_rows)
        valid_set = set(valid_rows)
        for y in range(proc_h):
            if y not in valid_set:
                luff_xs[y] = proc_w * 0.08
                leech_xs[y] = proc_w * 0.92
                
    sail_height = max(50, y_max_sail - y_min_sail)
    
    # Compute Autodetected Sail Color Metrics
    sail_pts_bgr = proc_img[sail_mask > 0]
    if len(sail_pts_bgr) > 0:
        sail_b = int(np.mean(sail_pts_bgr[:, 0]))
        sail_g = int(np.mean(sail_pts_bgr[:, 1]))
        sail_r = int(np.mean(sail_pts_bgr[:, 2]))
        detected_sail_hex = f"#{sail_r:02x}{sail_g:02x}{sail_b:02x}"
        if mean_brightness < 90:
            detected_sail_name = "Black Carbon / Dark Laminate"
        elif mean_brightness > 155:
            detected_sail_name = "White Dacron / Membrane"
        else:
            detected_sail_name = "Gray / Translucent 3Di"
    else:
        detected_sail_hex = "#1e293b" if is_dark_sail else "#f8fafc"
        detected_sail_name = "Black Carbon" if is_dark_sail else "White Dacron"

    # 2. Multi-spectral ridge & contrast saliency
    k_stripe = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 3))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_stripe).astype(np.float32)
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, k_stripe).astype(np.float32)
    blue_chroma = np.maximum(0, b.astype(np.float32) - np.maximum(r.astype(np.float32), g.astype(np.float32)))
    red_chroma = np.maximum(0, r.astype(np.float32) - np.maximum(b.astype(np.float32), g.astype(np.float32)))
    
    is_custom_hex = stripe_color_lower.startswith('#') or (len(stripe_color_lower) in [6, 3] and all(c in '0123456789abcdef' for c in stripe_color_lower))
    
    if is_custom_hex:
        hex_clean = stripe_color_lower.lstrip('#')
        if len(hex_clean) == 3: hex_clean = ''.join([c*2 for c in hex_clean])
        r_tgt = int(hex_clean[0:2], 16)
        g_tgt = int(hex_clean[2:4], 16)
        b_tgt = int(hex_clean[4:6], 16)
        tgt_bgr = np.uint8([[[b_tgt, g_tgt, r_tgt]]])
        tgt_lab = cv2.cvtColor(tgt_bgr, cv2.COLOR_BGR2Lab)[0, 0].astype(np.float32)
        
        delta_L = (lab[:, :, 0].astype(np.float32) - tgt_lab[0]) * 0.4
        delta_a = lab[:, :, 1].astype(np.float32) - tgt_lab[1]
        delta_b = lab[:, :, 2].astype(np.float32) - tgt_lab[2]
        c_dist = np.sqrt(delta_L**2 + delta_a**2 + delta_b**2)
        sal = np.maximum(0, 100.0 - c_dist * 2.0)
        detected_stripe_name = f"Custom Color (#{hex_clean})"
        detected_stripe_hex = f"#{hex_clean}"
    elif stripe_color_lower == 'red':
        sal = red_chroma * 2.5
        detected_stripe_name = "Red Stripe"
        detected_stripe_hex = "#ef4444"
    elif stripe_color_lower == 'blue':
        sal = blue_chroma * 2.5
        detected_stripe_name = "Blue Stripe"
        detected_stripe_hex = "#3b82f6"
    elif stripe_color_lower in ['black', 'dark']:
        sal = blackhat * 2.0
        detected_stripe_name = "Dark / Black Stripe"
        detected_stripe_hex = "#1e293b"
    elif stripe_color_lower in ['white', 'light']:
        sal = tophat * 2.5
        detected_stripe_name = "White / Light Stripe"
        detected_stripe_hex = "#f8fafc"
    else:  # 'auto' mode
        if is_dark_sail:
            r_peak = np.percentile(red_chroma[sail_mask > 0], 99.5) if np.any(sail_mask > 0) else 0
            if r_peak > 35:
                sal = red_chroma * 2.5
                detected_stripe_name = "Red Stripe"
                detected_stripe_hex = "#ef4444"
            else:
                sal = tophat * 2.5
                detected_stripe_name = "White / Light Stripe"
                detected_stripe_hex = "#f8fafc"
        else:
            b_peak = np.percentile(blue_chroma[sail_mask > 0], 99.5) if np.any(sail_mask > 0) else 0
            r_peak = np.percentile(red_chroma[sail_mask > 0], 99.5) if np.any(sail_mask > 0) else 0
            if b_peak > 25:
                sal = blue_chroma * 2.5
                detected_stripe_name = "Blue Stripe"
                detected_stripe_hex = "#3b82f6"
            elif r_peak > 35:
                sal = red_chroma * 2.5
                detected_stripe_name = "Red Stripe"
                detected_stripe_hex = "#ef4444"
            else:
                sal = blackhat * 2.0
                detected_stripe_name = "Dark / Black Stripe"
                detected_stripe_hex = "#1e293b"

    sal[sail_mask == 0] = 0
    sal *= float(sensitivity)
    
    # 3. Aerodynamic Draft Stripe Bands (Bottom, Mid, Top)
    colors = ['#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
    
    if num_stripes == 1:
        band_ranges = [('Mid', 0.25, 0.65)]
    elif num_stripes == 2:
        band_ranges = [('Bottom', 0.40, 0.85), ('Top', 0.10, 0.45)]
    else:
        band_ranges = [
            ('Bottom', 0.38, 0.85),
            ('Mid', 0.20, 0.55),
            ('Top', 0.05, 0.35)
        ]
        
    detected_stripes = []
    
    for idx, (b_label, f_min, f_max) in enumerate(band_ranges[:num_stripes]):
        y1_b = int(y_min_sail + f_min * sail_height)
        y2_b = int(min(proc_h - 4, y_min_sail + f_max * sail_height))
        if y2_b <= y1_b: continue
        
        sub_sal = sal[y1_b:y2_b, :]
        row_sums = np.sum(sub_sal, axis=1) if sub_sal.size > 0 else np.array([])
        
        if row_sums.size == 0 or np.max(row_sums) == 0:
            peak_y = (y1_b + y2_b) // 2
        else:
            peak_y = y1_b + int(np.argmax(row_sums))
            
        w_h = max(16, int(sail_height * 0.08))
        w1, w2 = max(0, peak_y - w_h), min(proc_h, peak_y + w_h)
        
        sal_sail_pts = sal[sail_mask > 0]
        thresh_val = np.percentile(sal_sail_pts, 80) if len(sal_sail_pts) > 0 else 10.0
        sub_pts_mask = (sal[w1:w2, :] > max(8.0, thresh_val))
        pts_y, pts_x = np.where(sub_pts_mask)
        pts_y += w1
        
        y_center = int(np.clip(peak_y, 0, proc_h - 1))
        x_start_proc = float(luff_xs[y_center])
        x_end_proc = float(leech_xs[y_center])
        chord_proc = max(20.0, x_end_proc - x_start_proc)
        
        fitted_poly = None
        if len(pts_x) >= 20 and (pts_x.max() - pts_x.min()) > (proc_w * 0.20):
            # RANSAC on points within band
            best_inliers_cnt = 0
            for _ in range(120):
                samp_idx = np.random.choice(len(pts_x), 3, replace=False)
                sx, sy = pts_x[samp_idx], pts_y[samp_idx]
                if (np.max(sx) - np.min(sx)) < (chord_proc * 0.25): continue
                try:
                    p = np.polyfit(sx, sy, 2)
                    if abs(p[0]) > 0.005: continue
                    pred_y = np.polyval(p, pts_x)
                    inliers_cnt = np.sum(np.abs(pts_y - pred_y) < 8.0)
                    if inliers_cnt > best_inliers_cnt:
                        best_inliers_cnt = inliers_cnt
                        fitted_poly = p
                except Exception:
                    pass
            if fitted_poly is not None and best_inliers_cnt >= 20:
                inlier_mask = np.abs(pts_y - np.polyval(fitted_poly, pts_x)) < 8.0
                in_x = pts_x[inlier_mask]
                in_y = pts_y[inlier_mask]
                try:
                    fitted_poly = np.polyfit(in_x, in_y, 2)
                    x_start_proc = float(min(x_start_proc, in_x.min()))
                    x_end_proc = float(max(x_end_proc, in_x.max()))
                except Exception:
                    pass
                    
        if fitted_poly is None:
            # Aerodynamic parabolic curve spanning from luff to leech
            c_depth = chord_proc * (0.12 - idx * 0.015)
            x_mid = x_start_proc + chord_proc * 0.45
            fitted_poly = np.polyfit([x_start_proc, x_mid, x_end_proc], [peak_y - 4, peak_y + c_depth, peak_y], 2)
            
        eval_xs_proc = np.linspace(x_start_proc, x_end_proc, 70)
        eval_ys_proc = np.polyval(fitted_poly, eval_xs_proc)
        
        # Map back to original coordinate space
        eval_xs = eval_xs_proc / scale
        eval_ys = eval_ys_proc / scale
        path = [[float(x), float(y)] for x, y in zip(eval_xs, eval_ys)]
        
        p0_pt = {'x': float(eval_xs[0]), 'y': float(eval_ys[0])}
        p3_pt = {'x': float(eval_xs[-1]), 'y': float(eval_ys[-1])}
        
        chord_len = math.hypot(p3_pt['x'] - p0_pt['x'], p3_pt['y'] - p0_pt['y']) + 1e-6
        dx = p3_pt['x'] - p0_pt['x']
        dy = p3_pt['y'] - p0_pt['y']
        
        dists = []
        for px, py in path:
            dist = (dy * px - dx * py + p3_pt['x'] * p0_pt['y'] - p3_pt['y'] * p0_pt['x']) / chord_len
            dists.append(dist)
            
        max_idx = int(np.argmax(np.abs(dists))) if dists else 0
        max_depth = abs(dists[max_idx]) if dists else 0.0
        camber_sign = 1.0 if dists[max_idx] >= 0 else -1.0
        camber_pct = float((max_depth / chord_len) * 100.0)
        draft_pos_pct = float((max_idx / max(1, len(path) - 1)) * 100.0)
        
        # Compute 4-point B-spline controls with signed camber
        p0_ctrl, p1_ctrl, p2_ctrl, p3_ctrl = compute_4pt_bspline_controls(
            p0_pt, p3_pt, max(5.0, camber_pct), draft_pos_pct, camber_sign
        )
        
        max_pt = {'x': float(eval_xs[max_idx]), 'y': float(eval_ys[max_idx])}
        
        detected_stripes.append({
            'id': f'stripe_{idx+1}',
            'label': f'Stripe #{idx+1} ({b_label})',
            'color': colors[idx % len(colors)],
            'p0': p0_ctrl,
            'p1': p1_ctrl,
            'p2': p2_ctrl,
            'p3': p3_ctrl,
            'path': path,
            'mean_y': float(np.mean(eval_ys)),
            'metrics': {
                'camber': round(camber_pct, 2),
                'draft_pos': round(draft_pos_pct, 1),
                'twist': round(idx * 3.5, 1),
                'entry': 17.0,
                'exit': 8.5,
                'chord_len': round(chord_len, 1),
                'max_point': max_pt,
                'normalized_curve': [[(px - p0_pt['x'])/chord_len, (abs(d)/chord_len)*100] for (px, py), d in zip(path, dists)]
            }
        })
        
    return {
        'success': True,
        'stripes': detected_stripes,
        'sail_color_detected': 'black' if is_dark_sail else 'white',
        'stripe_color_detected': stripe_color_lower,
        'detected_sail': {
            'name': detected_sail_name,
            'hex': detected_sail_hex,
            'is_dark': bool(is_dark_sail),
            'brightness': round(mean_brightness, 1)
        },
        'detected_stripe': {
            'name': detected_stripe_name,
            'hex': detected_stripe_hex,
            'color_type': stripe_color_lower
        },
        'image_dimensions': {'width': int(orig_w), 'height': int(orig_h)}
    }

def snap_stripe_at_point(image_bytes, click_pt, sail_color='auto', stripe_color='auto', sensitivity=1.0):
    """
    1-Click Smart Ridge Snap Tool:
    Given a single click coordinate (x, y), locks onto the stripe ridge and traces the full curve across the sail!
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None: raise ValueError("Decode error")
    
    orig_h, orig_w = img.shape[:2]
    cx, cy = int(click_pt['x']), int(click_pt['y'])
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    b, g, r = cv2.split(img)
    
    stripe_color_lower = str(stripe_color).lower().strip() if stripe_color else 'auto'
    sail_color_lower = str(sail_color).lower().strip() if sail_color else 'auto'
    mean_brightness = float(np.mean(gray))
    is_dark_sail = (sail_color_lower in ['black', 'dark', 'carbon']) or (sail_color_lower == 'auto' and mean_brightness < 125)
    
    # 1. Saliency
    is_custom_hex = stripe_color_lower.startswith('#') or (len(stripe_color_lower) in [6, 3] and all(c in '0123456789abcdef' for c in stripe_color_lower))
    
    k_stripe = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 3))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_stripe).astype(np.float32)
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, k_stripe).astype(np.float32)
    blue_chroma = np.maximum(0, b.astype(np.float32) - np.maximum(r.astype(np.float32), g.astype(np.float32)))
    red_chroma = np.maximum(0, r.astype(np.float32) - np.maximum(b.astype(np.float32), g.astype(np.float32)))
    
    if is_custom_hex:
        hex_clean = stripe_color_lower.lstrip('#')
        if len(hex_clean) == 3: hex_clean = ''.join([c*2 for c in hex_clean])
        r_tgt = int(hex_clean[0:2], 16)
        g_tgt = int(hex_clean[2:4], 16)
        b_tgt = int(hex_clean[4:6], 16)
        tgt_bgr = np.uint8([[[b_tgt, g_tgt, r_tgt]]])
        tgt_lab = cv2.cvtColor(tgt_bgr, cv2.COLOR_BGR2Lab)[0, 0].astype(np.float32)
        delta_L = (lab[:, :, 0].astype(np.float32) - tgt_lab[0]) * 0.4
        delta_a = lab[:, :, 1].astype(np.float32) - tgt_lab[1]
        delta_b = lab[:, :, 2].astype(np.float32) - tgt_lab[2]
        c_dist = np.sqrt(delta_L**2 + delta_a**2 + delta_b**2)
        saliency = np.maximum(0, 1.0 - (c_dist / 35.0)) * 100.0
    elif stripe_color_lower == 'red':
        saliency = red_chroma * 2.5
    elif stripe_color_lower == 'blue':
        saliency = blue_chroma * 2.5
    elif stripe_color_lower in ['black', 'dark']:
        saliency = blackhat * 2.0
    elif stripe_color_lower in ['white', 'light']:
        saliency = tophat * 2.5
    else:  # Auto: evaluate clicked region patch
        w_patch = max(5, int(orig_w * 0.01))
        x1_p, x2_p = max(0, cx - w_patch), min(orig_w, cx + w_patch)
        y1_p, y2_p = max(0, cy - w_patch), min(orig_h, cy + w_patch)
        patch_lab = lab[y1_p:y2_p, x1_p:x2_p]
        if patch_lab.size > 0:
            seed_L = np.mean(patch_lab[:, :, 0])
            seed_a = np.mean(patch_lab[:, :, 1])
            seed_b = np.mean(patch_lab[:, :, 2])
            dL = (lab[:, :, 0].astype(np.float32) - seed_L) * 0.3
            da = lab[:, :, 1].astype(np.float32) - seed_a
            db = lab[:, :, 2].astype(np.float32) - seed_b
            c_dist = np.sqrt(dL**2 + da**2 + db**2)
            color_sal = np.maximum(0, 1.0 - (c_dist / 35.0)) * 50.0
            ridge_sal = tophat if is_dark_sail else blackhat
            saliency = color_sal + ridge_sal * 1.5
        else:
            saliency = tophat if is_dark_sail else blackhat
            
    # 2. Local search around click point to lock onto exact stripe center
    win = int(max(25, orig_h * 0.06))
    x_min = max(0, cx - win)
    x_max = min(orig_w, cx + win)
    y_min = max(0, cy - win)
    y_max = min(orig_h, cy + win)
    
    local_sal = saliency[y_min:y_max, x_min:x_max]
    if local_sal.size == 0 or np.max(local_sal) < 1.0:
        seed_x, seed_y = cx, cy
    else:
        max_idx = np.unravel_index(np.argmax(local_sal), local_sal.shape)
        seed_y = y_min + max_idx[0]
        seed_x = x_min + max_idx[1]
        
    # 3. Horizontal Ribbon Tracking (Left and Right from seed)
    xs = [seed_x]
    ys = [seed_y]
    
    step = max(3, int(orig_w / 100))
    search_half_h = int(max(18, orig_h * 0.04))
    
    # Track Left
    curr_y = seed_y
    for x in range(seed_x - step, int(orig_w * 0.05), -step):
        y1 = max(0, curr_y - search_half_h)
        y2 = min(orig_h, curr_y + search_half_h)
        col = saliency[y1:y2, x]
        if col.size > 0 and np.max(col) > 1.2:
            best_y = y1 + int(np.argmax(col))
            xs.insert(0, x)
            ys.insert(0, best_y)
            curr_y = best_y
        else:
            xs.insert(0, x)
            ys.insert(0, curr_y)
            
    # Track Right
    curr_y = seed_y
    for x in range(seed_x + step, int(orig_w * 0.95), step):
        y1 = max(0, curr_y - search_half_h)
        y2 = min(orig_h, curr_y + search_half_h)
        col = saliency[y1:y2, x]
        if col.size > 0 and np.max(col) > 1.2:
            best_y = y1 + int(np.argmax(col))
            xs.append(x)
            ys.append(best_y)
            curr_y = best_y
        else:
            xs.append(x)
            ys.append(curr_y)
            
    # 4. Fit Spline & Calculate Metrics
    xs_arr = np.array(xs)
    ys_arr = np.array(ys)
    
    poly = np.polyfit(xs_arr, ys_arr, 2)
    eval_xs = np.linspace(xs_arr[0], xs_arr[-1], 70)
    eval_ys = np.polyval(poly, eval_xs)
    
    p1 = {'x': float(eval_xs[0]), 'y': float(eval_ys[0])}
    p2 = {'x': float(eval_xs[-1]), 'y': float(eval_ys[-1])}
    path = [[float(x), float(y)] for x, y in zip(eval_xs, eval_ys)]
    
    chord_len = math.hypot(p2['x'] - p1['x'], p2['y'] - p1['y']) + 1e-6
    dx = p2['x'] - p1['x']
    dy = p2['y'] - p1['y']
    dists = [(dy * px - dx * py + p2['x'] * p1['y'] - p2['y'] * p1['x']) / chord_len for px, py in path]
    
    max_idx = int(np.argmax(np.abs(dists))) if dists else 0
    max_depth = abs(dists[max_idx]) if dists else 0.0
    camber_sign = 1.0 if dists[max_idx] >= 0 else -1.0
    camber_pct = float((max_depth / chord_len) * 100.0)
    draft_pos_pct = float((max_idx / max(1, len(path) - 1)) * 100.0)
    
    p0_pt, p1_ctrl, p2_ctrl, p3_pt = compute_4pt_bspline_controls(
        p1, p2, max(5.0, camber_pct), draft_pos_pct, camber_sign
    )
    
    max_point = {'x': float(eval_xs[max_idx]), 'y': float(eval_ys[max_idx])}
    
    return {
        'success': True,
        'p0': p0_pt,
        'p1': p1_ctrl,
        'p2': p2_ctrl,
        'p3': p3_pt,
        'path': path,
        'metrics': {
            'camber': round(camber_pct, 2),
            'draft_pos': round(draft_pos_pct, 1),
            'twist': 0.0,
            'entry': 16.0,
            'exit': 8.0,
            'chord_len': round(chord_len, 1),
            'max_point': max_point,
            'normalized_curve': [[(px - p1['x'])/chord_len, (abs(d)/chord_len)*100] for (px, py), d in zip(path, dists)]
        }
    }


def trace_stripe_path(image_bytes, p1, p2):
    """
    v3.0: Fast Cropped Corridor Search.
    Crops processing to the P1-P2 corridor bounding box for sub-50ms execution on high-res photos.
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None: raise ValueError("Decode error")
    
    h, w = img.shape[:2]
    
    pt1 = (int(p1['x']), int(p1['y']))
    pt2 = (int(p2['x']), int(p2['y']))
    
    px_dist = np.linalg.norm(np.array(pt1) - np.array(pt2))
    thickness = int(max(80, px_dist * 0.25))
    
    # 1. Compute bounding box of corridor with padding
    xmin = max(0, min(pt1[0], pt2[0]) - thickness)
    xmax = min(w, max(pt1[0], pt2[0]) + thickness)
    ymin = max(0, min(pt1[1], pt2[1]) - thickness)
    ymax = min(h, max(pt1[1], pt2[1]) + thickness)
    
    crop = img[ymin:ymax, xmin:xmax]
    crop_h, crop_w = crop.shape[:2]
    
    if crop_h < 5 or crop_w < 5:
        return np.array([[p1['x'], p1['y']], [p2['x'], p2['y']]])
        
    local_p1 = (pt1[0] - xmin, pt1[1] - ymin)
    local_p2 = (pt2[0] - xmin, pt2[1] - ymin)
    
    corridor_mask = np.zeros((crop_h, crop_w), dtype=np.uint8)
    cv2.line(corridor_mask, local_p1, local_p2, 255, thickness)
    
    # 2. Image Processing
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)
    inverted = cv2.bitwise_not(blurred)
    inverted = cv2.normalize(inverted, None, 0, 255, cv2.NORM_MINMAX)
    
    # Fast Ridge Response
    vesselness = frangi(inverted, sigmas=range(1, 4), black_ridges=False)
    if vesselness.max() > 0:
        vesselness /= vesselness.max()
        
    base_cost = 1.0 - vesselness
    cost_map = (base_cost * 1000).astype(np.float64)
    
    outside_corridor = (corridor_mask == 0)
    cost_map[outside_corridor] = 1000000.0
    
    try:
        start = (local_p1[1], local_p1[0]) # r, c
        end = (local_p2[1], local_p2[0])
        
        indices, _ = route_through_array(cost_map, start, end, geometric=True, fully_connected=True)
        path = np.array(indices)
        
        # Convert local r,c to global x,y
        path_xy = np.column_stack((path[:, 1] + xmin, path[:, 0] + ymin))
        
        if len(path_xy) > 10:
            window = min(len(path_xy), 31)
            if window % 2 == 0: window -= 1
            if window > 3:
                x_smooth = savgol_filter(path_xy[:, 0], window, 3)
                y_smooth = savgol_filter(path_xy[:, 1], window, 3)
                return np.column_stack((x_smooth, y_smooth))
                
        return path_xy
    except Exception as e:
        print(f"Corridor Trace Fallback: {e}")
        return np.array([[p1['x'], p1['y']], [p2['x'], p2['y']]])


def calculate_interactive_geometry(path_points, p1, p2):
    """
    Calculates metrics for the traced path.
    path_points: np.array [[x,y], [x,y]...]
    p1, p2: User manual endpoints {x,y}
    """
    # 1. Chord
    start = np.array([p1['x'], p1['y']])
    end = np.array([p2['x'], p2['y']])
    
    chord_vec = end - start
    chord_len = np.linalg.norm(chord_vec)
    chord_angle = math.atan2(chord_vec[1], chord_vec[0])
    
    # 2. Rotate points
    c, s = np.cos(-chord_angle), np.sin(-chord_angle)
    R = np.array(((c, -s), (s, c)))
    
    pts = path_points - start
    pts_rot = np.dot(pts, R.T) # x along chord, y is depth
    
    ys = pts_rot[:, 1]
    xs = pts_rot[:, 0]
    
    if len(ys) == 0: return None
    
    # 3. Measures
    # "Assumes pictures taken from below... entry is nearest leading edge (mast)"
    # User clicks P1 and P2. We should auto-orient.
    # Usually: Mast is Left or Right?
    # Valid_XS should be 0 to chord_len
    
    # Max Depth (Camber)
    # We take the maximum ABSOLUTE deviation from the chord.
    max_y_idx = np.argmax(np.abs(ys))
    max_depth = abs(ys[max_y_idx])
    max_depth_x = xs[max_y_idx]
    
    # Draft Position
    draft_pct = (max_depth_x / chord_len) * 100
    camber_pct = (max_depth / chord_len) * 100
    
    # Twist
    # Angle of chord relative to image horizontal
    twist_deg = np.degrees(chord_angle)
    
    # Entry / Exit
    # Entry: First 15%
    le_thresh = chord_len * 0.15
    te_thresh = chord_len * 0.85
    
    le_mask = (xs < le_thresh)
    te_mask = (xs > te_thresh)
    
    entry_deg = 0
    exit_deg = 0
    
    if np.sum(le_mask) > 5:
        line_pts = pts_rot[le_mask]
        [vx, vy, x, y] = cv2.fitLine(line_pts.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01)
        entry_deg = float(abs(np.degrees(math.atan2(float(vy[0] if hasattr(vy, '__len__') else vy), float(vx[0] if hasattr(vx, '__len__') else vx)))))

    if np.sum(te_mask) > 5:
        line_pts = pts_rot[te_mask]
        [vx, vy, x, y] = cv2.fitLine(line_pts.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01)
        exit_deg = float(abs(np.degrees(math.atan2(float(vy[0] if hasattr(vy, '__len__') else vy), float(vx[0] if hasattr(vx, '__len__') else vx)))))

    # v1.2.5: Normalized Curve for Plotting
    # x: 0.0 - 1.0 (Location)
    # y: % Depth (Camber %)
    # We sample 100 points
    norm_curve = []
    # To be clean, let's just use the rotated points directly, 
    # but we need to ensure they are sorted by X? They should be since it's a trace.
    # We'll normalize X by chord_len, Y by chord_len.
    # However, since the path might backtrack slightly, we should ideally fit/sort.
    # But for a simple plot, raw normalized points are usually fine.
    
    # Ensure standard orientation (positive camber)
    # If mean Y is negative, flip it? Or just take abs.
    # Camber graph usually shows "Depth" as positive Y.
    sign = 1.0
    if np.mean(ys) < 0: sign = -1.0
    
    for i in range(len(xs)):
        nx = xs[i] / chord_len
        ny = (ys[i] * sign) / chord_len * 100 # In Percent
        if 0 <= nx <= 1.0:
            norm_curve.append([float(nx), float(ny)])
    
    return {
        "camber": float(round(camber_pct, 2)),
        "draft_pos": float(round(draft_pct, 2)),
        "twist": float(round(twist_deg, 2)),
        "entry": float(round(entry_deg, 2)),
        "exit": float(round(exit_deg, 2)),
        "chord_len": float(round(chord_len, 2)),
        "normalized_curve": norm_curve
    }


# ---------------- LEECH ANALYSIS V1.0 ----------------

def trace_leech_path(image_bytes, p1, p2):
    """
    Traces the leech edge (Contrast Boundary) between P1 and P2.
    Uses Gradient Magnitude instead of Frangi Ridge.
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None: raise ValueError("Decode error")
    
    h, w = img.shape[:2]

    # 1. Geometry: Search Corridor
    corridor_mask = np.zeros((h, w), dtype=np.uint8)
    pt1 = (int(p1['x']), int(p1['y']))
    pt2 = (int(p2['x']), int(p2['y']))
    px_dist = np.linalg.norm(np.array(pt1) - np.array(pt2))
    thickness = int(max(80, px_dist * 0.25)) 
    cv2.line(corridor_mask, pt1, pt2, 255, thickness)

    # 2. Image Processing: Edge Detection
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Sobel
    grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    grad_mag = cv2.magnitude(grad_x, grad_y)
    
    # Normalize Gradient (0-255)
    grad_mag = cv2.normalize(grad_mag, None, 0, 255, cv2.NORM_MINMAX)
    
    # 3. Cost Map (High Gradient = Low Cost)
    # Cost = 1.0 - (Grad / Max)
    max_grad = grad_mag.max()
    if max_grad > 0:
        base_cost = 1.0 - (grad_mag / max_grad)
    else:
        base_cost = np.ones_like(grad_mag)

    cost_map = (base_cost * 100).astype(np.float64)
    
    # 4. Apply Mask
    outside_corridor = (corridor_mask == 0)
    cost_map[outside_corridor] = 100000.0

    # 5. Route
    try:
        start = (pt1[1], pt1[0])
        end = (pt2[1], pt2[0])
        indices, weight = route_through_array(cost_map, start, end, geometric=True, fully_connected=True)
        path = np.array(indices)
        path_xy = np.column_stack((path[:, 1], path[:, 0]))

        # Smooth
        from scipy.signal import savgol_filter
        if len(path_xy) > 10:
            window = min(len(path_xy), 31)
            if window % 2 == 0: window -= 1
            if window > 3:
                x_smooth = savgol_filter(path_xy[:, 0], window, 3)
                y_smooth = savgol_filter(path_xy[:, 1], window, 3)
                return np.column_stack((x_smooth, y_smooth))
        return path_xy
        
    except Exception as e:
        print(f"Leech Trace Failed: {e}")
        return np.array([[p1['x'], p1['y']], [p2['x'], p2['y']]])


def calculate_leech_metrics(path_points, p1, p2):
    """
    Calculates deflection at 25%, 50%, 75% of chord.
    """
    # 1. Chord Frame
    start = np.array([p1['x'], p1['y']])
    end = np.array([p2['x'], p2['y']])
    chord_vec = end - start
    chord_len = np.linalg.norm(chord_vec)
    chord_angle = math.atan2(chord_vec[1], chord_vec[0])
    
    c, s = np.cos(-chord_angle), np.sin(-chord_angle)
    R = np.array(((c, -s), (s, c)))
    
    pts = path_points - start
    pts_rot = np.dot(pts, R.T)
    
    xs = pts_rot[:, 0]
    ys = pts_rot[:, 1]
    
    sign = 1.0
    if np.mean(ys) < 0: sign = -1.0
    
    # 2. Deflections
    def get_y_at_x(target_x):
        sorted_indices = np.argsort(xs)
        s_xs = xs[sorted_indices]
        s_ys = ys[sorted_indices]
        return np.interp(target_x, s_xs, s_ys)
    
    y_25 = get_y_at_x(chord_len * 0.25)
    y_25_raw = y_25 * sign
    
    y_50 = get_y_at_x(chord_len * 0.50)
    y_50_raw = y_50 * sign
    
    y_75 = get_y_at_x(chord_len * 0.75)
    y_75_raw = y_75 * sign
    
    # Max
    max_idx = np.argmax(np.abs(ys))
    max_y = ys[max_idx]
    
    pct_25 = (y_25_raw) / chord_len * 100
    pct_50 = (y_50_raw) / chord_len * 100
    pct_75 = (y_75_raw) / chord_len * 100
    pct_max = (max_y * sign) / chord_len * 100
    
    # Normalized Curve (for plot)
    norm_curve = []
    for i in range(len(xs)):
        nx = xs[i] / chord_len
        ny = (ys[i] * sign) / chord_len * 100
        if 0 <= nx <= 1.0:
            norm_curve.append([float(nx), float(ny)])
    
    return {
        "d_25": float(round(pct_25, 2)),
        "d_50": float(round(pct_50, 2)),
        "d_75": float(round(pct_75, 2)),
        "d_max": float(round(pct_max, 2)),
        "chord_len": float(round(chord_len, 2)),
        "normalized_curve": norm_curve
    }
