
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
        elif filename.lower().endswith('.gpx'):
            return parse_gpx_file(file_stream, filename)
        
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
                if key not in col_indices: # Prevent overwriting first finding
                    col_indices[key] = idx
            else:
                # Try simple fuzzy or check keys
                for k, v in col_map.items():
                    if k in clean_col and v not in col_indices:
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
                if 'hdt' in col_indices: metrics['hdt'].append(get_val('hdt'))
                
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

def parse_gpx_file(file_stream, filename):
    import xml.etree.ElementTree as ET
    import math
    from datetime import datetime
    
    try:
        stream_content = file_stream.read().decode('utf-8')
        root = ET.fromstring(stream_content)
        
        # Handle namespaces (GPX often uses default ns)
        ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
        # Try finding trkpts with namespace first, then without if not found
        points = root.findall('.//gpx:trkpt', ns)
        if not points:
            points = root.findall('.//trkpt')
            ns = '' # Proceed without namespace
            
        if not points:
            return {"error": "No track points found in GPX file."}
            
        track = []
        times = []
        
        # Helper for extracting text safely
        def get_text(element, tag):
            el = element.find(f'gpx:{tag}' if ns else tag, ns) if ns else element.find(tag)
            return el.text if el is not None else None
            
        for pt in points:
            lat = float(pt.get('lat', 0))
            lon = float(pt.get('lon', 0))
            time_str = get_text(pt, 'time')
            
            if lat != 0 and lon != 0 and time_str:
                track.append([lat, lon])
                # GPX time is already ISO, but maybe with Z formatting
                times.append(time_str.replace('T', ' ').replace('Z', ''))
                
        metrics = {'sog': [], 'cog': []}
        
        # Derive SOG and COG if missing (basic haversine derivation)
        for i in range(len(track)):
            if i == 0:
                metrics['sog'].append(0.0)
                metrics['cog'].append(0.0)
                continue
                
            p1 = track[i-1]
            p2 = track[i]
            
            def parse_time(ts):
                # Simple fallback
                try:
                    return datetime.fromisoformat(ts).timestamp()
                except:
                    # Sometimes fromisoformat struggles without Z
                    t = ts.replace(' ', 'T')
                    return datetime.fromisoformat(t).timestamp() if 'T' in t else 0
                    
            t1 = parse_time(times[i-1])
            t2 = parse_time(times[i])
            
            dt = max(t2 - t1, 1.0) # Avoid div by zero, min 1s
            
            # Simple distance in nautical miles
            R = 3440.065 # Earth radius in NM
            lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
            lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
            
            dlon = lon2 - lon1
            dlat = lat2 - lat1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            dist_nm = R * c
            
            metrics['sog'].append((dist_nm / dt) * 3600.0)
            
            # Bearing
            y = math.sin(dlon) * math.cos(lat2)
            x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
            brng = math.degrees(math.atan2(y, x))
            metrics['cog'].append((brng + 360) % 360)
            
        return {
            "success": True,
            "filename": filename,
            "track": track,
            "time": times,
            "metrics": metrics
        }
        
    except Exception as e:
        print(f"GPX Parse Error: {e}")
        return {"error": str(e)}
