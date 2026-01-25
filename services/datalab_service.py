
import csv
import json
import io
from datetime import datetime

def parse_log_file(file_stream, filename):
    """
    Parses a log file (CSV) and returns a JSON-serializable dict.
    Standardized Output:
    {
        "track": [[lat, lon], ...],
        "time": [iso_string, ...],
        "metrics": {
            "sog": [val, ...],
            "cog": [val, ...],
            "tws": [val, ...],
             ...
        }
    }
    """
    try:
        # Detect file type by extension
        if filename.lower().endswith('.json'):
            return json.load(file_stream)
        
        # Assume CSV
        # Decode stream to string
        stream_content = file_stream.read().decode('utf-8')
        f = io.StringIO(stream_content)
        reader = csv.reader(f)
        
        # Read Header
        try:
            header = next(reader)
        except StopIteration:
            return {"error": "Empty CSV file"}

        # Normalize Headers
        header_map = {}
        # Mapping common names including Sailmon specific
        col_map = {
            'latitude': 'lat', 'lat': 'lat',
            'longitude': 'lon', 'long': 'lon', 'lon': 'lon',
            'speed': 'sog', 'sog': 'sog', 'speed over ground': 'sog', 'sog - speed over ground': 'sog',
            'heading': 'cog', 'cog': 'cog', 'course over ground': 'cog', 'cog - course over ground': 'cog',
            'time': 'time', 'timestamp': 'time', 'utc': 'time',
            'twa - true wind angle': 'twa',
            'twd - true wind direction': 'twd',
            'hdt - heading true': 'hdt',
            'heel': 'heel',
            'tws - true wind speed': 'tws',
            'tws': 'tws'
        }

        # Index map: col_name -> index
        col_indices = {}
        for idx, col in enumerate(header):
            clean_col = col.lower().strip()
            # Direct match or mapped match
            if clean_col in col_map:
                key = col_map[clean_col]
                col_indices[key] = idx
            else:
                # Try simple fuzzy or check keys
                for k, v in col_map.items():
                    if k in clean_col:
                        col_indices[v] = idx
                        break
        
        if 'lat' not in col_indices or 'lon' not in col_indices:
             return {"error": "Missing 'lat' or 'lon' columns in CSV."}

        track = []
        metrics = {k: [] for k in ['sog', 'cog', 'twa', 'twd', 'heel', 'tws']}
        times = []

        # Read Data
        for row in reader:
            if not row: continue
            
            # Safe float conversion helper
            def get_val(key):
                if key in col_indices and col_indices[key] < len(row):
                    val = row[col_indices[key]]
                    try:
                        return float(val)
                    except ValueError:
                        return 0.0
                return 0.0

            # Safe string helper
            def get_str(key):
                if key in col_indices and col_indices[key] < len(row):
                    return row[col_indices[key]]
                return ""

            try:
                lat = get_val('lat')
                lon = get_val('lon')
                
                # Filter bad points (0,0)
                if abs(lat) < 0.1 and abs(lon) < 0.1: continue
                
                track.append([lat, lon])
                
                metrics['sog'].append(get_val('sog'))
                metrics['cog'].append(get_val('cog'))
                
                # Optional metrics
                if 'twa' in col_indices: metrics['twa'].append(get_val('twa'))
                if 'heel' in col_indices: metrics['heel'].append(get_val('heel'))
                if 'tws' in col_indices: metrics['tws'].append(get_val('tws'))
                
                times.append(get_str('time'))
                
            except Exception:
                continue # Skip bad rows

        # Clean empty metric lists
        metrics = {k: v for k,v in metrics.items() if len(v) > 0}

        return {
            "success": True,
            "filename": filename,
            "track": track,
            "time": times,
            "metrics": metrics
        }

    except Exception as e:
        print(f"DataLab Parse Error: {e}")
        return {"error": str(e)}
