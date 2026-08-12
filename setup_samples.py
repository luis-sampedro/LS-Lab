import shutil
import cv2
import numpy as np

# 1. Copy existing test1 and test2 images
shutil.copy('camber-images/test1.jpg', 'static/images/sample-white-blue.jpg')
shutil.copy('camber-images/test2.jpg', 'static/images/sample-white-boom.jpg')

# 2. Create sample black carbon with red stripes if not present
img_black = np.zeros((800, 1000, 3), dtype=np.uint8)
# Background dark carbon texture
for y in range(800):
    for x in range(1000):
        val = int(25 + 15 * np.sin(x / 5.0) * np.cos(y / 7.0) + (800 - y) * 0.05)
        img_black[y, x] = [val, val, val + 5]

# Add red draft stripes
y_levels = [620, 420, 220]
for idx, y_pos in enumerate(y_levels):
    x1, x2 = 120, 880
    depth = 60 - idx * 10
    for x in range(x1, x2):
        t = (x - x1) / (x2 - x1)
        y = int(y_pos - depth * 4 * t * (1 - t) + 15 * t)
        cv2.circle(img_black, (x, y), 3, (30, 40, 230), -1)

cv2.imwrite('static/images/sample-black-red.jpg', img_black)

# 3. Create sample jib top label badge with ORC handwritten details
label_img = np.ones((600, 750, 3), dtype=np.uint8) * 40 # dark background
# white sticker badge
cv2.rectangle(label_img, (80, 80), (670, 520), (240, 240, 240), -1)
cv2.rectangle(label_img, (80, 80), (670, 520), (180, 180, 180), 2)

# Text lines
font = cv2.FONT_HERSHEY_SIMPLEX
cv2.putText(label_img, "ORC", (130, 150), font, 1.0, (20, 20, 20), 2)
cv2.putText(label_img, "831", (360, 150), font, 1.0, (20, 20, 20), 2)
cv2.putText(label_img, "ESP", (540, 150), font, 1.0, (20, 20, 20), 2)
cv2.putText(label_img, "11/08/2025", (130, 210), font, 0.9, (40, 40, 40), 2)

cv2.putText(label_img, "HB: 0.108", (130, 280), font, 0.9, (20, 20, 20), 2)
cv2.putText(label_img, "HHW: 2.68", (360, 280), font, 0.9, (20, 20, 20), 2)
cv2.putText(label_img, "HLU: 18.14", (540, 280), font, 0.9, (20, 20, 20), 2)

cv2.putText(label_img, "HUW: 0.77", (130, 350), font, 0.9, (20, 20, 20), 2)
cv2.putText(label_img, "HQW: 3.93", (360, 350), font, 0.9, (20, 20, 20), 2)

cv2.putText(label_img, "HTW: 1.46", (130, 420), font, 0.9, (20, 20, 20), 2)
cv2.putText(label_img, "HLP: 5.25", (360, 420), font, 0.9, (20, 20, 20), 2)

cv2.imwrite('static/images/sample-jib-label.jpg', label_img)
print("Sample images created successfully.")
