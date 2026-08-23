from __future__ import annotations

import math
import subprocess
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
BACKGROUND = ROOT / "wheres-daddy-clean-plate.png"
WALK_STRIP = ROOT / "wheres-daddy-astronaut-moonwalk-strip.png"
DOG_STRIP = ROOT / "wheres-daddy-chihuahua-run-strip.png"
STAND_POSE = ROOT / "wheres-daddy-astronaut-stand.png"
HELD_POSE = ROOT / "wheres-daddy-astronaut-holding-chihuahua.png"
OUTPUT = ROOT / "wheres-daddy-chihuahua-wormhole-held.mp4"

WIDTH, HEIGHT = 1280, 720
FPS = 30
DURATION_SECONDS = 6
WALK_FRAMES = 138
DOG_RUN_FRAMES = 132


def trim_alpha(image: np.ndarray, threshold: int = 5) -> np.ndarray:
    alpha = image[:, :, 3]
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        raise ValueError("Sprite has no visible pixels")
    return image[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def split_walk_strip(strip: np.ndarray) -> list[np.ndarray]:
    boundaries = np.linspace(0, strip.shape[1], 7).astype(int)
    cells = [strip[:, boundaries[i] : boundaries[i + 1]] for i in range(6)]

    # Keep the generator's original cell registration so the torso and planted
    # foot do not jump sideways when the silhouette changes from pose to pose.
    visible_rows = []
    for cell in cells:
        ys = np.where(cell[:, :, 3] > 5)[0]
        visible_rows.append((ys.min(), ys.max() + 1))
    top = min(item[0] for item in visible_rows)
    bottom = max(item[1] for item in visible_rows)
    max_width = max(cell.shape[1] for cell in cells)
    registered = []
    for cell in cells:
        crop = cell[top:bottom]
        canvas = np.zeros((crop.shape[0], max_width, 4), dtype=np.uint8)
        offset = (max_width - crop.shape[1]) // 2
        canvas[:, offset : offset + crop.shape[1]] = crop
        registered.append(canvas)
    return registered


def resize_to_height(sprite: np.ndarray, height: int) -> np.ndarray:
    width = max(1, round(sprite.shape[1] * height / sprite.shape[0]))
    return cv2.resize(sprite, (width, height), interpolation=cv2.INTER_AREA)


def blend_rgba(first: np.ndarray, second: np.ndarray, amount: float) -> np.ndarray:
    if amount <= 0:
        return first
    if amount >= 1:
        return second
    first_f = first.astype(np.float32) / 255.0
    second_f = second.astype(np.float32) / 255.0
    a1 = first_f[:, :, 3:4]
    a2 = second_f[:, :, 3:4]
    alpha = a1 * (1.0 - amount) + a2 * amount
    premultiplied = first_f[:, :, :3] * a1 * (1.0 - amount) + second_f[:, :, :3] * a2 * amount
    rgb = np.divide(premultiplied, np.maximum(alpha, 1e-6))
    return np.clip(np.dstack((rgb, alpha)) * 255.0, 0, 255).astype(np.uint8)


def grade_sprite(sprite: np.ndarray) -> np.ndarray:
    graded = sprite.copy()
    rgb = graded[:, :, :3].astype(np.float32)
    rgb *= np.array([0.82, 0.88, 0.94], dtype=np.float32)
    graded[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return graded


def grade_dog_sprite(sprite: np.ndarray) -> np.ndarray:
    graded = sprite.copy()
    rgb = graded[:, :, :3].astype(np.float32)
    rgb *= np.array([0.72, 0.80, 0.88], dtype=np.float32)
    graded[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return graded


def composite_rgba(frame: np.ndarray, sprite: np.ndarray, center_x: int, bottom_y: int, opacity: float = 1.0) -> None:
    h, w = sprite.shape[:2]
    x1, y1 = center_x - w // 2, bottom_y - h
    x2, y2 = x1 + w, y1 + h
    fx1, fy1 = max(0, x1), max(0, y1)
    fx2, fy2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
    if fx1 >= fx2 or fy1 >= fy2:
        return
    sx1, sy1 = fx1 - x1, fy1 - y1
    sx2, sy2 = sx1 + (fx2 - fx1), sy1 + (fy2 - fy1)
    src = sprite[sy1:sy2, sx1:sx2]
    alpha = (src[:, :, 3:4].astype(np.float32) / 255.0) * opacity
    dst = frame[fy1:fy2, fx1:fx2].astype(np.float32)
    frame[fy1:fy2, fx1:fx2] = np.clip(src[:, :, :3] * alpha + dst * (1.0 - alpha), 0, 255).astype(np.uint8)


def add_shadow(frame: np.ndarray, center_x: int, bottom_y: int, sprite_height: int, strength: float) -> None:
    axes = (max(12, sprite_height // 5), max(3, sprite_height // 35))
    pad = 16
    layer = np.zeros((2 * (axes[1] + pad), 2 * (axes[0] + pad), 4), dtype=np.uint8)
    local_center = (axes[0] + pad, axes[1] + pad)
    cv2.ellipse(layer, local_center, axes, 0, 0, 360, (0, 0, 0, int(105 * strength)), -1)
    layer[:, :, 3] = cv2.GaussianBlur(layer[:, :, 3], (0, 0), sigmaX=6, sigmaY=3)
    composite_rgba(frame, layer, center_x, bottom_y + axes[1] + pad - 2)


def add_dog_shadow(frame: np.ndarray, center_x: int, bottom_y: int, sprite_height: int) -> None:
    axes = (max(2, sprite_height // 4), max(1, sprite_height // 15))
    pad = 5
    layer = np.zeros((2 * (axes[1] + pad), 2 * (axes[0] + pad), 4), dtype=np.uint8)
    local_center = (axes[0] + pad, axes[1] + pad)
    cv2.ellipse(layer, local_center, axes, 0, 0, 360, (0, 0, 0, 85), -1)
    layer[:, :, 3] = cv2.GaussianBlur(layer[:, :, 3], (0, 0), sigmaX=2.0, sigmaY=1.2)
    composite_rgba(frame, layer, center_x, bottom_y + axes[1] + pad - 1)


def smoothstep(value: float) -> float:
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


def walk_position(progress: float) -> tuple[int, int, int]:
    eased = smoothstep(progress)
    center_x = round(470 + 215 * eased)
    bottom_y = round(665 - 280 * eased)
    sprite_height = round(210 - 52 * eased)
    return center_x, bottom_y, sprite_height


def dog_position(progress: float) -> tuple[int, int, int]:
    eased = smoothstep(progress)
    center_x = round(1025 - 525 * eased)
    # Rise out of the vortex on a supernatural arc into the astronaut's arms.
    bottom_y = round(615 - 110 * eased - 120 * math.sin(math.pi * eased))
    sprite_height = round(5 + 41 * eased)
    return center_x, bottom_y, sprite_height


def add_portal_glow(frame: np.ndarray, center_x: int, center_y: int, sprite_height: int, progress: float) -> None:
    strength = max(0.0, 1.0 - progress) ** 1.65
    if strength <= 0.01:
        return
    radius = max(18, round(34 + sprite_height * 0.9))
    size = radius * 4
    layer = np.zeros((size, size, 4), dtype=np.uint8)
    local_center = (size // 2, size // 2)
    cv2.circle(layer, local_center, radius, (255, 195, 78, round(105 * strength)), -1)
    layer[:, :, 3] = cv2.GaussianBlur(layer[:, :, 3], (0, 0), sigmaX=max(8, radius * 0.65))
    composite_rgba(frame, layer, center_x, center_y + size // 2)


def add_dust(frame: np.ndarray, frame_index: int) -> None:
    dust = np.zeros_like(frame)
    mask = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    for event in range(12, WALK_FRAMES, 15):
        age = frame_index - event
        if age < 0 or age >= 24:
            continue
        progress = event / (WALK_FRAMES - 1)
        anchor_x, anchor_y, sprite_height = walk_position(progress)
        rng = np.random.default_rng(event)
        fade = 1.0 - age / 24.0
        for _ in range(7):
            x = round(anchor_x + rng.normal(0, sprite_height * 0.10) + rng.normal(0, 0.45) * age)
            y = round(anchor_y - 2 + rng.uniform(-0.9, -0.2) * age + 0.035 * age * age)
            radius = max(1, round(rng.uniform(1.2, 3.4) * fade))
            cv2.circle(dust, (x, y), radius, (34, 73, 128), -1)
            cv2.circle(mask, (x, y), radius + 1, int(42 * fade), -1)
    if mask.max() == 0:
        return
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=1.8)
    alpha = mask[:, :, None].astype(np.float32) / 255.0
    frame[:] = np.clip(dust.astype(np.float32) * alpha + frame.astype(np.float32) * (1.0 - alpha), 0, 255).astype(np.uint8)


def apply_camera_move(frame: np.ndarray, frame_index: int, total_frames: int) -> np.ndarray:
    progress = smoothstep(frame_index / (total_frames - 1))
    zoom = 1.0 + 0.016 * progress
    matrix = cv2.getRotationMatrix2D((760, 405), 0.0, zoom)
    return cv2.warpAffine(frame, matrix, (WIDTH, HEIGHT), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT_101)


def main() -> None:
    background = cv2.imread(str(BACKGROUND), cv2.IMREAD_COLOR)
    strip = cv2.imread(str(WALK_STRIP), cv2.IMREAD_UNCHANGED)
    dog_strip = cv2.imread(str(DOG_STRIP), cv2.IMREAD_UNCHANGED)
    stand = cv2.imread(str(STAND_POSE), cv2.IMREAD_UNCHANGED)
    held = cv2.imread(str(HELD_POSE), cv2.IMREAD_UNCHANGED)
    if background is None or strip is None or dog_strip is None or stand is None or held is None:
        raise FileNotFoundError("One or more animation assets could not be loaded")
    if strip.shape[2] != 4 or dog_strip.shape[2] != 4 or stand.shape[2] != 4 or held.shape[2] != 4:
        raise ValueError("Character assets must retain transparent alpha channels")

    background = cv2.resize(background, (WIDTH, HEIGHT), interpolation=cv2.INTER_LANCZOS4)
    walk_poses = split_walk_strip(strip)
    dog_poses = split_walk_strip(dog_strip)
    stand = grade_sprite(trim_alpha(stand))
    held = grade_sprite(trim_alpha(held))
    walk_poses = [grade_sprite(pose) for pose in walk_poses]
    dog_poses = [grade_dog_sprite(pose) for pose in dog_poses]
    glow = np.zeros_like(background)
    cv2.circle(glow, (1030, 610), 235, (255, 180, 80), -1)
    glow = cv2.GaussianBlur(glow, (0, 0), sigmaX=95)

    command = [
        "ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-",
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUTPUT),
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert encoder.stdin is not None

    total_frames = FPS * DURATION_SECONDS
    for index in range(total_frames):
        frame = background.copy()
        pickup_start = 112
        pickup_end = DOG_RUN_FRAMES
        pickup_amount = smoothstep((index - pickup_start) / (pickup_end - pickup_start))

        # The Chihuahua runs from the distant plain toward the foreground and
        # arrives beside the astronaut near the cliff.
        if index < DOG_RUN_FRAMES:
            dog_progress = index / (DOG_RUN_FRAMES - 1)
            dog_x, dog_y, dog_height = dog_position(dog_progress)
            dog_gait = smoothstep(dog_progress) * 36.0
            dog_frame = int(math.floor(dog_gait)) % 6
            dog_fraction = dog_gait - math.floor(dog_gait)
            dog_blend = smoothstep((dog_fraction - 0.35) / 0.65)
            dog_next = (dog_frame + 1) % 6
            dog_y -= round(1.4 * abs(math.sin(2.0 * math.pi * dog_gait / 6.0)))
            add_portal_glow(frame, dog_x, dog_y - dog_height // 2, dog_height, dog_progress)
            dog_current = resize_to_height(dog_poses[dog_frame], dog_height)
            dog_following = resize_to_height(dog_poses[dog_next], dog_height)
            dog_sprite = blend_rgba(dog_current, dog_following, dog_blend)
            visibility = smoothstep(dog_progress / 0.15)
            composite_rgba(frame, dog_sprite, dog_x, dog_y, opacity=visibility * (1.0 - pickup_amount))

        # The astronaut stays planted on the broad foreground shelf throughout.
        center_x, bottom_y, sprite_height = 470, 625, 225
        add_shadow(frame, center_x, bottom_y, sprite_height, 0.62)
        sprite = resize_to_height(stand, sprite_height)
        composite_rgba(frame, sprite, center_x, bottom_y, opacity=1.0 - pickup_amount)
        held_sprite = resize_to_height(held, sprite_height)
        composite_rgba(frame, held_sprite, center_x, bottom_y, opacity=pickup_amount)

        # A subtle breathing glow keeps the abyss alive without replacing the character motion.
        glow_strength = 0.018 + 0.008 * math.sin(2.0 * math.pi * index / 90.0)
        frame = cv2.addWeighted(frame, 1.0, glow, glow_strength, 0)

        encoder.stdin.write(frame.tobytes())

    encoder.stdin.close()
    return_code = encoder.wait()
    if return_code != 0:
        raise RuntimeError(f"ffmpeg exited with status {return_code}")


if __name__ == "__main__":
    main()
