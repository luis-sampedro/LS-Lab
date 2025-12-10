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

def verify_token(id_token):
    """Verifies ID token from client."""
    try:
        # Verify the ID token. 
        # clock_skew_seconds=10 allows for slight time diffs.
        decoded_token = auth.verify_id_token(id_token, check_revoked=False, clock_skew_seconds=10)
        return decoded_token
    except Exception as e:
        print(f"!!! TOKEN VERIFICATION FAILED !!!")
        print(f"Error details: {e}")
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

def create_sail(uid, boat_id, code, description):
    """Creates a new sail."""
    if not db: return None
    try:
        sails_ref = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails')
        _, doc_ref = sails_ref.add({
            'code': code,
            'description': description,
            'created_at': firestore.SERVER_TIMESTAMP
        })
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

def update_sail(uid, boat_id, sail_id, code, description):
    if not db: return False
    try:
        db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).update({
            'code': code,
            'description': description
        })
        return True
    except Exception as e:
        print(f"Error updating sail: {e}")
        return False


def create_analysis(uid, boat_id, sail_id, date_str, metrics, path, snapshot=None):
    if not db: return None
    try:
        analyses_ref = db.collection('users').document(uid).collection('boats').document(boat_id).collection('sails').document(sail_id).collection('analyses')
        _, doc_ref = analyses_ref.add({
            'date': date_str,
            'metrics': metrics,
            'path': path, # List of points
            'snapshot': snapshot, # Base64 Image
            'created_at': firestore.SERVER_TIMESTAMP
        })
        return doc_ref.id
    except Exception as e:
        print(f"Error creating analysis: {e}")
        raise e

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
