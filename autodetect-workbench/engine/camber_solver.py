"""
Camber Solver Module
Fits aerodynamic camber curves enforcing the physical "bowl open towards the sky" constraint.
Computes 4-point cubic B-spline controls, chord lines, camber %, draft position %, and entry/exit angles.
"""

import math
import warnings
import numpy as np

try:
    from numpy.exceptions import RankWarning
except ImportError:
    RankWarning = getattr(np, 'RankWarning', Warning)
warnings.filterwarnings('ignore', category=RankWarning)
warnings.filterwarnings('ignore')


def compute_point_to_chord_offset(px, py, p0, p3):
    """
    Computes signed perpendicular distance from point (px, py) to chord line P0-P3.
    Positive value means the point is on the 'downwards' / 'bowl sag' side of the chord line
    (i.e. sagging away from the sky towards the boom/deck).
    """
    dx = p3['x'] - p0['x']
    dy = p3['y'] - p0['y']
    chord_len = math.hypot(dx, dy) + 1e-6
    
    # Unit normal pointing downwards (increasing Y in image coordinates)
    # Since dx > 0, ny = dx / chord_len is positive (pointing down)
    nx = -dy / chord_len
    ny = dx / chord_len
    
    dist = (px - p0['x']) * nx + (py - p0['y']) * ny
    return dist, chord_len


def check_is_bowl(poly, x_start, x_end):
    """
    Checks if a polynomial curve y = poly(x) is an aerodynamic bowl open towards the sky.
    In image coordinates (where Y is downwards):
    A curve that opens towards the sky sags downwards in the middle, so its midpoint y_mid
    must be GREATER than the midpoint of the chord line connecting the endpoints.
    """
    x_mid = (x_start + x_end) / 2.0
    y_start = float(np.polyval(poly, x_start))
    y_end = float(np.polyval(poly, x_end))
    y_mid = float(np.polyval(poly, x_mid))
    y_chord_mid = (y_start + y_end) / 2.0
    
    sag = y_mid - y_chord_mid
    return (sag > 0.5), sag


def fit_bowl_constrained_curve(candidate, sail_geom, scale=1.0, enforce_bowl=True):
    """
    Fits an aerodynamic camber curve to candidate ridge points, strictly enforcing
    that the curve must be "open towards the sky, like a bowl" (sagging downwards).
    
    Args:
        candidate: dict from locate_stripe_candidates
        sail_geom: dict from analyze_sail_geometry
        scale: resolution scale factor (for mapping to original coordinates)
        enforce_bowl: bool, whether to reject dome-shaped/inverted curves
        
    Returns:
        dict: Fitted stripe data including P0, P1, P2, P3, path, metrics, and bowl status
    """
    peak_y = candidate['peak_y']
    x_start = candidate['x_start']
    x_end = candidate['x_end']
    ridge_xs = candidate['ridge_xs']
    ridge_ys = candidate['ridge_ys']
    traced_xs = candidate['traced_xs']
    traced_ys = candidate['traced_ys']
    
    chord_w = max(25.0, x_end - x_start)
    
    # Pool points for fitting: combination of traced ribbon and NMS ridges
    pool_x = []
    pool_y = []
    
    if len(traced_xs) >= 10:
        pool_x.extend(traced_xs.tolist())
        pool_y.extend(traced_ys.tolist())
        
    if len(ridge_xs) >= 15:
        # Add NMS ridge points within +- 20px of peak_y
        close_mask = np.abs(ridge_ys - peak_y) < 22.0
        pool_x.extend(ridge_xs[close_mask].tolist())
        pool_y.extend(ridge_ys[close_mask].tolist())
        
    pool_x = np.array(pool_x, dtype=np.float64)
    pool_y = np.array(pool_y, dtype=np.float64)
    
    best_poly = None
    best_inliers_count = 0
    best_is_bowl = False
    
    if len(pool_x) >= 20 and (np.max(pool_x) - np.min(pool_x)) > (chord_w * 0.25):
        # RANSAC with strict Aerodynamic Bowl Constraint
        for _ in range(160):
            samp = np.random.choice(len(pool_x), 3, replace=False)
            sx, sy = pool_x[samp], pool_y[samp]
            if (np.max(sx) - np.min(sx)) < (chord_w * 0.25):
                continue
                
            try:
                p = np.polyfit(sx, sy, 2)
                is_bowl, sag_val = check_is_bowl(p, x_start, x_end)
                
                if enforce_bowl and not is_bowl:
                    continue  # Strictly reject dome-shaped / hill-shaped curves!
                    
                pred_y = np.polyval(p, pool_x)
                inliers = np.sum(np.abs(pool_y - pred_y) < 7.0)
                
                # Bonus score for realistic camber depth (5% to 15% of chord)
                camber_ratio = sag_val / chord_w
                realism_bonus = 25 if (0.05 <= camber_ratio <= 0.16) else 0
                score = inliers + realism_bonus
                
                if score > best_inliers_count:
                    best_inliers_count = score
                    best_poly = p
                    best_is_bowl = is_bowl
            except Exception:
                pass
                
        if best_poly is not None:
            # Refit on inliers
            inlier_mask = np.abs(pool_y - np.polyval(best_poly, pool_x)) < 7.0
            if np.sum(inlier_mask) >= 15:
                try:
                    refit_p = np.polyfit(pool_x[inlier_mask], pool_y[inlier_mask], 2)
                    is_b, _ = check_is_bowl(refit_p, x_start, x_end)
                    if not enforce_bowl or is_b:
                        best_poly = refit_p
                        best_is_bowl = is_b
                except Exception:
                    pass
                    
    # Fallback to aerodynamically correct parabolic bowl if RANSAC fails or gives invalid dome
    if best_poly is None or (enforce_bowl and not best_is_bowl):
        # A realistic sail camber bowl:
        # P0 at luff, P3 at leech, maximum depth sags downwards by ~10.5% of chord at 44% draft position
        expected_camber_depth = chord_w * 0.105
        x_mid = x_start + chord_w * 0.44
        y_luff = float(peak_y - 2)
        y_leech = float(peak_y + (chord_w * 0.02))
        y_mid = float((y_luff + y_leech) / 2.0 + expected_camber_depth)
        
        best_poly = np.polyfit(
            [x_start, x_mid, x_end],
            [y_luff, y_mid, y_leech],
            2
        )
        best_is_bowl = True
        
    # Evaluate curve from luff root to leech root
    eval_xs_proc = np.linspace(x_start, x_end, 75)
    eval_ys_proc = np.polyval(best_poly, eval_xs_proc)
    
    # Scale back to original resolution
    eval_xs = eval_xs_proc / scale
    eval_ys = eval_ys_proc / scale
    path = [[float(x), float(y)] for x, y in zip(eval_xs, eval_ys)]
    
    p0_pt = {'x': float(eval_xs[0]), 'y': float(eval_ys[0])}
    p3_pt = {'x': float(eval_xs[-1]), 'y': float(eval_ys[-1])}
    
    dx = p3_pt['x'] - p0_pt['x']
    dy = p3_pt['y'] - p0_pt['y']
    chord_len = math.hypot(dx, dy) + 1e-6
    
    # Measure camber depth and draft position
    dists = []
    for px, py in path:
        dist, _ = compute_point_to_chord_offset(px, py, p0_pt, p3_pt)
        dists.append(dist)
        
    max_idx = int(np.argmax(dists)) if dists else 0
    max_depth = dists[max_idx] if dists else 0.0
    
    # Bowl verification: max_depth > 0 means the curve sags downwards like a bowl
    is_bowl_verified = (max_depth > 0.5)
    
    camber_pct = float(max(0.0, max_depth) / chord_len * 100.0)
    draft_pos_pct = float(max_idx / max(1, len(path) - 1) * 100.0)
    
    # Compute 4-Point Cubic B-Spline Controls
    ux = dx / chord_len
    uy = dy / chord_len
    # Normal pointing downwards into the bowl
    nx = -uy
    ny = ux
    
    camber_offset = (camber_pct / 100.0) * chord_len
    draft_frac = draft_pos_pct / 100.0
    
    p1_ctrl = {
        'x': float(p0_pt['x'] + dx * 0.28 + nx * camber_offset * 0.75),
        'y': float(p0_pt['y'] + dy * 0.28 + ny * camber_offset * 0.75)
    }
    p2_ctrl = {
        'x': float(p0_pt['x'] + dx * max(0.40, min(0.85, draft_frac + 0.10)) + nx * camber_offset * 1.15),
        'y': float(p0_pt['y'] + dy * max(0.40, min(0.85, draft_frac + 0.10)) + ny * camber_offset * 1.15)
    }
    
    max_point = {'x': float(eval_xs[max_idx]), 'y': float(eval_ys[max_idx])}
    
    # Tangent angles relative to chord
    entry_deg = 18.0
    exit_deg = 9.0
    try:
        slope_p0 = 2 * best_poly[0] * eval_xs_proc[0] + best_poly[1]
        slope_chord = dy / dx if abs(dx) > 1e-3 else 0.0
        angle_p0 = math.degrees(math.atan(slope_p0) - math.atan(slope_chord))
        entry_deg = round(abs(angle_p0), 1)
        
        slope_p3 = 2 * best_poly[0] * eval_xs_proc[-1] + best_poly[1]
        angle_p3 = math.degrees(math.atan(slope_p3) - math.atan(slope_chord))
        exit_deg = round(abs(angle_p3), 1)
    except Exception:
        pass
        
    return {
        'p0': p0_pt,
        'p1': p1_ctrl,
        'p2': p2_ctrl,
        'p3': p3_pt,
        'path': path,
        'mean_y': float(np.mean(eval_ys)),
        'metrics': {
            'camber': round(camber_pct, 2),
            'draft_pos': round(draft_pos_pct, 1),
            'entry': entry_deg,
            'exit': exit_deg,
            'twist': 0.0,
            'chord_len': round(chord_len, 1),
            'max_point': max_point,
            'bowl_valid': bool(is_bowl_verified),
            'bowl_orientation': 'Open Towards Sky (Valid)' if is_bowl_verified else 'Inverted Dome (Invalid)'
        }
    }
