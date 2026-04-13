import csv
import json

file_path = r'c:\Users\LUIS\Desktop\LS-Personal-Lab\LS-Lab\camber-images\SAILMON Data\2026-04-11-j80-abril.csv'
try:
    with open(file_path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        first_row = next(reader)
        
        output = {
            'columns': header,
            'first_row': first_row,
            'total_rows': sum(1 for row in reader) + 1
        }
    with open(r'c:\Users\LUIS\Desktop\LS-Personal-Lab\LS-Lab\tmp_output.json', 'w') as f:
        json.dump(output, f, indent=2)
    print("DONE")
except Exception as e:
    print(f"Error: {e}")
