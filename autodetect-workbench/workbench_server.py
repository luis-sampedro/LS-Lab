"""
Autodetect Workbench Server
A standalone testing platform and workbench for rapid development, testing,
parameter tuning, and live visualization of the sail camber autodetect engine.
"""

import os
import glob
import base64
import json
import cv2
import numpy as np
from flask import Flask, render_template, request, jsonify, send_file

from engine.autodetect_engine import run_autodetect_pipeline
from engine.stripe_tracker import trace_ridge_from_seed
from engine.camber_solver import compute_point_to_chord_offset

app = Flask(
    __name__,
    template_folder='templates',
    static_folder='static'
)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, '..'))
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)


def get_available_images():
    """Gathers all test images available across LS-Lab and uploads."""
    results = []
    
    # 1. Uploaded workbench images
    for p in glob.glob(os.path.join(UPLOADS_DIR, '*.*')):
        if p.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp')):
            results.append({
                'id': f"upload_{os.path.basename(p)}",
                'name': f"[Upload] {os.path.basename(p)}",
                'path': p
            })
            
    # 2. User uploaded test image in brain directory
    brain_uploads = 'C:/Users/LUIS/.gemini/antigravity/brain/0956116e-d0ec-4281-9f8a-03b65de2c546/.user_uploaded'
    if os.path.exists(brain_uploads):
        for p in glob.glob(os.path.join(brain_uploads, '*.*')):
            if p.lower().endswith(('.jpg', '.jpeg', '.png')):
                results.append({
                    'id': f"brain_{os.path.basename(p)}",
                    'name': f"[User Test] {os.path.basename(p)}",
                    'path': p
                })
                
    # 3. camber-images gallery
    camber_dir = os.path.join(PROJECT_ROOT, 'camber-images')
    if os.path.exists(camber_dir):
        for p in glob.glob(os.path.join(camber_dir, '*.*')):
            if p.lower().endswith(('.jpg', '.jpeg', '.png')):
                results.append({
                    'id': f"camber_{os.path.basename(p)}",
                    'name': f"[Camber Gallery] {os.path.basename(p)}",
                    'path': p
                })
                
    # 4. static sample images
    static_dir = os.path.join(PROJECT_ROOT, 'static', 'images')
    if os.path.exists(static_dir):
        for p in glob.glob(os.path.join(static_dir, '*sample*.*')):
            results.append({
                'id': f"sample_{os.path.basename(p)}",
                'name': f"[Sample] {os.path.basename(p)}",
                'path': p
            })
            
    # Prioritize Port1.jpg as the default test image
    results.sort(key=lambda x: 0 if 'port1' in x['name'].lower() else 1)
    return results


@app.route('/')
def index():
    images = get_available_images()
    return render_template('index.html', images=images)


@app.route('/api/images', methods=['GET'])
def api_images():
    return jsonify({'success': True, 'images': get_available_images()})


@app.route('/api/image-file', methods=['GET'])
def api_image_file():
    path = request.args.get('path')
    if not path or not os.path.exists(path):
        return jsonify({'error': 'Image not found'}), 404
    return send_file(path)


@app.route('/api/detect', methods=['POST'])
def api_detect():
    data = request.get_json() or {}
    
    img_bgr = None
    if 'image_b64' in data and data['image_b64']:
        raw_b64 = data['image_b64'].split(',')[-1]
        img_bytes = base64.b64decode(raw_b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    elif 'image_path' in data and data['image_path'] and os.path.exists(data['image_path']):
        img_bgr = cv2.imread(data['image_path'])
        
    if img_bgr is None:
        return jsonify({'success': False, 'error': 'Could not load image'}), 400
        
    sail_type = data.get('sail_type', 'mainsail')
    is_foot_picture = bool(data.get('is_foot_picture', True))
    stripe_color = data.get('stripe_color', 'auto')
    filter_mode = data.get('filter_mode', 'auto')
    num_stripes = int(data.get('num_stripes', 3))
    sensitivity = float(data.get('sensitivity', 1.0))
    enforce_bowl = bool(data.get('enforce_bowl', True))
    
    result = run_autodetect_pipeline(
        img_bgr,
        sail_type=sail_type,
        is_foot_picture=is_foot_picture,
        stripe_color=stripe_color,
        filter_mode=filter_mode,
        num_stripes=num_stripes,
        sensitivity=sensitivity,
        enforce_bowl=enforce_bowl
    )
    
    return jsonify(result)


@app.route('/api/upload', methods=['POST'])
def api_upload():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'Empty filename'}), 400
        
    filename = f"upload_{int(time.time())}_{file.filename}"
    save_path = os.path.join(UPLOADS_DIR, filename)
    file.save(save_path)
    
    return jsonify({
        'success': True,
        'path': save_path,
        'name': file.filename
    })


if __name__ == '__main__':
    print("================================================================")
    print(" Sail Autodetect Testing Platform & Workbench")
    print(" Running on: http://127.0.0.1:5055")
    print("================================================================")
    app.run(host='0.0.0.0', port=5055, debug=False)
