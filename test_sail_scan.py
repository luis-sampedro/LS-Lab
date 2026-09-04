import app as flask_app
import base64
import json

def test_endpoints():
    client = flask_app.app.test_client()
    
    # 1. Test /sail-scan GET (English and Spanish)
    print("Testing GET /sail-scan ...")
    r1 = client.get('/sail-scan')
    assert r1.status_code == 200, f"Expected 200, got {r1.status_code}"
    assert b"L3S Sail Scan" in r1.data
    print("  -> GET /sail-scan (EN) OK")

    r1_es = client.get('/sail-scan?lang=es')
    assert r1_es.status_code == 200, f"Expected 200, got {r1_es.status_code}"
    assert b"L3S Sail Scan" in r1_es.data
    print("  -> GET /sail-scan (ES) OK")
    
    # 2. Test /api/sail-scan/autodetect with Auto tone detection on Black Carbon
    print("Testing POST /api/sail-scan/autodetect (Auto-Detect Mode) ...")
    with open('static/images/sample-black-red.jpg', 'rb') as f:
        img_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode('utf-8')
        
    payload = {
        'image': img_b64,
        'sail_color': 'auto',
        'stripe_color': 'auto',
        'num_stripes': 3,
        'sensitivity': 1.0
    }
    r2 = client.post('/api/sail-scan/autodetect', data=json.dumps(payload), content_type='application/json')
    assert r2.status_code == 200, f"Expected 200, got {r2.status_code}: {r2.data}"
    data2 = json.loads(r2.data)
    assert data2.get('success') is True, "Autodetect returned success=False"
    assert 'detected_sail' in data2, "Missing detected_sail in response"
    assert 'detected_stripe' in data2, "Missing detected_stripe in response"
    
    # Assert 4-point B-Spline control points and metadata
    for s in data2['stripes']:
        assert 'p0' in s and 'p1' in s and 'p2' in s and 'p3' in s, "Stripe missing 4-point B-spline controls (p0, p1, p2, p3)"
        assert 'label' in s and 'name' in s and 'type' in s, "Stripe missing label/name/type"
    print(f"  -> Auto-Detect OK! 4-Point B-Splines verified. Sail: {data2['detected_sail']['name']} ({data2['detected_sail']['hex']}), Stripe: {data2['detected_stripe']['name']} ({data2['detected_stripe']['hex']})")
    
    # 2b. Test /api/sail-scan/autodetect with Port1.jpg benchmark
    import os
    port1_path = 'autodetect-workbench/uploads/Port1.jpg'
    if os.path.exists(port1_path):
        print("Testing POST /api/sail-scan/autodetect (Port1.jpg Real Sail Benchmark) ...")
        with open(port1_path, 'rb') as f:
            port1_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode('utf-8')
        r_port1 = client.post('/api/sail-scan/autodetect', data=json.dumps({'image': port1_b64}), content_type='application/json')
        assert r_port1.status_code == 200
        d_port1 = json.loads(r_port1.data)
        assert d_port1.get('success') is True, "Port1 autodetection failed"
        assert len(d_port1['stripes']) == 3, f"Expected 3 stripes on Port1, got {len(d_port1['stripes'])}"
        for s in d_port1['stripes']:
            assert s['metrics']['bowl_valid'] is True, f"Stripe {s['label']} bowl not valid"
            assert 7.0 <= s['metrics']['camber'] <= 15.0, f"Stripe {s['label']} camber out of range"
        print(f"  -> Port1.jpg Benchmark OK! 3 bowl curves verified: {[s['label'] + ': ' + str(s['metrics']['camber']) + '%' for s in d_port1['stripes']]}")
    
    # 3. Test /api/sail-scan/autodetect with Custom Sampled Color (#c83232)
    print("Testing POST /api/sail-scan/autodetect (Custom Sampled Color #c83232) ...")
    payload_custom = {
        'image': img_b64,
        'sail_color': 'black',
        'stripe_color': '#c83232',
        'num_stripes': 3,
        'sensitivity': 1.0
    }
    r_cust = client.post('/api/sail-scan/autodetect', data=json.dumps(payload_custom), content_type='application/json')
    assert r_cust.status_code == 200
    data_cust = json.loads(r_cust.data)
    assert data_cust.get('success') is True
    print(f"  -> Custom Sampled Color OK! Detected {len(data_cust['stripes'])} stripes with custom hex.")
    
    # 4. Test /api/sail-scan/snap-stripe with Custom Color
    print("Testing POST /api/sail-scan/snap-stripe (Custom Hex) ...")
    snap_payload = {
        'image': img_b64,
        'click_point': {'x': 400, 'y': 160},
        'sail_color': 'black',
        'stripe_color': '#ef4444',
        'sensitivity': 1.0
    }
    r3 = client.post('/api/sail-scan/snap-stripe', data=json.dumps(snap_payload), content_type='application/json')
    assert r3.status_code == 200, f"Expected 200, got {r3.status_code}: {r3.data}"
    data3 = json.loads(r3.data)
    assert data3.get('success') is True, "Snap stripe failed"
    assert 'p0' in data3 and 'p1' in data3 and 'p2' in data3 and 'p3' in data3, "Snap stripe missing 4-point B-spline"
    print(f"  -> Snap Stripe OK! 4-Point B-Spline verified. Camber: {data3['metrics']['camber']}%")
    
    # 5. Test /api/sail-scan/save-analysis
    print("Testing POST /api/sail-scan/save-analysis ...")
    flask_app.verify_token = lambda token: {'uid': 'test_user_123', 'email': 'test@lslab.com'}
    import services.firebase_service as fs
    fs.verify_token = lambda token: {'uid': 'test_user_123', 'email': 'test@lslab.com'}
    fs.update_sail = lambda uid, b_id, s_id, extra_data: None
    fs.create_analysis = lambda uid, b_id, s_id, full_payload: 'analysis_123'
    fs.save_sailscan_project = lambda uid, data: 'proj_123'

    save_payload = {
        'boat_id': 'test_boat_1',
        'sail_id': 'test_sail_1',
        'analysis_data': {
            'scan_type': 'foot',
            'stripes': data2['stripes'],
            'annotations': [{'type': 'ruler', 'p1': {'x': 100, 'y': 100}, 'p2': {'x': 500, 'y': 100}}],
            'metrics': data2['stripes'][0]['metrics']
        },
        'sail_specs': {'sail_number': 'ESP-831', 'sail_name': 'J1 Medium'}
    }
    r4 = client.post(
        '/api/sail-scan/save-analysis',
        data=json.dumps(save_payload),
        content_type='application/json',
        headers={'Authorization': 'Bearer mock_token_123'}
    )
    assert r4.status_code == 200, f"Expected 200, got {r4.status_code}: {r4.data}"
    data4 = json.loads(r4.data)
    assert data4.get('success') is True, "Save analysis failed"
    print("  -> Save Analysis OK!")

    # 6. Test /api/sail-scan/save-project
    print("Testing POST /api/sail-scan/save-project ...")
    proj_payload = {
        'name': 'GrandPrix_J1_Scan',
        'scanData': {'sailName': 'J1 Medium', 'stripes': []}
    }
    r5 = client.post(
        '/api/sail-scan/save-project',
        data=json.dumps(proj_payload),
        content_type='application/json',
        headers={'Authorization': 'Bearer mock_token_123'}
    )
    assert r5.status_code == 200, f"Expected 200, got {r5.status_code}: {r5.data}"
    data5 = json.loads(r5.data)
    assert data5.get('success') is True, "Save project failed"
    print("  -> Save Project OK!")
    
    print("\nALL CV COLOR AUTODETECT, CAD STUDIO & PERSISTENCE TESTS PASSED!")

if __name__ == '__main__':
    test_endpoints()
