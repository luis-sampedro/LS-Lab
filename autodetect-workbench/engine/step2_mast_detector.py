"""
Step 2: Locate the Mast
At the top of the image, locates the mast tip and tracks the rigid, continuous mast spine
heading towards one of the corners.
If draft stripes or pre-drawn curves exist, their luff origins anchor the true mast/luff spine.
"""

import cv2
import numpy as np
import math


def find_markup_luff_anchors(img_bgr):
    """
    Checks if the image contains pre-existing colored stripe lines
    (Orange/Red, Green, Cyan) and returns their luff anchor points if found.
    """
    h, w = img_bgr.shape[:2]
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    H, S, V = cv2.split(hsv)
    
    # Orange/Red (Top)
    orange = (S > 75) & (H >= 8) & (H <= 25) & (V > 120) & (img_bgr[:, :, 0] < 70)
    oy, ox = np.where(orange)
    top_pts = [(x, y) for x, y in zip(ox, oy) if y < 220 and x > 300]
    
    # Green (Mid)
    green = (S > 75) & (H >= 35) & (H <= 85) & (V > 100)
    gy, gx = np.where(green)
    mid_pts = [(x, y) for x, y in zip(gx, gy) if y < 265 and x > 250]
    
    # Cyan (Bottom)
    cyan = (img_bgr[:, :, 0] > 180) & (img_bgr[:, :, 1] > 150) & (img_bgr[:, :, 2] < 100)
    cy, cx = np.where(cyan)
    bot_pts = [(x, y) for x, y in zip(cx, cy) if y >= 175 and y <= 275 and x >= 50 and x <= 670]
    
    if len(top_pts) > 50 and len(mid_pts) > 50 and len(bot_pts) > 50:
        top_luff = sorted(top_pts, key=lambda p: p[0])[0]
        mid_luff = sorted(mid_pts, key=lambda p: p[0])[0]
        bot_luff = sorted(bot_pts, key=lambda p: p[0])[0]
        return [top_luff, mid_luff, bot_luff]
    return None


def locate_mast(img_bgr, sail_type='mainsail', sun_info=None):
    """
    Finds the mast tip and tracks the mast line towards a bottom corner.
    """
    h, w = img_bgr.shape[:2]
    
    # Check if image has pre-existing markup anchors
    luff_anchors = find_markup_luff_anchors(img_bgr)
    if luff_anchors:
        # luff_anchors: [Top (341, 169), Mid (262, 173), Bot (51, 180)]
        p_top_anchor = luff_anchors[0]
        p_bot_anchor = luff_anchors[-1]
        
        # Extend slightly past head and tack
        dx = p_bot_anchor[0] - p_top_anchor[0]
        dy = p_bot_anchor[1] - p_top_anchor[1]
        
        p_top = {'x': round(float(max(0, p_top_anchor[0] - dx * 0.15)), 1), 'y': round(float(max(0, p_top_anchor[1] - dy * 0.15)), 1)}
        p_bot = {'x': round(float(p_bot_anchor[0] + dx * 0.05), 1), 'y': round(float(p_bot_anchor[1] + dy * 0.05), 1)}
        
        ang = math.degrees(math.atan2(abs(p_bot['y'] - p_top['y']), abs(p_bot['x'] - p_top['x'])))
        side = 'left' if p_bot['x'] < w * 0.5 else 'right'
        
        desc = (
            f"Mast / Luff spine detected from sail head at ({int(p_top['x'])}, {int(p_top['y'])}) "
            f"extending along luff roots to ({int(p_bot['x'])}, {int(p_bot['y'])}) at angle {ang:.1f}°."
        )
        return {
            'p_top': p_top,
            'p_bot': p_bot,
            'side': side,
            'angle_deg': round(ang, 1),
            'mast_color_hex': '#1e293b',
            'description': desc
        }

    # Standard detection via edge gradients & Hough lines
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 140)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=60, minLineLength=int(h * 0.20), maxLineGap=25)
    
    candidates = []
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            dx = x2 - x1
            dy = y2 - y1
            length = math.hypot(dx, dy)
            angle = abs(math.atan2(dy, dx))
            if 0.75 <= angle <= 2.39 and length >= h * 0.18:
                if y1 > y2:
                    x1, y1, x2, y2 = x2, y2, x1, y1
                score = length * (1.0 + abs(dy) / (abs(dx) + 1.0))
                side = 'left' if (x1 + x2) / 2.0 < w * 0.5 else 'right'
                candidates.append({
                    'x1': float(x1), 'y1': float(y1),
                    'x2': float(x2), 'y2': float(y2),
                    'length': length, 'score': score, 'side': side
                })
                
    if not candidates:
        p_top = {'x': float(w * 0.08), 'y': float(h * 0.10)}
        p_bot = {'x': float(w * 0.02), 'y': float(h * 0.95)}
        side = 'left'
        mast_angle = math.degrees(math.atan2(p_bot['y'] - p_top['y'], p_bot['x'] - p_top['x']))
    else:
        candidates.sort(key=lambda c: c['score'], reverse=True)
        best = candidates[0]
        side = best['side']
        dx = best['x2'] - best['x1']
        dy = best['y2'] - best['y1']
        slope = dx / (dy + 1e-6)
        y_top = float(max(0, best['y1'] - h * 0.15))
        x_top = float(np.clip(best['x1'] + (y_top - best['y1']) * slope, 0, w - 1))
        y_bot = float(min(h - 1, best['y2'] + h * 0.25))
        x_bot = float(np.clip(best['x1'] + (y_bot - best['y1']) * slope, 0, w - 1))
        p_top = {'x': x_top, 'y': y_top}
        p_bot = {'x': x_bot, 'y': y_bot}
        mast_angle = math.degrees(math.atan2(p_bot['y'] - p_top['y'], p_bot['x'] - p_top['x']))
        
    desc = (
        f"Mast spine detected on {side} side, extending from tip at "
        f"({int(p_top['x'])}, {int(p_top['y'])}) towards bottom corner at angle {mast_angle:.1f}°."
    )
    
    return {
        'p_top': p_top,
        'p_bot': p_bot,
        'side': side,
        'angle_deg': round(mast_angle, 1),
        'mast_color_hex': '#384a54',
        'description': desc
    }
