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
