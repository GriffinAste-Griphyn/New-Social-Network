from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "wheres-daddy-astronaut-holding-chihuahua-source.png"
OUTPUT = ROOT / "wheres-daddy-astronaut-holding-chihuahua.png"


def main() -> None:
    image = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(SOURCE)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    candidate = np.where((saturation >= 25) | (value <= 190), 255, 0).astype(np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    contours, _ = cv2.findContours(candidate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("No astronaut silhouette found")
    silhouette = np.zeros_like(candidate)
    cv2.drawContours(silhouette, [max(contours, key=cv2.contourArea)], -1, 255, -1)
    silhouette = cv2.erode(silhouette, np.ones((3, 3), np.uint8), iterations=1)
    silhouette = cv2.GaussianBlur(silhouette, (0, 0), sigmaX=0.75)
    output = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    output[:, :, 3] = silhouette
    cv2.imwrite(str(OUTPUT), output)


if __name__ == "__main__":
    main()
