import sys
import os

# add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'APP', 'src'))
from utils.mft_scan import get_space_analyzer_data
import time

t0 = time.time()
data = get_space_analyzer_data("C")
t1 = time.time()

if "error" in data:
    print(f"Error: {data['error']}")
else:
    print(f"Scanned C: in {t1-t0:.2f} seconds")
    print(f"Path: {data['path']}")
    print(f"Total Size: {data['total_size'] / 1024**3:.2f} GB")
    print(f"Found {len(data['children'])} children at root level")
    
    # print top 5
    for c in data['children'][:5]:
        print(f" - {c['name']} : {c['size'] / 1024**3:.2f} GB (dir: {c['is_dir']})")
