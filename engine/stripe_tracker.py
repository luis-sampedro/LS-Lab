"""
Stripe Tracker Module
Extracts 1D ridge centerlines by applying vertical non-maximum suppression (NMS)
and dynamic horizontal ribbon tracking from Luff to Leech across Bottom, Mid, and Top zones.
Uses robust signal peak detection to locate the exact physical stripe heights.
"""

import cv2
import numpy as np
from scipy.signal import find_peaks


def extract_vertical_nms_ridges(saliency, y1, y2, x_min_arr, x_max_arr, thresh_percentile=70):
    """
    Extracts 1D ridge centerline points within row range [y1, y2] by taking
    the local column-wise vertical maxima (NMS).
    """
    h, w = saliency.shape[:2]
    sub = saliency[y1:y2, :]
    if sub.size == 0:
        return np.array([]), np.array([])
        
    pts_saliency = sub[sub > 0]
    if len(pts_saliency) == 0:
        return np.array([]), np.array([])
        
    min_sal = np.percentile(pts_saliency, thresh_percentile)
    
    ridge_xs = []
    ridge_ys = []
    
    for x in range(w):
        col_vals = sub[:, x]
        if np.max(col_vals) < max(4.0, min_sal):
            continue
            
        padded = np.pad(col_vals, (1, 1), mode='constant', constant_values=0)
        local_maxima = np.where((padded[1:-1] > padded[:-2]) & (padded[1:-1] >= padded[2:]) & (padded[1:-1] >= min_sal))[0]
        
        for peak_y_rel in local_maxima:
            abs_y = y1 + peak_y_rel
            if x >= x_min_arr[abs_y] - 5 and x <= x_max_arr[abs_y] + 5:
                ridge_xs.append(x)
                ridge_ys.append(abs_y)
                
    return np.array(ridge_xs, dtype=np.float32), np.array(ridge_ys, dtype=np.float32)


def trace_ridge_from_seed(saliency, seed_x, seed_y, x_left_limit, x_right_limit, step=3, win_h=16):
    """
    Traces a continuous stripe ribbon horizontally left and right from a seed point.
    """
    h, w = saliency.shape[:2]
    xs = [seed_x]
    ys = [seed_y]
    
    # 1. Track Left towards Luff
    curr_y = seed_y
    for x in range(int(seed_x) - step, int(x_left_limit), -step):
        y_low = max(0, int(curr_y - win_h))
        y_high = min(h, int(curr_y + win_h + 1))
        col = saliency[y_low:y_high, x]
        if col.size > 0 and np.max(col) > 2.5:
            best_offset = int(np.argmax(col))
            best_y = y_low + best_offset
            xs.insert(0, x)
            ys.insert(0, best_y)
            curr_y = best_y
        else:
            xs.insert(0, x)
            ys.insert(0, curr_y)
            
    # 2. Track Right towards Leech
    curr_y = seed_y
    for x in range(int(seed_x) + step, int(x_right_limit), step):
        y_low = max(0, int(curr_y - win_h))
        y_high = min(h, int(curr_y + win_h + 1))
        col = saliency[y_low:y_high, x]
        if col.size > 0 and np.max(col) > 2.5:
            best_offset = int(np.argmax(col))
            best_y = y_low + best_offset
            xs.append(x)
            ys.append(best_y)
            curr_y = best_y
        else:
            xs.append(x)
            ys.append(curr_y)
            
    return np.array(xs, dtype=np.float32), np.array(ys, dtype=np.float32)


def locate_stripe_candidates(saliency, sail_geom, num_stripes=3):
    """
    Locates stripe candidates across the sail using adaptive peak detection
    and horizontal ribbon tracking.
    """
    h, w = saliency.shape[:2]
    y_min = sail_geom['y_min']
    y_max = sail_geom['y_max']
    sail_h = sail_geom['sail_height']
    luff_xs = sail_geom['luff_xs']
    leech_xs = sail_geom['leech_xs']
    
    # Calculate width-normalized row energy across the sail height
    row_sums = np.sum(saliency, axis=1).astype(float)
    row_widths = np.maximum(50.0, leech_xs - luff_xs)
    norm_prof = row_sums / row_widths
    smoothed_prof = np.convolve(norm_prof, np.ones(7)/7.0, mode='same')
    
    # Search range on sail (avoid extreme top/bottom edges)
    sr_y1 = int(y_min + 0.05 * sail_h)
    sr_y2 = int(min(h - 4, y_min + 0.85 * sail_h))
    
    min_dist = max(25, int(sail_h * 0.12))
    detected_peaks, _ = find_peaks(
        smoothed_prof[sr_y1:sr_y2],
        distance=min_dist,
        prominence=max(1.5, np.percentile(smoothed_prof[sr_y1:sr_y2], 65) * 0.4)
    )
    abs_peaks = [sr_y1 + p for p in detected_peaks]
    
    # Sort peaks by normalized intensity
    abs_peaks = sorted(abs_peaks, key=lambda p: smoothed_prof[p], reverse=True)
    
    # Select up to num_stripes peaks that have good vertical separation
    selected_peaks = []
    for p in abs_peaks:
        if all(abs(p - sp) >= min_dist for sp in selected_peaks):
            selected_peaks.append(p)
            if len(selected_peaks) >= num_stripes:
                break
                
    # If not enough peaks found by find_peaks, fill in with standard aerodynamic heights
    if len(selected_peaks) < num_stripes:
        default_fracs = [0.70, 0.45, 0.20] if num_stripes == 3 else [0.50]
        for f in default_fracs:
            candidate_y = int(y_min + f * sail_h)
            if all(abs(candidate_y - sp) >= min_dist * 0.7 for sp in selected_peaks):
                selected_peaks.append(candidate_y)
                if len(selected_peaks) >= num_stripes:
                    break
                    
    # Sort selected peaks from bottom (highest Y in screen coords) to top (lowest Y)
    selected_peaks = sorted(selected_peaks, reverse=True)[:num_stripes]
    
    candidates = []
    band_names = ['Bottom', 'Mid', 'Top', 'Stripe #4', 'Stripe #5']
    
    for idx, peak_y in enumerate(selected_peaks):
        b_label = band_names[idx] if idx < len(band_names) else f"Stripe #{idx+1}"
        
        peak_y = int(np.clip(peak_y, 0, h - 1))
        x_luff = float(luff_xs[peak_y])
        x_leech = float(leech_xs[peak_y])
        chord_w = max(20.0, x_leech - x_luff)
        
        # 1. NMS Ridge Centerlines within +- 20px window
        w_h = max(18, int(sail_h * 0.08))
        win_y1 = max(0, peak_y - w_h)
        win_y2 = min(h, peak_y + w_h)
        
        ridge_xs, ridge_ys = extract_vertical_nms_ridges(saliency, win_y1, win_y2, luff_xs, leech_xs, thresh_percentile=70)
        
        # 2. Seed Point near middle of chord (35% to 65%)
        mid_x1 = x_luff + chord_w * 0.35
        mid_x2 = x_luff + chord_w * 0.65
        
        seed_x, seed_y = int((x_luff + x_leech) / 2.0), peak_y
        if len(ridge_xs) > 0:
            mid_mask = (ridge_xs >= mid_x1) & (ridge_xs <= mid_x2)
            if np.any(mid_mask):
                mid_pts_x = ridge_xs[mid_mask]
                mid_pts_y = ridge_ys[mid_mask]
                sal_vals = [saliency[int(py), int(px)] for px, py in zip(mid_pts_x, mid_pts_y)]
                best_idx = int(np.argmax(sal_vals))
                seed_x = int(mid_pts_x[best_idx])
                seed_y = int(mid_pts_y[best_idx])
                
        # 3. Ribbon Track from seed to boundaries
        step_sz = max(3, int(w / 120))
        traced_xs, traced_ys = trace_ridge_from_seed(saliency, seed_x, seed_y, x_luff, x_leech, step=step_sz, win_h=16)
        
        candidates.append({
            'band_label': b_label,
            'peak_y': peak_y,
            'x_start': x_luff,
            'x_end': x_leech,
            'ridge_xs': ridge_xs,
            'ridge_ys': ridge_ys,
            'traced_xs': traced_xs,
            'traced_ys': traced_ys
        })
        
    return candidates
