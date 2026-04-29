try:
    import vtracer
    print("vtracer imported successfully")
except ImportError as e:
    print(f"vtracer import failed: {e}")
except Exception as e:
    print(f"vtracer error: {e}")
