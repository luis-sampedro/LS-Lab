"""
Multi-Scale Ridge Extractor Module
Computes robust saliency maps using Top-Hat morphological filtering, Steerable Hessian/Frangi eigenvalues,
and color chroma differences to highlight draft stripe centerlines.
"""

import cv2
import numpy as np


def compute_hessian_ridge(gray, sigma=2.0, bright_ridge=True):
    """
    Computes eigenvalue response of Hessian matrix at scale sigma.
    Ideal for detecting thin, continuous curved lines on sails.
    """
    # Gaussian blur at scale sigma
    ksize = int(2 * round(3 * sigma) + 1)
    blurred = cv2.GaussianBlur(gray, (ksize, ksize), sigma)
    
    # 2nd order derivatives
    # Sobel with ksize=3 on float
    dx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
    dy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
    dxx = cv2.Sobel(dx, cv2.CV_32F, 1, 0, ksize=3)
    dyy = cv2.Sobel(dy, cv2.CV_32F, 0, 1, ksize=3)
    dxy = cv2.Sobel(dx, cv2.CV_32F, 0, 1, ksize=3)
    
    # Eigenvalues of [[dxx, dxy], [dxy, dyy]]
    # Trace = dxx + dyy
    # Det = dxx * dyy - dxy^2
    trace = dxx + dyy
    det = dxx * dyy - dxy * dxy
    disc = np.sqrt(np.maximum(0, (trace * trace) / 4.0 - det))
    
    lambda1 = trace / 2.0 + disc
    lambda2 = trace / 2.0 - disc
    
    # For bright ridges on dark background: lambda2 is strongly negative
    # For dark ridges on bright background: lambda1 is strongly positive
    if bright_ridge:
        ridge = np.maximum(0, -lambda2)
    else:
        ridge = np.maximum(0, lambda1)
        
    if np.max(ridge) > 0:
        ridge = (ridge / np.max(ridge)) * 255.0
    return ridge.astype(np.float32)


def extract_stripe_saliency(img_bgr, sail_mask, is_dark_sail, stripe_color='auto', filter_mode='auto', sensitivity=1.0):
    """
    Extracts multi-spectral ridge saliency map on the sail.
    
    Args:
        img_bgr: BGR input image
        sail_mask: Binary mask of sail cloth
        is_dark_sail: Boolean
        stripe_color: 'auto', 'red', 'blue', 'white', 'black', or custom hex '#RRGGBB'
        filter_mode: 'auto', 'tophat', 'hessian', 'chroma', 'combined'
        sensitivity: float multiplier (0.5 to 2.5)
        
    Returns:
        dict: {
            'saliency': np.ndarray (float32, 0 to 255),
            'detected_stripe_name': str,
            'detected_stripe_hex': str,
            'saliency_stages': dict of intermediate images for workbench debug
        }
    """
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2Lab)
    b, g, r = cv2.split(img_bgr)
    
    # 1. Morphological Top-Hat and Black-Hat
    k_stripe = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_stripe).astype(np.float32)
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, k_stripe).astype(np.float32)
    
    # 2. Steerable Hessian Ridge
    hessian_bright = compute_hessian_ridge(gray, sigma=2.0, bright_ridge=True)
    hessian_dark = compute_hessian_ridge(gray, sigma=2.0, bright_ridge=False)
    
    # 3. Chroma Channels
    b_f = b.astype(np.float32)
    g_f = g.astype(np.float32)
    r_f = r.astype(np.float32)
    blue_chroma = np.maximum(0, b_f - np.maximum(r_f, g_f))
    red_chroma = np.maximum(0, r_f - np.maximum(b_f, g_f))
    
    stripe_color_str = str(stripe_color).lower().strip() if stripe_color else 'auto'
    is_custom_hex = stripe_color_str.startswith('#') or (len(stripe_color_str) in [3, 6] and all(c in '0123456789abcdef' for c in stripe_color_str))
    
    detected_name = "Auto-detected"
    detected_hex = "#38bdf8"
    
    if is_custom_hex:
        hex_clean = stripe_color_str.lstrip('#')
        if len(hex_clean) == 3:
            hex_clean = ''.join([c*2 for c in hex_clean])
        r_tgt = int(hex_clean[0:2], 16)
        g_tgt = int(hex_clean[2:4], 16)
        b_tgt = int(hex_clean[4:6], 16)
        tgt_bgr = np.uint8([[[b_tgt, g_tgt, r_tgt]]])
        tgt_lab = cv2.cvtColor(tgt_bgr, cv2.COLOR_BGR2Lab)[0, 0].astype(np.float32)
        
        dL = (lab[:, :, 0].astype(np.float32) - tgt_lab[0]) * 0.4
        da = lab[:, :, 1].astype(np.float32) - tgt_lab[1]
        db = lab[:, :, 2].astype(np.float32) - tgt_lab[2]
        c_dist = np.sqrt(dL**2 + da**2 + db**2)
        sal = np.maximum(0, 100.0 - c_dist * 2.0) * 2.0
        
        # Boost with structural ridge
        sal = sal * 0.7 + (tophat if is_dark_sail else blackhat) * 0.8
        detected_name = f"Custom Color (#{hex_clean})"
        detected_hex = f"#{hex_clean}"
        
    elif stripe_color_str == 'red':
        sal = red_chroma * 2.5 + (tophat * 0.5 if is_dark_sail else blackhat * 0.5)
        detected_name = "Red Stripe"
        detected_hex = "#ef4444"
        
    elif stripe_color_str == 'blue':
        sal = blue_chroma * 2.5 + (tophat * 0.5 if is_dark_sail else blackhat * 0.5)
        detected_name = "Blue Stripe"
        detected_hex = "#3b82f6"
        
    elif stripe_color_str in ['black', 'dark']:
        sal = blackhat * 1.8 + hessian_dark * 0.7
        detected_name = "Dark / Black Stripe"
        detected_hex = "#1e293b"
        
    elif stripe_color_str in ['white', 'light']:
        sal = tophat * 1.8 + hessian_bright * 0.7
        detected_name = "White / Light Stripe"
        detected_hex = "#f8fafc"
        
    else:  # 'auto'
        if is_dark_sail:
            r_peak = np.percentile(red_chroma[sail_mask > 0], 99.5) if np.any(sail_mask > 0) else 0
            if r_peak > 35:
                sal = red_chroma * 2.2 + tophat * 0.6
                detected_name = "Red Stripe"
                detected_hex = "#ef4444"
            else:
                sal = tophat * 1.6 + hessian_bright * 0.8
                detected_name = "White / Light Stripe"
                detected_hex = "#f8fafc"
        else:
            b_peak = np.percentile(blue_chroma[sail_mask > 0], 99.5) if np.any(sail_mask > 0) else 0
            r_peak = np.percentile(red_chroma[sail_mask > 0], 99.5) if np.any(sail_mask > 0) else 0
            if b_peak > 25:
                sal = blue_chroma * 2.5 + blackhat * 0.5
                detected_name = "Blue Stripe"
                detected_hex = "#3b82f6"
            elif r_peak > 35:
                sal = red_chroma * 2.2 + blackhat * 0.5
                detected_name = "Red Stripe"
                detected_hex = "#ef4444"
            else:
                sal = blackhat * 1.6 + hessian_dark * 0.8
                detected_name = "Dark / Black Stripe"
                detected_hex = "#1e293b"
                
    # Filter mode override if requested by user workbench
    if filter_mode == 'tophat':
        sal = tophat * 2.0
    elif filter_mode == 'hessian':
        sal = hessian_bright * 2.0 if is_dark_sail else hessian_dark * 2.0
    elif filter_mode == 'chroma':
        sal = np.maximum(red_chroma, blue_chroma) * 3.0
    elif filter_mode == 'combined':
        sal = (tophat * 1.2 + hessian_bright * 0.8) if is_dark_sail else (blackhat * 1.2 + hessian_dark * 0.8)
        
    # Mask out background
    sal[sail_mask == 0] = 0.0
    sal *= float(sensitivity)
    
    # Intermediate stages for visual debug
    stages = {
        'tophat': cv2.normalize(tophat, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8),
        'hessian': cv2.normalize(hessian_bright if is_dark_sail else hessian_dark, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8),
        'saliency': cv2.normalize(sal, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    }
    
    return {
        'saliency': sal,
        'detected_stripe_name': detected_name,
        'detected_stripe_hex': detected_hex,
        'stages': stages
    }
