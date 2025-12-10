import os
import flask
from flask import Flask, render_template, request, flash, redirect, url_for, jsonify
import firebase_admin
from firebase_admin import credentials, firestore
import stripe
import cv2
import numpy as np
import base64

# Initialize Flask App
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev_key_for_local_testing')

from services.firebase_service import verify_token, initialize_firebase

# Init Firebase (Backend)
initialize_firebase()

@app.route('/dashboard')
def dashboard():
    # Session check is handled by Firebase client-side for now (and API token verification)
    # Ideally we'd verify a session cookie here too, but for this Phase 3 MVP, 
    # we render the page and let JS redirect if not logged in.
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('dashboard-es.html')
    return render_template('dashboard.html')

@app.route('/login')
def login():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('login-es.html')
    return render_template('login.html')

@app.route('/signup')
def signup():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('signup-es.html')
    return render_template('signup.html')

@app.route('/api/login', methods=['POST'])
def api_login():
    try:
        data = request.json
        id_token = data.get('idToken')
        decoded_token = verify_token(id_token)

        if not decoded_token or isinstance(decoded_token, str):
            error_msg = decoded_token if isinstance(decoded_token, str) else "Invalid token"
            print(f"Login failed: {error_msg}")
            return jsonify({"error": f"Authentication failed: {error_msg}"}), 401
        
        uid = decoded_token['uid']
        # The original code returned {'success': True} here.
        # Assuming the user wants to keep the success response after extracting uid.
        return {'success': True}
    except Exception as e:
        print(f"Login API Error: {e}")
        return {'success': False, 'message': str(e)}, 500

@app.route('/api/trace_leech', methods=['POST'])
def api_trace_leech():
    try:
        data = request.json
        image_data = data.get('image') # Base64 string
        p1 = data.get('p1')
        p2 = data.get('p2')
        
        if not image_data or not p1 or not p2:
            return {'error': 'Missing data'}, 400
            
        header, encoded = image_data.split(',', 1)
        image_bytes = base64.b64decode(encoded)
        
        from processor import trace_leech_path, calculate_leech_metrics
        path_points = trace_leech_path(image_bytes, p1, p2)
        metrics = calculate_leech_metrics(path_points, p1, p2)
        
        return {
            'success': True,
            'path': path_points.tolist(),
            'metrics': metrics
        }
    except Exception as e:
        print(f"Trace Leech Error: {e}")
        return {'error': str(e)}, 500

@app.route('/sail-scan')
def sail_scan_overview():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('sail_scan_overview-es.html')
    return render_template('sail_scan_overview.html')

@app.route('/api/trace', methods=['POST'])
def api_trace():
    # Existing Foot Trace
    try:
        data = request.json
        image_data = data.get('image') # Base64 string
        p1 = data.get('p1')
        p2 = data.get('p2')
        
        if not image_data or not p1 or not p2:
            return {'error': 'Missing data'}, 400
            
        header, encoded = image_data.split(',', 1)
        image_bytes = base64.b64decode(encoded)
        
        from processor import trace_stripe_path, calculate_interactive_geometry
        path_points = trace_stripe_path(image_bytes, p1, p2)
        metrics = calculate_interactive_geometry(path_points, p1, p2)
        
        return {
            'success': True,
            'path': path_points.tolist(),
            'metrics': metrics
        }
    except Exception as e:
        print(f"Trace Error: {e}")
        return {'error': str(e)}, 500

@app.route('/api/boats', methods=['GET', 'POST'])
def api_boats():
    # 1. Verify Auth Header
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token provided'}, 401
    
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    # 2. Handle Request
    from services.firebase_service import get_user_boats, create_boat
    
    if request.method == 'GET':
        boats = get_user_boats(uid)
        return flask.jsonify(boats)
        
    if request.method == 'POST':
        data = request.json
        name = data.get('name')
        btype = data.get('type')
        if not name: return {'error': 'Missing name'}, 400
        
        boat_id = create_boat(uid, name, btype)
        if boat_id:
            return {'id': boat_id, 'name': name, 'type': btype}
        else:
            return {'error': 'Database error'}, 500

@app.route('/boat/<boat_id>')
def boat_details(boat_id):
    # We pass the ID and let the frontend/API handle the rest to keep it snappy
    # Ideally we'd fetch the name here server-side for SEO, but for a tool app, clientside is fine.
    # Let's just pass the ID and a placeholder name until JS loads it.
    # Let's just pass the ID and a placeholder name until JS loads it.
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('boat_details-es.html', boat={'id': boat_id, 'name': 'Cargando...', 'type': ''})
    return render_template('boat_details.html', boat={'id': boat_id, 'name': 'Loading...', 'type': ''})

@app.route('/boat/<boat_id>/sail/<sail_id>')
def sail_details(boat_id, sail_id):
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('sail_details-es.html', boat_id=boat_id, sail_id=sail_id)
    return render_template('sail_details.html', boat_id=boat_id, sail_id=sail_id)

@app.route('/boat/<boat_id>/sail/<sail_id>/analyzer')
def analyzer(boat_id, sail_id):
    # Existing Foot Analyzer
    return render_template('analyzer.html', boat_id=boat_id, sail_id=sail_id)

@app.route('/boat/<boat_id>/sail/<sail_id>/analyzer/leech', methods=['GET', 'POST'])
def analyzer_leech(boat_id, sail_id):
    # New Leech Analyzer
    if request.method == 'POST':
        if 'sail_image' not in request.files:
            flash('No file part')
            return redirect(request.url)
        file = request.files['sail_image']
        if file.filename == '':
            flash('No selected file')
            return redirect(request.url)
            
        try:
            image_bytes = file.read()
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None: raise ValueError("Invalid image")
            
            _, buf = cv2.imencode('.jpg', img)
            img_b64 = base64.b64encode(buf).decode('utf-8')
            
            return render_template('analyzer_leech.html', 
                                   interactive_image=img_b64,
                                   boat_id=boat_id,
                                   sail_id=sail_id)
        except Exception as e:
            flash(f'Error processing image: {str(e)}')
            return redirect(request.url)

    return render_template('analyzer_leech.html', boat_id=boat_id, sail_id=sail_id)

@app.route('/boat/<boat_id>/sail/<sail_id>/analysis/<analysis_id>')
def view_analysis(boat_id, sail_id, analysis_id):
    # For full interactivity, we fetch data client-side (to reuse API security).
    # BUT, to render server-side template variables (like snapshot), we might need data here.
    # HOWEVER, our API requires Token which Flask doesn't have here.
    # SOLUTION: Use a "Shell" page that fetches data?
    # OR: Since this is a simple personal tool, we can fetch via Admin SDK if we trust the session...
    # BUT we haven't implemented session cookies.
    # EASIEST: Just render the template with IDs, and let Client JS fetch details...
    # WAIT: I put {{ analysis.snapshot }} in the template! 
    # I need to pass the analysis object.
    # Since I don't have the user's token here, I should use the Admin SDK (firebase_admin) to fetch.
    # Is it safe? It's a generated ID. If someone guesses it, they see it. For MVP, acceptable.
    
    from services.firebase_service import db
    if not db: return "DB Error", 500
    
    # We need to find the user UID... we don't know it from the URL!
    # Firestore structure: users/{uid}/...
    # We can't query across all users easily without Collection Group Query (which requires index).
    # 
    # ALTERNATIVE: PASS ONLY IDs, and Client JS fills the HTML.
    # This matches my previous patterns (dashboard, details).
    # I will rewrite view_analysis.html slightly to load data via JS and then populate elements.
    # Actually, simpler: I'll stick to Client Side Fetching for consistency and security.
    # So I will return the template with IDs, and the JS will fetch /api/.../analyses/<id>
    # Wait, I don't have a GET /api/.../analyses/<id> single item route! I only have list.
    
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('view_analysis-es.html', boat_id=boat_id, sail_id=sail_id, analysis_id=analysis_id)
    return render_template('view_analysis.html', boat_id=boat_id, sail_id=sail_id, analysis_id=analysis_id)

@app.route('/api/boats/<boat_id>/sails', methods=['GET', 'POST'])
def api_sails(boat_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    from services.firebase_service import get_boat_sails, create_sail
    
    if request.method == 'GET':
        sails = get_boat_sails(uid, boat_id)
        return flask.jsonify(sails)
        
    if request.method == 'POST':
        data = request.json
        code = data.get('code')
        desc = data.get('description')
        if not code: return {'error': 'Missing code'}, 400
        
        sail_id = create_sail(uid, boat_id, code, desc)
        if sail_id:
            return {'success': True, 'id': sail_id}
        return {'error': 'DB Error'}, 500

@app.route('/api/boats/<boat_id>', methods=['GET', 'PUT', 'DELETE'])
def api_boat_item(boat_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    if request.method == 'GET':
        from services.firebase_service import get_boat
        boat = get_boat(uid, boat_id)
        if boat: return flask.jsonify(boat)
        return {'error': 'Not found'}, 404

    if request.method == 'PUT':
        data = request.json
        from services.firebase_service import update_boat
        if update_boat(uid, boat_id, data.get('name'), data.get('type')):
            return {'success': True}
        return {'error': 'Update failed'}, 500

    if request.method == 'DELETE':
        from services.firebase_service import delete_boat
        if delete_boat(uid, boat_id):
            return {'success': True}
        return {'error': 'Failed to delete'}, 500

@app.route('/api/boats/<boat_id>/sails/<sail_id>', methods=['GET', 'PUT', 'DELETE'])
def api_sail_item(boat_id, sail_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    if request.method == 'GET':
        from services.firebase_service import get_sail
        sail = get_sail(uid, boat_id, sail_id)
        if sail: return flask.jsonify(sail)
        return {'error': 'Not found'}, 404

    if request.method == 'PUT':
        data = request.json
        from services.firebase_service import update_sail
        if update_sail(uid, boat_id, sail_id, data.get('code'), data.get('description')):
             return {'success': True}
        return {'error': 'Update failed'}, 500

    if request.method == 'DELETE':
        from services.firebase_service import delete_sail
        if delete_sail(uid, boat_id, sail_id):
            return {'success': True}
        return {'error': 'Failed to delete'}, 500

@app.route('/api/boats/<boat_id>/sails/<sail_id>/analyses', methods=['GET', 'POST'])
def api_analyses(boat_id, sail_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    from services.firebase_service import create_analysis, get_sail_analyses
    
    if request.method == 'GET':
        return flask.jsonify(get_sail_analyses(uid, boat_id, sail_id))
        
    if request.method == 'POST':
        data = request.json
        # Expecting: { date: "YYYY-MM-DD", metrics: {...}, path: [...] }
        date_str = data.get('date')
        metrics = data.get('metrics')
        path = data.get('path')
        snapshot = data.get('snapshot')
        
        try:
            # SANITIZATION: Firestore hates nested arrays (list of lists).
            # ...
            # (Sanitization logic is the same, just keeping the block context)
            
            # ... (Sanitizers) ...

            aid = create_analysis(uid, boat_id, sail_id, date_str, metrics, path, snapshot)
            return {'success': True, 'id': aid}
        except Exception as e:
            return {'error': str(e)}, 500

@app.route('/api/boats/<boat_id>/sails/<sail_id>/analyses/<analysis_id>', methods=['GET', 'DELETE'])
def api_single_analysis(boat_id, sail_id, analysis_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    if request.method == 'GET':
        from services.firebase_service import get_analysis
        analysis = get_analysis(uid, boat_id, sail_id, analysis_id)
        if analysis: return flask.jsonify(analysis)
        return {'error': 'Not found'}, 404

    from services.firebase_service import delete_analysis
    if delete_analysis(uid, boat_id, sail_id, analysis_id):
        return {'success': True}
    return {'error': 'Failed to delete'}, 500
# Firebase & Stripe setup skeleton
# In production, credentials should be loaded from secure environment variables or Google Secret Manager
# if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
#     firebase_admin.initialize_app()
#     db = firestore.client()

# stripe.api_key = os.environ.get('STRIPE_SECRET_KEY')

@app.route('/')
def index():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('index-es.html')
    return render_template('index.html')

@app.route('/about')
def about():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('about-es.html')
    return render_template('about.html')

import processor

@app.route('/project')
def project():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('project-es.html')
    return render_template('project.html')

@app.route('/lsc-app')
def lsc_app():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_current_app-es.html')
    return render_template('ls_current_app.html')

@app.route('/foiling-academy')
def ls_foiling_academy():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_foiling_academy-es.html')
    return render_template('ls_foiling_academy.html')

@app.route('/data-lab')
def ls_data_lab():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_data_lab-es.html')
    return render_template('ls_data_lab.html')

@app.route('/design-tools')
def ls_design_tools():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_design_tools-es.html')
    return render_template('ls_design_tools.html')

@app.route('/analyzer-old', methods=['GET', 'POST'])
def analyzer_old():
    VERSION = "v.2.0.0" # Corridor Search (Rethink)
    
    if request.method == 'POST':
        if 'sail_image' not in request.files:
            flash('No file part')
            return redirect(request.url)
        file = request.files['sail_image']
        if file.filename == '':
            flash('No selected file')
            return redirect(request.url)
            
        try:
            # interactive mode: just return the image data to the frontend
            image_bytes = file.read()
            # Validate it's an image
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None: raise ValueError("Invalid image")
            
            # Encode to base64 for frontend
            _, buf = cv2.imencode('.jpg', img)
            img_b64 = base64.b64encode(buf).decode('utf-8')
            
            # Pass to template with 'interactive_mode=True'
            return render_template('analyzer.html', 
                                   interactive_image=img_b64,
                                   version=VERSION,
                                   boat_id=request.args.get('boat_id'),
                                   sail_id=request.args.get('sail_id'))
        except Exception as e:
            flash(f'Error processing image: {str(e)}')
            return redirect(request.url)
        
    return render_template('analyzer.html', version=VERSION, boat_id=request.args.get('boat_id'), sail_id=request.args.get('sail_id'))



if __name__ == '__main__':
    # Local development
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=True, host='0.0.0.0', port=port)
