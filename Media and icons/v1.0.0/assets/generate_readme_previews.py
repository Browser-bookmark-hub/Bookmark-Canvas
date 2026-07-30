from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


SCALE = 2
CANVAS_SIZE = (1280 * SCALE, 800 * SCALE)
OUTPUT_SIZE = (1280, 800)
ASSETS_DIR = Path(__file__).resolve().parent
SOURCE_DIR = ASSETS_DIR.parent

EN_FONT = Path("/System/Library/Fonts/HelveticaNeue.ttc")
ZH_FONT = Path("/System/Library/Fonts/Hiragino Sans GB.ttc")


PREVIEWS = (
    {
        "source": "GitHub配置 en.png",
        "output": "github-configuration-en.png",
        "title": "GitHub Configuration",
        "subtitle": (
            "Configure repository access, push modes, pull methods, and AI guide "
            "files in one place."
        ),
        "font": EN_FONT,
        "title_index": 1,
        "body_index": 0,
        "spacing": 24,
        "title_offset": 4,
        "screenshot_gap": 26,
    },
    {
        "source": "GitHub配置 zh.png",
        "output": "github-configuration-zh.png",
        "title": "GitHub 配置",
        "subtitle": "在一个面板中配置仓库连接、推送模式、拉取方式与 AI 指南文件。",
        "font": ZH_FONT,
        "title_index": 2,
        "body_index": 0,
        "spacing": 20,
        "title_offset": 0,
        "screenshot_gap": 26,
    },
    {
        "source": "画布示例图 en.png",
        "output": "canvas-en.png",
        "title": "Side Panel (Card Fullscreen) & Tab (Global State)",
        "subtitle": (
            "Focus on one card in the Side Panel, then use the tab to view and "
            "organize the complete canvas."
        ),
        "font": EN_FONT,
        "title_index": 1,
        "body_index": 0,
        "spacing": 26,
        "title_offset": 4,
        "screenshot_gap": 64,
    },
    {
        "source": "画布示例图 zh.png",
        "output": "canvas-zh.png",
        "title": "侧边栏（卡片全屏）与标签页（全局状态）",
        "subtitle": "在侧边栏中专注查看单张卡片，在标签页中统览并组织完整画布。",
        "font": ZH_FONT,
        "title_index": 2,
        "body_index": 0,
        "spacing": 22,
        "title_offset": 0,
        "screenshot_gap": 64,
    },
)


def resize_and_crop(image, target_size):
    target_width, target_height = target_size
    target_ratio = target_width / target_height
    image_ratio = image.width / image.height

    if image_ratio > target_ratio:
        crop_width = round(image.height * target_ratio)
        left = (image.width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, image.height))
    else:
        crop_height = round(image.width / target_ratio)
        top = (image.height - crop_height) // 2
        image = image.crop((0, top, image.width, top + crop_height))

    return image.resize(target_size, Image.Resampling.LANCZOS)


def add_rounded_corners(image, radius, top_only=False):
    mask = Image.new("L", image.size, 255)
    corner = Image.new("L", (radius * 2, radius * 2), 0)
    ImageDraw.Draw(corner).ellipse((0, 0, radius * 2 - 1, radius * 2 - 1), fill=255)
    mask.paste(corner.crop((0, 0, radius, radius)), (0, 0))
    mask.paste(
        corner.crop((radius, 0, radius * 2, radius)), (image.width - radius, 0)
    )
    if not top_only:
        mask.paste(
            corner.crop((0, radius, radius, radius * 2)), (0, image.height - radius)
        )
        mask.paste(
            corner.crop((radius, radius, radius * 2, radius * 2)),
            (image.width - radius, image.height - radius),
        )
    image.putalpha(mask)
    return image


def fit_font(text, font_path, index, start_size, min_size, max_width):
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    for size in range(start_size, min_size - 1, -1):
        font = ImageFont.truetype(font_path, size, index=index)
        bounds = probe.textbbox((0, 0), text, font=font)
        if bounds[2] - bounds[0] <= max_width:
            return font
    return ImageFont.truetype(font_path, min_size, index=index)


def generate_preview(spec):
    background = resize_and_crop(
        Image.open(ASSETS_DIR / "背景图.png").convert("RGBA"), CANVAS_SIZE
    )
    screenshot = Image.open(SOURCE_DIR / spec["source"]).convert("RGBA")
    screenshot_ratio = screenshot.height / screenshot.width

    if screenshot_ratio > 0.62:
        screenshot_width = 900 * SCALE
        max_ratio = 0.74
        icon_size = 105 * SCALE
        icon_y = 22 * SCALE
        title_size = 38 * SCALE
        subtitle_size = 21 * SCALE
        text_y_offset = -8 * SCALE
        spacing = round(spec["spacing"] * 0.75)
    else:
        screenshot_width = 1000 * SCALE
        max_ratio = 0.56
        icon_size = 125 * SCALE
        icon_y = 32 * SCALE
        title_size = 46 * SCALE
        subtitle_size = 24 * SCALE
        text_y_offset = 0
        spacing = spec["spacing"]

    if screenshot_ratio > max_ratio:
        crop_height = round(screenshot.width * max_ratio)
        screenshot = screenshot.crop((0, 0, screenshot.width, crop_height))
        screenshot_ratio = max_ratio

    screenshot_height = round(screenshot_width * screenshot_ratio)
    screenshot = screenshot.resize(
        (screenshot_width, screenshot_height), Image.Resampling.LANCZOS
    )
    screenshot = screenshot.filter(
        ImageFilter.UnsharpMask(radius=1.2, percent=75, threshold=2)
    )
    screenshot = add_rounded_corners(screenshot, 12 * SCALE, top_only=True)

    icon = Image.open(ASSETS_DIR / "icon128.png").convert("RGBA")
    icon = icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    icon = add_rounded_corners(icon, 26 * SCALE)
    background.alpha_composite(icon, (40 * SCALE, icon_y))

    draw = ImageDraw.Draw(background)
    title_font = fit_font(
        spec["title"],
        spec["font"],
        spec["title_index"],
        title_size,
        30 * SCALE,
        870 * SCALE,
    )
    subtitle_font = fit_font(
        spec["subtitle"],
        spec["font"],
        spec["body_index"],
        subtitle_size,
        18 * SCALE,
        900 * SCALE,
    )

    screenshot_y = CANVAS_SIZE[1] - screenshot.height
    title_bounds = draw.textbbox((0, 0), spec["title"], font=title_font)
    subtitle_bounds = draw.textbbox((0, 0), spec["subtitle"], font=subtitle_font)
    title_width = title_bounds[2] - title_bounds[0]
    title_height = title_bounds[3] - title_bounds[1]
    subtitle_width = subtitle_bounds[2] - subtitle_bounds[0]
    subtitle_height = subtitle_bounds[3] - subtitle_bounds[1]
    block_height = title_height + spacing + subtitle_height

    title_y = (
        screenshot_y
        - spec["screenshot_gap"] * SCALE
        - block_height
        + text_y_offset
    )
    title_x = (CANVAS_SIZE[0] - title_width) // 2
    draw.text(
        (title_x, title_y - spec["title_offset"] * SCALE),
        spec["title"],
        font=title_font,
        fill=(20, 20, 20, 255),
    )

    subtitle_x = (CANVAS_SIZE[0] - subtitle_width) // 2
    subtitle_y = title_y + title_height + spacing * SCALE
    pad_x = 24 * SCALE
    pad_y = 12 * SCALE
    pill_bounds = (
        subtitle_x - pad_x,
        subtitle_y + subtitle_bounds[1] - pad_y,
        subtitle_x + subtitle_width + pad_x,
        subtitle_y + subtitle_bounds[3] + pad_y,
    )
    pill_layer = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    pill_draw = ImageDraw.Draw(pill_layer)
    pill_draw.rounded_rectangle(
        pill_bounds,
        radius=(subtitle_height + pad_y * 2) // 2,
        fill=(0, 0, 0, 25),
    )
    background = Image.alpha_composite(background, pill_layer)
    ImageDraw.Draw(background).text(
        (subtitle_x, subtitle_y),
        spec["subtitle"],
        font=subtitle_font,
        fill=(35, 35, 35, 255),
    )

    screenshot_x = (CANVAS_SIZE[0] - screenshot.width) // 2
    background.alpha_composite(screenshot, (screenshot_x, screenshot_y))

    output_path = ASSETS_DIR / spec["output"]
    output = background.convert("RGB").resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)
    output = output.filter(
        ImageFilter.UnsharpMask(radius=0.8, percent=105, threshold=2)
    )
    output.save(output_path, "PNG", optimize=True)
    print(f"Generated {output_path.name}: {output.width}x{output.height}, RGB")


if __name__ == "__main__":
    for preview in PREVIEWS:
        generate_preview(preview)
