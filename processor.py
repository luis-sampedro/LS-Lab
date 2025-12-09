
import cv2
import numpy as np
import base64
import math
from skimage.graph import route_through_array

from skimage.filters import frangi

def trace_stripe_path(image_bytes, p1, p2):
    """
    v2.0: Restricted Corridor Search.
    User Report: Global search jumps to sky/shortcuts.
    Solution: Mask out everything except a 150px wide corridor connecting P1-P2.
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None: raise ValueError("Decode error")
    
    h, w = img.shape[:2]
    
    # 1. Geometry: Define the "Search Corridor"
    # The stripe MUST be roughly between P1 and P2.
    # We create a mask that is a thick line connecting them.
    corridor_mask = np.zeros((h, w), dtype=np.uint8)
    pt1 = (int(p1['x']), int(p1['y']))
    pt2 = (int(p2['x']), int(p2['y']))
    
    # Calculate adaptive corridor width (e.g. 15% of image width or min 100px)
    px_dist = np.linalg.norm(np.array(pt1) - np.array(pt2))
    thickness = int(max(100, px_dist * 0.3)) # 30% of length as width flexibility
    
    cv2.line(corridor_mask, pt1, pt2, 255, thickness)
    
    # 2. Image Processing: Dark Stripe Detection (Simplified)
    # Convert to Gray
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Invert so Dark Stripe = Bright (High Value)
    inverted = cv2.bitwise_not(gray)
    
    # Contrast Enhancement (Clip gradients)
    # This makes the stripe "pop" against the white sail constraints
    inverted = cv2.normalize(inverted, None, 0, 255, cv2.NORM_MINMAX)
    
    # 3. Frangi (Ridge Detection)
    # We still use Frangi because it's excellent at finding "lines" vs "blobs"
    # But now we only look INSIDE the corridor.
    from skimage.filters import frangi
    vesselness = frangi(inverted, sigmas=range(1, 5), black_ridges=False)
    if vesselness.max() > 0: vesselness /= vesselness.max()
    
    # 4. Cost Map Construction
    # High Vesselness = Low Cost.
    # We want cost to be 1.0 (base) - vesselness.
    base_cost = 1.0 - vesselness
    
    # Scale to integer cost 1-100
    cost_map = (base_cost * 100).astype(np.float64)
    
    # 5. APPLY CORRIDOR MASK ( The "Brick Wall" )
    # Pixels outside the corridor get INFINITE cost.
    # We interpret 0 in mask as "Outside".
    # But wait, we need to ensure local continuity. 
    # Let's add a "Distance Field" from the center line of the corridor?
    # Actually, a hard mask is safest to prevent sky jumps.
    
    # However, to be safe against slight curves outside the straight line,
    # the thickness needs to be generous.
    outside_corridor = (corridor_mask == 0)
    cost_map[outside_corridor] = 100000.0 # Huge penalty
    
    # 6. Pathfinding
    # Downscale for speed/stability? No, keep precision.
    try:
        start = (pt1[1], pt1[0]) # r, c
        end = (pt2[1], pt2[0])
        
        # Route
        indices, weight = route_through_array(cost_map, start, end, geometric=True, fully_connected=True)
        path = np.array(indices) # [[r, c], ...]
        
        # Convert to [x, y]
        # x = c, y = r
        path_xy = np.column_stack((path[:, 1], path[:, 0]))
        
        # 7. Smoothing (Savitzky-Golay)
        # We need to smooth the pixel steps.
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
        print(f"Corridor Trace Failed: {e}")
        # Return straight line fallback
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
        entry_deg = abs(np.degrees(math.atan2(vy, vx)))

    if np.sum(te_mask) > 5:
        line_pts = pts_rot[te_mask]
        [vx, vy, x, y] = cv2.fitLine(line_pts.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01)
        exit_deg = abs(np.degrees(math.atan2(vy, vx)))

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
