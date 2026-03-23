import os

src = r"c:\Users\redis\Desktop\Projects\Licenta-App\APP\UI\pages\ImageConverterPage.tsx"
dst = r"c:\Users\redis\Desktop\Projects\Licenta-App\APP\UI\pages\VideoConverterPage.tsx"

with open(src, "r", encoding="utf-8") as f:
    text = f.read()

# Replacements
text = text.replace("ImageConverterPage", "VideoConverterPage")
text = text.replace("Image Converter", "Video Converter")
text = text.replace("image-converter", "video-converter")
text = text.replace("image converter", "video converter")
text = text.replace("ImageConversionResults", "VideoConversionResults")
text = text.replace("Batch convert images", "Batch convert videos")

text = text.replace(
    "['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif']",
    "['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg']"
)
text = text.replace(
    "['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif']",
    "['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm']"
)
text = text.replace(
    "['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif']",
    "['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg']"
)
text = text.replace("isImageFile", "isVideoFile")
text = text.replace("IMAGE_EXTENSIONS", "VIDEO_EXTENSIONS")
text = text.replace("imageEntries", "videoEntries")
text = text.replace("allImagesSelected", "allVideosSelected")
text = text.replace("someImagesSelected", "someVideosSelected")
text = text.replace("image", "video") # Careful with this one
text = text.replace("Image", "Video") # and this one - but let's be careful around lucide icons

# Actually let's refine the icon/text replacement manually after:
# We might accidentally break lucide-react imports. Lucide doesn't have a "VideoFile" icon, but has "FileVideo"
text = text.replace("FileImage", "FileVideo")

# Quality range remains 1-100 or we can remove it. Let's just remove the quality slider for now, or keep it.
# The user might want easy conversion. ffmpeg uses -qscale:v or -crf, but our backend doesn't take quality yet.
# Let's remove the quality UI box completely to keep it simpler, or just leave it and backend ignores it.
# Actually, it's safer to just let the backend ignore it (we didn't read quality in backend).

with open(dst, "w", encoding="utf-8") as f:
    f.write(text)
print("Done")
