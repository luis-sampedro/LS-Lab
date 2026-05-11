import os
import flask
from flask import Flask, render_template, request, flash, redirect, url_for, jsonify
import firebase_admin
from firebase_admin import credentials, firestore
import stripe
import cv2
import numpy as np
import base64
import sqlite3
import io
from datetime import datetime, timedelta
from flask import send_file, abort, send_from_directory

# Initialize Flask App
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev_key_for_local_testing')

from services.firebase_service import verify_token, initialize_firebase

# Init Firebase (Backend)
initialize_firebase()

@app.route('/tiles/<map_id>/<int:z>/<int:x>/<int:y>.png')
def serve_mbtiles(map_id, z, x, y):
    if map_id == 'riasbaixas':
        # SECURITY CHECK FOR PRO
        auth_header = request.headers.get('Authorization')
        # If no auth header, maybe it's in the URL as a token? 
        token = request.args.get('token')
        if not token and auth_header:
            token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
            
        if not token:
            return abort(401, description="Authentication required for PRO charts")
            
        user = verify_token(token)
        if not user: return abort(401, description="Invalid token")
        
        from services.firebase_service import is_user_pro
        if not is_user_pro(user['uid']):
            return abort(403, description="PRO subscription required for this map")

        db_path = r"C:\Users\LUIS\Desktop\riasbaixas.mbtiles"
        if not os.path.exists(db_path):
            return abort(404, description="MBTiles file not found")
            
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # TMS format translation
            tms_y = (1 << z) - 1 - y
            
            # Check both normal Y and TMS Y coordinates to handle XYZ AND TMS exports natively
            cursor.execute("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND (tile_row=? OR tile_row=?)", (z, x, y, tms_y))
            row = cursor.fetchone()
            conn.close()
            
            if row and row[0]:
                return send_file(io.BytesIO(row[0]), mimetype='image/png')
            else:
                return abort(404, description="Tile not found")
        except Exception as e:
            return abort(500, description=str(e))
    return abort(404)



@app.route('/my-account')
def my_account():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('my_account-es.html')
    return render_template('my_account.html')

@app.route('/api/user/profile', methods=['GET', 'POST'])
def api_user_profile():
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    from services.firebase_service import get_user_profile, update_user_profile
    
    if request.method == 'GET':
        profile = get_user_profile(uid)
        if profile and profile.get('is_trial'):
            # Check expiration
            start_ts = profile.get('trial_started_at')
            if start_ts:
                # Firestore timestamp can be datetime or internal obj depending on fetch
                # services/firebase_service.py usually returns dicts from to_dict()
                # which converts Timestamps to datetimes.
                if isinstance(start_ts, datetime):
                    if datetime.now(start_ts.tzinfo) > start_ts + timedelta(days=7):
                        # Expired
                        update_user_profile(uid, {'is_trial': False, 'is_pro': False})
                        profile['is_trial'] = False
                        profile['is_pro'] = False
        
        return flask.jsonify(profile if profile else {})
        
    if request.method == 'POST':
        data = request.json
        if update_user_profile(uid, data):
            return {'success': True}
        return {'error': 'Update failed'}, 500

@app.route('/api/download/mbtiles/<path:filename>')
def api_download_mbtiles(filename):
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        # Check if token is in query param for easier download links if needed, 
        # but header is safer. Let's support both for usability.
        token = request.args.get('token')
    else:
        token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
    
    if not token: return abort(401)
    
    user = verify_token(token)
    if not user: return abort(401)
    
    from services.firebase_service import is_user_pro
    if not is_user_pro(user['uid']):
        return abort(403, description="PRO status required for downloads")
    
    directory = os.path.join(app.root_path, 'protected_downloads')
    return send_from_directory(directory, filename, as_attachment=True)

@app.route('/api/user/activate-pro', methods=['POST'])
def api_activate_pro():
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    data = request.json
    code = data.get('code', '').upper().strip()
    
    # MASTER_CODE from environment variable or fallback for development
    master_code = os.environ.get('MASTER_CODE', 'LUISIÑO').upper()
    trial_code = "ÑOTH"
    
    from services.firebase_service import update_user_profile
    if code == master_code:
        if update_user_profile(uid, {'is_pro': True, 'is_trial': False}):
            return {'success': True, 'message': 'PRO activated!'}
        return {'error': 'Failed to update status'}, 500
    elif code == trial_code:
        if update_user_profile(uid, {
            'is_trial': True, 
            'is_pro': False,
            'trial_started_at': datetime.now()
        }):
            return {'success': True, 'message': '7-Day Trial activated!'}
        return {'error': 'Failed to activate trial'}, 500
    else:
        return {'error': 'Invalid code. Keep searching!'}, 403


@app.route('/my-fleet')
def my_fleet():
    # Session check is handled by Firebase client-side for now
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('my_fleet-es.html')
    return render_template('my_fleet.html')


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

@app.route('/boat/<boat_id>/sail/<sail_id>/analyzer', methods=['GET', 'POST'])
def analyzer(boat_id, sail_id):
    print(f"DEBUG: Analyzer route hit! Method: {request.method}")
    VERSION = "v3.0.0" 
    if request.method == 'POST':
        print(f"DEBUG: POST data keys: {request.files.keys()}")
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
            
            lang = request.args.get('lang', 'en')
            template = 'analyzer-es.html' if lang == 'es' else 'analyzer.html'
            return render_template(template, 
                                   interactive_image=img_b64,
                                   version=VERSION,
                                   boat_id=boat_id,
                                   sail_id=sail_id)
        except Exception as e:
            flash(f'Error processing image: {str(e)}')
            return redirect(request.url)

    lang = request.args.get('lang', 'en')
    template = 'analyzer-es.html' if lang == 'es' else 'analyzer.html'
    return render_template(template, version=VERSION, boat_id=boat_id, sail_id=sail_id)

@app.route('/api/analyze/geometry', methods=['POST'])
def api_analyze_geometry():
    try:
        data = request.json
        p1 = data.get('p1')
        p2 = data.get('p2')
        path = data.get('path') # List of {x,y} or [x,y]
        
        if not p1 or not p2 or not path: 
            return {'error': 'Missing data'}, 400
            
        # Convert path to numpy array [[x, y], ...]
        import numpy as np
        if len(path) > 0 and isinstance(path[0], dict):
             path_arr = np.array([[p['x'], p['y']] for p in path])
        else:
             path_arr = np.array(path)
             
        from processor import calculate_interactive_geometry
        metrics = calculate_interactive_geometry(path_arr, p1, p2)
        
        return {'success': True, 'metrics': metrics}
    except Exception as e:
        print(f"Geometry Calc Error: {e}")
        return {'error': str(e)}, 500

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
            
            lang = request.args.get('lang', 'en')
            # Check if -es version exists (checking manually in next turn if not sure, but let's assume pattern)
            template = 'analyzer_leech-es.html' if lang == 'es' else 'analyzer_leech.html'
            return render_template(template, 
                                   interactive_image=img_b64,
                                   boat_id=boat_id,
                                   sail_id=sail_id)
        except Exception as e:
            flash(f'Error processing image: {str(e)}')
            return redirect(request.url)

    lang = request.args.get('lang', 'en')
    template = 'analyzer_leech-es.html' if lang == 'es' else 'analyzer_leech.html'
    return render_template(template, boat_id=boat_id, sail_id=sail_id)

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
            def sanitize_lists(obj):
                if isinstance(obj, list):
                    if len(obj) > 0 and isinstance(obj[0], list):
                        return [{"x": float(p[0]), "y": float(p[1])} if len(p) >= 2 else {"x": p[0], "y": p[0]} for p in obj]
                    return [sanitize_lists(item) for item in obj]
                elif isinstance(obj, dict):
                    return {k: sanitize_lists(v) for k, v in obj.items()}
                return obj

            metrics = sanitize_lists(metrics)
            path = sanitize_lists(path)

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

@app.route('/api/boats/<boat_id>/reports', methods=['POST'])
def api_boat_reports(boat_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'No token'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Invalid token'}, 401
    uid = user['uid']
    
    from services.firebase_service import add_datalab_report
    data = request.json
    try:
        report_id = add_datalab_report(uid, boat_id, data)
        if report_id:
            return {'success': True, 'id': report_id}
        return {'error': 'Could not save report'}, 500
    except Exception as e:
        return {'error': str(e)}, 500

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
        return render_template('about_me-es.html')
    return render_template('about_me.html')

@app.route('/methodology')
def methodology():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('methodology-es.html')
    return render_template('methodology.html')

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

@app.route('/ls-nav')
def ls_nav():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_nav-es.html')
    return render_template('ls_nav.html')

@app.route('/download/lsc-latest')
def download_lsc_latest():
    # Permanent redirect to the latest APK version
    return redirect(url_for('static', filename='LSC-release-2.1.apk'))

@app.route('/foiling-academy')
def ls_foiling_academy():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_foiling_academy-es.html')
    return render_template('ls_foiling_academy.html')

@app.route('/foiling-academy/catalog')
def ls_foiling_academy_catalog():
    lang = request.args.get('lang', 'en')
    # If using separate templates for languages
    if lang == 'es':
        return render_template('ls_foiling_academy_catalog-es.html')
    return render_template('ls_foiling_academy_catalog.html')

@app.route('/foiling-academy/on-water')
def ls_foiling_academy_on_water():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_foiling_academy_on_water-es.html')
    return render_template('ls_foiling_academy_on_water.html')

@app.route('/foiling-academy/on-water/moth')
def ls_foiling_academy_moth_course():
    lang = request.args.get('lang', 'en')
    # For now, we only have the Spanish version of the premium landing
    if lang == 'es':
        return render_template('ls_foiling_academy_moth_course-es.html')
    return render_template('ls_foiling_academy_moth_course.html')

@app.route('/foiling-academy/on-water/moth/booking')
def ls_foiling_academy_moth_booking():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_foiling_academy_moth_booking-es.html')
    return render_template('ls_foiling_academy_moth_booking.html')

@app.route('/api/moth/calendar')
def api_moth_calendar():
    import json
    auth_header = request.headers.get('Authorization')
    is_pro = False
    if auth_header:
        user = verify_token(auth_header)
        if not isinstance(user, str): # if success
            from services.firebase_service import is_user_pro
            is_pro = is_user_pro(user['uid'])

    try:
        # 1. Load Fixed Events
        json_path = os.path.join(app.static_folder, 'moth_calendar.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            fixed_events = json.load(f)
        
        # 2. Get Dynamic Occupancy from Firestore
        from services.firebase_service import get_moth_bookings, get_user_names
        bookings = get_moth_bookings() 
        
        # 3. Convert bookings to occupancy events
        occupancy_events = []
        for date_str, data in bookings.items():
            uids_map = data.get('uids', {})
            confirmed_uids = [k for k, v in uids_map.items() if v == 'confirmed']
            standby_uids = [k for k, v in uids_map.items() if v == 'standby']
            
            names = {}
            if is_pro:
                all_uids = list(uids_map.keys())
                names = get_user_names(all_uids)

            occupancy_events.append({
                'title': f'{len(confirmed_uids)}/6',
                'start': date_str,
                'display': 'background',
                'backgroundColor': 'rgba(56, 189, 248, 0.2)' if len(confirmed_uids) < 6 else 'rgba(245, 158, 11, 0.2)',
                'confirmed_count': len(confirmed_uids),
                'standby_count': len(standby_uids),
                'attendees': [{'name': names.get(uid, 'Alumno'), 'status': uids_map[uid]} for uid in uids_map] if is_pro else [],
                'type': 'occupancy'
            })
            
            occupancy_events.append({
                'title': f'👥 {len(confirmed_uids)}/6' + (f' (+{len(standby_uids)})' if len(standby_uids) > 0 else ''),
                'start': date_str,
                'type': 'occupancy_label',
                'color': 'transparent',
                'textColor': '#fff'
            })
            
        return flask.jsonify(fixed_events + occupancy_events)
    except Exception as e:
        print(f"Calendar API Error: {e}")
        return {'error': str(e)}, 500

@app.route('/api/moth/book', methods=['POST'])
def api_moth_book():
    auth_header = request.headers.get('Authorization')
    if not auth_header: return {'error': 'Inicia sesión para reservar.'}, 401
    user = verify_token(auth_header)
    if not user: return {'error': 'Sesión inválida.'}, 401
    
    data = request.json
    date_str = data.get('date')
    if not date_str: return {'error': 'Fecha no proporcionada.'}, 400
    
    from services.firebase_service import book_moth_day
    result = book_moth_day(user['uid'], date_str)
    return flask.jsonify(result)

@app.route('/api/foiling-academy/interest', methods=['POST'])
def api_foiling_interest():
    try:
        data = request.json
        email = data.get('email')
        interest_type = data.get('interest_type', 'general') # One of: waszp_moth, pro_coaching, data_analysis, other
        
        if not email:
            return jsonify({'error': 'Email is required'}), 400
            
        from services.firebase_service import create_lead
        lead_id = create_lead(email, interest_type)
        
        if lead_id:
            return jsonify({'success': True, 'id': lead_id})
        else:
            return jsonify({'error': 'Database error'}), 500
            
    except Exception as e:
        print(f"Interest Capture Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/foiling-academy/course/<course_id>')
def ls_foiling_academy_course(course_id):
    lang = request.args.get('lang', 'en')
    # Draft course data (pseudo-database)
    # In a real app, this would come from Firebase or a JSON file
    courses = {
        'foil-beg': {
            'title': 'Foiling Basics', 
            'level': 'beginner', 
            'desc': 'First flights, stability, and safety. The foundation of flight.',
            'lessons': [
                {'title': 'Lesson 1: Understanding Hydrofoils', 'status': 'active'},
                {'title': 'Lesson 2: Boat Setup & Safety', 'status': 'active'},
                {'title': 'Lesson 3: First Flights', 'status': 'coming_soon'}
            ]
        },
        'foil-int': {
            'title': 'Equilibrium & Sustained Flight', 
            'level': 'intermediate', 
            'desc': 'Mastering ride height, maneuvers, and extended flight times.',
            'lessons': [
                {'title': 'Lesson 1: Ride Height Control', 'status': 'active'},
                {'title': 'Lesson 2: Foiling Tacks', 'status': 'coming_soon'},
                {'title': 'Lesson 3: Foiling Gybes', 'status': 'coming_soon'}
            ]
        },
        'foil-adv': {
            'title': 'Next Level Foiling', 
            'level': 'advanced', 
            'desc': 'Racing techniques, high speed handling, and aggressive maneuvers.',
            'lessons': [
                {'title': 'Lesson 1: High Speed Bear-aways', 'status': 'coming_soon'},
                {'title': 'Lesson 2: Starting Strategies', 'status': 'coming_soon'}
            ]
        },
        
        'sail-beg': {
            'title': 'Sailing Performance Basics', 
            'level': 'beginner', 
            'desc': 'Understanding VMG, polars, and the basics of boat speed.',
            'lessons': [
                {'title': 'Lesson 1: VMG Explained', 'status': 'active'},
                {'title': 'Lesson 2: Reading Polars', 'status': 'active'}
            ]
        },
        'sail-int': {
            'title': 'Strategy & Tactics', 
            'level': 'intermediate', 
            'desc': 'Race course management, wind shifts, and fleet tactics.',
            'lessons': [
                {'title': 'Lesson 1: Starting Line Geometry', 'status': 'active'},
                {'title': 'Lesson 2: Wind Shifts & Ladders', 'status': 'coming_soon'}
            ]
        },
        'sail-adv': {
            'title': 'Data Analysis & Optimization', 
            'level': 'advanced', 
            'desc': 'Using sensors and data to refine performance and win races.',
            'lessons': [
                {'title': 'Lesson 1: Sensor Calibration', 'status': 'active'},
                {'title': 'Lesson 2: Log Analysis', 'status': 'coming_soon'}
            ]
        },
        
        'maint-beg': {
            'title': 'Splicing & Repairs', 
            'level': 'beginner', 
            'desc': 'Essential ropework, knots, and basic fiberglass repairs.',
            'lessons': [
                {'title': 'Lesson 1: Eye Splice (Dyneema)', 'status': 'active'},
                {'title': 'Lesson 2: Basic Gelcoat Repair', 'status': 'active'}
            ]
        },
        'maint-int': {
            'title': 'Rig Tuning', 
            'level': 'intermediate', 
            'desc': 'Setting up your mast and shrouds for optimal power and control.',
            'lessons': [
                {'title': 'Lesson 1: Mast Rake & Tension', 'status': 'active'},
                {'title': 'Lesson 2: Sail Depth Control', 'status': 'coming_soon'}
            ]
        },
        'maint-adv': {
            'title': 'Sail Tuning & Composites', 
            'level': 'advanced', 
            'desc': 'Advanced sail shape analysis and carbon fiber composite work.',
            'lessons': [
                {'title': 'Lesson 1: Carbon Repair Techniques', 'status': 'coming_soon'},
                {'title': 'Lesson 2: Flying Shape Analysis', 'status': 'coming_soon'}
            ]
        },
    }
    
    course = courses.get(course_id, {'title': 'Unknown Course', 'level': 'beginner', 'desc': ''})
    
    if lang == 'es':
        return render_template('ls_foiling_academy_course-es.html', course=course, course_id=course_id)
    return render_template('ls_foiling_academy_course.html', course=course, course_id=course_id)


@app.route('/data-lab')
def ls_data_lab():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_data_lab-es.html')
    return render_template('ls_data_lab.html')



@app.route('/data-lab/upload', methods=['POST'])
def data_lab_upload():
    try:
        if 'log_file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
            
        file = request.files['log_file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        from services.datalab_service import parse_log_file
        # Process in memory for MVP
        # In production, save to /tmp or cloud bucket first
        result = parse_log_file(file, file.filename)
        
        if 'error' in result:
             return jsonify(result), 400
             
        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/design-tools')
def ls_design_tools():
    lang = request.args.get('lang', 'en')
    if lang == 'es':
        return render_template('ls_design_tools-es.html')
    return render_template('ls_design_tools.html')

# /analyzer-old was removed as it is now integrated into the main /analyzer route.





if __name__ == '__main__':
    # Local development
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=True, host='0.0.0.0', port=port)
