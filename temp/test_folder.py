import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'APP', 'src'))
from utils.mft_scan import get_space_analyzer_data
import time

t0 = time.time()
data = get_space_analyzer_data("C", "C:\\Users\\redis\\Desktop\\Projects\\Licenta-App")
t1 = time.time()

if "error" in data:
    print(f"Error: {data['error']}")
else:
    print(f"Scanned folder in {t1-t0:.2f} seconds")
    print(f"Path: {data['path']}")
    print(f"Total Size: {data['total_size'] / 1024**3:.2f} GB")
    print(f"Found {len(data['children'])} children")
