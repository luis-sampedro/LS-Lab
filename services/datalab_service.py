import struct
import math
import csv
import io
import json
from datetime import datetime, timezone, timedelta

try:
    from timezonefinder import TimezoneFinder
    from zoneinfo import ZoneInfo
    tz_finder = TimezoneFinder()
except Exception as e:
    tz_finder = None

def resolve_timezone_and_dst(lat, lon, date_str):
    """
    Automatically calculates exact IANA Timezone, Daylight Saving Time (Summertime),
    and UTC offset for given GPS location and timestamp.
    """
    tz_name = None
    if tz_finder and lat and lon:
        try:
            tz_name = tz_finder.timezone_at(lng=lon, lat=lat)
        except Exception:
            tz_name = None

    if not tz_name:
        if 35 <= lat <= 65 and -10 <= lon <= 30:
            tz_name = 'Europe/Rome' if lon > 5 else 'Europe/Madrid'
        elif -125 <= lon <= -65 and 24 <= lat <= 50:
            tz_name = 'America/New_York'
        else:
            tz_name = 'UTC'

    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc

    try:
        dt_utc = datetime.fromisoformat(str(date_str).replace(' ', 'T')).replace(tzinfo=timezone.utc)
    except Exception:
        dt_utc = datetime.now(timezone.utc)

    dt_local = dt_utc.astimezone(tz)
    offset_min = int(dt_local.utcoffset().total_seconds() / 60)
    is_dst = bool(dt_local.dst() and dt_local.dst().total_seconds() != 0)
    tz_abbrev = dt_local.tzname()

    return {
        "tz_name": tz_name,
        "tz_abbrev": tz_abbrev,
        "utc_offset_minutes": offset_min,
        "is_dst": is_dst,
        "local_time_str": dt_local.strftime("%H:%M:%S")
    }

def safe_fromtimestamp(ts_ms):
    try:
        ts_sec = ts_ms / 1000.0
        if ts_sec < 86400 or ts_sec > 4102444800:
            return None
        return datetime.fromtimestamp(ts_sec, tz=timezone.utc)
    except Exception:
        return None

def q_to_euler(qw, qx, qy, qz):
    sinr_cosp = 2 * (qw * qx + qy * qz)
    cosr_cosp = 1 - 2 * (qx * qx + qy * qy)
    roll = math.atan2(sinr_cosp, cosr_cosp)

    sinp = 2 * (qw * qy - qz * qx)
    pitch = math.copysign(math.pi / 2, sinp) if abs(sinp) >= 1 else math.asin(sinp)

    siny_cosp = 2 * (qw * qz + qx * qy)
    cosy_cosp = 1 - 2 * (qy * qy + qz * qz)
    yaw = math.atan2(siny_cosp, cosy_cosp)

    return math.degrees(roll), math.degrees(pitch), math.degrees(yaw) % 360

def parse_vkx_file(file_stream, filename):
    try:
        data = file_stream.read()
        i = 0
        
        track = []
        raw_datetime_objs = []
        metrics = {
            'sog': [],
            'cog': [],
            'heel': [],
            'pitch': [],
            'hdt': [],
            'alt': []
        }
        
        HEADER_MAGIC = b'VKX'
        if data.startswith(HEADER_MAGIC):
            i = 8
            
        while i < len(data) - 4:
            key = data[i]
            i += 1
            
            payload_size = None
            if key == 0x01: payload_size = 24
            elif key == 0x02: payload_size = 44
            elif key == 0x03: payload_size = 16
            elif key == 0x04: payload_size = 12
            elif key == 0x05: payload_size = 32
            elif key == 0x06: payload_size = 8
            
            if payload_size is None:
                continue
                
            if i + payload_size > len(data):
                break
                
            payload = data[i:i + payload_size]
            i += payload_size
            
            if key == 0x02:
                ts_ms = struct.unpack_from('<Q', payload, 0)[0]
                lat_raw = struct.unpack_from('<i', payload, 8)[0]
                lon_raw = struct.unpack_from('<i', payload, 12)[0]
                sog_ms = struct.unpack_from('<f', payload, 16)[0]
                cog_rad = struct.unpack_from('<f', payload, 20)[0]
                alt_m = struct.unpack_from('<f', payload, 24)[0]
                
                qw = struct.unpack_from('<f', payload, 28)[0]
                qx = struct.unpack_from('<f', payload, 32)[0]
                qy = struct.unpack_from('<f', payload, 36)[0]
                qz = struct.unpack_from('<f', payload, 40)[0]
                
                lat = lat_raw * 1e-7
                lon = lon_raw * 1e-7
                
                if abs(lat) < 1.0 or abs(lon) < 1.0 or abs(lat) > 90.0 or abs(lon) > 180.0:
                    if len(track) > 0:
                        lat, lon = track[-1]
                    else:
                        continue
                    
                ts = safe_fromtimestamp(ts_ms)
                sog_kt = max(0.0, sog_ms * 1.94384)
                cog_deg = math.degrees(cog_rad) % 360
                heel, pitch, heading = q_to_euler(qw, qx, qy, qz)
                
                track.append([lat, lon])
                raw_datetime_objs.append(ts)
                metrics['sog'].append(sog_kt)
                metrics['cog'].append(cog_deg)
                metrics['alt'].append(alt_m)
                metrics['heel'].append(heel)
                metrics['pitch'].append(pitch)
                metrics['hdt'].append(heading)
                
        times = []
        last_dt = None
        for dt in raw_datetime_objs:
            if dt is None:
                if last_dt is not None:
                    last_dt = last_dt + timedelta(seconds=1)
                else:
                    last_dt = datetime(2026, 7, 5, 12, 0, 0, tzinfo=timezone.utc)
            else:
                if last_dt is not None and dt < last_dt:
                    last_dt = last_dt + timedelta(seconds=1)
                else:
                    last_dt = dt
            times.append(last_dt.strftime('%Y-%m-%d %H:%M:%S'))

        if not track:
            return {"error": "No valid telemetry records found in VKX binary stream."}

        first_lat = track[0][0]
        first_lon = track[0][1]
        first_time = times[0]
        tz_info = resolve_timezone_and_dst(first_lat, first_lon, first_time)

        return {
            "success": True,
            "filename": filename,
            "detected_format": "Vakaros Binary (.vkx)",
            "track": track,
            "time": times,
            "timezone_info": tz_info,
            "metrics": metrics
        }
    except Exception as e:
        print(f"VKX Parse Error: {e}")
        return {"error": f"Failed to parse Vakaros VKX file: {str(e)}"}

def process_telemetry_file(file_stream, filename):
    filename_lower = filename.lower()

    if filename_lower.endswith('.vkx'):
        return parse_vkx_file(file_stream, filename)

    content = file_stream.read()
    
    if filename_lower.endswith('.csv') or b'sog' in content.lower() or b'speed' in content.lower() or b'lat' in content.lower():
        try:
            text = content.decode('utf-8', errors='ignore')
            reader = csv.DictReader(io.StringIO(text))

            track = []
            times = []
            sogs = []
            cogs = []
            heels = []

            for row in reader:
                lat_key = next((k for k in row.keys() if 'lat' in k.lower()), None)
                lon_key = next((k for k in row.keys() if 'lon' in k.lower()), None)
                sog_key = next((k for k in row.keys() if 'sog' in k.lower() or 'speed' in k.lower()), None)
                cog_key = next((k for k in row.keys() if 'cog' in k.lower() or 'heading' in k.lower()), None)
                heel_key = next((k for k in row.keys() if 'heel' in k.lower() or 'roll' in k.lower()), None)
                time_key = next((k for k in row.keys() if 'time' in k.lower() or 'date' in k.lower()), None)

                if lat_key and lon_key and row[lat_key] and row[lon_key]:
                    try:
                        lat = float(row[lat_key])
                        lon = float(row[lon_key])
                        if abs(lat) < 1.0 or abs(lon) < 1.0:
                            continue
                        track.append([lat, lon])
                        times.append(row[time_key] if time_key and row[time_key] else f"t_{len(times)}")
                        sogs.append(float(row[sog_key]) if sog_key and row[sog_key] else 0.0)
                        cogs.append(float(row[cog_key]) if cog_key and row[cog_key] else 0.0)
                        heels.append(float(row[heel_key]) if heel_key and row[heel_key] else 0.0)
                    except ValueError:
                        continue

            if track:
                first_lat = track[0][0]
                first_lon = track[0][1]
                first_time = times[0] if times else "2026-07-01 00:00:00"
                tz_info = resolve_timezone_and_dst(first_lat, first_lon, first_time)

                return {
                    "success": True,
                    "filename": filename,
                    "detected_format": "CSV Telemetry Log (.csv)",
                    "track": track,
                    "time": times,
                    "timezone_info": tz_info,
                    "metrics": {
                        "sog": sogs,
                        "cog": cogs,
                        "heel": heels
                    }
                }
        except Exception as e:
            print(f"CSV Parse Error: {e}")

    try:
        import xml.etree.ElementTree as ET
        text = content.decode('utf-8', errors='ignore')
        root = ET.fromstring(text)
        
        ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
        trkpts = root.findall('.//gpx:trkpt', ns) or root.findall('.//trkpt')
        
        track = []
        times = []
        
        for pt in trkpts:
            lat = float(pt.attrib['lat'])
            lon = float(pt.attrib['lon'])
            if abs(lat) < 1.0 or abs(lon) < 1.0:
                continue
            track.append([lat, lon])
            
            time_node = pt.find('gpx:time', ns) if pt.find('gpx:time', ns) is not None else pt.find('time')
            times.append(time_node.text if time_node is not None else f"pt_{len(times)}")

        if not track:
            return {"error": "No valid GPS track points found in file."}

        metrics = {
            "sog": [],
            "cog": [],
            "heel": [0.0] * len(track)
        }

        for i in range(len(track)):
            if i == 0:
                metrics['sog'].append(0.0)
                metrics['cog'].append(0.0)
                continue
                
            p1 = track[i-1]
            p2 = track[i]
            
            def parse_time(ts):
                try:
                    return datetime.fromisoformat(ts).timestamp()
                except:
                    t = ts.replace(' ', 'T')
                    return datetime.fromisoformat(t).timestamp() if 'T' in t else 0
                    
            t1 = parse_time(times[i-1])
            t2 = parse_time(times[i])
            
            dt = max(t2 - t1, 1.0)
            
            R = 3440.065
            lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
            lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
            
            dlon = lon2 - lon1
            dlat = lat2 - lat1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            dist_nm = R * c
            
            metrics['sog'].append((dist_nm / dt) * 3600.0)
            
            y = math.sin(dlon) * math.cos(lat2)
            x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
            brng = math.degrees(math.atan2(y, x))
            metrics['cog'].append((brng + 360) % 360)

        first_lat = track[0][0]
        first_lon = track[0][1]
        first_time = times[0] if times else "2026-07-01 00:00:00"
        tz_info = resolve_timezone_and_dst(first_lat, first_lon, first_time)

        return {
            "success": True,
            "filename": filename,
            "detected_format": "GPX XML Track (.gpx)",
            "track": track,
            "time": times,
            "timezone_info": tz_info,
            "metrics": metrics
        }
        
    except Exception as e:
        print(f"GPX Parse Error: {e}")
        return {"error": str(e)}
