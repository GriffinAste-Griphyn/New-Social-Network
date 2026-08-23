from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "wheres-daddy-chihuahua-run-strip-source.png"
OUTPUT = ROOT / "wheres-daddy-chihuahua-run-strip.png"


def main() -> None:
    image = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(SOURCE)

    height, width = image.shape[:2]
    boundaries = np.linspace(0, width, 7).astype(int)
    alpha = np.zeros((height, width), dtype=np.uint8)

    for index in range(6):
        x1, x2 = boundaries[index], boundaries[index + 1]
        cell = image[:, x1:x2]
        hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)
        saturation = hsv[:, :, 1]
        value = hsv[:, :, 2]

        # The generated checkerboard is neutral and bright; the tan dog is
        # strongly saturated. Keep the largest connected silhouette per cell.
        candidate = np.where((saturation >= 28) | (value <= 188), 255, 0).astype(np.uint8)
        candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=2)
        contours, _ = cv2.findContours(candidate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            raise ValueError(f"No Chihuahua silhouette found in cell {index}")
        silhouette = np.zeros_like(candidate)
        cv2.drawContours(silhouette, [max(contours, key=cv2.contourArea)], -1, 255, -1)
        silhouette = cv2.erode(silhouette, np.ones((3, 3), np.uint8), iterations=1)
        silhouette = cv2.GaussianBlur(silhouette, (0, 0), sigmaX=0.75)
        alpha[:, x1:x2] = silhouette

    output = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    output[:, :, 3] = alpha
    cv2.imwrite(str(OUTPUT), output)


if __name__ == "__main__":
    main()
