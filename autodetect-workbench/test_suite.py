"""
Automated Test Suite for SailCam Vision Lab Autodetect Workbench
Tests server endpoints, engine pipeline, bowl constraint validation, and multiple sail types.
"""

import os
import json
import base64
import unittest
from workbench_server import app


class TestAutodetectWorkbench(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()

    def test_01_index_page(self):
        """Verify workbench index page renders successfully."""
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'SailCam Vision Lab', res.data)
        self.assertIn(b'Autodetect Workbench', res.data)
        print("  [PASS] Test 01: Index page renders 200 OK")

    def test_02_get_images_api(self):
        """Verify available images list endpoint."""
        res = self.client.get('/api/images')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get('success'))
        self.assertGreater(len(data.get('images', [])), 0)
        print(f"  [PASS] Test 02: /api/images returned {len(data['images'])} test images")

    def test_03_detect_user_carbon_sail(self):
        test_path = os.path.abspath('autodetect-workbench/uploads/Port1.jpg')
        if not os.path.exists(test_path):
            test_path = os.path.abspath('static/images/sample-black-red.jpg')
        if not os.path.exists(test_path):
            self.skipTest("Carbon test image not found")

        payload = {
            'image_path': test_path,
            'sail_color': 'auto',
            'stripe_color': 'auto',
            'num_stripes': 3,
            'sensitivity': 1.0,
            'enforce_bowl': True
        }
        res = self.client.post('/api/detect', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(len(data['stripes']), 3)
        self.assertTrue(data['detected_sail']['is_dark'])

        # Verify all 3 stripes pass the bowl constraint
        for s in data['stripes']:
            self.assertIn('p0', s)
            self.assertIn('p1', s)
            self.assertIn('p2', s)
            self.assertIn('p3', s)
            self.assertTrue(s['metrics']['bowl_valid'], f"Stripe {s['label']} failed bowl constraint!")
            self.assertEqual(s['metrics']['bowl_orientation'], 'Open Towards Sky (Valid)')
            print(f"      - {s['label']}: Camber {s['metrics']['camber']}%, Draft {s['metrics']['draft_pos']}%, Bowl: {s['metrics']['bowl_orientation']}")

        # Verify debug stage images are present
        self.assertIn('sail_mask', data['debug_stages'])
        self.assertIn('boundary_vis', data['debug_stages'])
        self.assertIn('saliency_map', data['debug_stages'])
        self.assertIn('inliers_vis', data['debug_stages'])
        print("  [PASS] Test 03: Carbon sail autodetect & bowl constraints passed")

    def test_04_detect_camber_test1(self):
        """Verify autodetect on camber-images/test1.jpg."""
        test_path = os.path.abspath('camber-images/test1.jpg')
        if not os.path.exists(test_path):
            self.skipTest("test1.jpg not found")

        payload = {
            'image_path': test_path,
            'num_stripes': 3,
            'enforce_bowl': True
        }
        res = self.client.post('/api/detect', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get('success'))
        self.assertEqual(len(data['stripes']), 3)
        for s in data['stripes']:
            self.assertTrue(s['metrics']['bowl_valid'])
        print(f"  [PASS] Test 04: test1.jpg ({len(data['stripes'])} stripes, latency: {data['elapsed_ms']}ms) passed")


if __name__ == '__main__':
    print("================================================================")
    print(" Running SailCam Vision Lab Autodetect Workbench Test Suite")
    print("================================================================")
    unittest.main()
