from pathlib import Path

from PIL import Image, ImageFilter


ASSETS_DIR = Path(__file__).resolve().parent
SOURCE_PATH = Path("/Users/kk/Desktop/Screenshot 2026-07-30 at 16.40.22.png")

TILES = (
    {
        "name": "bookmark-canvas-tile-440x280.png",
        "crop": (440, 55, 1540, 755),
        "size": (440, 280),
    },
    {
        "name": "bookmark-canvas-marquee-1400x560.png",
        "crop": (0, 48, 1760, 752),
        "size": (1400, 560),
    },
)


def generate_tile(source, spec):
    crop = source.crop(spec["crop"])
    output = crop.resize(spec["size"], Image.Resampling.LANCZOS)
    output = output.filter(
        ImageFilter.UnsharpMask(radius=0.7, percent=85, threshold=2)
    )
    output = output.convert("RGB")

    output_path = ASSETS_DIR / spec["name"]
    output.save(output_path, "PNG", optimize=True)
    print(f"Generated {output_path.name}: {output.width}x{output.height}, RGB")


if __name__ == "__main__":
    source_image = Image.open(SOURCE_PATH).convert("RGB")
    for tile in TILES:
        generate_tile(source_image, tile)
