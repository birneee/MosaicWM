import * as Logger from './logger.js';
/**
 * Reordering Manager
 * 
 * Handles manual window reordering via drag-and-drop.
 */

import GLib from 'gi://GLib';
import * as constants from './constants.js';
import { TileZone } from './edgeTiling.js';

export class ReorderingManager {
    constructor() {
        this.dragStart = false;
        this._dragTimeout = 0;
        this._dragSafetyTimeout = 0; // Safety timeout to prevent infinite drag loops
        
        this._tilingManager = null;
        this._edgeTilingManager = null;
        this._animationsManager = null;
        this._windowingManager = null;
    }

    setTilingManager(manager) {
        this._tilingManager = manager;
    }

    setEdgeTilingManager(manager) {
        this._edgeTilingManager = manager;
    }

    setAnimationsManager(manager) {
        this._animationsManager = manager;
    }

    setWindowingManager(manager) {
        this._windowingManager = manager;
    }

    /**
     * Calculates the distance from the cursor to the center of a window frame.
     * @private
     */
    _cursorDistance(cursor, frame) {
        let x = cursor.x - (frame.x + frame.width / 2);
        let y = cursor.y - (frame.y + frame.height / 2);
        return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
    }

    /**
     * Main drag loop function.
     * @private
     */
    _drag(meta_window, child_frame, id, windows) {
        if (!this._tilingManager) return;
        
        let workspace = meta_window.get_workspace();
        let monitor = meta_window.get_monitor();
        let workArea = workspace.get_work_area_for_monitor(monitor);

        // Get current cursor position
        let _cursor = global.get_pointer();
        let cursor = {
            x: _cursor[0],
            y: _cursor[1]
        }
        
        // EDGE TILING AWARENESS
        let edgeTiledWindows = [];
        if (this._edgeTilingManager) {
            edgeTiledWindows = this._edgeTilingManager.getEdgeTiledWindows(workspace, monitor);
        }
        const edgeTiledIds = edgeTiledWindows.map(s => s.window.get_id());
        
        // Filter windows to only non-edge-tiled ones for reordering
        const reorderableWindows = windows.filter(w => !edgeTiledIds.includes(w.id));
        
        // If dragged window is edge-tiled, don't allow it to be reordered
        if (edgeTiledIds.includes(id)) {
            if(this.dragStart) {
                this._dragTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, constants.DRAG_UPDATE_INTERVAL_MS, () => {
                    this._drag(meta_window, child_frame, id, windows);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }

        // Find the window closest to the cursor
        let minimum_distance = Infinity;
        let target_id = null;
        for(let window of reorderableWindows) {
            let distance = this._cursorDistance(cursor, window);
            if(distance < minimum_distance)
            {
                minimum_distance = distance;
                target_id = window.id;
            }
        }

        // Set up temporary swap
        if(target_id === id || target_id === null) {
            this._tilingManager.clearTmpSwap();
            Logger.log('[MOSAIC WM] Drag: No swap (cursor not over another window)');
        } else {
            this._tilingManager.setTmpSwap(id, target_id);
            Logger.log(`[MOSAIC WM] Drag: Setting swap ${id} <-> ${target_id}`);
        }

        // Check if cursor is over an edge tiling zone
        let isOverEdgeZone = false;
        if (this._edgeTilingManager) {
            const zone = this._edgeTilingManager.detectZone(cursor.x, cursor.y, workArea, workspace);
            isOverEdgeZone = zone !== TileZone.NONE;
        }
        
        const windowToExclude = isOverEdgeZone ? meta_window : null;
        
        // Re-tile with temporary swap
        // tileWorkspaceWindows returns overflow boolean, but original code checked it in if statement?
        // Original: if(tiling.tileWorkspaceWindows(...)) { clear; tile... }
        // Wait, original:
        // if(tiling.tileWorkspaceWindows(workspace, windowToExclude, monitor)) {
        //     tiling.clearTmpSwap();
        //     tiling.tileWorkspaceWindows(workspace, windowToExclude, monitor)
        // }
        // This implies if overflow (true), it clears swap and retiles.
        
        const overflow = this._tilingManager.tileWorkspaceWindows(workspace, windowToExclude, monitor);
        
        if(overflow) {
             this._tilingManager.clearTmpSwap();
             this._tilingManager.tileWorkspaceWindows(workspace, windowToExclude, monitor);
        }

        // Continue drag loop
        if(this.dragStart) {
            this._dragTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, constants.DRAG_UPDATE_INTERVAL_MS, () => {
                this._drag(meta_window, child_frame, id, windows);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Starts a drag operation for a window.
     */
    startDrag(meta_window) {
        if (!this._tilingManager) return;
        
        Logger.log(`[MOSAIC WM] startDrag called for window ${meta_window.get_id()}`);
        let workspace = meta_window.get_workspace()
        let monitor = meta_window.get_monitor();
        let meta_windows = this._windowingManager.getMonitorWorkspaceWindows(workspace, monitor);
        
        if (this._animationsManager) {
            this._animationsManager.setDragging(true);
        }
        
        // EDGE TILING AWARENESS
        let edgeTiledWindows = [];
        if (this._edgeTilingManager) {
            edgeTiledWindows = this._edgeTilingManager.getEdgeTiledWindows(workspace, monitor);
        }
        const edgeTiledIds = edgeTiledWindows.map(s => s.window.get_id());
        
        const nonEdgeTiledMetaWindows = meta_windows.filter(w => !edgeTiledIds.includes(w.get_id()));
        Logger.log(`[MOSAIC WM] startDrag: Total windows: ${meta_windows.length}, Edge-tiled: ${edgeTiledWindows.length}, Non-edge-tiled: ${nonEdgeTiledMetaWindows.length}`);
        
        // Apply swaps to non-edge-tiled
        this._tilingManager.applySwaps(workspace, nonEdgeTiledMetaWindows);
        
        // Create descriptors
        let descriptors = this._tilingManager.windowsToDescriptors(nonEdgeTiledMetaWindows, monitor);
        
        // Calculate remaining space
        let remainingSpace = null;
        if (edgeTiledWindows.length > 0 && this._edgeTilingManager) {
            remainingSpace = this._edgeTilingManager.calculateRemainingSpace(workspace, monitor);
            Logger.log(`[MOSAIC WM] startDrag: Remaining space for drag: x=${remainingSpace.x}, y=${remainingSpace.y}, w=${remainingSpace.width}, h=${remainingSpace.height}`);
        }

        this._tilingManager.createMask(meta_window);
        this._tilingManager.clearTmpSwap();
        
        this._tilingManager.enableDragMode(remainingSpace);

        this.dragStart = true;
        // Deep copy descriptors to avoid mutation issues during drag loop if any
        const descriptorsCopy = JSON.parse(JSON.stringify(descriptors));
        
        // Safety timeout: Force stop drag after 10 seconds to prevent infinite loops
        if (this._dragSafetyTimeout) {
            GLib.source_remove(this._dragSafetyTimeout);
            this._dragSafetyTimeout = 0;
        }
        this._dragSafetyTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            if (this.dragStart) {
                Logger.error(`[MOSAIC WM] SAFETY: Force-stopping drag loop after 10 seconds`);
                this.stopDrag(meta_window, true, false);
            }
            this._dragSafetyTimeout = 0;
            return GLib.SOURCE_REMOVE;
        });
        
        this._drag(meta_window, meta_window.get_frame_rect(), meta_window.get_id(), descriptorsCopy);
    }

    /**
     * Stops a drag operation.
     */
    stopDrag(meta_window, skip_apply, skip_tiling) {
        if (!this._tilingManager) return;
        
        Logger.log(`[MOSAIC WM] stopDrag called for window ${meta_window.get_id()}, dragStart was: ${this.dragStart}`);
        let workspace = meta_window.get_workspace();
        this.dragStart = false;
        
        if (this._dragTimeout) {
            GLib.source_remove(this._dragTimeout);
            this._dragTimeout = 0;
        }
        
        // Clear safety timeout since drag ended normally
        if (this._dragSafetyTimeout) {
            GLib.source_remove(this._dragSafetyTimeout);
            this._dragSafetyTimeout = 0;
        }
        
        if (this._animationsManager) {
            this._animationsManager.setDragging(false);
        }
        
        this._tilingManager.disableDragMode();
        this._tilingManager.destroyMasks();
        
        if(!skip_apply)
            this._tilingManager.applyTmpSwap(workspace);
            
        this._tilingManager.clearTmpSwap();
        
        if (!skip_tiling) {
            this._tilingManager.tileWorkspaceWindows(workspace, null, meta_window.get_monitor());
        } else {
            Logger.log(`[MOSAIC WM] stopDrag: Skipping workspace tiling (requested)`);
        }
    }

    /**
     * Cleanup and destroy manager
     */
    destroy() {
        if (this._dragTimeout) {
            GLib.source_remove(this._dragTimeout);
            this._dragTimeout = 0;
        }
        if (this._dragSafetyTimeout) {
            GLib.source_remove(this._dragSafetyTimeout);
            this._dragSafetyTimeout = 0;
        }
        this.dragStart = false;
        this._tilingManager = null;
        this._edgeTilingManager = null;
        this._animationsManager = null;
    }
}