import firebase_admin
from firebase_admin import credentials, firestore, auth
import os

# Initialize Firebase (Skeleton)
# In production, we will look for 'serviceAccountKey.json' or ENV variables.

db = None

def initialize_firebase():
    global db
    if not firebase_admin._apps:
        # 1. Try Environment Variable (JSON String) - Best for Cloud Run / Render
        firebase_creds_json = os.environ.get('FIREBASE_CREDENTIALS')
        if firebase_creds_json:
            import json
            try:
                cred_dict = json.loads(firebase_creds_json)
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred)
                db = firestore.client()
                print("Firebase Initialized via FIREBASE_CREDENTIALS env var.")
                return True
            except Exception as e:
                print(f"Error loading FIREBASE_CREDENTIALS: {e}")
        
        # 2. Try Local File
        key_path = os.path.join(os.getcwd(), 'serviceAccountKey.json')
        if os.path.exists(key_path):
            cred = credentials.Certificate(key_path)
            firebase_admin.initialize_app(cred)
            db = firestore.client()
            print("Firebase Initialized with serviceAccountKey.json.")
        else:
            # 3. Try Default Credentials (e.g. Google Cloud Run generic identity)
            try:
                # Explicitly set Project ID so Auth verification knows what audience to expect
                firebase_admin.initialize_app(options={'projectId': 'ls-personal-lab'})
                db = firestore.client()
                print("Firebase Initialized with Application Default Credentials for ls-personal-lab.")
            except Exception as e:
                 print(f"WARNING: Init failed: {e}")
                 print("WARNING: No credentials found. Database features will fail.")
                 return False
    return True

def create_user(email, password):
    """Creates a user in Firebase Auth and a document in Firestore."""
    try:
        user = auth.create_user(email=email, password=password)
        # Create user doc
        if db:
            db.collection('users').document(user.uid).set({
                'email': email,
                'created_at': firestore.SERVER_TIMESTAMP
            })
        return user
    except Exception as e:
        print(f"Error creating user: {e}")
        raise e

def get_user_profile(uid):
    """Fetches user profile data from Firestore."""
    if not db: return None
    try:
        doc = db.collection('users').document(uid).get()
        if doc.exists:
            return doc.to_dict()
        return None
    except Exception as e:
        print(f"Error getting user profile: {e}")
        return None

def update_user_profile(uid, data):
    """Updates user profile data in Firestore."""
    if not db: return False
    try:
        # Merge data
        db.collection('users').document(uid).set(data, merge=True)
        return True
    except Exception as e:
        print(f"Error updating user profile: {e}")
        return False

def is_user_pro(uid):
    """Checks if a user has PRO status."""
    profile = get_user_profile(uid)
    return profile.get('is_pro', False) if profile else False


def sanitize_for_firestore(data):
    """
    Recursively sanitizes data to be compliant with Firestore requirements:
    - Firestore disallows nested arrays / list of lists (e.g. [[x, y], [x, y]]).
    - Converts lists of lists/tuples to lists of dicts: [{'x': p[0], 'y': p[1]}].
    - Converts numpy types (float32, int64, ndarray) to native python types.
    """
    if data is None:
        return None
    try:
        import numpy as np
        if isinstance(data, (np.integer, np.int32, np.int64)):
            return int(data)
        if isinstance(data, (np.floating, np.float32, np.float64)):
            return float(data)
        if isinstance(data, np.ndarray):
            return sanitize_for_firestore(data.tolist())
    except ImportError:
        pass

    if isinstance(data, list):
        if len(data) > 0 and isinstance(data[0], (list, tuple)):
            return [
                {"x": float(p[0]), "y": float(p[1])} if len(p) >= 2 
                else {"x": float(p[0])} if len(p) == 1 
                else {} 
                for p in data
            ]
        return [sanitize_for_firestore(item) for item in data]
    if isinstance(data, dict):
        return {str(k): sanitize_for_firestore(v) for k, v in data.items()}
    return data

def verify_token(id_token):
    """Verifies ID token from client."""
    if not id_token or not isinstance(id_token, str):
        return None
    try:
        token = id_token.strip()
        if token.lower().startswith('bearer '):
            token = token[7:].strip()
        # Verify the ID token. 
        # clock_skew_seconds=10 allows for slight time diffs.
        decoded_token = auth.verify_id_token(token, check_revoked=True)
        return decoded_token
    except Exception as e:
        print(f"!!! TOKEN VERIFICATION FAILED: {e} !!!")
        return None


def get_user_boats(uid):
    """Fetches boats for a specific user."""
    if not db: return []
    try:
        # Boats are stored in users/{uid}/boats/{boat_id}
        boats_ref = db.collection('users').document(uid).collection('boats')
        docs = boats_ref.stream()
        return [{'id': d.id, **d.to_dict()} for d in docs]
    except Exception as e:
        print(f"Error getting boats: {e}")
        return []

def get_boat(uid, boat_id):
    """Fetches a single boat."""
    if not db: return None
    try:
        doc = db.collection('users').document(uid).collection('boats').document(boat_id).get()
        if doc.exists:
            return {'id': doc.id, **doc.to_dict()}
        return None
    except Exception as e:
        print(f"Error getting boat: {e}")
        return None

def create_boat(uid, name, boat_type):
    """Creates a new boat for the user."""
    if not db: return None
    try:
        boats_ref = db.collection('users').document(uid).collection('boats')
        _, doc_ref = boats_ref.add({
            'name': name,
            'type': boat_type,
            'created_at': firestore.SERVER_TIMESTAMP
        })
        print(f"Boat created with ID: {doc_ref.id}")
        return doc_ref.id
    except Exception as e:
        print(f"!!! ERROR CREATING BOAT !!!: {e}")
        import traceback
        traceback.print_exc()
        return None

def get_boat_sails(uid, boat_id):
    """Fetches sails for a specific boat."""
    if not db: return []
    try:
        # Sails are: users/{uid}/boats/{boat_id}/sails/{sail_id}
        sails_ref = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails')
        docs = sails_ref.stream()
        return [{'id': d.id, **d.to_dict()} for d in docs]
    except Exception as e:
        print(f"Error getting sails: {e}")
        return []

def create_sail(uid, boat_id, code, description, extra_data=None):
    """Creates a new sail with optional dimensions, label_photo, and specs."""
    if not db: return None
    try:
        sails_ref = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails')
        doc_payload = {
            'code': code,
            'description': description,
            'created_at': firestore.SERVER_TIMESTAMP
        }
        if isinstance(extra_data, dict):
            doc_payload.update(extra_data)
        _, doc_ref = sails_ref.add(doc_payload)
        return doc_ref.id
    except Exception as e:
        print(f"Error creating sail: {e}")
        return None

def delete_boat(uid, boat_id):
    if not db: return False
    try:
        # Note: Subcollections are NOT deleted automatically in Firestore!
        # For a full delete, we should delete sails too. 
        # For Phase 3 MVP, we just delete the document reference.
        # Ideally, use a Cloud Function for recursive delete.
        db.collection('users').document(uid).collection('boats').document(boat_id).delete()
        return True
    except Exception as e:
        print(f"Error deleting boat: {e}")
        return False

def delete_sail(uid, boat_id, sail_id):
    if not db: return False
    try:
        # Same note about subcollections (analyses)
        db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).delete()
        return True
    except Exception as e:
        print(f"Error deleting sail: {e}")
        return False


def update_boat(uid, boat_id, name, boat_type):
    if not db: return False
    try:
        db.collection('users').document(uid).collection('boats').document(boat_id).update({
            'name': name,
            'type': boat_type
        })
        return True
    except Exception as e:
        print(f"Error updating boat: {e}")
        return False

def get_sail(uid, boat_id, sail_id):
    if not db: return None
    try:
        doc = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).get()
        if doc.exists:
            return {'id': doc.id, **doc.to_dict()}
        return None
    except Exception as e:
        print(f"Error getting sail: {e}")
        return None

def update_sail(uid, boat_id, sail_id, code=None, description=None, extra_data=None):
    if not db: return False
    try:
        update_dict = {}
        if isinstance(code, dict) and description is None and extra_data is None:
            update_dict = code
        else:
            if code is not None: update_dict['code'] = code
            if description is not None: update_dict['description'] = description
            if isinstance(extra_data, dict):
                update_dict.update(extra_data)
        
        if update_dict:
            sanitized_dict = sanitize_for_firestore(update_dict)
            db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).set(sanitized_dict, merge=True)
        return True
    except Exception as e:
        print(f"Error updating sail: {e}")
        return False


def create_analysis(uid, boat_id, sail_id, date_str=None, metrics=None, path=None, snapshot=None, full_payload=None):
    if not db: return None
    try:
        analyses_ref = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).collection('analyses')
        
        doc_data = {}
        if isinstance(full_payload, dict):
            doc_data = full_payload
        else:
            doc_data = {
                'date': date_str,
                'metrics': metrics or {},
                'path': path or [],
                'snapshot': snapshot
            }
            
        doc_data['created_at'] = firestore.SERVER_TIMESTAMP
        doc_data = sanitize_for_firestore(doc_data)
        _, doc_ref = analyses_ref.add(doc_data)
        return doc_ref.id
    except Exception as e:
        print(f"Error creating analysis: {e}")
        raise e

def save_sailscan_project(uid, project_data):
    """Saves complete LS-PRO Sail Scan project workspace."""
    if not db: return None
    try:
        project_id = project_data.get('id')
        projects_ref = db.collection('users').document(uid).collection('sailscan_projects')
        
        project_data['updated_at'] = firestore.SERVER_TIMESTAMP
        project_data = sanitize_for_firestore(project_data)
        
        if project_id:
            projects_ref.document(project_id).set(project_data, merge=True)
            return project_id
        else:
            project_data['created_at'] = firestore.SERVER_TIMESTAMP
            _, doc_ref = projects_ref.add(project_data)
            return doc_ref.id
    except Exception as e:
        print(f"Error saving sail scan project: {e}")
        raise e

def get_sailscan_project(uid, project_id):
    """Fetches a saved LS-PRO Sail Scan project."""
    if not db: return None
    try:
        doc = db.collection('users').document(uid).collection('sailscan_projects').document(project_id).get()
        if doc.exists:
            return {'id': doc.id, **doc.to_dict()}
        return None
    except Exception as e:
        print(f"Error getting sail scan project: {e}")
        return None

def get_user_sailscan_projects(uid):
    """Lists saved LS-PRO Sail Scan projects for a user."""
    if not db: return []
    try:
        docs = db.collection('users').document(uid).collection('sailscan_projects').order_by('created_at', direction=firestore.Query.DESCENDING).stream()
        return [{'id': d.id, **d.to_dict()} for d in docs]
    except Exception as e:
        print(f"Error listing sail scan projects: {e}")
        return []


def get_sail_analyses(uid, boat_id, sail_id):
    if not db: return []
    try:
        analyses_ref = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).collection('analyses').order_by('created_at', direction=firestore.Query.DESCENDING)
        docs = analyses_ref.stream()
        return [{'id': d.id, **d.to_dict()} for d in docs]
    except Exception as e:
        print(f"Error getting analyses: {e}")
        return []

def get_analysis(uid, boat_id, sail_id, analysis_id):
    if not db: return None
    try:
        doc = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).collection('analyses').document(analysis_id).get()
        if doc.exists:
            return {'id': doc.id, **doc.to_dict()}
        return None
    except Exception as e:
        print(f"Error getting analysis: {e}")
        return None

def delete_analysis(uid, boat_id, sail_id, analysis_id):
    if not db: return False
    try:
        db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).collection('analyses').document(analysis_id).delete()
        return True
    except Exception as e:
        print(f"Error deleting analysis: {e}")
        return False

def create_lead(email, interest_type):
    """Creates a new lead in the leads collection."""
    if not db: return None
    try:
        # Leads collection: leads/{lead_id}
        _, doc_ref = db.collection('leads').add({
            'email': email,
            'interest_type': interest_type,
            'created_at': firestore.SERVER_TIMESTAMP
        })
        return doc_ref.id
    except Exception as e:
        print(f"Error creating lead: {e}")
        return None

def add_datalab_report(uid, boat_id, report_data):
    """Saves a Data Lab analysis report to a boat's subcollection."""
    if not db: return None
    try:
        reports_ref = db.collection('users').document(uid).collection('boats').document(boat_id).collection('datalab_reports')
        
        # Add server timestamp
        report_data['created_at'] = firestore.SERVER_TIMESTAMP
        report_data = sanitize_for_firestore(report_data)
        
        _, doc_ref = reports_ref.add(report_data)
        return doc_ref.id
    except Exception as e:
        print(f"Error creating datalab report: {e}")
        raise e


def get_moth_bookings(date_str=None):
    """Fetches all bookings for a date or all dates if date_str is None."""
    if not db: return {}
    try:
        if date_str:
            doc = db.collection('moth_bookings').document(date_str).get()
            return doc.to_dict() if doc.exists else {}
        else:
            docs = db.collection('moth_bookings').stream()
            return {d.id: d.to_dict() for d in docs}
    except Exception as e:
        print(f"Error getting moth bookings: {e}")
        return {}

def book_moth_day(uid, date_str):
    """Registers a user for a specific day. Returns status or error."""
    if not db: return {'error': 'Database not initialized'}
    try:
        # 1. Check user total bookings (Limit 10)
        user_bookings = db.collection('moth_bookings').where(f'uids.{uid}', 'in', ['confirmed', 'standby']).get()
        if len(user_bookings) >= 10:
            return {'error': 'Has alcanzado el límite de 10 días.'}

        # 2. Check daily limit
        doc_ref = db.collection('moth_bookings').document(date_str)
        doc = doc_ref.get()
        data = doc.to_dict() if doc.exists else {'uids': {}}
        
        uids = data.get('uids', {})
        if uid in uids:
            return {'error': 'Ya estás registrado para este día.'}

        confirmed = [k for k, v in uids.items() if v == 'confirmed']
        standby = [k for k, v in uids.items() if v == 'standby']

        status = 'confirmed'
        if len(confirmed) >= 6:
            if len(standby) >= 1:
                return {'error': 'Este día está completo (6 plazas + 1 reserva).'}
            status = 'standby'

        # 3. Save
        uids[uid] = status
        doc_ref.set({'uids': uids}, merge=True)
        return {'success': True, 'status': status}
    except Exception as e:
        print(f"Error booking moth day: {e}")
        return {'error': str(e)}

def get_user_names(uids_list):
    """Fetches names for a list of UIDs."""
    if not db or not uids_list: return {}
    try:
        # Firestore 'in' query limit is 30. We only need up to 7 (6+1).
        users_ref = db.collection('users').where(firestore.FieldPath.document_id(), 'in', uids_list)
        docs = users_ref.stream()
        return {d.id: d.to_dict().get('display_name', d.to_dict().get('email', 'Usuario')) for d in docs}
    except Exception as e:
        print(f"Error getting user names: {e}")
        return {}
