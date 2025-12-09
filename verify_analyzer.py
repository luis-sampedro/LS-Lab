import requests
import os

url = 'http://localhost:8080/analyzer'
file_path = r'c:\Users\LUIS\Desktop\LS-Personal-Lab\LS-Lab\camber-images\test2.jpg'

if not os.path.exists(file_path):
    print(f"File not found: {file_path}")
    exit(1)

files = {'sail_image': open(file_path, 'rb')}

try:
    print(f"Sending request to {url} with {file_path}...")
    response = requests.post(url, files=files)
    
    if response.status_code == 200:
        if "Analysis Results" in response.text:
            print("SUCCESS: Analysis Results found in response.")
            # We could extract the metrics if we parsed the HTML, but this is enough to prove it works.
            if "Max Draft" in response.text:
                 print("SUCCESS: Metrics found.")
        else:
            print("FAILURE: 'Analysis Results' text not found in response.")
            print("Response snippet:", response.text[:500])
    else:
        print(f"FAILURE: Status Code {response.status_code}")

except Exception as e:
    print(f"ERROR: {e}")
