import cv2
import numpy as np
import os

# IMAGE_PATH = r'c:\Users\LUIS\Desktop\LS-Personal-Lab\LS-Lab\camber-images\test1.jpg'
IMAGE_PATH = r'c:\Users\LUIS\Desktop\LS-Personal-Lab\LS-Lab\camber-images\test2.jpg'

if not os.path.exists(IMAGE_PATH):
    print("Image not found path:", IMAGE_PATH)
    exit()

img = cv2.imread(IMAGE_PATH)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

print(f"Image Shape: {img.shape}")

# Define Blue Mask (Debugging)
lower_blue = np.array([90, 50, 50])
upper_blue = np.array([140, 255, 255])
mask = cv2.inRange(hsv, lower_blue, upper_blue)

red_pixels = cv2.countNonZero(mask) # actually blue
print(f"Blue pixels found: {red_pixels}")

contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
print(f"Total contours found: {len(contours)}")

# Analyze contour sizes
min_area = (img.shape[0] * img.shape[1]) * 0.0001
large_contours = [c for c in contours if cv2.contourArea(c) > min_area]
print(f"Large contours (> {min_area:.1f} px): {len(large_contours)}")

for i, c in enumerate(large_contours):
    # Check both BoundingRect (used in current broken processor) and MinAreaRect
    x,y,w,h = cv2.boundingRect(c)
    ar_bound = max(w,h)/min(w,h) if min(w,h) > 0 else 0
    
    rect = cv2.minAreaRect(c)
    (center), (w_rot, h_rot), angle = rect
    ar_rot = max(w_rot, h_rot)/min(w_rot, h_rot) if min(w_rot, h_rot) > 0 else 0
    
    print(f"Contour {i}: Area={cv2.contourArea(c):.0f} | BoundAR={ar_bound:.2f} | RotatedAR={ar_rot:.2f}")

    if i > 10: break # Don't spam

# Sample center pixel color
center_y, center_x = img.shape[0]//2, img.shape[1]//2
pixel = hsv[center_y, center_x]
print(f"Center Pixel HSV: {pixel}")
