import * as Logger from './logger.js';
/**
 * Animations Manager
 * 
 * Provides smooth animations for window movements and resizing.
 * Uses Clutter Actor ease() API for hardware-accelerated animations.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as constants from './constants.js';

// Animation configuration
const ANIMATION_DURATION = constants.ANIMATION_DURATION_MS;
const ANIMATION_MODE = Clutter.AnimationMode.EASE_OUT_BACK; // Momentum for re-tiling
const ANIMATION_MODE_MOMENTUM = Clutter.AnimationMode.EASE_OUT_BACK; // Momentum for open/close
const ANIMATION_MODE_SUBTLE = Clutter.AnimationMode.EASE_OUT_QUAD; // Subtle for edge tiling

export class AnimationsManager {
    constructor() {
        this._isDragging = false; // Track if user is dragging a window
        this._animatingWindows = new Set(); // Track windows currently being animated
        this._initialWindowPositions = new Map(); // Track initial positions for new windows
        this._justEndedDrag = false; // Track if we just ended a drag (for smooth drop animation)
        this._resizingWindowId = null; // Track window being resized
    }

    /**
     * Set which window is currently being resized
     */
    setResizingWindow(windowId) {
        this._resizingWindowId = windowId;
    }

    /**
     * Get the ID of window currently being resized
     */
    getResizingWindowId() {
        return this._resizingWindowId;
    }

    /**
     * Set dragging state
     * Animations are disabled for the dragged window itself during drag
     */
    setDragging(dragging) {
        // If ending drag, set flag for smooth drop animation
        if (this._isDragging && !dragging) {
            this._justEndedDrag = true;
            // Clear flag after a short delay (enough for one animation)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, constants.DEBOUNCE_DELAY_MS, () => {
                this._justEndedDrag = false;
                return GLib.SOURCE_REMOVE;
            });
        }
        this._isDragging = dragging;
    }

    /**
     * Save initial position of a newly added window
     */
    saveInitialPosition(window) {
        const windowId = window.get_id();
        const rect = window.get_frame_rect();
        this._initialWindowPositions.set(windowId, {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        });
    }

    /**
     * Get and clear initial position for a window
     */
    getAndClearInitialPosition(window) {
        const windowId = window.get_id();
        const pos = this._initialWindowPositions.get(windowId);
        if (pos) {
            this._initialWindowPositions.delete(windowId);
        }
        return pos;
    }

    /**
     * Check if animations are allowed
     */
    isAnimationAllowed() {
        // Always allow animations for other windows, just not the dragged one
        return true;
    }

    /**
     * Check if a specific window should be animated
     */
    shouldAnimateWindow(window, draggedWindow = null) {
        // Don't animate the window being dragged
        if (draggedWindow && window.get_id() === draggedWindow.get_id()) {
            return false;
        }
        
        // Don't animate if window is already being animated (prevent conflicts)
        if (this._animatingWindows.has(window.get_id())) {
            return false;
        }
        
        // Don't animate manually resized windows
        if (this._resizingWindowId === window.get_id()) {
            return false;
        }
        
        return true;
    }

    /**
     * Animate a window to a target position and size
     */
    animateWindow(window, targetRect, options = {}) {
        const {
            duration = ANIMATION_DURATION,
            mode = null,
            onComplete = null,
            draggedWindow = null,
            subtle = false
        } = options;
        
        // Check if we should animate this window
        if (!this.shouldAnimateWindow(window, draggedWindow)) {
            // Apply position immediately without animation
            window.move_resize_frame(false, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
            if (onComplete) onComplete();
            return;
        }
        
        const windowActor = window.get_compositor_private();
        if (!windowActor) {
            Logger.log(`[MOSAIC WM] No actor for window ${window.get_id()}, skipping animation`);
            window.move_resize_frame(false, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
            if (onComplete) onComplete();
            return;
        }
        
        // Mark window as animating
        const windowId = window.get_id();
        this._animatingWindows.add(windowId);
        
        // Get current frame rect for animation
        const currentRect = window.get_frame_rect();
        
        // Choose animation mode based on context
        let animationMode;
        if (mode !== null) {
            animationMode = mode;
        } else if (subtle) {
            animationMode = ANIMATION_MODE_SUBTLE;
        } else if (this._justEndedDrag) {
            animationMode = ANIMATION_MODE_SUBTLE;
        } else {
            animationMode = ANIMATION_MODE;
        }
        
        // Calculate scale and translation for smooth animation
        const scaleX = currentRect.width / targetRect.width;
        const scaleY = currentRect.height / targetRect.height;
        const translateX = currentRect.x - targetRect.x;
        const translateY = currentRect.y - targetRect.y;
        
        const hasValidDimensions = currentRect.width > 0 && currentRect.height > 0 && 
                                    targetRect.width > 0 && targetRect.height > 0 &&
                                    !isNaN(scaleX) && !isNaN(scaleY);
        
        if (!hasValidDimensions) {
            window.move_resize_frame(false, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
            windowActor.set_translation(translateX, translateY, 0);
            windowActor.ease({
                translation_x: 0,
                translation_y: 0,
                duration: duration,
                mode: animationMode,
                onComplete: () => {
                    windowActor.set_translation(0, 0, 0);
                    this._animatingWindows.delete(windowId);
                    if (onComplete) onComplete();
                }
            });
            return;
        }
        
        window.move_resize_frame(false, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
        
        windowActor.set_pivot_point(0, 0);
        windowActor.set_scale(scaleX, scaleY);
        windowActor.set_translation(translateX, translateY, 0);
        
        const safetyTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration + constants.SAFETY_TIMEOUT_BUFFER_MS, () => {
            if (this._animatingWindows.has(windowId)) {
                this._animatingWindows.delete(windowId);
                try {
                    windowActor.set_scale(1.0, 1.0);
                    windowActor.set_translation(0, 0, 0);
                } catch (e) {
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        
        windowActor.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            translation_x: 0,
            translation_y: 0,
            duration: duration,
            mode: animationMode,
            onComplete: () => {
                GLib.source_remove(safetyTimeout);
                windowActor.set_scale(1.0, 1.0);
                windowActor.set_translation(0, 0, 0);
                this._animatingWindows.delete(windowId);
                if (onComplete) onComplete();
            }
        });
    }

    /**
     * Animate window opening
     */
    animateWindowOpen(window, targetRect) {
        const windowActor = window.get_compositor_private();
        if (!windowActor) {
            window.move_resize_frame(false, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
            return;
        }
        
        const windowId = window.get_id();
        this._animatingWindows.add(windowId);
        
        window.move_resize_frame(false, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
        
        windowActor.set_pivot_point(0.5, 0.5);
        windowActor.set_scale(0.9, 0.9);
        windowActor.set_opacity(0);
        
        windowActor.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            opacity: 255,
            duration: ANIMATION_DURATION,
            mode: ANIMATION_MODE,
            onComplete: () => {
                windowActor.set_scale(1.0, 1.0);
                windowActor.set_opacity(255);
                this._animatingWindows.delete(windowId);
            }
        });
    }

    /**
     * Animate window closing
     */
    animateWindowClose(window, onComplete) {
        const windowActor = window.get_compositor_private();
        if (!windowActor) {
            if (onComplete) onComplete();
            return;
        }
        
        const windowId = window.get_id();
        this._animatingWindows.add(windowId);
        
        windowActor.set_pivot_point(0.5, 0.5);
        
        windowActor.ease({
            scale_x: 0.9,
            scale_y: 0.9,
            opacity: 0,
            duration: ANIMATION_DURATION,
            mode: ANIMATION_MODE,
            onComplete: () => {
                this._animatingWindows.delete(windowId);
                if (onComplete) onComplete();
            }
        });
    }

    /**
     * Animate a window moving from point A to point B
     */
    animateWindowMove(window, fromRect, toRect, options = {}) {
        const {
            duration = ANIMATION_DURATION,
            mode = ANIMATION_MODE_MOMENTUM,
            onComplete = null
        } = options;
        
        const windowActor = window.get_compositor_private();
        if (!windowActor) {
            if (onComplete) onComplete();
            return;
        }
        
        const windowId = window.get_id();
        this._animatingWindows.add(windowId);
        
        const translateX = fromRect.x - toRect.x;
        const translateY = fromRect.y - toRect.y;
        
        windowActor.set_pivot_point(0, 0);
        windowActor.set_translation(translateX, translateY, 0);
        
        windowActor.ease({
            translation_x: 0,
            translation_y: 0,
            duration: duration,
            mode: mode,
            onComplete: () => {
                windowActor.set_translation(0, 0, 0);
                this._animatingWindows.delete(windowId);
                if (onComplete) onComplete();
            }
        });
    }

    /**
     * Animate multiple windows to new layout
     */
    animateReTiling(windowLayouts, draggedWindow = null) {
        if (windowLayouts.length === 1) {
            const { window, rect } = windowLayouts[0];
            const currentRect = window.get_frame_rect();
            
            const needsMove = Math.abs(currentRect.x - rect.x) > constants.ANIMATION_DIFF_THRESHOLD || 
                             Math.abs(currentRect.y - rect.y) > constants.ANIMATION_DIFF_THRESHOLD ||
                             Math.abs(currentRect.width - rect.width) > constants.ANIMATION_DIFF_THRESHOLD ||
                             Math.abs(currentRect.height - rect.height) > constants.ANIMATION_DIFF_THRESHOLD;
            
            if (!needsMove) {
                window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
                return;
            }
        }
        
        for (const {window, rect} of windowLayouts) {
            this.animateWindow(window, rect, { draggedWindow });
        }
    }

    /**
     * Cleanup function
     */
    cleanup() {
        this._animatingWindows.clear();
        this._isDragging = false;
    }

    destroy() {
        this.cleanup();
    }

    /**
     * Cleanup and destroy manager
     */
    destroy() {
        this.cleanup();
    }
}
