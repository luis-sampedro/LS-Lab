
import pandas as pd
import numpy as np
import io
import json
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
        if filename.lower().endswith('.csv'):
            df = pd.read_csv(file_stream)
        elif filename.lower().endswith('.json'):
            data = json.load(file_stream)
            # Assuming it's already in our format or similar, but let's stick to CSV for MVP
            return data
        else:
            return {"error": "Unsupported file format. Please upload CSV."}

        # Normalize Columns (Basic Heuristics)
        df.columns = [c.lower().strip() for c in df.columns]
        
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
            'heel': 'heel'
        }
        
        df = df.rename(columns=col_map)
        
        if 'lat' not in df.columns or 'lon' not in df.columns:
            return {"error": "Missing 'lat' or 'lon' columns in CSV."}

        # Fill NaNs
        df = df.fillna(0)
        
        # Extract Track
        track = df[['lat', 'lon']].values.tolist()
        
        # Metrics
        metrics = {}
        possible_metrics = ['sog', 'cog', 'tws', 'twd', 'aws', 'awa', 'heel', 'pitch']
        for m in possible_metrics:
            if m in df.columns:
                metrics[m] = df[m].tolist()
                
        # Time
        if 'time' in df.columns:
            # Try to ensure ISO format? Or just pass as is if string.
            # If numeric (Excel time or timestamp), might need conversion.
            # For MVP, assume it's a parseable string or list.
            times = df['time'].astype(str).tolist()
        else:
            # Generate dummy time index
            times = [str(i) for i in range(len(df))]

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
