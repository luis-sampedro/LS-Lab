"""
Step 4: Divide Sail Height into 1/4, 2/4, and 3/4 Sectors
Calculates the 3 canonical height sectors and reference chords along the sail span.
"""

import math
import numpy as np


def compute_height_sectors(img_bgr, sail_boundaries, mast_info=None):
    h, w = img_bgr.shape[:2]
    
    luff_poly = sail_boundaries.get('luff_polyline', [])
    leech_poly = sail_boundaries.get('leech_polyline', [])
    
    fractions = [
        {'name': '1/4 Bottom', 'label': '1/4', 'frac': 0.25, 'order': 'bottom'},
        {'name': '2/4 Mid', 'label': '2/4', 'frac': 0.50, 'order': 'mid'},
        {'name': '3/4 Top', 'label': '3/4', 'frac': 0.75, 'order': 'top'}
    ]
    
    sectors = []
    
    if len(luff_poly) >= 5 and len(leech_poly) >= 5:
        n_luff = len(luff_poly)
        n_leech = len(leech_poly)
        
        for item in fractions:
            f = item['frac']
            # Both polylines are ordered from Foot (0) to Head (1)
            idx_l = int(round(f * (n_luff - 1)))
            idx_r = int(round(f * (n_leech - 1)))
            
            lp = {'x': float(luff_poly[idx_l][0]), 'y': float(luff_poly[idx_l][1])}
            rp = {'x': float(leech_poly[idx_r][0]), 'y': float(leech_poly[idx_r][1])}
            
            dx = rp['x'] - lp['x']
            dy = rp['y'] - lp['y']
            chord = float(math.hypot(dx, dy))
            
            y_mid = (lp['y'] + rp['y']) / 2.0
            
            sectors.append({
                'name': item['name'],
                'label': item['label'],
                'order': item['order'],
                'fraction': f,
                'y': lp['y'],
                'luff_point': lp,
                'leech_point': rp,
                'chord_length': round(chord, 1),
                'search_y_min': int(max(0, y_mid - h * 0.12)),
                'search_y_max': int(min(h - 1, y_mid + h * 0.12))
            })
    else:
        # Fallback default geometry
        luff_side = mast_info.get('side', 'left') if mast_info else 'left'
        for item in fractions:
            f = item['frac']
            y_pos = float(h * (0.85 - f * 0.65)) # Bottom to Top
            if luff_side == 'left':
                lx = float(w * 0.10)
                rx = float(w * (0.90 - f * 0.35))
            else:
                lx = float(w * 0.90)
                rx = float(w * (0.10 + f * 0.35))
                
            lp = {'x': lx, 'y': y_pos}
            rp = {'x': rx, 'y': y_pos}
            chord = float(abs(rx - lx))
            
            sectors.append({
                'name': item['name'],
                'label': item['label'],
                'order': item['order'],
                'fraction': f,
                'y': y_pos,
                'luff_point': lp,
                'leech_point': rp,
                'chord_length': round(chord, 1),
                'search_y_min': int(max(0, y_pos - h * 0.12)),
                'search_y_max': int(min(h - 1, y_pos + h * 0.12))
            })
            
    luff_span = abs(sectors[-1]['luff_point']['y'] - sectors[0]['luff_point']['y'])
    desc = (
        f"Anchored 3 canonical sectors along luff: "
        f"1/4 Bottom ({int(sectors[0]['chord_length'])}px chord), "
        f"2/4 Mid ({int(sectors[1]['chord_length'])}px chord), and "
        f"3/4 Top ({int(sectors[2]['chord_length'])}px chord)."
    )
    
    return {
        'sectors': sectors,
        'luff_span_px': round(float(luff_span), 1),
        'description': desc
    }
