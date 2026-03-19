try:
    from APP.src.tools import image_to_svg
    print("image_to_svg imported")
    import vtracer
    print("vtracer imported")
except ImportError as e:
    print(f"ImportError: {e}")
except Exception as e:
    print(f"Error: {e}")
