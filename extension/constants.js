import * as Logger from './logger.js';
/**
 * Constants Module
 * 
 * This module defines configuration constants used throughout the extension.
 * All constants use UPPER_CASE naming convention as per JavaScript best practices.
 */

/**
 * Spacing between windows in the tiling layout (in pixels).
 * This creates visual separation between tiled windows.
 */
export const WINDOW_SPACING = 8;

/**
 * Interval for periodic re-tiling of all workspaces (in milliseconds).
 * This helps recover from display sleep or other edge cases.
 * Default: 5 minutes (300,000 ms)
 */
export const TILE_INTERVAL_MS = 60000 * 5;

/**
 * Delay before checking window validity during window creation (in milliseconds).
 * This gives the window time to fully initialize before tiling.
 */
export const WINDOW_VALIDITY_CHECK_INTERVAL_MS = 10;

/**
 * Delay for drag update loop (in milliseconds).
 * Controls how frequently the drag position is updated during window reordering.
 */
export const DRAG_UPDATE_INTERVAL_MS = 50;

/**
 * Initial delay before tiling all workspaces at startup (in milliseconds).
 * Allows GNOME Shell to fully initialize before the extension starts tiling.
 */
export const STARTUP_TILE_DELAY_MS = 300;

/**
 * Duration for window animations (in milliseconds).
 * Used for smooth transitions when windows move or resize.
 */
export const ANIMATION_DURATION_MS = 350;

/**
 * Duration for window open/close animations (in milliseconds).
 * Separate from general animations to allow independent tuning.
 */
export const ANIMATION_OPEN_CLOSE_DURATION_MS = 350;

/**
 * Minimum window dimensions for tiling consideration.
 */
export const MIN_WINDOW_WIDTH = 400;
export const MIN_WINDOW_HEIGHT = 100;
export const ABSOLUTE_MIN_HEIGHT = 200;

/**
 * Thresholds for edge tiling detection (pixels from screen edge).
 */
export const EDGE_TILING_THRESHOLD = 10;

/**
 * Timing constants for polling and delays.
 */
export const POLL_INTERVAL_MS = 50;
export const DEBOUNCE_DELAY_MS = 500;
export const RETILE_DELAY_MS = 100;
export const GEOMETRY_CHECK_DELAY_MS = 10;
export const SAFETY_TIMEOUT_BUFFER_MS = 100;

/**
 * Threshold for identifying significant changes in window geometry for animations.
 */
export const ANIMATION_DIFF_THRESHOLD = 10;

/**
 * Grab Operation IDs (Legacy replacements/Helpers if Meta doesn't expose them cleanly)
 * These match common Meta.GrabOp values for resizing.
 */
export const GRAB_OP_RESIZING_NW = 4097;  // Top-Left
export const GRAB_OP_RESIZING_N  = 8193;  // Top
export const GRAB_OP_RESIZING_NE = 20481; // Top-Right
export const GRAB_OP_RESIZING_W  = 32769; // Left
export const GRAB_OP_RESIZING_E  = 16385; // Right
export const GRAB_OP_RESIZING_SW = 40961; // Bottom-Left
export const GRAB_OP_RESIZING_S  = 61441; // Bottom (Guessing/Example) - wait, let's just list the ones we use
// The ones used in code: 4097, 8193, 20481, 32769, 16385, 40961
export const RESIZE_GRAB_OPS = [4097, 8193, 20481, 32769, 16385, 40961];

export const GRAB_OP_MOVING = 1;
export const GRAB_OP_KEYBOARD_MOVING = 1025;
