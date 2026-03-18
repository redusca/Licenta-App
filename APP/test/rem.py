from PIL import Image
from rembg import remove

img = Image.open("test.jpg")
out = remove(img)
out.save("test_nobg.png", format="PNG")
print("Works!")