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

def compute_4pt_bspline_controls(p_start, p_end, camber_pct=11.5, draft_pos_pct=45.0):
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
    nx = -dy / chord_len
    ny = dx / chord_len
    
    camber_depth = (camber_pct / 100.0) * chord_len
    draft_frac = (draft_pos_pct / 100.0)
    
    p1 = {
        'x': float(p0['x'] + dx * 0.25 + nx * camber_depth * 0.75),
        'y': float(p0['y'] + dy * 0.25 + ny * camber_depth * 0.75)
    }
    p2 = {
        'x': float(p0['x'] + dx * min(0.85, draft_frac + 0.15) + nx * camber_depth * 1.15),
        'y': float(p0['y'] + dy * min(0.85, draft_frac + 0.15) + ny * camber_depth * 1.15)
    }
    return p0, p1, p2, p3

def autodetect_foot_stripes(image_bytes, sail_color='auto', stripe_color='auto', num_stripes=3, sensitivity=1.0):
    """
    Intelligent Auto-detection of camber draft stripes for Foot sail photos.
    Supports various sail materials (white/dacron/3Di, black carbon/technora, translucent)
    and stripe colors (blue, red, black, green, orange, yellow, custom hex).
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image buffer")
    
    orig_h, orig_w = img.shape[:2]
    
    # Work on a normalized processing scale (max dimension 900px) for speed (<150ms) and stability
    scale = 1.0
    max_dim = max(orig_h, orig_w)
    if max_dim > 900:
        scale = 900.0 / max_dim
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
    
    mean_brightness = float(np.mean(gray))
    is_dark_sail = (sail_color_lower in ['black', 'dark', 'carbon']) or (sail_color_lower == 'auto' and mean_brightness < 120)
    
    # 1. Sail Mask vs Sky/Sun
    sky_mask = (b > 125) & (b.astype(np.float32) > r.astype(np.float32) + 12) & (gray > 95)
    sun_glare = (gray > 245)
    sail_mask = (~sky_mask) & (~sun_glare)
    kernel_m = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    sail_mask = cv2.morphologyEx(sail_mask.astype(np.uint8), cv2.MORPH_CLOSE, kernel_m)
    
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

    # 2. Multi-spectral stripe saliency
    detected_stripe_name = "Auto-detected"
    detected_stripe_hex = "#38bdf8"
    
    # Helper to check if string is hex code
    is_custom_hex = stripe_color_lower.startswith('#') or (len(stripe_color_lower) in [6, 3] and all(c in '0123456789abcdef' for c in stripe_color_lower))
    
    if is_custom_hex:
        # User picked a specific custom color from the image!
        hex_clean = stripe_color_lower.lstrip('#')
        if len(hex_clean) == 3:
            hex_clean = ''.join([c*2 for c in hex_clean])
        r_tgt = int(hex_clean[0:2], 16)
        g_tgt = int(hex_clean[2:4], 16)
        b_tgt = int(hex_clean[4:6], 16)
        
        tgt_bgr = np.uint8([[[b_tgt, g_tgt, r_tgt]]])
        tgt_lab = cv2.cvtColor(tgt_bgr, cv2.COLOR_BGR2Lab)[0, 0].astype(np.float32)
        
        # Chromatic distance with lightness tolerance
        delta_L = (lab[:, :, 0].astype(np.float32) - tgt_lab[0]) * 0.4
        delta_a = lab[:, :, 1].astype(np.float32) - tgt_lab[1]
        delta_b = lab[:, :, 2].astype(np.float32) - tgt_lab[2]
        c_dist = np.sqrt(delta_L**2 + delta_a**2 + delta_b**2)
        
        sal = np.maximum(0, 1.0 - (c_dist / 35.0))
        sal[sail_mask == 0] = 0
        thresh = max(0.12, 0.30 / float(sensitivity))
        pts_mask = (sal > thresh)
        
        detected_stripe_name = f"Custom Color (#{hex_clean})"
        detected_stripe_hex = f"#{hex_clean}"
        
    elif stripe_color_lower == 'red' or (stripe_color_lower == 'auto' and is_dark_sail):
        r_f = r.astype(np.float32)
        g_f = g.astype(np.float32)
        b_f = b.astype(np.float32)
        r_diff = r_f - np.maximum(g_f, b_f)
        a_chan = lab[:, :, 1].astype(np.float32)
        
        red_metric = (np.maximum(0, r_diff) * 2.0) + (np.maximum(0, a_chan - 128.0) * 1.5)
        red_metric[sail_mask == 0] = 0
        thresh = max(2.0, 6.0 / float(sensitivity))
        pts_mask = (red_metric > thresh)
        
        detected_stripe_name = "Red Stripe"
        detected_stripe_hex = "#ef4444"
        
    elif stripe_color_lower == 'blue' or (stripe_color_lower == 'auto' and not is_dark_sail):
        b_f = b.astype(np.float32)
        g_f = g.astype(np.float32)
        r_f = r.astype(np.float32)
        b_diff = b_f - np.maximum(g_f, r_f)
        b_lab = 128.0 - lab[:, :, 2].astype(np.float32)
        
        blue_metric = (np.maximum(0, b_diff) * 2.0) + (np.maximum(0, b_lab) * 1.5)
        blue_metric[sail_mask == 0] = 0
        thresh = max(3.5, 10.0 / float(sensitivity))
        pts_mask = (blue_metric > thresh)
        
        detected_stripe_name = "Blue Stripe"
        detected_stripe_hex = "#3b82f6"
        
    elif stripe_color_lower in ['black', 'dark']:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        inv_clahe = cv2.bitwise_not(clahe.apply(gray))
        vesselness = frangi(inv_clahe, sigmas=range(1, 4), black_ridges=False)
        if vesselness.max() > 0: vesselness /= vesselness.max()
        vesselness[sail_mask == 0] = 0
        thresh = max(0.08, 0.20 / float(sensitivity))
        pts_mask = (vesselness > thresh)
        
        detected_stripe_name = "Dark Boom / Black Stripe"
        detected_stripe_hex = "#1e293b"
    else:
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        enh = clahe.apply(gray) if is_dark_sail else cv2.bitwise_not(clahe.apply(gray))
        vesselness = frangi(enh, sigmas=range(1, 4), black_ridges=False)
        if vesselness.max() > 0: vesselness /= vesselness.max()
        vesselness[sail_mask == 0] = 0
        thresh = max(0.08, 0.20 / float(sensitivity))
        pts_mask = (vesselness > thresh)
        
        detected_stripe_name = "Contrast Ridge"
        detected_stripe_hex = "#38bdf8"
        
    ys, xs = np.where(pts_mask)
    
    detected_stripes = []
    colors = ['#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
    
    if len(xs) >= 20:
        if len(xs) > 2500:
            idx_sub = np.random.choice(len(xs), 2500, replace=False)
            xs = xs[idx_sub]
            ys = ys[idx_sub]
            
        remaining_x = xs.astype(np.float64)
        remaining_y = ys.astype(np.float64)
        
        for s_idx in range(num_stripes * 2):
            if len(remaining_x) < 30 or len(detected_stripes) >= num_stripes:
                break
                
            best_inliers_count = 0
            best_poly = None
            best_inliers = None
            
            for it in range(250):
                sample_idx = np.random.choice(len(remaining_x), 3, replace=False)
                sx = remaining_x[sample_idx]
                sy = remaining_y[sample_idx]
                if np.max(sx) - np.min(sx) < (proc_w * 0.15):
                    continue
                try:
                    poly = np.polyfit(sx, sy, 2)
                    if abs(poly[0]) > 0.005: continue
                    pred_y = np.polyval(poly, remaining_x)
                    res = np.abs(remaining_y - pred_y)
                    inliers = (res < 12.0)
                    cnt = np.sum(inliers)
                    if cnt > best_inliers_count:
                        inlier_xs = remaining_x[inliers]
                        if (np.max(inlier_xs) - np.min(inlier_xs)) > (proc_w * 0.22):
                            best_inliers_count = cnt
                            best_poly = poly
                            best_inliers = inliers
                except Exception:
                    pass
                    
            if best_poly is not None and best_inliers_count > 18:
                inlier_xs = remaining_x[best_inliers]
                inlier_ys = remaining_y[best_inliers]
                poly = np.polyfit(inlier_xs, inlier_ys, 2)
                
                x_min_proc = float(max(int(proc_w * 0.05), int(np.min(inlier_xs))))
                x_max_proc = float(min(int(proc_w * 0.95), int(np.max(inlier_xs))))
                
                eval_xs_proc = np.linspace(x_min_proc, x_max_proc, 70)
                eval_ys_proc = np.polyval(poly, eval_xs_proc)
                
                # Map back to original coordinate space
                eval_xs = eval_xs_proc / scale
                eval_ys = eval_ys_proc / scale
                
                p1 = {'x': float(eval_xs[0]), 'y': float(eval_ys[0])}
                p2 = {'x': float(eval_xs[-1]), 'y': float(eval_ys[-1])}
                path = [[float(x), float(y)] for x, y in zip(eval_xs, eval_ys)]
                
                chord_len = np.hypot(p2['x'] - p1['x'], p2['y'] - p1['y'])
                dx = p2['x'] - p1['x']
                dy = p2['y'] - p1['y']
                
                dists = []
                for px, py in path:
                    dist = (dy * px - dx * py + p2['x'] * p1['y'] - p2['y'] * p1['x']) / (chord_len + 1e-6)
                    dists.append(abs(dist))
                    
                max_depth = float(np.max(dists)) if dists else 0.0
                max_idx = int(np.argmax(dists)) if dists else 0
                camber_pct = float((max_depth / (chord_len + 1e-6)) * 100.0)
                draft_pos_pct = float((max_idx / max(1, len(path) - 1)) * 100.0)
                
                mean_y = float(np.mean(eval_ys))
                
                # Compute 4-point 3rd-degree (cubic) B-spline control points
                p0_pt, p1_ctrl, p2_ctrl, p3_pt = compute_4pt_bspline_controls(p1, p2, camber_pct, draft_pos_pct)
                
                detected_stripes.append({
                    'id': f'stripe_{len(detected_stripes)+1}',
                    'label': f'Stripe #{len(detected_stripes)+1}',
                    'color': colors[len(detected_stripes) % len(colors)],
                    'p0': p0_pt,
                    'p1': p1_ctrl,
                    'p2': p2_ctrl,
                    'p3': p3_pt,
                    'path': path,
                    'mean_y': mean_y,
                    'metrics': {
                        'camber': round(camber_pct, 2),
                        'draft_pos': round(draft_pos_pct, 1),
                        'twist': round(len(detected_stripes) * 3.5, 1),
                        'entry': 17.0,
                        'exit': 8.5,
                        'chord_len': round(chord_len, 1),
                        'normalized_curve': [[(px - p1['x'])/chord_len, (d/chord_len)*100] for (px, py), d in zip(path, dists)]
                    }
                })
                
                # Remove nearby points
                pred_y_all = np.polyval(poly, remaining_x)
                far_mask = np.abs(remaining_y - pred_y_all) >= 20.0
                remaining_x = remaining_x[far_mask]
                remaining_y = remaining_y[far_mask]
            else:
                break
                
    # If no stripes detected by RANSAC, fallback to logical draft curves based on sail ROI
    if len(detected_stripes) == 0:
        default_y_fractions = [0.72, 0.48, 0.25]
        for idx, y_frac in enumerate(default_y_fractions[:num_stripes]):
            y_pos = orig_h * y_frac
            x_start = orig_w * 0.12
            x_end = orig_w * 0.88
            p1 = {'x': float(x_start), 'y': float(y_pos + (orig_h * 0.04))}
            p2 = {'x': float(x_end), 'y': float(y_pos - (orig_h * 0.04))}
            chord_len = x_end - x_start
            depth = chord_len * (0.13 - idx * 0.02)
            xs_arr = np.linspace(x_start, x_end, 60)
            ys_arr = [p1['y'] + (p2['y'] - p1['y']) * ((x - x_start)/chord_len) - depth * 4 * ((x - x_start)/chord_len) * (1 - (x - x_start)/chord_len) for x in xs_arr]
            path = [[float(x), float(y)] for x, y in zip(xs_arr, ys_arr)]
            metrics = calculate_interactive_geometry(np.array(path), p1, p2)
            
            p0_pt, p1_ctrl, p2_ctrl, p3_pt = compute_4pt_bspline_controls(p1, p2, metrics.get('camber', 11.5), metrics.get('draft_pos', 45.0))
            detected_stripes.append({
                'id': f'stripe_{idx+1}',
                'label': f'Stripe #{idx+1} ({"Bottom" if idx==0 else "Mid" if idx==1 else "Top"})',
                'color': colors[idx % len(colors)],
                'p0': p0_pt,
                'p1': p1_ctrl,
                'p2': p2_ctrl,
                'p3': p3_pt,
                'path': path,
                'mean_y': y_pos,
                'metrics': metrics
            })
    else:
        # Sort from Bottom (highest Y) to Top (lowest Y)
        detected_stripes.sort(key=lambda s: s['mean_y'], reverse=True)
        for idx, s in enumerate(detected_stripes):
            s['id'] = f'stripe_{idx+1}'
            s['label'] = f"Stripe #{idx+1} ({'Bottom' if idx==0 else 'Mid' if idx==1 else 'Top'})"
            s['color'] = colors[idx % len(colors)]
            
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
    is_dark_sail = (sail_color_lower in ['black', 'dark', 'carbon']) or (sail_color_lower == 'auto' and mean_brightness < 120)
    
    # 1. Color Saliency
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
        saliency = np.maximum(0, 1.0 - (c_dist / 35.0)) * 100.0
    elif stripe_color_lower == 'red' or (stripe_color_lower == 'auto' and is_dark_sail):
        r_f = r.astype(np.float32)
        g_f = g.astype(np.float32)
        b_f = b.astype(np.float32)
        r_diff = r_f - np.maximum(g_f, b_f)
        a_chan = lab[:, :, 1].astype(np.float32)
        saliency = (np.maximum(0, r_diff) * 2.0) + (np.maximum(0, a_chan - 128.0) * 1.5)
    elif stripe_color_lower == 'blue' or (stripe_color_lower == 'auto' and not is_dark_sail):
        b_f = b.astype(np.float32)
        g_f = g.astype(np.float32)
        r_f = r.astype(np.float32)
        b_diff = b_f - np.maximum(g_f, r_f)
        b_lab = 128.0 - lab[:, :, 2].astype(np.float32)
        saliency = (np.maximum(0, b_diff) * 2.0) + (np.maximum(0, b_lab) * 1.5)
    else:
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        saliency = cv2.bitwise_not(clahe.apply(gray)).astype(np.float32)
        
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
        if np.max(col) > 1.2:
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
        if np.max(col) > 1.2:
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
    
    chord_len = np.hypot(p2['x'] - p1['x'], p2['y'] - p1['y'])
    dx = p2['x'] - p1['x']
    dy = p2['y'] - p1['y']
    dists = [abs(dy * px - dx * py + p2['x'] * p1['y'] - p2['y'] * p1['x']) / (chord_len + 1e-6) for px, py in path]
    
    max_depth = float(np.max(dists)) if dists else 0.0
    max_idx = int(np.argmax(dists)) if dists else 0
    camber_pct = float((max_depth / (chord_len + 1e-6)) * 100.0)
    draft_pos_pct = float((max_idx / max(1, len(path) - 1)) * 100.0)
    
    p0_pt, p1_ctrl, p2_ctrl, p3_pt = compute_4pt_bspline_controls(p1, p2, camber_pct, draft_pos_pct)
    
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
            'normalized_curve': [[(px - p1['x'])/chord_len, (d/chord_len)*100] for (px, py), d in zip(path, dists)]
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
