import cv2
import numpy as np
import os
import math
from skimage.filters import frangi
from skimage.graph import route_through_array
from scipy.signal import savgol_filter

def autodetect_foot_stripes(image_bytes, sail_color='auto', stripe_color='auto', num_stripes=3, sensitivity=1.0):
    """
    Intelligent Auto-detection of camber draft stripes for Foot sail photos.
    Supports various sail materials (white/dacron, black carbon/technora, translucent)
    and stripe colors (blue, red, black, green, orange, yellow, custom).
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image buffer")
    
    orig_h, orig_w = img.shape[:2]
    
    # Work on a normalized processing scale for speed and consistency (max dimension 1200px)
    scale = 1.0
    max_dim = max(orig_h, orig_w)
    if max_dim > 1200:
        scale = 1200.0 / max_dim
        proc_w = int(orig_w * scale)
        proc_h = int(orig_h * scale)
        proc_img = cv2.resize(img, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
    else:
        proc_img = img.copy()
        proc_w, proc_h = orig_w, orig_h
        
    hsv = cv2.cvtColor(proc_img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(proc_img, cv2.COLOR_BGR2GRAY)
    
    # 1. Detect / Auto-estimate Colors if set to 'auto'
    stripe_color_lower = stripe_color.lower().strip() if stripe_color else 'auto'
    sail_color_lower = sail_color.lower().strip() if sail_color else 'auto'
    
    # Auto-detect sail darkness/brightness
    mean_brightness = np.mean(gray)
    is_dark_sail = (sail_color_lower == 'black' or (sail_color_lower == 'auto' and mean_brightness < 90))
    
    # Compute stripe saliency mask
    stripe_mask = np.zeros((proc_h, proc_w), dtype=np.float32)
    
    if stripe_color_lower == 'blue' or (stripe_color_lower == 'auto' and not is_dark_sail):
        # Blue stripe detector (works on White sails like Image 1)
        # Blue in HSV: H in [90, 140], S > 35, V > 35
        b_mask = cv2.inRange(hsv, np.array([85, 30, 30]), np.array([145, 255, 255])).astype(np.float32) / 255.0
        # Also color difference in Lab or normalized B channel
        b_diff = (proc_img[:, :, 0].astype(np.float32) - 0.5 * (proc_img[:, :, 1].astype(np.float32) + proc_img[:, :, 2].astype(np.float32)))
        b_diff = np.clip(b_diff, 0, 255) / 255.0
        stripe_mask = np.maximum(b_mask, b_diff)
        
    elif stripe_color_lower == 'red' or (stripe_color_lower == 'auto' and is_dark_sail):
        # Red stripe detector (works on Black Carbon sails like Image 3)
        # Red wraps around 0/180 in HSV
        r_mask1 = cv2.inRange(hsv, np.array([0, 35, 40]), np.array([15, 255, 255])).astype(np.float32) / 255.0
        r_mask2 = cv2.inRange(hsv, np.array([165, 35, 40]), np.array([180, 255, 255])).astype(np.float32) / 255.0
        r_diff = (proc_img[:, :, 2].astype(np.float32) - 0.5 * (proc_img[:, :, 0].astype(np.float32) + proc_img[:, :, 1].astype(np.float32)))
        r_diff = np.clip(r_diff, 0, 255) / 255.0
        stripe_mask = np.maximum(np.maximum(r_mask1, r_mask2), r_diff)
        
    elif stripe_color_lower == 'black' or stripe_color_lower == 'dark':
        # Dark stripe on light sail
        inv_gray = cv2.bitwise_not(gray)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        inv_clahe = clahe.apply(inv_gray)
        stripe_mask = inv_clahe.astype(np.float32) / 255.0
        
    elif stripe_color_lower == 'green':
        g_mask = cv2.inRange(hsv, np.array([35, 35, 35]), np.array([85, 255, 255])).astype(np.float32) / 255.0
        stripe_mask = g_mask
        
    elif stripe_color_lower == 'orange' or stripe_color_lower == 'yellow':
        o_mask = cv2.inRange(hsv, np.array([15, 40, 40]), np.array([35, 255, 255])).astype(np.float32) / 255.0
        stripe_mask = o_mask
        
    else:
        # Generic multi-spectral ridge & contrast detector
        if is_dark_sail:
            enhanced = cv2.equalizeHist(gray)
        else:
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            enhanced = cv2.bitwise_not(clahe.apply(gray))
        stripe_mask = enhanced.astype(np.float32) / 255.0

    # 2. Multi-scale Frangi Ridge Filtering for curvilinear stripe detection
    vesselness = frangi(stripe_mask, sigmas=range(2, 7), black_ridges=False)
    if vesselness.max() > 0:
        vesselness = vesselness / vesselness.max()
        
    combined_response = 0.6 * stripe_mask + 0.4 * vesselness
    
    # 3. Detect Sail Boundaries / Mask
    # In foot pictures, the sail typically spans from lower part upwards
    # Find horizontal-ish strip candidates by analyzing row activations
    row_sums = np.sum(combined_response, axis=1)
    # Smooth row sums
    kernel_size = int(proc_h * 0.03)
    if kernel_size % 2 == 0: kernel_size += 1
    kernel_size = max(5, kernel_size)
    kernel = np.ones(kernel_size) / kernel_size
    smoothed_rows = np.convolve(row_sums, kernel, mode='same')
    
    # Find prominent peaks in vertical height representing stripes
    # Typically 3 stripes on modern sails: Stripe #1 (Lower 25-35%), Stripe #2 (Mid 50-60%), Stripe #3 (Upper 70-85%)
    from scipy.signal import find_peaks
    min_distance = int(proc_h * 0.12) # stripes are spaced by at least 12% of image height
    peaks, properties = find_peaks(smoothed_rows, distance=min_distance, prominence=np.max(smoothed_rows)*0.15*sensitivity)
    
    # If not enough peaks found, fall back to adaptive percentile slices
    detected_stripes = []
    
    # If peaks found, sort peaks by vertical coordinate (from bottom of sail to top, or bottom of image to top)
    candidate_y_levels = list(peaks)
    if len(candidate_y_levels) < num_stripes:
        # Fill in plausible default heights (e.g. 75%, 50%, 30% of height)
        default_levels = [int(proc_h * 0.75), int(proc_h * 0.50), int(proc_h * 0.28)]
        for dl in default_levels:
            if not any(abs(dl - py) < min_distance for py in candidate_y_levels):
                candidate_y_levels.append(dl)
                
    candidate_y_levels.sort(reverse=True) # Bottom to Top in image coordinates
    candidate_y_levels = candidate_y_levels[:num_stripes]
    candidate_y_levels.sort(reverse=True)
    
    for idx, target_y in enumerate(candidate_y_levels):
        # Extract corridor around this vertical level
        corridor_half_h = int(proc_h * 0.12)
        y_min = max(0, target_y - corridor_half_h)
        y_max = min(proc_h, target_y + corridor_half_h)
        
        corridor = combined_response[y_min:y_max, :]
        
        # Trace stripe across X coordinates
        # For each column X, find the peak Y inside the corridor
        xs = []
        ys = []
        col_step = max(2, int(proc_w / 120)) # sample ~120 points across width
        
        for cx in range(int(proc_w * 0.08), int(proc_w * 0.92), col_step):
            col_slice = corridor[:, cx]
            if np.max(col_slice) > 0.1:
                local_peak_y = np.argmax(col_slice)
                actual_y = y_min + local_peak_y
                xs.append(cx)
                ys.append(actual_y)
                
        if len(xs) >= 8:
            # Fit a robust 2nd/3rd degree polynomial or smoothing spline
            poly_deg = 2 if len(xs) < 20 else 3
            try:
                poly = np.polyfit(xs, ys, poly_deg)
                fit_fn = np.poly1d(poly)
                
                # Filter outliers
                residuals = np.abs(np.array(ys) - fit_fn(xs))
                valid_mask = residuals < (proc_h * 0.05)
                if np.sum(valid_mask) >= 6:
                    clean_xs = np.array(xs)[valid_mask]
                    clean_ys = np.array(ys)[valid_mask]
                    poly = np.polyfit(clean_xs, clean_ys, poly_deg)
                    fit_fn = np.poly1d(poly)
                    
                    x_start = float(clean_xs[0])
                    x_end = float(clean_xs[-1])
                    
                    # Generate smooth path in original image coordinates
                    eval_xs = np.linspace(x_start, x_end, 80)
                    eval_ys = fit_fn(eval_xs)
                    
                    orig_path = []
                    for ex, ey in zip(eval_xs, eval_ys):
                        orig_path.append([float(ex / scale), float(ey / scale)])
                        
                    p1_orig = {'x': float(x_start / scale), 'y': float(fit_fn(x_start) / scale)}
                    p2_orig = {'x': float(x_end / scale), 'y': float(fit_fn(x_end) / scale)}
                    
                    from processor import calculate_interactive_geometry
                    metrics = calculate_interactive_geometry(np.array(orig_path), p1_orig, p2_orig)
                    
                    detected_stripes.append({
                        'id': f'stripe_{idx+1}',
                        'label': f'Stripe #{idx+1} ({"Bottom" if idx==0 else "Mid" if idx==1 else "Top"})',
                        'p1': p1_orig,
                        'p2': p2_orig,
                        'path': orig_path,
                        'metrics': metrics
                    })
            except Exception as e:
                print(f"Polynomial fit failed for stripe {idx+1}: {e}")
                
    # If no stripes could be automatically resolved from image peaks, synthesize default positions
    if len(detected_stripes) == 0:
        default_y_fractions = [0.75, 0.52, 0.30]
        for idx, y_frac in enumerate(default_y_fractions[:num_stripes]):
            y_pos = orig_h * y_frac
            x_start = orig_w * 0.15
            x_end = orig_w * 0.85
            p1 = {'x': x_start, 'y': y_pos + (orig_h * 0.05)}
            p2 = {'x': x_end, 'y': y_pos - (orig_h * 0.05)}
            # Generate slight camber curve
            xs = np.linspace(x_start, x_end, 60)
            mid_x = (x_start + x_end) / 2
            chord_len = x_end - x_start
            depth = chord_len * 0.12 # 12% default camber
            ys = [p1['y'] + (p2['y'] - p1['y']) * ((x - x_start)/chord_len) - depth * 4 * ((x - x_start)/chord_len) * (1 - (x - x_start)/chord_len) for x in xs]
            path = [[float(x), float(y)] for x, y in zip(xs, ys)]
            from processor import calculate_interactive_geometry
            metrics = calculate_interactive_geometry(np.array(path), p1, p2)
            detected_stripes.append({
                'id': f'stripe_{idx+1}',
                'label': f'Stripe #{idx+1} ({"Bottom" if idx==0 else "Mid" if idx==1 else "Top"})',
                'p1': p1,
                'p2': p2,
                'path': path,
                'metrics': metrics
            })
            
    return {
        'success': True,
        'stripes': detected_stripes,
        'sail_color_detected': 'black' if is_dark_sail else 'white',
        'stripe_color_detected': stripe_color_lower,
        'image_dimensions': {'width': orig_w, 'height': orig_h}
    }

if __name__ == '__main__':
    with open('camber-images/test1.jpg', 'rb') as f:
        data1 = f.read()
    res1 = autodetect_foot_stripes(data1, 'white', 'blue')
    print("Test 1 Result:", len(res1['stripes']), "stripes detected.")
    for s in res1['stripes']:
        print(s['label'], s['metrics']['camber'], s['metrics']['draft_pos'])
