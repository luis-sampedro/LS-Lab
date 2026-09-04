"""
Step 4: Divide Sail Height into 1/4, 2/4, and 3/4 Sectors
Calculates the 3 canonical height sectors and reference chords.
"""

import numpy as np
from .step2_mast_detector import find_markup_luff_anchors
from .step3_sail_boundaries import extract_markup_leech_anchors


def compute_height_sectors(img_bgr, sail_boundaries, mast_info=None):
    h, w = img_bgr.shape[:2]
    
    luff_anchors = find_markup_luff_anchors(img_bgr)
    leech_anchors = extract_markup_leech_anchors(img_bgr)
    
    if luff_anchors and leech_anchors:
        # luff_anchors: [Top (341, 169), Mid (262, 173), Bot (51, 180)]
        # leech_anchors: [Top (450, 200), Mid (654, 251), Bot (666, 251)]
        sectors = [
            {
                'name': '1/4 Bottom',
                'label': '1/4',
                'order': 'bottom',
                'fraction': 0.25,
                'y': float(luff_anchors[2][1]),
                'luff_point': {'x': float(luff_anchors[2][0]), 'y': float(luff_anchors[2][1])},
                'leech_point': {'x': float(leech_anchors[2][0]), 'y': float(leech_anchors[2][1])},
                'chord_length': round(float(np.hypot(leech_anchors[2][0] - luff_anchors[2][0], leech_anchors[2][1] - luff_anchors[2][1])), 1),
                'search_y_min': int(max(0, luff_anchors[2][1] - 40)),
                'search_y_max': int(min(h - 1, leech_anchors[2][1] + 40))
            },
            {
                'name': '2/4 Mid',
                'label': '2/4',
                'order': 'mid',
                'fraction': 0.50,
                'y': float(luff_anchors[1][1]),
                'luff_point': {'x': float(luff_anchors[1][0]), 'y': float(luff_anchors[1][1])},
                'leech_point': {'x': float(leech_anchors[1][0]), 'y': float(leech_anchors[1][1])},
                'chord_length': round(float(np.hypot(leech_anchors[1][0] - luff_anchors[1][0], leech_anchors[1][1] - luff_anchors[1][1])), 1),
                'search_y_min': int(max(0, luff_anchors[1][1] - 40)),
                'search_y_max': int(min(h - 1, leech_anchors[1][1] + 40))
            },
            {
                'name': '3/4 Top',
                'label': '3/4',
                'order': 'top',
                'fraction': 0.75,
                'y': float(luff_anchors[0][1]),
                'luff_point': {'x': float(luff_anchors[0][0]), 'y': float(luff_anchors[0][1])},
                'leech_point': {'x': float(leech_anchors[0][0]), 'y': float(leech_anchors[0][1])},
                'chord_length': round(float(np.hypot(leech_anchors[0][0] - luff_anchors[0][0], leech_anchors[0][1] - luff_anchors[0][1])), 1),
                'search_y_min': int(max(0, luff_anchors[0][1] - 40)),
                'search_y_max': int(min(h - 1, leech_anchors[0][1] + 40))
            }
        ]
        luff_span = float(abs(luff_anchors[2][0] - luff_anchors[0][0]))
        desc = (
            f"Anchored 3 canonical sectors to the 3 sail stripes: "
            f"1/4 Bottom ({int(sectors[0]['chord_length'])}px chord), "
            f"2/4 Mid ({int(sectors[1]['chord_length'])}px chord), and "
            f"3/4 Top ({int(sectors[2]['chord_length'])}px chord)."
        )
        return {
            'sectors': sectors,
            'luff_span_px': round(luff_span, 1),
            'description': desc
        }

    # Check if sail_boundaries provided luff_polyline and leech_polyline
    luff_poly = sail_boundaries.get('luff_polyline')
    leech_poly = sail_boundaries.get('leech_polyline')
    
    if luff_poly and leech_poly and len(luff_poly) >= 10 and len(leech_poly) >= 10:
        fractions = [
            {'name': '1/4 Bottom', 'label': '1/4', 'frac': 0.15, 'order': 'bottom'},
            {'name': '2/4 Mid', 'label': '2/4', 'frac': 0.42, 'order': 'mid'},
            {'name': '3/4 Top', 'label': '3/4', 'frac': 0.68, 'order': 'top'},
        ]
        sectors = []
        for item in fractions:
            f = item['frac']
            l_idx = int(round(f * (len(luff_poly) - 1)))
            # Leech polyline starts at head (t=1) and ends at clew (t=0)
            r_idx = int(round((1.0 - f) * (len(leech_poly) - 1)))
            lp = {'x': float(luff_poly[l_idx][0]), 'y': float(luff_poly[l_idx][1])}
            rp = {'x': float(leech_poly[r_idx][0]), 'y': float(leech_poly[r_idx][1])}
            chord = float(np.hypot(rp['x'] - lp['x'], rp['y'] - lp['y']))
            sectors.append({
                'name': item['name'],
                'label': item['label'],
                'order': item['order'],
                'fraction': f,
                'y': lp['y'],
                'luff_point': lp,
                'leech_point': rp,
                'chord_length': round(chord, 1),
                'search_y_min': int(max(0, min(lp['y'], rp['y']) - 35)),
                'search_y_max': int(min(h - 1, max(lp['y'], rp['y']) + 60))
            })
            
        dx_luff = luff_poly[-1][0] - luff_poly[0][0]
        dy_luff = luff_poly[-1][1] - luff_poly[0][1]
        luff_span = float(np.hypot(dx_luff, dy_luff))
        
        desc = (
            f"Anchored 3 canonical sectors along luff: "
            f"1/4 Bottom ({int(sectors[0]['chord_length'])}px chord), "
            f"2/4 Mid ({int(sectors[1]['chord_length'])}px chord), and "
            f"3/4 Top ({int(sectors[2]['chord_length'])}px chord)."
        )
        return {
            'sectors': sectors,
            'luff_span_px': round(luff_span, 1),
            'description': desc
        }

    # Standard fractional height sector computation fallback
    y_head = sail_boundaries.get('y_head', int(h * 0.15))
    y_foot = sail_boundaries.get('y_foot', int(h * 0.90))
    luff_xs = sail_boundaries.get('luff_xs', [w * 0.15] * h)
    leech_xs = sail_boundaries.get('leech_xs', [w * 0.85] * h)
    
    luff_span = max(40.0, float(y_foot - y_head))
    fractions = [
        {'name': '1/4 Bottom', 'label': '1/4', 'frac': 0.25, 'order': 'bottom'},
        {'name': '2/4 Mid', 'label': '2/4', 'frac': 0.50, 'order': 'mid'},
        {'name': '3/4 Top', 'label': '3/4', 'frac': 0.75, 'order': 'top'},
    ]
    
    sectors = []
    band_half_h = max(15.0, luff_span * 0.14)
    
    for item in fractions:
        f = item['frac']
        sec_y = float(y_foot - f * luff_span)
        y_int = int(np.clip(round(sec_y), 0, h - 1))
        lx = float(luff_xs[y_int])
        rx = float(leech_xs[y_int])
        
        p_luff = {'x': round(lx, 1), 'y': round(sec_y, 1)}
        p_leech = {'x': round(rx, 1), 'y': round(sec_y, 1)}
        chord_len = abs(rx - lx)
        
        sectors.append({
            'name': item['name'],
            'label': item['label'],
            'order': item['order'],
            'fraction': f,
            'y': round(sec_y, 1),
            'luff_point': p_luff,
            'leech_point': p_leech,
            'chord_length': round(chord_len, 1),
            'search_y_min': int(max(0, sec_y - band_half_h)),
            'search_y_max': int(min(h - 1, sec_y + band_half_h))
        })
        
    desc = (
        f"Divided sail height ({int(luff_span)}px luff span) into 3 canonical sectors: "
        f"1/4 Bottom (y={int(sectors[0]['y'])}), "
        f"2/4 Mid (y={int(sectors[1]['y'])}), and "
        f"3/4 Top (y={int(sectors[2]['y'])})."
    )
    
    return {
        'sectors': sectors,
        'luff_span_px': round(luff_span, 1),
        'description': desc
    }
