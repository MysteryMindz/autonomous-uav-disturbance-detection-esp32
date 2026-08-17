#!/usr/bin/env python3
"""
Visual Perception Node v2 - Pi Zero v1.3 + Pi Camera
Robust visibility + obstacle detection with:
  - ROI banding (ignores floor/ceiling noise)
  - Auto-Canny (adapts to lighting instead of fixed thresholds)
  - Edge-density normalization (not raw pixel counts)
  - Hysteresis (separate enter/exit thresholds -> no flicker)
  - Temporal smoothing + consecutive-frame confirmation
  - Direction stickiness (no flip-flopping on close calls)
  - DEBUG_MODE for on-site threshold calibration without ESP32 attached

Protocol out: "S:<CLEAR|POOR>,V:<CLEAR|POOR>,DIR:<CENTER|LEFT|RIGHT>\n"
"""

import time
import collections
import serial
import numpy as np
import cv2
from picamera2 import Picamera2

# ================= CONFIG (calibrate on-site) =================
FRAME_W, FRAME_H = 160, 120
FRAMERATE = 8

DEBUG_MODE = True         # True = print stats only, skip UART entirely
SHOW_PREVIEW_STATS = True   # print live stats even when not in debug mode

# --- Visibility (weather/fog) ---
VIS_STDDEV_ENTER_POOR = 30.0   # std dev must drop below this to declare POOR
VIS_STDDEV_EXIT_POOR = 38.0    # must rise above this to go back to CLEAR (hysteresis gap)

# --- Obstacle ROI: only look at the middle horizontal band ---
# (ignores floor texture near bottom and ceiling/sky near top)
ROI_TOP_FRAC = 0.25     # skip top 25% of frame
ROI_BOTTOM_FRAC = 0.85  # skip bottom 15% of frame

# --- Obstacle detection thresholds (edge density = edge_px / region_area) ---
OBSTACLE_DENSITY_ENTER = 0.12   # density above this in center -> obstacle candidate
OBSTACLE_DENSITY_EXIT = 0.08    # density must drop below this to clear obstacle state

# --- Temporal confirmation ---
SMOOTHING_WINDOW = 5        # rolling average window size (frames)
CONFIRM_FRAMES = 3          # must agree on obstacle state for N consecutive frames to switch

# --- Direction stickiness ---
DIRECTION_MARGIN_RATIO = 1.15   # one side must have >=15% fewer edges than the other to switch away from CENTER->L/R decision changing

SERIAL_PORT = "/dev/serial0"
BAUD_RATE = 115200
SEND_INTERVAL = 0.2  # seconds between UART sends
# =================================================================


def auto_canny(gray_blurred, sigma=0.33):
    """Median-based adaptive Canny thresholds - adapts to current lighting."""
    median_val = np.median(gray_blurred)
    lower = int(max(0, (1.0 - sigma) * median_val))
    upper = int(min(255, (1.0 + sigma) * median_val))
    return cv2.Canny(gray_blurred, lower, upper)


class HysteresisLatch:
    """Simple two-threshold latch to prevent flicker at a boundary."""

    def __init__(self, enter_thresh, exit_thresh, enter_above=True, initial_state=False):
        self.enter_thresh = enter_thresh
        self.exit_thresh = exit_thresh
        self.enter_above = enter_above  # True: state becomes True when value >= enter_thresh
        self.state = initial_state

    def update(self, value):
        if self.enter_above:
            if not self.state and value >= self.enter_thresh:
                self.state = True
            elif self.state and value <= self.exit_thresh:
                self.state = False
        else:
            if not self.state and value <= self.enter_thresh:
                self.state = True
            elif self.state and value >= self.exit_thresh:
                self.state = False
        return self.state


class ConsecutiveConfirmer:
    """Requires N consecutive frames agreeing before committing to a state change."""

    def __init__(self, confirm_frames, initial_state=False):
        self.confirm_frames = confirm_frames
        self.committed_state = initial_state
        self.pending_state = initial_state
        self.count = 0

    def update(self, candidate_state):
        if candidate_state == self.pending_state:
            self.count += 1
        else:
            self.pending_state = candidate_state
            self.count = 1

        if self.count >= self.confirm_frames:
            self.committed_state = self.pending_state

        return self.committed_state


class VisionAnalyzer:
    def __init__(self):
        self.vis_latch = HysteresisLatch(
            enter_thresh=VIS_STDDEV_ENTER_POOR,
            exit_thresh=VIS_STDDEV_EXIT_POOR,
            enter_above=False,   # POOR triggers when std DROPS below enter_thresh
            initial_state=False,  # False = not poor (CLEAR) initially
        )
        self.obstacle_latch = HysteresisLatch(
            enter_thresh=OBSTACLE_DENSITY_ENTER,
            exit_thresh=OBSTACLE_DENSITY_EXIT,
            enter_above=True,
            initial_state=False,
        )
        self.vis_confirmer = ConsecutiveConfirmer(CONFIRM_FRAMES, initial_state=False)
        self.obs_confirmer = ConsecutiveConfirmer(CONFIRM_FRAMES, initial_state=False)

        self.std_history = collections.deque(maxlen=SMOOTHING_WINDOW)
        self.center_density_history = collections.deque(maxlen=SMOOTHING_WINDOW)

        self.last_direction = "CENTER"

    def analyze_visibility(self, gray_frame):
        _, stddev = cv2.meanStdDev(gray_frame)
        std_val = stddev[0][0]
        self.std_history.append(std_val)
        smoothed_std = float(np.mean(self.std_history))

        raw_poor = self.vis_latch.update(smoothed_std)
        confirmed_poor = self.vis_confirmer.update(raw_poor)

        return ("POOR" if confirmed_poor else "CLEAR"), smoothed_std

    def analyze_obstacles(self, gray_frame):
        h, w = gray_frame.shape
        roi_top = int(h * ROI_TOP_FRAC)
        roi_bottom = int(h * ROI_BOTTOM_FRAC)
        roi = gray_frame[roi_top:roi_bottom, :]

        # 1. Better Edge Detection: CLAHE + Gaussian + Canny + Morph Close
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced_roi = clahe.apply(roi)
        blurred = cv2.GaussianBlur(enhanced_roi, (5, 5), 0)
        edges = auto_canny(blurred)
        
        # Connect broken edges to strengthen detection
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

        # 2. Corridor Grid Analysis (2x3 grid)
        rh, rw = edges.shape
        half_h = rh // 2
        third_w = rw // 3

        # Grid slices
        top_left = edges[0:half_h, 0:third_w]
        top_center = edges[0:half_h, third_w:2 * third_w]
        top_right = edges[0:half_h, 2 * third_w:rw]

        bot_left = edges[half_h:rh, 0:third_w]
        bot_center = edges[half_h:rh, third_w:2 * third_w]
        bot_right = edges[half_h:rh, 2 * third_w:rw]

        def get_density(region):
            return cv2.countNonZero(region) / region.size if region.size > 0 else 0.0

        tl_d, tc_d, tr_d = get_density(top_left), get_density(top_center), get_density(top_right)
        bl_d, bc_d, br_d = get_density(bot_left), get_density(bot_center), get_density(bot_right)

        # Spatial weighting: bottom cells (closer obstacles) weighted higher
        W_TOP = 0.4
        W_BOT = 1.0

        left_density = (tl_d * W_TOP + bl_d * W_BOT) / (W_TOP + W_BOT)
        center_density = (tc_d * W_TOP + bc_d * W_BOT) / (W_TOP + W_BOT)
        right_density = (tr_d * W_TOP + br_d * W_BOT) / (W_TOP + W_BOT)

        # For stats reporting
        left_count = cv2.countNonZero(edges[:, 0:third_w])
        center_count = cv2.countNonZero(edges[:, third_w:2 * third_w])
        right_count = cv2.countNonZero(edges[:, 2 * third_w:rw])

        self.center_density_history.append(center_density)
        smoothed_center_density = float(np.mean(self.center_density_history))

        raw_obstacle = self.obstacle_latch.update(smoothed_center_density)
        confirmed_obstacle = self.obs_confirmer.update(raw_obstacle)

        if confirmed_obstacle:
            # Only switch direction if one side is meaningfully clearer than the other,
            # otherwise keep the last recommended direction to avoid oscillation.
            lo = min(left_density, right_density) + 1e-6
            hi = max(left_density, right_density)
            if hi / lo >= DIRECTION_MARGIN_RATIO:
                direction = "LEFT" if left_density < right_density else "RIGHT"
            else:
                direction = self.last_direction if self.last_direction in ("LEFT", "RIGHT") else \
                    ("LEFT" if left_density < right_density else "RIGHT")
            self.last_direction = direction
        else:
            direction = "CENTER"
            self.last_direction = "CENTER"

        stats = {
            "left_density": left_density,
            "center_density": center_density,
            "right_density": right_density,
            "smoothed_center_density": smoothed_center_density,
            "left_count": left_count,
            "center_count": center_count,
            "right_count": right_count,
        }

        return confirmed_obstacle, direction, stats


def build_message(vis_status, obstacle_present, direction):
    obstacle_status = "POOR" if obstacle_present else "CLEAR"
    return f"S:{obstacle_status},V:{vis_status},DIR:{direction}\n"


def main():
    ser = None
    if not DEBUG_MODE:
        print("[vision_node] opening serial port...")
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    else:
        print("[vision_node] DEBUG_MODE on - no serial writes, stats only.")

    print("[vision_node] initializing camera...")
    picam2 = Picamera2()
    config = picam2.create_video_configuration(
        main={"size": (FRAME_W, FRAME_H), "format": "RGB888"},
        controls={"FrameRate": FRAMERATE},
    )
    picam2.configure(config)
    picam2.start()
    time.sleep(2)

    analyzer = VisionAnalyzer()
    print("[vision_node] running. Ctrl+C to stop.")

    last_send = 0

    try:
        while True:
            image = picam2.capture_array()
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

            vis_status, smoothed_std = analyzer.analyze_visibility(gray)
            obstacle_present, direction, stats = analyzer.analyze_obstacles(gray)

            now = time.time()
            if now - last_send >= SEND_INTERVAL:
                msg = build_message(vis_status, obstacle_present, direction)
                if not DEBUG_MODE:
                    ser.write(msg.encode("utf-8"))
                last_send = now

                if SHOW_PREVIEW_STATS or DEBUG_MODE:
                    print(
                        f"[{'DBG' if DEBUG_MODE else 'TX '}] {msg.strip()}  "
                        f"std={smoothed_std:.1f}  "
                        f"density L/C/R={stats['left_density']:.3f}/"
                        f"{stats['center_density']:.3f}/{stats['right_density']:.3f}  "
                        f"(smoothed_center={stats['smoothed_center_density']:.3f})"
                    )
            else:
                time.sleep(0.02)

    except KeyboardInterrupt:
        print("\n[vision_node] stopping...")
    finally:
        if ser:
            ser.close()
        picam2.stop()


if __name__ == "__main__":
    main()