from moviepy import ImageClip, concatenate_videoclips, CompositeVideoClip, AudioFileClip
from gtts import gTTS
import os
from PIL import Image
import io
import subprocess

# Configuration
images = [
    "12.png",  # Welcome to ConvoVault, Ultimate Conversation Management Solution
    "1.png",  # Conversation tabs supports all filters to search data and export all the conversations with ease
    "2.png",  # View of conversations and click into a conversation to view the messages
    "3.png",  # View of messages for single conversations
    "4.png",  # Messages tab supports all filters to search data and export all the messages with ease
    "5.png",  # View of messages for the selected filters primarily on subaccount
    "6.png",  # Import conversations from CSV/Excel files
    "7.png",  # History and stats for the uploaded or imported conversations
    "8.png",  # We have a dedicated support team to help you with any questions or issues
    "9.png",  # We have api documentation to access the api endpoints used in this app
    "10.png", # we have all conversation tab related apis which supports all filters to search data and export all the conversations with ease
    "13.png", # we have all messages tab related apis which supports all filters to search data and export all the messages with ease 
    # we have all apis documentated for all the tabs including import and export as well and support 
]

# Video settings
DURATION_PER_SLIDE = 4.0  # seconds per image
TARGET_RESOLUTION = (1920, 1080)  # Full HD
FPS = 30  # Smooth 30fps

# Voiceover script for each slide
# Professional narration matched to each image
voiceover_texts = [
    "Welcome to ConvoVault. The ultimate conversation management solution.",
    "Access all your conversations in one place. Use powerful filters to search, sort, and export your data with ease.",
    "View your conversations at a glance. Click into any conversation to see the complete message history.",
    "Dive deep into individual conversations. Review every message with full context and details.",
    "The Messages tab gives you complete control. Filter, search, and export all messages across your entire system.",
    "Apply advanced filters to find exactly what you need. View messages by subaccount, date range, or any custom criteria.",
    "Import your historical conversations effortlessly. Simply upload your CSV or Excel files and let ConvoVault handle the rest.",
    "Track your import history and monitor statistics. See detailed analytics for all your uploaded and imported conversations.",
    "Get dedicated support whenever you need it. Our team is available 24/7 to help you succeed. Just send us an email and we'll respond within 24 hours.",
    "Access our comprehensive API documentation. All endpoints are fully documented with examples and detailed parameters.",
    "Use our Conversations API with advanced filtering. Search, download, and export conversations with powerful query options and pagination support.",
    "Leverage our Messages API for complete control. Filter, search, and export messages with all the features you need. Full documentation for Import, Export, and Support endpoints included."
]

def convert_svg_to_png(svg_path, png_path, width=1920, height=1080):
    """Convert SVG file to PNG using ImageMagick or skip if not available"""
    try:
        # Try using ImageMagick convert command
        subprocess.run([
            'convert',
            '-background', 'none',
            '-resize', f'{width}x{height}',
            svg_path,
            png_path
        ], check=True, capture_output=True)
        return png_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        # If ImageMagick is not available, try with rsvg-convert
        try:
            subprocess.run([
                'rsvg-convert',
                '-w', str(width),
                '-h', str(height),
                '-o', png_path,
                svg_path
            ], check=True, capture_output=True)
            return png_path
        except (subprocess.CalledProcessError, FileNotFoundError):
            # If neither works, return None to signal error
            print(f"   ⚠️  Warning: Could not convert {svg_path}. Please convert to PNG manually.")
            return None

print("🎙️  Creating video with voiceover...")
print(f"📊 Resolution: {TARGET_RESOLUTION[0]}x{TARGET_RESOLUTION[1]}")
print(f"🎞️  FPS: {FPS}")
print()

# Generate voiceover audio files
print("🗣️  Generating voiceover narration...")
audio_files = []

for i, text in enumerate(voiceover_texts):
    audio_file = f"temp_audio_{i}.mp3"
    audio_file_fast = f"temp_audio_{i}_fast.mp3"
    print(f"   📝 Slide {i+1}: '{text[:60]}...'")
    
    # Generate speech using Google Text-to-Speech
    # Using optimal settings for clear, professional narration
    tts = gTTS(
        text=text, 
        lang='en', 
        slow=False,
        tld='com'  # Use US English for consistency
    )
    tts.save(audio_file)
    
    # Speed up audio to 1.5x using ffmpeg for better YouTube playback
    print(f"   ⚡ Speeding up audio to 1.5x...")
    subprocess.run([
        'ffmpeg',
        '-i', audio_file,
        '-filter:a', 'atempo=1.5',
        '-y',  # Overwrite output file
        '-loglevel', 'error',  # Suppress ffmpeg output
        audio_file_fast
    ], check=True)
    
    # Use the fast version
    audio_files.append(audio_file_fast)

print()
print("📸 Creating video slides...")

# Create video clips (simple, no effects)
clips = []
temp_converted_images = []  # Track temporary PNG files from SVG conversion

for i, img in enumerate(images):
    print(f"   Processing image {i+1}/{len(images)}: {img}")
    
    # Convert SVG to PNG if needed
    if img.endswith('.svg'):
        # Try to find a PNG version first
        png_alternative = img.replace('.svg', '.png')
        if os.path.exists(png_alternative):
            print(f"   ✅ Using PNG version: {png_alternative}")
            img_to_use = png_alternative
        else:
            png_path = f"temp_converted_{i}.png"
            print(f"   🔄 Converting SVG to PNG...")
            result = convert_svg_to_png(img, png_path, TARGET_RESOLUTION[0], TARGET_RESOLUTION[1])
            if result is None:
                print(f"   ❌ Skipping {img} - conversion failed and no PNG alternative found.")
                continue
            img_to_use = png_path
            temp_converted_images.append(png_path)
    else:
        img_to_use = img
    
    # Load audio (already sped up to 1.5x during generation)
    audio_clip = AudioFileClip(audio_files[i])
    audio_duration = audio_clip.duration
    
    # Create image clip with duration matching audio (+ small buffer)
    clip_duration = audio_duration + 0.5  # 0.5 second buffer
    
    # Load image and resize to target resolution
    clip = ImageClip(img_to_use).with_duration(clip_duration)
    
    # Resize to fit 1920x1080 while maintaining aspect ratio
    clip = clip.resized(height=TARGET_RESOLUTION[1])
    
    # If wider than 1920, resize to width instead
    if clip.w > TARGET_RESOLUTION[0]:
        clip = clip.resized(width=TARGET_RESOLUTION[0])
    
    # Add audio to the clip
    clip = clip.with_audio(audio_clip)
    
    clips.append(clip)

print()
print("🎬 Combining slides into final video...")

# Concatenate all clips
video = concatenate_videoclips(clips, method="compose")

# Calculate total duration
total_duration = sum([clip.duration for clip in clips])

print()
print(f"⏱️  Total duration: {total_duration:.1f} seconds")
print()
print("💾 Rendering video with voiceover (this may take a few minutes)...")
print("    ⏳ Please wait...")

# Export with high quality settings
video.write_videofile(
    "ConvoVault_Product_Overview.mp4",
    fps=FPS,
    codec='libx264',
    audio_codec='aac',
    audio_bitrate='192k',  # High quality audio
    preset='medium',
    bitrate='8000k',
    threads=4,
    logger='bar'
)

print()
print("🧹 Cleaning up temporary files...")

# Clean up fast audio files
for audio_file in audio_files:
    if os.path.exists(audio_file):
        os.remove(audio_file)
        print(f"   ✓ Removed {audio_file}")

# Clean up original slow audio files
for i in range(len(voiceover_texts)):
    slow_file = f"temp_audio_{i}.mp3"
    if os.path.exists(slow_file):
        os.remove(slow_file)
        print(f"   ✓ Removed {slow_file}")

# Clean up converted PNG files
for png_file in temp_converted_images:
    if os.path.exists(png_file):
        os.remove(png_file)
        print(f"   ✓ Removed {png_file}")

print()
print("=" * 60)
print("✅ Video with voiceover created successfully!")
print(f"📁 Output: ConvoVault_Product_Overview.mp4")
print(f"📐 Resolution: {TARGET_RESOLUTION[0]}x{TARGET_RESOLUTION[1]} @ {FPS} FPS")
print(f"🎙️  Total duration: {total_duration:.1f} seconds with narration")
print(f"🎉 Ready to showcase your ConvoVault product!")
print("=" * 60)
