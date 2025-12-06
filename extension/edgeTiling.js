import * as Logger from './logger.js';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as animations from './animations.js';
import * as constants from './constants.js';

/**
 * Edge Tiling Zones
 * 
 * 6-zone system:
 * - Left/Right Full: 50% width, 100% height
 * - Corners: 50% width, 50% height (TL, TR, BL, BR)
 */
export const TileZone = {
    NONE: 0,
    LEFT_FULL: 1,
    RIGHT_FULL: 2,
    TOP_LEFT: 3,
    TOP_RIGHT: 4,
    BOTTOM_LEFT: 5,
    BOTTOM_RIGHT: 6,
    FULLSCREEN: 7
};

export class EdgeTilingManager {
    constructor() {
        // Module state for window states (pre-tile position/size)
        this._windowStates = new Map(); // windowId -> { x, y, width, height, zone }

        // Module state for edge tiling activity
        this._isEdgeTilingActive = false;
        this._activeEdgeTilingWindow = null;

        // Module state for interactive resize
        this._resizeListeners = new Map(); // windowId -> signalId
        this._isResizing = false; // Flag to prevent recursive resize
        this._previousSizes = new Map(); // windowId -> { width, height } for delta tracking

        // Module state for auto-tiling dependencies
        // Maps: dependentWindowId -> masterWindowId
        this._autoTiledDependencies = new Map();
        
        this._animationsManager = null;
    }
    
    setAnimationsManager(manager) {
        this._animationsManager = manager;
    }

    /**
     * Check if edge tiling is currently active (during drag)
     * @returns {boolean}
     */
    isEdgeTilingActive() {
        return this._isEdgeTilingActive;
    }

    /**
     * Get the window currently being edge-tiled
     * @returns {Meta.Window|null}
     */
    getActiveEdgeTilingWindow() {
        return this._activeEdgeTilingWindow;
    }

    /**
     * Set edge tiling active state
     * @param {boolean} active
     * @param {Meta.Window|null} window
     */
    setEdgeTilingActive(active, window = null) {
        Logger.log(`[MOSAIC WM] Edge tiling state: ${this._isEdgeTilingActive} -> ${active}, window: ${window ? window.get_id() : 'null'}`);
        this._isEdgeTilingActive = active;
        this._activeEdgeTilingWindow = window;
    }

    /**
     * Clear all window states (cleanup)
     */
    clearAllStates() {
        // Remove all listeners first
        this._resizeListeners.forEach((signalId, winId) => {
            const window = this._findWindowById(winId);
            if (window) {
                try {
                    window.disconnect(signalId);
                } catch (e) {
                    // Ignore if window destroyed
                }
            }
        });
        this._resizeListeners.clear();
        this._windowStates.clear();
        this._autoTiledDependencies.clear();
        this._previousSizes.clear();
        this._isResizing = false;
        this._isEdgeTilingActive = false;
        this._activeEdgeTilingWindow = null;
    }

    /**
     * Cleanup and destroy manager
     */
    destroy() {
        this.clearAllStates();
        this._animationsManager = null;
    }

    /**
     * Check if there are edge-tiled windows on a specific side
     * @private
     * @param {Meta.Workspace} workspace
     * @param {string} side - 'left' or 'right'
     * @returns {boolean}
     */
    _hasEdgeTiledWindows(workspace, side) {
        if (!workspace) return false;
        
        const windows = workspace.list_windows();
        for (const win of windows) {
            const state = this._windowStates.get(win.get_id());
            if (!state || state.zone === TileZone.NONE || state.zone === TileZone.FULLSCREEN) continue;
            
            if (side === 'left') {
                if (state.zone === TileZone.LEFT_FULL || 
                    state.zone === TileZone.TOP_LEFT || 
                    state.zone === TileZone.BOTTOM_LEFT) {
                    return true;
                }
            } else if (side === 'right') {
                if (state.zone === TileZone.RIGHT_FULL || 
                    state.zone === TileZone.TOP_RIGHT || 
                    state.zone === TileZone.BOTTOM_RIGHT) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Detect which edge tiling zone the cursor is in
     * @param {number} cursorX
     * @param {number} cursorY
     * @param {Object} workArea
     * @param {Meta.Workspace} workspace
     * @returns {number} TileZone enum value
     */
    detectZone(cursorX, cursorY, workArea, workspace) {
        const threshold = constants.EDGE_TILING_THRESHOLD;
        const thirdY = workArea.height / 3;
        
        if (cursorY < workArea.y + threshold) return TileZone.FULLSCREEN;
        
        if (cursorX < workArea.x + threshold) {
            const hasLeftWindows = this._hasEdgeTiledWindows(workspace, 'left');
            
            if (!hasLeftWindows) return TileZone.LEFT_FULL;
            
            const relY = cursorY - workArea.y;
            if (relY < thirdY) return TileZone.TOP_LEFT;
            if (relY > workArea.height - thirdY) return TileZone.BOTTOM_LEFT;
            return TileZone.LEFT_FULL;
        }
        
        if (cursorX > workArea.x + workArea.width - threshold) {
            const hasRightWindows = this._hasEdgeTiledWindows(workspace, 'right');
            
            if (!hasRightWindows) return TileZone.RIGHT_FULL;
            
            const relY = cursorY - workArea.y;
            if (relY < thirdY) return TileZone.TOP_RIGHT;
            if (relY > workArea.height - thirdY) return TileZone.BOTTOM_RIGHT;
            return TileZone.RIGHT_FULL;
        }
        return TileZone.NONE;
    }

    /**
     * Get width of existing tile on the same side
     * @private
     */
    _getExistingSideWidth(workspace, monitor, side) {
        if (!workspace || monitor === undefined) return null;
        
        const workspaceWindows = workspace.list_windows().filter(w => 
            w.get_monitor() === monitor &&
            !w.is_hidden() &&
            w.get_window_type() === Meta.WindowType.NORMAL
        );
        
        let existing = null;
        for (const w of workspaceWindows) {
            const state = this.getWindowState(w);
            if (!state || !state.zone) continue;
            
            if (side === 'LEFT' && (
                state.zone === TileZone.LEFT_FULL ||
                state.zone === TileZone.TOP_LEFT ||
                state.zone === TileZone.BOTTOM_LEFT
            )) {
                existing = w;
                break;
            } else if (side === 'RIGHT' && (
                state.zone === TileZone.RIGHT_FULL ||
                state.zone === TileZone.TOP_RIGHT ||
                state.zone === TileZone.BOTTOM_RIGHT
            )) {
                existing = w;
                break;
            }
        }
        
        if (existing) {
            const frame = existing.get_frame_rect();
            return frame.width;
        }
        return null;
    }

    /**
     * Get height of existing quarter tile window
     * @private
     */
    _getExistingQuarterHeight(workspace, monitor, zone) {
        if (!workspace || monitor === undefined) return null;
        
        const workspaceWindows = workspace.list_windows().filter(w => 
            w.get_monitor() === monitor &&
            !w.is_hidden() &&
            w.get_window_type() === Meta.WindowType.NORMAL
        );
        
        const existing = workspaceWindows.find(w => {
            const state = this.getWindowState(w);
            return state && state.zone === zone;
        });
        
        if (existing) {
            const frame = existing.get_frame_rect();
            return frame.height;
        }
        return null;
    }

    /**
     * Get rectangle for a tile zone
     * @param {number} zone
     * @param {Object} workArea
     * @param {Meta.Window} [windowToTile]
     * @returns {Object|null}
     */
    getZoneRect(zone, workArea, windowToTile = null) {
        if (!workArea) return null;
        
        let existingWidth = null;
        
        if (windowToTile) {
            const workspace = windowToTile.get_workspace();
            const monitor = windowToTile.get_monitor();
            const workspaceWindows = workspace.list_windows().filter(w => 
                w.get_monitor() === monitor && 
                w.get_id() !== windowToTile.get_id() &&
                !w.is_hidden() &&
                w.get_window_type() === Meta.WindowType.NORMAL
            );
            
            let oppositeZone = null;
            if (zone === TileZone.LEFT_FULL) oppositeZone = TileZone.RIGHT_FULL;
            else if (zone === TileZone.RIGHT_FULL) oppositeZone = TileZone.LEFT_FULL;
            
            if (oppositeZone) {
                const existingWindow = workspaceWindows.find(w => {
                    const state = this.getWindowState(w);
                    return state && state.zone === oppositeZone;
                });
                
                if (existingWindow) {
                    const frame = existingWindow.get_frame_rect();
                    existingWidth = frame.width;
                    Logger.log(`[MOSAIC WM] getZoneRect: Found existing tiled window with width ${existingWidth}px`);
                }
            }
        }
        
        const halfWidth = Math.floor(workArea.width / 2);
        const halfHeight = Math.floor(workArea.height / 2);
        
        const workspace = windowToTile?.get_workspace();
        const monitor = windowToTile?.get_monitor();

        switch(zone) {
            case TileZone.LEFT_FULL:
                return {
                    x: workArea.x,
                    y: workArea.y,
                    width: existingWidth ? (workArea.width - existingWidth) : halfWidth,
                    height: workArea.height
                };
                
            case TileZone.RIGHT_FULL:
                return {
                    x: existingWidth ? (workArea.x + existingWidth) : (workArea.x + halfWidth),
                    y: workArea.y,
                    width: existingWidth ? (workArea.width - existingWidth) : (workArea.width - halfWidth),
                    height: workArea.height
                };
                
            case TileZone.TOP_LEFT: {
                const leftWidth = this._getExistingSideWidth(workspace, monitor, 'LEFT') || halfWidth;
                const bottomHeight = this._getExistingQuarterHeight(workspace, monitor, TileZone.BOTTOM_LEFT);
                return { 
                    x: workArea.x, 
                    y: workArea.y, 
                    width: leftWidth, 
                    height: bottomHeight ? (workArea.height - bottomHeight) : halfHeight 
                };
            }
                
            case TileZone.TOP_RIGHT: {
                const rightWidth = this._getExistingSideWidth(workspace, monitor, 'RIGHT') || halfWidth;
                const bottomHeight = this._getExistingQuarterHeight(workspace, monitor, TileZone.BOTTOM_RIGHT);
                return { 
                    x: workArea.x + workArea.width - rightWidth, 
                    y: workArea.y, 
                    width: rightWidth, 
                    height: bottomHeight ? (workArea.height - bottomHeight) : halfHeight 
                };
            }
                
            case TileZone.BOTTOM_LEFT: {
                const leftWidth = this._getExistingSideWidth(workspace, monitor, 'LEFT') || halfWidth;
                const topHeight = this._getExistingQuarterHeight(workspace, monitor, TileZone.TOP_LEFT);
                return { 
                    x: workArea.x, 
                    y: topHeight ? (workArea.y + topHeight) : (workArea.y + halfHeight), 
                    width: leftWidth, 
                    height: topHeight ? (workArea.height - topHeight) : (workArea.height - halfHeight) 
                };
            }
                
            case TileZone.BOTTOM_RIGHT: {
                const rightWidth = this._getExistingSideWidth(workspace, monitor, 'RIGHT') || halfWidth;
                const topHeight = this._getExistingQuarterHeight(workspace, monitor, TileZone.TOP_RIGHT);
                return { 
                    x: workArea.x + workArea.width - rightWidth, 
                    y: topHeight ? (workArea.y + topHeight) : (workArea.y + halfHeight), 
                    width: rightWidth, 
                    height: topHeight ? (workArea.height - topHeight) : (workArea.height - halfHeight) 
                };
            }
                
            case TileZone.FULLSCREEN:
                return { 
                    x: workArea.x, 
                    y: workArea.y, 
                    width: workArea.width, 
                    height: workArea.height 
                };
            default:
                return null;
        }
    }


    /**
     * Save window's current state before tiling
     * @param {Meta.Window} window
     */
    saveWindowState(window) {
        const winId = window.get_id();
        const existingState = this._windowStates.get(winId);
        
        if (existingState) {
            Logger.log(`[MOSAIC WM] Window ${winId} already has saved state (${existingState.width}x${existingState.height}), preserving it`);
            return;
        }
        
        const frame = window.get_frame_rect();
        this._windowStates.set(winId, {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            zone: TileZone.NONE
        });
        Logger.log(`[MOSAIC WM] Saved window ${winId} PRE-TILING state: ${frame.width}x${frame.height}`);
    }

    /**
     * Get saved window state
     * @param {Meta.Window} window
     * @returns {Object|undefined} Saved state or undefined
     */
    getWindowState(window) {
        return this._windowStates.get(window.get_id());
    }

    /**
     * Get all edge-tiled windows in a workspace
     * @param {Meta.Workspace} workspace
     * @param {number} monitor
     * @returns {Array<{window: Meta.Window, zone: number}>}
     */
    getEdgeTiledWindows(workspace, monitor) {
        const windows = workspace.list_windows().filter(w => 
            w.get_monitor() === monitor && 
            !w.is_skip_taskbar() &&
            w.window_type === Meta.WindowType.NORMAL
        );
        
        return windows
            .map(w => ({window: w, state: this.getWindowState(w)}))
            .filter(({state}) => state && state.zone !== TileZone.NONE)
            .map(({window, state}) => ({window, zone: state.zone}));
    }

    /**
     * Get all non-edge-tiled windows in a workspace
     * @param {Meta.Workspace} workspace
     * @param {number} monitor
     * @returns {Array<Meta.Window>}
     */
    getNonEdgeTiledWindows(workspace, monitor) {
        const windows = workspace.list_windows().filter(w => 
            w.get_monitor() === monitor && 
            !w.is_skip_taskbar() &&
            w.window_type === Meta.WindowType.NORMAL
        );
        
        return windows.filter(w => {
            const state = this.getWindowState(w);
            return !state || state.zone === TileZone.NONE;
        });
    }

    /**
     * Get the window currently occupying a specific zone
     * @param {number} zone
     * @param {Meta.Workspace} workspace
     * @param {number} monitor
     * @returns {Meta.Window|null}
     */
    getWindowInZone(zone, workspace, monitor) {
        const edgeTiledWindows = this.getEdgeTiledWindows(workspace, monitor);
        
        for (const {window, zone: windowZone} of edgeTiledWindows) {
            if (windowZone === zone) {
                return window;
            }
        }
        return null;
    }

    /**
     * Calculate remaining workspace space after edge-tiled windows
     * @param {Meta.Workspace} workspace
     * @param {number} monitor
     * @returns {Object} Remaining space rectangle {x, y, width, height}
     */
    calculateRemainingSpace(workspace, monitor) {
        const workArea = workspace.get_work_area_for_monitor(monitor);
        const edgeTiledWindows = this.getEdgeTiledWindows(workspace, monitor);
        
        if (edgeTiledWindows.length === 0) return workArea;
        
        const hasLeftFull = edgeTiledWindows.some(w => w.zone === TileZone.LEFT_FULL);
        const hasLeftQuarters = edgeTiledWindows.some(w => 
            w.zone === TileZone.TOP_LEFT || w.zone === TileZone.BOTTOM_LEFT
        );
        
        const hasRightFull = edgeTiledWindows.some(w => w.zone === TileZone.RIGHT_FULL);
        const hasRightQuarters = edgeTiledWindows.some(w => 
            w.zone === TileZone.TOP_RIGHT || w.zone === TileZone.BOTTOM_RIGHT
        );
        
        const halfWidth = Math.floor(workArea.width / 2);
        
        if (hasLeftFull || hasLeftQuarters) {
            return {
                x: workArea.x + halfWidth,
                y: workArea.y,
                width: workArea.width - halfWidth,
                height: workArea.height
            };
        }
        
        if (hasRightFull || hasRightQuarters) {
            return {
                x: workArea.x,
                y: workArea.y,
                width: halfWidth,
                height: workArea.height
            };
        }
        
        return workArea;
    }

    /**
     * Calculate remaining workspace space for a specific zone (for preview)
     * @param {number} zone
     * @param {Object} workArea
     * @returns {Object}
     */
    calculateRemainingSpaceForZone(zone, workArea) {
        const halfWidth = Math.floor(workArea.width / 2);
        
        switch (zone) {
            case TileZone.LEFT_FULL:
            case TileZone.TOP_LEFT:
            case TileZone.BOTTOM_LEFT:
                return {
                    x: workArea.x + halfWidth,
                    y: workArea.y,
                    width: workArea.width - halfWidth,
                    height: workArea.height
                };
                
            case TileZone.RIGHT_FULL:
            case TileZone.TOP_RIGHT:
            case TileZone.BOTTOM_RIGHT:
                return {
                    x: workArea.x,
                    y: workArea.y,
                    width: halfWidth,
                    height: workArea.height
                };
                
            default:
                return workArea;
        }
    }

    /**
     * Clear saved window state
     * @param {Meta.Window} window
     */
    clearWindowState(window) {
        const winId = window.get_id();
        const state = this._windowStates.get(winId);
        
        // If this was a quarter tile, expand the adjacent quarter to FULL
        if (state && state.zone && this._isQuarterZone(state.zone)) {
            Logger.log(`[MOSAIC WM] Quarter tile ${winId} being removed from zone ${state.zone}`);
            
            const adjacentZone = this._getAdjacentQuarterZone(state.zone);
            if (adjacentZone) {
                const adjacentWindow = this._findWindowInZone(adjacentZone, window.get_workspace());
                
                if (adjacentWindow) {
                    Logger.log(`[MOSAIC WM] Found adjacent quarter ${adjacentWindow.get_id()} in zone ${adjacentZone}, expanding to FULL`);
                    
                    const fullZone = this._getFullZoneFromQuarter(state.zone);
                    const workspace = window.get_workspace();
                    const monitor = window.get_monitor();
                    const workArea = workspace.get_work_area_for_monitor(monitor);
                    const fullRect = this.getZoneRect(fullZone, workArea, adjacentWindow);
                    
                    if (fullRect) {
                        adjacentWindow.move_resize_frame(false, fullRect.x, fullRect.y, fullRect.width, fullRect.height);
                        
                        const adjacentState = this._windowStates.get(adjacentWindow.get_id());
                        if (adjacentState) adjacentState.zone = fullZone;
                        
                        Logger.log(`[MOSAIC WM] Expanded quarter to ${fullZone}: ${fullRect.width}x${fullRect.height}`);
                    }
                }
            }
        }
        
        // Clean up dependencies
        this._autoTiledDependencies.forEach((masterId, dependentId) => {
            if (masterId === winId || dependentId === winId) {
                this._autoTiledDependencies.delete(dependentId);
            }
        });
        
        this._windowStates.delete(winId);
    }

    /**
     * Register an auto-tile dependency
     * @param {number} dependentId
     * @param {number} masterId
     */
    registerAutoTileDependency(dependentId, masterId) {
        this._autoTiledDependencies.set(dependentId, masterId);
        Logger.log(`[MOSAIC WM] Registered auto-tile dependency: ${dependentId} depends on ${masterId}`);
    }

    /**
     * Check if window is currently edge-tiled
     * @param {Meta.Window} window
     * @returns {boolean}
     */
    isEdgeTiled(window) {
        const state = this._windowStates.get(window.get_id());
        return state && state.zone !== TileZone.NONE;
    }

    /**
     * Check if a single quarter tile should expand to half tile
     * @param {Meta.Workspace} workspace
     * @param {number} monitor
     */
    checkQuarterExpansion(workspace, monitor) {
        const edgeTiledWindows = this.getEdgeTiledWindows(workspace, monitor);
        if (edgeTiledWindows.length === 0) return;
        
        const workArea = workspace.get_work_area_for_monitor(monitor);
        
        // Check left side
        const leftQuarters = edgeTiledWindows.filter(w => 
            w.zone === TileZone.TOP_LEFT || w.zone === TileZone.BOTTOM_LEFT
        );
        
        if (leftQuarters.length === 1) {
            const window = leftQuarters[0].window;
            Logger.log(`[MOSAIC WM] Single quarter on left - expanding to LEFT_FULL`);
            
            const state = this._windowStates.get(window.get_id());
            if (state) state.zone = TileZone.LEFT_FULL;
            
            const rect = this.getZoneRect(TileZone.LEFT_FULL, workArea, window);
            if (rect) {
                if (this._animationsManager) {
                    this._animationsManager.animateWindow(window, rect, { subtle: true });
                } else {
                    window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
                }
            }
        }
        
        // Check right side
        const rightQuarters = edgeTiledWindows.filter(w => 
            w.zone === TileZone.TOP_RIGHT || w.zone === TileZone.BOTTOM_RIGHT
        );
        
        if (rightQuarters.length === 1) {
            const window = rightQuarters[0].window;
            Logger.log(`[MOSAIC WM] Single quarter on right - expanding to RIGHT_FULL`);
            
            const state = this._windowStates.get(window.get_id());
            if (state) state.zone = TileZone.RIGHT_FULL;
            
            const rect = this.getZoneRect(TileZone.RIGHT_FULL, workArea, window);
            if (rect) {
                if (this._animationsManager) {
                    this._animationsManager.animateWindow(window, rect, { subtle: true });
                } else {
                    window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
                }
            }
        }
    }

    // Helpers for clearWindowState
    _isQuarterZone(zone) {
        return zone === TileZone.TOP_LEFT || zone === TileZone.BOTTOM_LEFT ||
               zone === TileZone.TOP_RIGHT || zone === TileZone.BOTTOM_RIGHT;
    }

    _getAdjacentQuarterZone(zone) {
        switch (zone) {
            case TileZone.TOP_LEFT: return TileZone.BOTTOM_LEFT;
            case TileZone.BOTTOM_LEFT: return TileZone.TOP_LEFT;
            case TileZone.TOP_RIGHT: return TileZone.BOTTOM_RIGHT;
            case TileZone.BOTTOM_RIGHT: return TileZone.TOP_RIGHT;
            default: return null;
        }
    }

    _getFullZoneFromQuarter(zone) {
        if (zone === TileZone.TOP_LEFT || zone === TileZone.BOTTOM_LEFT) {
            return TileZone.LEFT_FULL;
        } else {
            return TileZone.RIGHT_FULL;
        }
    }

    _findWindowInZone(zone, workspace) {
        const windows = workspace.list_windows();
        for (const win of windows) {
            const state = this._windowStates.get(win.get_id());
            if (state && state.zone === zone) return win;
        }
        return null;
    }


    /**
     * Set the tiling manager instance
     * @param {Object} tilingManager
     */
    setTilingManager(tilingManager) {
        this._tilingManager = tilingManager;
    }

    /**
     * Check if window can be resized to target dimensions
     * @private
     * @param {Meta.Window} window
     * @param {number} targetWidth
     * @param {number} targetHeight
     * @returns {boolean}
     */
    _canResize(window, targetWidth, targetHeight) {
        if (window.window_type !== 0) { // Meta.WindowType.NORMAL
            Logger.log(`[MOSAIC WM] Window type ${window.window_type} cannot be edge-tiled`);
            return false;
        }
        
        if (window.allows_resize && !window.allows_resize()) {
            Logger.log(`[MOSAIC WM] Window does not allow resize`);
            return false;
        }
        return true;
    }

    /**
     * Apply edge tiling to a window
     * @param {Meta.Window} window
     * @param {number} zone - TileZone enum value
     * @param {Object} workArea - Work area rectangle
     * @param {boolean} skipOverflowCheck - If true, skip mosaic overflow check (for swaps)
     * @returns {boolean} Success
     */
    applyTile(window, zone, workArea, skipOverflowCheck = false) {
        this.saveWindowState(window);
        
        const winId = window.get_id();
        
        if (this._autoTiledDependencies.has(winId)) {
            Logger.log(`[MOSAIC WM] Manual retile breaks auto-tile dependency for ${winId}`);
            this._autoTiledDependencies.delete(winId);
        }
        
        if (zone === TileZone.FULLSCREEN) {
            window.maximize(Meta.MaximizeFlags.BOTH);
            const state = this._windowStates.get(window.get_id());
            if (state) state.zone = zone;
            Logger.log(`[MOSAIC WM] Maximized window ${window.get_id()}`);
            return true;
        }
        
        const rect = this.getZoneRect(zone, workArea, window);
        if (!rect) {
            Logger.log(`[MOSAIC WM] Invalid zone ${zone}`);
            return false;
        }
        
        if (!this._canResize(window, rect.width, rect.height)) return false;
        
        const workspace = window.get_workspace();
        const monitor = window.get_monitor();
        let fullToQuarterConversion = null;
        
        if (zone === TileZone.BOTTOM_LEFT || zone === TileZone.TOP_LEFT) {
            const workspaceWindows = workspace.list_windows().filter(w => 
                w.get_monitor() === monitor &&
                w.get_id() !== window.get_id() &&
                !w.is_hidden() &&
                w.get_window_type() === Meta.WindowType.NORMAL
            );
            
            const leftFullWindow = workspaceWindows.find(w => {
                const state = this.getWindowState(w);
                return state && state.zone === TileZone.LEFT_FULL;
            });
            
            if (leftFullWindow) {
                const newZone = (zone === TileZone.BOTTOM_LEFT) ? TileZone.TOP_LEFT : TileZone.BOTTOM_LEFT;
                fullToQuarterConversion = { window: leftFullWindow, newZone };
            }
        } else if (zone === TileZone.BOTTOM_RIGHT || zone === TileZone.TOP_RIGHT) {
            const workspaceWindows = workspace.list_windows().filter(w => 
                w.get_monitor() === monitor &&
                w.get_id() !== window.get_id() &&
                !w.is_hidden() &&
                w.get_window_type() === Meta.WindowType.NORMAL
            );
            
            const rightFullWindow = workspaceWindows.find(w => {
                const state = this.getWindowState(w);
                return state && state.zone === TileZone.RIGHT_FULL;
            });
            
            if (rightFullWindow) {
                const newZone = (zone === TileZone.BOTTOM_RIGHT) ? TileZone.TOP_RIGHT : TileZone.BOTTOM_RIGHT;
                fullToQuarterConversion = { window: rightFullWindow, newZone };
            }
        }
        
        let savedFullTileWidth = null;
        if (fullToQuarterConversion) {
            const fullFrame = fullToQuarterConversion.window.get_frame_rect();
            savedFullTileWidth = fullFrame.width;
            Logger.log(`[MOSAIC WM] Converting FULL tile ${fullToQuarterConversion.window.get_id()} to quarter zone ${fullToQuarterConversion.newZone}, preserving width=${savedFullTileWidth}px`);
        }
        
        window.unmaximize();
        
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._animationsManager) {
                this._animationsManager.animateWindow(window, rect, { subtle: true });
            } else {
                window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
            }
            
            this.setupResizeListener(window);
            
            const state = this._windowStates.get(winId);
            if (state) state.zone = zone;
            
            Logger.log(`[MOSAIC WM] Applied edge tile zone ${zone} to window ${winId}`);
            
            if (fullToQuarterConversion && savedFullTileWidth) {
                const convertedRect = this.getZoneRect(fullToQuarterConversion.newZone, workArea, fullToQuarterConversion.window);
                
                convertedRect.width = savedFullTileWidth;
                rect.width = savedFullTileWidth;
                
                if (fullToQuarterConversion.newZone === TileZone.TOP_LEFT || fullToQuarterConversion.newZone === TileZone.BOTTOM_LEFT) {
                    convertedRect.x = workArea.x;
                    rect.x = workArea.x;
                } else {
                    convertedRect.x = workArea.x + workArea.width - savedFullTileWidth;
                    rect.x = workArea.x + workArea.width - savedFullTileWidth;
                }
                
                const halfHeight = Math.floor(workArea.height / 2);
                
                animations.animateWindow(fullToQuarterConversion.window, {
                    x: convertedRect.x,
                    y: convertedRect.y,
                    width: convertedRect.width,
                    height: halfHeight
                }, { subtle: true });
                
                animations.animateWindow(window, {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: halfHeight
                });
                
                Logger.log(`[MOSAIC WM] Applied quarter tiles with halfHeight=${halfHeight}px, width=${savedFullTileWidth}px`);
                
                const convertedState = this._windowStates.get(fullToQuarterConversion.window.get_id());
                if (convertedState) convertedState.zone = fullToQuarterConversion.newZone;
                
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, constants.POLL_INTERVAL_MS, () => {
                    const actualConvertedFrame = fullToQuarterConversion.window.get_frame_rect();
                    const actualNewFrame = window.get_frame_rect();
                    
                    if (actualConvertedFrame.height !== halfHeight || actualNewFrame.height !== halfHeight) {
                        if (zone === TileZone.BOTTOM_LEFT || zone === TileZone.BOTTOM_RIGHT) {
                            if (actualNewFrame.height > halfHeight) {
                                const topHeight = workArea.height - actualNewFrame.height;
                                const bottomY = workArea.y + topHeight;
                                fullToQuarterConversion.window.move_resize_frame(false, convertedRect.x, workArea.y, convertedRect.width, topHeight);
                                window.move_resize_frame(false, rect.x, bottomY, rect.width, actualNewFrame.height);
                            } else {
                                const bottomY = actualConvertedFrame.y + actualConvertedFrame.height;
                                const bottomHeight = (workArea.y + workArea.height) - bottomY;
                                window.move_resize_frame(false, rect.x, bottomY, rect.width, bottomHeight);
                            }
                        } else {
                            if (actualNewFrame.height > halfHeight) {
                                const bottomHeight = workArea.height - actualNewFrame.height;
                                const bottomY = workArea.y + actualNewFrame.height;
                                fullToQuarterConversion.window.move_resize_frame(false, convertedRect.x, bottomY, convertedRect.width, bottomHeight);
                            } else {
                                const bottomY = actualNewFrame.y + actualNewFrame.height;
                                const bottomHeight = (workArea.y + workArea.height) - bottomY;
                                fullToQuarterConversion.window.move_resize_frame(false, convertedRect.x, bottomY, convertedRect.width, bottomHeight);
                            }
                        }
                    }
                    
                    if (this._tilingManager) {
                        this._tilingManager.tileWorkspaceWindows(workspace, null, monitor, false);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
            
            if (!skipOverflowCheck) {
                this._handleMosaicOverflow(window, zone);
            }
            
            return GLib.SOURCE_REMOVE;
        });
        
        return true;
    }

    /**
     * Remove edge tiling and restore window to previous state
     * @param {Meta.Window} window
     * @param {Function} callback
     */
    removeTile(window, callback = null) {
        const winId = window.get_id();
        const savedState = this._windowStates.get(winId);

        if (!savedState || savedState.zone === TileZone.NONE) {
            Logger.log(`[MOSAIC WM] removeTile: Window ${winId} is not edge-tiled`);
            if (callback) callback();
            return;
        }
        
        Logger.log(`[MOSAIC WM] removeTile: Removing tile from window ${winId}, zone=${savedState.zone}`);
        
        this._removeResizeListener(window);
        
        const savedWidth = savedState.width;
        const savedHeight = savedState.height;
        const savedX = savedState.x;
        const savedY = savedState.y;
        
        this._autoTiledDependencies.forEach((masterId, dependentId) => {
            if (masterId === winId) {
                const dependent = this._findWindowById(dependentId);
                if (dependent) this.removeTile(dependent);
                this._autoTiledDependencies.delete(dependentId);
            }
        });
        
        if (this._isQuarterZone(savedState.zone)) {
            Logger.log(`[MOSAIC WM] Quarter tile ${winId} being removed from zone ${savedState.zone}`);
            
            const adjacentZone = this._getAdjacentQuarterZone(savedState.zone);
            if (adjacentZone) {
                const adjacentWindow = this._findWindowInZone(adjacentZone, window.get_workspace());
                
                if (adjacentWindow) {
                    const fullZone = this._getFullZoneFromQuarter(savedState.zone);
                    const workspace = window.get_workspace();
                    const monitor = window.get_monitor();
                    const workArea = workspace.get_work_area_for_monitor(monitor);
                    const fullRect = this.getZoneRect(fullZone, workArea, adjacentWindow);
                    
                    if (fullRect) {
                        adjacentWindow.move_resize_frame(false, fullRect.x, fullRect.y, fullRect.width, fullRect.height);
                        const adjacentState = this._windowStates.get(adjacentWindow.get_id());
                        if (adjacentState) adjacentState.zone = fullZone;
                    }
                }
            }
        }
        
        savedState.zone = TileZone.NONE;
        
        if (window.maximized_horizontally || window.maximized_vertically) {
            window.unmaximize();
        }
        
        const [cursorX, cursorY] = global.get_pointer();
        const restoredX = cursorX - (savedWidth / 2);
        const restoredY = cursorY - 20;
        
        Logger.log(`[MOSAIC WM] removeTile: Restoring to cursor position (${restoredX}, ${restoredY})`);
        window.move_resize_frame(false, restoredX, restoredY, savedWidth, savedHeight);
        
        if (callback) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, constants.RETILE_DELAY_MS, () => {
                callback();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Handle mosaic overflow after edge tiling is applied
     * @private
     * @param {Meta.Window} tiledWindow
     * @param {number} zone
     */
    _handleMosaicOverflow(tiledWindow, zone) {
        if (zone !== TileZone.LEFT_FULL && zone !== TileZone.RIGHT_FULL) return;
        
        const workspace = tiledWindow.get_workspace();
        const monitor = tiledWindow.get_monitor();
        const workArea = workspace.get_work_area_for_monitor(monitor);
        const remainingSpace = this.calculateRemainingSpace(workspace, monitor);
        const mosaicWindows = this.getNonEdgeTiledWindows(workspace, monitor);
        
        if (mosaicWindows.length === 0) return;
        
        if (mosaicWindows.length === 1) {
            const mosaicWindow = mosaicWindows[0];
            const frame = mosaicWindow.get_frame_rect();
            const widthThreshold = remainingSpace.width * 0.8;
            
            if (frame.width >= widthThreshold) {
                const oppositeZone = (zone === TileZone.LEFT_FULL) ? TileZone.RIGHT_FULL : TileZone.LEFT_FULL;
                
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this.applyTile(mosaicWindow, oppositeZone, workArea);
                    
                    const dependentId = mosaicWindow.get_id();
                    const masterId = tiledWindow.get_id();
                    this._autoTiledDependencies.set(dependentId, masterId);
                    
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
        }
        
        let totalMosaicArea = 0;
        for (const w of mosaicWindows) {
            const frame = w.get_frame_rect();
            totalMosaicArea += frame.width * frame.height;
        }
        
        const remainingArea = remainingSpace.width * remainingSpace.height;
        const areaThreshold = remainingArea * 0.7;
        
        if (totalMosaicArea > areaThreshold) {
            const workspaceManager = global.workspace_manager;
            const newWorkspace = workspaceManager.append_new_workspace(false, global.get_current_time());
            
            Logger.log(`[MOSAIC WM] Created new workspace ${newWorkspace.index()} for ${mosaicWindows.length} mosaic windows`);
            
            for (const mosaicWindow of mosaicWindows) {
                mosaicWindow.change_workspace(newWorkspace);
            }
            
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                if (this._tilingManager) {
                    this._tilingManager.tileWorkspaceWindows(workspace, null, monitor);
                }
                return GLib.SOURCE_REMOVE;
            });
            
            newWorkspace.activate(global.get_current_time());
        }
    }


    /**
     * Setup resize listener for edge-tiled window
     * @param {Meta.Window} window
     */
    setupResizeListener(window) {
        const winId = window.get_id();
        
        if (this._resizeListeners.has(winId)) return;
        
        const signalId = window.connect('size-changed', () => {
            this._handleWindowResize(window);
        });
        
        this._resizeListeners.set(winId, signalId);
        Logger.log(`[MOSAIC WM] Setup resize listener for window ${winId}`);
    }

    /**
     * Remove resize listener from window
     * @private
     * @param {Meta.Window} window
     */
    _removeResizeListener(window) {
        const winId = window.get_id();
        const signalId = this._resizeListeners.get(winId);
        
        if (signalId) {
            window.disconnect(signalId);
            this._resizeListeners.delete(winId);
            Logger.log(`[MOSAIC WM] Removed resize listener from window ${winId}`);
        }
    }

    /**
     * Handle window resize event
     * @private
     * @param {Meta.Window} window
     */
    _handleWindowResize(window) {
        const state = this.getWindowState(window);
        if (!state || state.zone === TileZone.NONE) return;
        
        if (this._isResizing) return;
        
        Logger.log(`[MOSAIC WM] Resize detected on edge-tiled window ${window.get_id()}, zone=${state.zone}`);
        
        if (state.zone === TileZone.LEFT_FULL || state.zone === TileZone.RIGHT_FULL) {
            this._handleHorizontalResize(window, state.zone);
        } else if (this._isQuarterZone(state.zone)) {
            this._handleVerticalResize(window, state.zone);
        }
    }

    _handleHorizontalResize(window, zone) {
        const workspace = window.get_workspace();
        const monitor = window.get_monitor();
        const workArea = workspace.get_work_area_for_monitor(monitor);
        
        const adjacentWindow = this._getAdjacentWindow(window, workspace, monitor, zone);
        
        if (!adjacentWindow) {
            if (!this._isResizing) {
                this._handleResizeWithMosaic(window, workspace, monitor);
            }
            return;
        }
        
        this._resizeTiledPair(window, adjacentWindow, workArea, zone);
    }

    _handleVerticalResize(window, zone) {
        const workspace = window.get_workspace();
        const monitor = window.get_monitor();
        const workArea = workspace.get_work_area_for_monitor(monitor);
        
        const adjacentZone = this._getAdjacentQuarterZone(zone);
        if (!adjacentZone) return;
        
        const adjacentWindow = this._findWindowInZone(adjacentZone, workspace);
        if (!adjacentWindow) return;
        
        const resizedId = window.get_id();
        const adjacentId = adjacentWindow.get_id();
        const resizedFrame = window.get_frame_rect();
        
        const previousState = this._previousSizes.get(resizedId);
        
        if (!previousState) {
            const adjacentFrame = adjacentWindow.get_frame_rect();
            this._previousSizes.set(resizedId, { width: resizedFrame.width, height: resizedFrame.height, y: resizedFrame.y });
            this._previousSizes.set(adjacentId, { width: adjacentFrame.width, height: adjacentFrame.height, y: adjacentFrame.y });
            return;
        }
        
        const newAdjacentHeight = workArea.height - resizedFrame.height;
        const minHeight = constants.MIN_WINDOW_HEIGHT;
        const maxResizedHeight = workArea.height - minHeight;
        
        if (resizedFrame.height > maxResizedHeight) return;
        if (newAdjacentHeight < minHeight) return;
        
        const isResizedTop = (zone === TileZone.TOP_LEFT || zone === TileZone.TOP_RIGHT);
        this._isResizing = true;
        
        try {
            if (isResizedTop) {
                window.move_frame(false, resizedFrame.x, workArea.y);
                window.move_resize_frame(false, resizedFrame.x, workArea.y, resizedFrame.width, resizedFrame.height);
                
                const adjacentY = workArea.y + resizedFrame.height;
                adjacentWindow.move_frame(false, resizedFrame.x, adjacentY);
                adjacentWindow.move_resize_frame(false, resizedFrame.x, adjacentY, resizedFrame.width, newAdjacentHeight);
                
                this._previousSizes.set(resizedId, { width: resizedFrame.width, height: resizedFrame.height, y: workArea.y });
                this._previousSizes.set(adjacentId, { width: resizedFrame.width, height: newAdjacentHeight, y: adjacentY });
            } else {
                adjacentWindow.move_frame(false, resizedFrame.x, workArea.y);
                adjacentWindow.move_resize_frame(false, resizedFrame.x, workArea.y, resizedFrame.width, newAdjacentHeight);
                
                const resizedY = workArea.y + newAdjacentHeight;
                window.move_frame(false, resizedFrame.x, resizedY);
                window.move_resize_frame(false, resizedFrame.x, resizedY, resizedFrame.width, resizedFrame.height);
                
                this._previousSizes.set(adjacentId, { width: resizedFrame.width, height: newAdjacentHeight, y: workArea.y });
                this._previousSizes.set(resizedId, { width: resizedFrame.width, height: resizedFrame.height, y: resizedY });
            }
        } finally {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2, () => {
                this._isResizing = false;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _resizeTiledPair(resizedWindow, adjacentWindow, workArea, zone) {
        const resizedId = resizedWindow.get_id();
        const adjacentId = adjacentWindow.get_id();
        const resizedFrame = resizedWindow.get_frame_rect();
        
        const previousState = this._previousSizes.get(resizedId);
        
        if (!previousState) {
            const adjacentFrame = adjacentWindow.get_frame_rect();
            this._previousSizes.set(resizedId, { width: resizedFrame.width, height: resizedFrame.height, x: resizedFrame.x });
            this._previousSizes.set(adjacentId, { width: adjacentFrame.width, height: resizedFrame.height, x: adjacentFrame.x });
            return;
        }
        
        const minWidth = 400;
        const maxResizedWidth = workArea.width - minWidth;
        
        if (resizedFrame.width > maxResizedWidth) return;
        
        const newAdjacentWidth = workArea.width - resizedFrame.width;
        
        this._isResizing = true;
        
        try {
            const isResizedLeft = (zone === TileZone.LEFT_FULL);
            
            if (isResizedLeft) {
                resizedWindow.move_frame(false, workArea.x, workArea.y);
                resizedWindow.move_resize_frame(false, workArea.x, workArea.y, resizedFrame.width, workArea.height);
                
                adjacentWindow.move_frame(false, workArea.x + resizedFrame.width, workArea.y);
                adjacentWindow.move_resize_frame(false, workArea.x + resizedFrame.width, workArea.y, newAdjacentWidth, workArea.height);
                
                this._previousSizes.set(resizedId, { width: resizedFrame.width, height: workArea.height, x: workArea.x });
                this._previousSizes.set(adjacentId, { width: newAdjacentWidth, height: workArea.height, x: workArea.x + resizedFrame.width });
            } else {
                adjacentWindow.move_frame(false, workArea.x, workArea.y);
                adjacentWindow.move_resize_frame(false, workArea.x, workArea.y, newAdjacentWidth, workArea.height);
                
                resizedWindow.move_frame(false, workArea.x + newAdjacentWidth, workArea.y);
                resizedWindow.move_resize_frame(false, workArea.x + newAdjacentWidth, workArea.y, resizedFrame.width, workArea.height);
                
                this._previousSizes.set(adjacentId, { width: newAdjacentWidth, height: workArea.height, x: workArea.x });
                this._previousSizes.set(resizedId, { width: resizedFrame.width, height: workArea.height, x: workArea.x + newAdjacentWidth });
            }
        } finally {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2, () => {
                this._isResizing = false;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _handleResizeWithMosaic(window, workspace, monitor) {
        if (this._tilingManager) {
            Logger.log(`[MOSAIC WM] Edge-tiled window resized - re-tiling mosaic`);
            this._tilingManager.tileWorkspaceWindows(workspace, null, monitor, true);
        }
    }

    _getAdjacentWindow(window, workspace, monitor, zone) {
        const edgeTiledWindows = this.getEdgeTiledWindows(workspace, monitor);
        const windowId = window.get_id();
        const targetZone = (zone === TileZone.LEFT_FULL) ? TileZone.RIGHT_FULL : TileZone.LEFT_FULL;
        const adjacent = edgeTiledWindows.find(w => w.window.get_id() !== windowId && w.zone === targetZone);
        return adjacent ? adjacent.window : null;
    }

    /**
     * Fix tiled pair sizes after resize ends
     * @param {Meta.Window} resizedWindow
     * @param {number} zone
     */
    fixTiledPairSizes(resizedWindow, zone) {
        const workspace = resizedWindow.get_workspace();
        const monitor = resizedWindow.get_monitor();
        const workArea = workspace.get_work_area_for_monitor(monitor);
        const adjacentWindow = this._getAdjacentWindow(resizedWindow, workspace, monitor, zone);
        
        if (!adjacentWindow) return;
        
        const resizedFrame = resizedWindow.get_frame_rect();
        const minWidth = 400;
        const impliedAdjacentWidth = workArea.width - resizedFrame.width;
        
        if (impliedAdjacentWidth < minWidth) {
            const newAdjacentWidth = minWidth;
            const newResizedWidth = workArea.width - newAdjacentWidth;
            
            this._isResizing = true;
            try {
                const isResizedLeft = (zone === TileZone.LEFT_FULL);
                if (isResizedLeft) {
                    resizedWindow.move_frame(false, workArea.x, workArea.y);
                    resizedWindow.move_resize_frame(false, workArea.x, workArea.y, newResizedWidth, workArea.height);
                    
                    adjacentWindow.move_frame(false, workArea.x + newResizedWidth, workArea.y);
                    adjacentWindow.move_resize_frame(false, workArea.x + newResizedWidth, workArea.y, newAdjacentWidth, workArea.height);
                } else {
                    adjacentWindow.move_frame(false, workArea.x, workArea.y);
                    adjacentWindow.move_resize_frame(false, workArea.x, workArea.y, newAdjacentWidth, workArea.height);
                    
                    resizedWindow.move_frame(false, workArea.x + newAdjacentWidth, workArea.y);
                    resizedWindow.move_resize_frame(false, workArea.x + newAdjacentWidth, workArea.y, newResizedWidth, workArea.height);
                }
            } finally {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._isResizing = false;
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        
        const adjacentFrame = adjacentWindow.get_frame_rect();
        const totalWidth = resizedFrame.width + adjacentFrame.width;
        
        if (totalWidth < workArea.width) {
            const gap = workArea.width - totalWidth;
            const newResizedWidth = resizedFrame.width + gap;
            
            this._isResizing = true;
            try {
                const isResizedLeft = (zone === TileZone.LEFT_FULL);
                if (isResizedLeft) {
                    resizedWindow.move_frame(false, workArea.x, workArea.y);
                    resizedWindow.move_resize_frame(false, workArea.x, workArea.y, newResizedWidth, workArea.height);
                    
                    adjacentWindow.move_frame(false, workArea.x + newResizedWidth, workArea.y);
                    adjacentWindow.move_resize_frame(false, workArea.x + newResizedWidth, workArea.y, adjacentFrame.width, workArea.height);
                } else {
                    adjacentWindow.move_frame(false, workArea.x, workArea.y);
                    adjacentWindow.move_resize_frame(false, workArea.x, workArea.y, adjacentFrame.width, workArea.height);
                    
                    resizedWindow.move_frame(false, workArea.x + adjacentFrame.width, workArea.y);
                    resizedWindow.move_resize_frame(false, workArea.x + adjacentFrame.width, workArea.y, newResizedWidth, workArea.height);
                }
            } finally {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._isResizing = false;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }
    
    /**
     * Fix quarter tile pair sizes after vertical resize ends
     * @param {Meta.Window} resizedWindow
     * @param {number} zone
     */
    fixQuarterPairSizes(resizedWindow, zone) {
        const workspace = resizedWindow.get_workspace();
        const monitor = resizedWindow.get_monitor();
        const workArea = workspace.get_work_area_for_monitor(monitor);
        const adjacentZone = this._getAdjacentQuarterZone(zone);
        if (!adjacentZone) return;
        
        const adjacentWindow = this._findWindowInZone(adjacentZone, workspace);
        if (!adjacentWindow) return;
        
        const resizedFrame = resizedWindow.get_frame_rect();
        const adjacentFrame = adjacentWindow.get_frame_rect();
        const absoluteMinHeight = constants.ABSOLUTE_MIN_HEIGHT;
        const minHeight = Math.max(adjacentFrame.height, absoluteMinHeight);
        const impliedAdjacentHeight = workArea.height - resizedFrame.height;
        
        if (impliedAdjacentHeight < minHeight) {
            const newAdjacentHeight = minHeight;
            const newResizedHeight = workArea.height - newAdjacentHeight;
            
            this._isResizing = true;
            try {
                const isResizedTop = (zone === TileZone.TOP_LEFT || zone === TileZone.TOP_RIGHT);
                if (isResizedTop) {
                    resizedWindow.move_frame(false, resizedFrame.x, workArea.y);
                    resizedWindow.move_resize_frame(false, resizedFrame.x, workArea.y, resizedFrame.width, newResizedHeight);
                    
                    const adjacentY = workArea.y + newResizedHeight;
                    adjacentWindow.move_frame(false, resizedFrame.x, adjacentY);
                    adjacentWindow.move_resize_frame(false, resizedFrame.x, adjacentY, resizedFrame.width, newAdjacentHeight);
                } else {
                    adjacentWindow.move_frame(false, resizedFrame.x, workArea.y);
                    adjacentWindow.move_resize_frame(false, resizedFrame.x, workArea.y, resizedFrame.width, newAdjacentHeight);
                    
                    const resizedY = workArea.y + newAdjacentHeight;
                    resizedWindow.move_frame(false, resizedFrame.x, resizedY);
                    resizedWindow.move_resize_frame(false, resizedFrame.x, resizedY, resizedFrame.width, newResizedHeight);
                }
            } finally {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._isResizing = false;
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        
        const totalHeight = resizedFrame.height + adjacentFrame.height;
        
        if (totalHeight < workArea.height) {
            const gap = workArea.height - totalHeight;
            const newResizedHeight = resizedFrame.height + gap;
            
            this._isResizing = true;
            try {
                const isResizedTop = (zone === TileZone.TOP_LEFT || zone === TileZone.TOP_RIGHT);
                if (isResizedTop) {
                    resizedWindow.move_frame(false, resizedFrame.x, workArea.y);
                    resizedWindow.move_resize_frame(false, resizedFrame.x, workArea.y, resizedFrame.width, newResizedHeight);
                    
                    const adjacentY = workArea.y + newResizedHeight;
                    adjacentWindow.move_frame(false, resizedFrame.x, adjacentY);
                    adjacentWindow.move_resize_frame(false, resizedFrame.x, adjacentY, resizedFrame.width, adjacentFrame.height);
                } else {
                    adjacentWindow.move_frame(false, resizedFrame.x, workArea.y);
                    adjacentWindow.move_resize_frame(false, resizedFrame.x, workArea.y, resizedFrame.width, adjacentFrame.height);
                    
                    const resizedY = workArea.y + adjacentFrame.height;
                    resizedWindow.move_frame(false, resizedFrame.x, resizedY);
                    resizedWindow.move_resize_frame(false, resizedFrame.x, resizedY, resizedFrame.width, newResizedHeight);
                }
            } finally {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._isResizing = false;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }


    /**
     * Find window by ID across all workspaces
     * @private
     * @param {number} windowId - Window ID to find
     * @returns {Meta.Window|null}
     */
    _findWindowById(windowId) {
        const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
        return allWindows.find(w => w.get_id() === windowId) || null;
    }
}

/**
 * Check if a zone is a quarter zone
 * @param {number} zone - TileZone value
 * @returns {boolean}
 */
export function isQuarterZone(zone) {
    return zone === TileZone.TOP_LEFT || zone === TileZone.BOTTOM_LEFT ||
           zone === TileZone.TOP_RIGHT || zone === TileZone.BOTTOM_RIGHT;
}

