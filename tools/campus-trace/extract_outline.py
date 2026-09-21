# -*- coding: utf-8 -*-
"""Extract a real building outline from satellite imagery inside a rough box.

Bounding boxes make every building look like a crate. Roofs are bright and
un-vegetated, so a colour mask plus contour tracing recovers the actual plan:
courtyards, wings and setbacks included.
"""
import cv2
import numpy as np


def building_mask(bgr):
    """Pixels that look like roof: bright, weakly saturated, not vegetation."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    bright = v > 105
    not_veg = ~(((h > 25) & (h < 95)) & (s > 60))      # greens
    not_soil = ~(((h < 22) | (h > 168)) & (s > 95))    # red/brown earth
    roof = bright & not_veg & not_soil

    # Bluish roofs (solar arrays, painted sheet) read as saturated blue.
    roof |= ((h > 95) & (h < 135) & (s > 40) & (v > 70))
    return (roof.astype(np.uint8)) * 255


def outline(bgr, margin, epsilon_frac=0.012, min_area_frac=0.06):
    """Polygon of the dominant structure, in pixel coords of the given crop."""
    mask = building_mask(bgr)
    k = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=3)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    h, w = mask.shape
    cx, cy = w / 2, h / 2
    inner = (w - 2 * margin) * (h - 2 * margin)

    # Prefer a large contour that actually covers the middle of the box.
    scored = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < inner * min_area_frac:
            continue
        d = cv2.pointPolygonTest(c, (cx, cy), True)
        scored.append((area + max(0, d) * 40, c))
    if not scored:
        return None
    contour = max(scored, key=lambda t: t[0])[1]

    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, epsilon_frac * peri, True)
    if len(approx) < 4:
        approx = cv2.approxPolyDP(contour, 0.006 * peri, True)
    if len(approx) < 4:
        rect = cv2.minAreaRect(contour)
        approx = cv2.boxPoints(rect).astype(np.int32).reshape(-1, 1, 2)
    return approx.reshape(-1, 2)
