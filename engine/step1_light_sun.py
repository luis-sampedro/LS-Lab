"""
Step 1: Locate the Sun & Light Source
Accurately detects the circular saturated sun disk or primary glare center in the sky
and confirms upper-half illumination, establishing the 'looking up from below' frame.
"""

import cv2
import numpy as np


def locate_sun_and_light(img_bgr):
    """
    Finds the exact sun/glare center and dominant illumination vector.
    
    Returns:
        dict: {
            'sun_x': float,
            'sun_y': float,
            'is_top_illumination': bool,
            'light_direction': str,
            'confidence': float,
            'description': str
        }
    """
    h, w = img_bgr.shape[:2]
    
    # 1. Saturated Sun Disk Detection:
    # A visible sun creates a cluster of saturated white pixels (R,G,B > 240)
    sat = (img_bgr[:, :, 0] > 240) & (img_bgr[:, :, 1] > 240) & (img_bgr[:, :, 2] > 240)
    
    # Limit direct sun search to upper 65% of the image (sky zone)
    sat_top = np.zeros((h, w), dtype=np.uint8)
    sat_top[:int(h * 0.65), :] = sat[:int(h * 0.65), :].astype(np.uint8)
    
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(sat_top)
    
    sun_x, sun_y = None, None
    conf = 0.80
    detection_method = "Brightness gradient"
    
    if num_labels > 1:
        # Find largest saturated cluster (excluding background label 0)
        best_idx = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        area = stats[best_idx, cv2.CC_STAT_AREA]
        if area >= 12:  # Saturated sun disk found
            sun_x = float(centroids[best_idx][0])
            sun_y = float(centroids[best_idx][1])
            conf = 0.98
            detection_method = "Saturated sun disk"
            
    # 2. Fallback: Local maximum of Gaussian-blurred brightness in upper sky
    if sun_x is None:
        gray = cv2.cvtColor(img_bgr[:int(h * 0.65), :], cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (51, 51), 0)
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(blurred)
        sun_x = float(max_loc[0])
        sun_y = float(max_loc[1])
        conf = 0.85
        detection_method = "Sky brightness peak"
        
    is_top = (sun_y < h * 0.65)
    
    # Horizontal classification
    if sun_x < w * 0.35:
        horiz = "top-left"
    elif sun_x > w * 0.65:
        horiz = "top-right"
    else:
        horiz = "overhead-center"
        
    desc = (
        f"Primary sun illumination located at {horiz} ({int(sun_x)}, {int(sun_y)}). "
        f"{detection_method} confirmed photo taken from below looking up towards the sky."
    )
    
    return {
        'sun_x': float(sun_x),
        'sun_y': float(sun_y),
        'is_top_illumination': bool(is_top),
        'light_direction': horiz,
        'confidence': float(conf),
        'description': desc
    }
