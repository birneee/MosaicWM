/**
 * Logger module for Mosaic WM
 * 
 * Controls debug logging based on DEBUG flag.
 * Set DEBUG = false for production/release to comply with extensions.gnome.org guidelines.
 */

const DEBUG = true; // Set to true during development, false for release

/**
 * Logs a debug message if DEBUG is enabled
 * @param {...any} args Arguments to log
 */
export function log(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

/**
 * Logs an informational message (always shown, even with DEBUG=false)
 * Use for critical lifecycle events like enable/disable
 * @param {...any} args Arguments to log
 */
export function info(...args) {
    console.log(...args);
}

/**
 * Logs an error message (always shown, even with DEBUG=false)
 * @param {...any} args Arguments to log
 */
export function error(...args) {
    console.error(...args);
}

/**
 * Logs a warning message (always shown, even with DEBUG=false)
 * @param {...any} args Arguments to log
 */
export function warn(...args) {
    console.warn(...args);
}
