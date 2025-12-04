/**
 * Window Swapping Module
 * 
 * Provides unified window swapping functionality across mosaic and tiling zones.
 * Supports both keyboard shortcuts and drag-and-drop operations.
 */

import Meta from 'gi://Meta';
import * as edgeTiling from './edgeTiling.js';
import * as tiling from './tiling.js';
import * as windowing from './windowing.js';

/**
 * Find the window's neighbor in a given direction
 * @param {Meta.Window} window - Source window
 * @param {string} direction - 'left', 'right', 'up', 'down'
 * @param {Meta.Workspace} workspace
 * @param {number} monitor
 * @returns {Object|null} - {window: Meta.Window|null, zone: TileZone|null, type: string}
 */
export function findNeighbor(window, direction, workspace, monitor) {
    const windowState = edgeTiling.getWindowState(window);
    const isWindowTiled = windowState && windowState.zone !== edgeTiling.TileZone.NONE;
    
    console.log(`[MOSAIC WM] Finding neighbor for window ${window.get_id()} in direction: ${direction}`);
    
    if (isWindowTiled) {
        // Window is edge-tiled
        return findNeighborFromTiling(window, windowState.zone, direction, workspace, monitor);
    } else {
        // Window is in mosaic
        return findNeighborFromMosaic(window, direction, workspace, monitor);
    }
}

/**
 * Find neighbor when source window is in tiling
 * @private
 */
function findNeighborFromTiling(window, zone, direction, workspace, monitor) {
    const isQuarter = edgeTiling.isQuarterZone(zone);
    
    // VERTICAL SWAP (Up/Down) - Only for quarter tiles
    if (direction === 'up' || direction === 'down') {
        if (!isQuarter) {
            console.log('[MOSAIC WM] Vertical swap only works for quarter tiles');
            return null;
        }
        
        return findVerticalQuarterNeighbor(zone, direction, workspace, monitor);
    }
    
    // HORIZONTAL SWAP (Left/Right)
    return findHorizontalNeighborFromTiling(window, zone, direction, workspace, monitor);
}

/**
 * Find vertical neighbor for quarter tiles (same side)
 * @private
 */
function findVerticalQuarterNeighbor(zone, direction, workspace, monitor) {
    const edgeTiledWindows = edgeTiling.getEdgeTiledWindows(workspace, monitor);
    
    // Map quarter zones to their vertical counterparts
    const verticalPairs = {
        [edgeTiling.TileZone.TOP_LEFT]: edgeTiling.TileZone.BOTTOM_LEFT,
        [edgeTiling.TileZone.BOTTOM_LEFT]: edgeTiling.TileZone.TOP_LEFT,
        [edgeTiling.TileZone.TOP_RIGHT]: edgeTiling.TileZone.BOTTOM_RIGHT,
        [edgeTiling.TileZone.BOTTOM_RIGHT]: edgeTiling.TileZone.TOP_RIGHT,
    };
    
    const targetZone = verticalPairs[zone];
    if (!targetZone) {
        return null;
    }
    
    // Find window in target zone
    const targetWindow = edgeTiledWindows.find(w => {
        const state = edgeTiling.getWindowState(w.window);
        return state && state.zone === targetZone;
    });
    
    if (targetWindow) {
        return {
            window: targetWindow.window,
            zone: targetZone,
            type: 'tiling'
        };
    }
    
    // No window in target zone - return empty zone
    return {
        window: null,
        zone: targetZone,
        type: 'empty_tiling'
    };
}

/**
 * Find horizontal neighbor from tiling zone
 * @private
 */
function findHorizontalNeighborFromTiling(window, zone, direction, workspace, monitor) {
    const isLeft = zone === edgeTiling.TileZone.LEFT_FULL || 
                   zone === edgeTiling.TileZone.TOP_LEFT || 
                   zone === edgeTiling.TileZone.BOTTOM_LEFT;
    const isRight = zone === edgeTiling.TileZone.RIGHT_FULL || 
                    zone === edgeTiling.TileZone.TOP_RIGHT || 
                    zone === edgeTiling.TileZone.BOTTOM_RIGHT;
    
    // Determine target side
    let targetSide;
    if (direction === 'left') {
        targetSide = 'left';
    } else if (direction === 'right') {
        targetSide = 'right';
    } else {
        return null;
    }
    
    // Check if moving to opposite side or same side
    const movingToOppositeSide = (isLeft && targetSide === 'right') || (isRight && targetSide === 'left');
    
    if (movingToOppositeSide) {
        // Moving to opposite side - check for tiling or mosaic
        return findOppositeSideNeighbor(window, zone, targetSide, workspace, monitor);
    } else {
        // Moving within same side - check mosaic on this side
        return findSameSideMosaicNeighbor(window, zone, direction, workspace, monitor);
    }
}

/**
 * Find neighbor on opposite side (from LEFT to RIGHT or vice versa)
 * @private
 */
function findOppositeSideNeighbor(window, sourceZone, targetSide, workspace, monitor) {
    const edgeTiledWindows = edgeTiling.getEdgeTiledWindows(workspace, monitor);
    const isQuarter = edgeTiling.isQuarterZone(sourceZone);
    
    // Determine vertical level for quarter tiles
    const isTop = sourceZone === edgeTiling.TileZone.TOP_LEFT || sourceZone === edgeTiling.TileZone.TOP_RIGHT;
    const isBottom = sourceZone === edgeTiling.TileZone.BOTTOM_LEFT || sourceZone === edgeTiling.TileZone.BOTTOM_RIGHT;
    
    // Find windows on target side
    const targetSideWindows = edgeTiledWindows.filter(w => {
        const state = edgeTiling.getWindowState(w.window);
        if (!state) return false;
        
        const zone = state.zone;
        if (targetSide === 'left') {
            return zone === edgeTiling.TileZone.LEFT_FULL || 
                   zone === edgeTiling.TileZone.TOP_LEFT || 
                   zone === edgeTiling.TileZone.BOTTOM_LEFT;
        } else {
            return zone === edgeTiling.TileZone.RIGHT_FULL || 
                   zone === edgeTiling.TileZone.TOP_RIGHT || 
                   zone === edgeTiling.TileZone.BOTTOM_RIGHT;
        }
    });
    
    if (targetSideWindows.length === 0) {
        // No tiling on target side - check mosaic
        const mosaicNeighbor = findMosaicOnSide(targetSide, workspace, monitor);
        if (mosaicNeighbor) {
            return mosaicNeighbor;
        }
        
        // No mosaic either - return empty zone
        // If source is quarter, expand to FULL
        // If source is FULL, no action
        if (isQuarter) {
            const targetZone = targetSide === 'left' ? edgeTiling.TileZone.LEFT_FULL : edgeTiling.TileZone.RIGHT_FULL;
            return {
                window: null,
                zone: targetZone,
                type: 'empty_tiling_expand'
            };
        } else {
            return null; // FULL tile cannot expand
        }
    }
    
    // Find matching window on target side
    if (isQuarter) {
        // Try to find matching vertical level first
        const matchingLevel = targetSideWindows.find(w => {
            const state = edgeTiling.getWindowState(w.window);
            if (isTop) {
                return state.zone === (targetSide === 'left' ? edgeTiling.TileZone.TOP_LEFT : edgeTiling.TileZone.TOP_RIGHT);
            } else if (isBottom) {
                return state.zone === (targetSide === 'left' ? edgeTiling.TileZone.BOTTOM_LEFT : edgeTiling.TileZone.BOTTOM_RIGHT);
            }
            return false;
        });
        
        if (matchingLevel) {
            const state = edgeTiling.getWindowState(matchingLevel.window);
            return {
                window: matchingLevel.window,
                zone: state.zone,
                type: 'tiling'
            };
        }
        
        // No matching level - swap with FULL or first quarter
        const targetWindow = targetSideWindows[0];
        const state = edgeTiling.getWindowState(targetWindow.window);
        return {
            window: targetWindow.window,
            zone: state.zone,
            type: 'tiling'
        };
    } else {
        // Source is FULL - swap with any window on target side
        const targetWindow = targetSideWindows[0];
        const state = edgeTiling.getWindowState(targetWindow.window);
        return {
            window: targetWindow.window,
            zone: state.zone,
            type: 'tiling'
        };
    }
}

/**
 * Find mosaic windows on a specific side
 * @private
 */
function findMosaicOnSide(side, workspace, monitor) {
    const mosaicWindows = edgeTiling.getNonEdgeTiledWindows(workspace, monitor);
    
    if (mosaicWindows.length === 0) {
        return null;
    }
    
    // Get workspace area
    const workArea = workspace.get_work_area_for_monitor(monitor);
    const centerX = workArea.x + workArea.width / 2;
    
    // Filter mosaic windows by side
    const sideWindows = mosaicWindows.filter(w => {
        const frame = w.get_frame_rect();
        const windowCenterX = frame.x + frame.width / 2;
        
        if (side === 'left') {
            return windowCenterX < centerX;
        } else {
            return windowCenterX >= centerX;
        }
    });
    
    if (sideWindows.length > 0) {
        return {
            window: sideWindows[0],
            zone: null,
            type: 'mosaic'
        };
    }
    
    return null;
}

/**
 * Find mosaic neighbor on same side as tiling zone
 * @private
 */
function findSameSideMosaicNeighbor(window, zone, direction, workspace, monitor) {
    // For now, return null (no mosaic on same side as tiling)
    // This would require more complex spatial detection
    return null;
}

/**
 * Find neighbor when source window is in mosaic
 * @private
 */
function findNeighborFromMosaic(window, direction, workspace, monitor) {
    // Get all mosaic windows
    const mosaicWindows = edgeTiling.getNonEdgeTiledWindows(workspace, monitor);
    const windowFrame = window.get_frame_rect();
    
    // PRIORITY 1: Find closest mosaic window in direction
    const mosaicNeighbor = findClosestMosaicInDirection(window, mosaicWindows, direction);
    if (mosaicNeighbor) {
        return mosaicNeighbor;
    }
    
    // PRIORITY 2: For horizontal directions, check for OCCUPIED tiling zones only
    // Do NOT tile to empty zones - swap is only for swapping with existing windows
    if (direction === 'left' || direction === 'right') {
        const edgeTiledWindows = edgeTiling.getEdgeTiledWindows(workspace, monitor);
        const workArea = workspace.get_work_area_for_monitor(monitor);
        const centerX = workArea.x + workArea.width / 2;
        const windowCenterX = windowFrame.x + windowFrame.width / 2;
        
        if (direction === 'left' && windowCenterX > centerX) {
            // Window is on right side of mosaic, check for LEFT tiling
            const leftTiles = edgeTiledWindows.filter(w => {
                const state = edgeTiling.getWindowState(w.window);
                return state && (state.zone === edgeTiling.TileZone.LEFT_FULL ||
                               state.zone === edgeTiling.TileZone.TOP_LEFT ||
                               state.zone === edgeTiling.TileZone.BOTTOM_LEFT);
            });
            
            if (leftTiles.length > 0) {
                const state = edgeTiling.getWindowState(leftTiles[0].window);
                return {
                    window: leftTiles[0].window,
                    zone: state.zone,
                    type: 'tiling'
                };
            }
        } else if (direction === 'right' && windowCenterX < centerX) {
            // Window is on left side of mosaic, check for RIGHT tiling
            const rightTiles = edgeTiledWindows.filter(w => {
                const state = edgeTiling.getWindowState(w.window);
                return state && (state.zone === edgeTiling.TileZone.RIGHT_FULL ||
                               state.zone === edgeTiling.TileZone.TOP_RIGHT ||
                               state.zone === edgeTiling.TileZone.BOTTOM_RIGHT);
            });
            
            if (rightTiles.length > 0) {
                const state = edgeTiling.getWindowState(rightTiles[0].window);
                return {
                    window: rightTiles[0].window,
                    zone: state.zone,
                    type: 'tiling'
                };
            }
        }
    }
    
    // No neighbor found - do NOT tile to empty zones
    return null;
}

/**
 * Find tiling zone in a direction from mosaic window
 * @private
 */
function findTilingZoneInDirection(windowFrame, direction, workspace, monitor) {
    const edgeTiledWindows = edgeTiling.getEdgeTiledWindows(workspace, monitor);
    const workArea = workspace.get_work_area_for_monitor(monitor);
    const centerX = workArea.x + workArea.width / 2;
    const windowCenterX = windowFrame.x + windowFrame.width / 2;
    
    if (direction === 'left' && windowCenterX > centerX) {
        // Window is on right side of mosaic, check for LEFT tiling
        const leftTiles = edgeTiledWindows.filter(w => {
            const state = edgeTiling.getWindowState(w.window);
            return state && (state.zone === edgeTiling.TileZone.LEFT_FULL ||
                           state.zone === edgeTiling.TileZone.TOP_LEFT ||
                           state.zone === edgeTiling.TileZone.BOTTOM_LEFT);
        });
        
        if (leftTiles.length > 0) {
            const state = edgeTiling.getWindowState(leftTiles[0].window);
            return {
                window: leftTiles[0].window,
                zone: state.zone,
                type: 'tiling'
            };
        }
        
        // No left tiles - return empty zone
        return {
            window: null,
            zone: edgeTiling.TileZone.LEFT_FULL,
            type: 'empty_tiling'
        };
    } else if (direction === 'right' && windowCenterX < centerX) {
        // Window is on left side of mosaic, check for RIGHT tiling
        const rightTiles = edgeTiledWindows.filter(w => {
            const state = edgeTiling.getWindowState(w.window);
            return state && (state.zone === edgeTiling.TileZone.RIGHT_FULL ||
                           state.zone === edgeTiling.TileZone.TOP_RIGHT ||
                           state.zone === edgeTiling.TileZone.BOTTOM_RIGHT);
        });
        
        if (rightTiles.length > 0) {
            const state = edgeTiling.getWindowState(rightTiles[0].window);
            return {
                window: rightTiles[0].window,
                zone: state.zone,
                type: 'tiling'
            };
        }
        
        // No right tiles - return empty zone
        return {
            window: null,
            zone: edgeTiling.TileZone.RIGHT_FULL,
            type: 'empty_tiling'
        };
    }
    
    return null;
}

/**
 * Find closest mosaic window in a direction
 * @private
 */
function findClosestMosaicInDirection(window, mosaicWindows, direction) {
    const windowFrame = window.get_frame_rect();
    const windowCenterX = windowFrame.x + windowFrame.width / 2;
    const windowCenterY = windowFrame.y + windowFrame.height / 2;
    
    // Filter candidates by direction - MUST be in the specified direction
    let candidates = mosaicWindows.filter(w => {
        if (w.get_id() === window.get_id()) return false;
        
        const frame = w.get_frame_rect();
        const centerX = frame.x + frame.width / 2;
        const centerY = frame.y + frame.height / 2;
        
        // For horizontal directions, also check vertical overlap
        // This prevents treating vertically stacked windows as horizontal neighbors
        if (direction === 'left' || direction === 'right') {
            // Check if there's vertical overlap between the windows
            const verticalOverlap = !(windowFrame.y + windowFrame.height <= frame.y || 
                                     frame.y + frame.height <= windowFrame.y);
            
            if (!verticalOverlap) {
                return false; // No vertical overlap, not a horizontal neighbor
            }
        }
        
        // Strict directional filtering
        switch (direction) {
            case 'left':
                return centerX < windowCenterX;
            case 'right':
                return centerX > windowCenterX;
            case 'up':
                return centerY < windowCenterY;
            case 'down':
                return centerY > windowCenterY;
            default:
                return false;
        }
    });
    
    if (candidates.length === 0) {
        return null;
    }
    
    // Find closest candidate based on direction
    let closest = candidates[0];
    let minDistance = Infinity;
    
    for (const candidate of candidates) {
        const frame = candidate.get_frame_rect();
        const centerX = frame.x + frame.width / 2;
        const centerY = frame.y + frame.height / 2;
        
        let distance;
        
        // Calculate distance based on direction
        switch (direction) {
            case 'left':
                distance = windowCenterX - centerX;
                break;
            case 'right':
                distance = centerX - windowCenterX;
                break;
            case 'up':
                distance = windowCenterY - centerY;
                break;
            case 'down':
                distance = centerY - windowCenterY;
                break;
            default:
                distance = Infinity;
        }
        
        if (distance < minDistance) {
            minDistance = distance;
            closest = candidate;
        }
    }
    
    return {
        window: closest,
        zone: null,
        type: 'mosaic'
    };
}

/**
 * Swap window with its neighbor in the given direction
 * @param {Meta.Window} window - Window to swap
 * @param {string} direction - 'left', 'right', 'up', 'down'
 */
export function swapWindow(window, direction) {
    const workspace = window.get_workspace();
    const monitor = window.get_monitor();
    
    console.log(`[MOSAIC WM] Swapping window ${window.get_id()} in direction: ${direction}`);
    
    // 1. Find neighbor
    const neighbor = findNeighbor(window, direction, workspace, monitor);
    
    if (!neighbor) {
        console.log('[MOSAIC WM] No neighbor found in direction:', direction);
        return false;
    }
    
    console.log(`[MOSAIC WM] Found neighbor type: ${neighbor.type}, zone: ${neighbor.zone}`);
    
    // 2. Determine swap type and execute
    const windowState = edgeTiling.getWindowState(window);
    const isWindowTiled = windowState && windowState.zone !== edgeTiling.TileZone.NONE;
    
    switch (neighbor.type) {
        case 'mosaic':
            if (isWindowTiled) {
                // Tiling → Mosaic
                return swapTiledWithMosaic(window, windowState.zone, neighbor.window, workspace, monitor);
            } else {
                // Mosaic ↔ Mosaic
                return swapMosaicWindows(window, neighbor.window, workspace, monitor);
            }
            
        case 'tiling':
            if (isWindowTiled) {
                // Tiling ↔ Tiling
                return swapTiledWindows(window, windowState.zone, neighbor.window, neighbor.zone, workspace, monitor);
            } else {
                // Mosaic → Tiling
                return swapMosaicWithTiled(window, neighbor.window, neighbor.zone, workspace, monitor);
            }
            
        case 'empty_tiling':
            // Tile to empty zone
            if (isWindowTiled) {
                // Already tiled, cannot tile to another zone without swap
                return false;
            } else {
                // Mosaic → Empty tiling zone
                return tileToEmptyZone(window, neighbor.zone, workspace, monitor);
            }
            
        case 'empty_tiling_expand':
            // Quarter tile expanding to FULL
            if (isWindowTiled && edgeTiling.isQuarterZone(windowState.zone)) {
                return expandQuarterToFull(window, windowState.zone, neighbor.zone, workspace, monitor);
            }
            return false;
            
        default:
            console.log('[MOSAIC WM] Unknown neighbor type:', neighbor.type);
            return false;
    }
}

/**
 * Swap windows via drag-and-drop
 * Called when dragging a window to an occupied tiling zone
 * @param {Meta.Window} draggedWindow - Window being dragged
 * @param {Meta.Window} targetWindow - Window in target zone
 * @param {number} targetZone - Zone being dragged to
 * @param {Meta.Workspace} workspace
 * @param {number} monitor
 * @returns {boolean} Success
 */
export function swapWindows(draggedWindow, targetWindow, targetZone, workspace, monitor) {
    console.log(`[MOSAIC WM] DnD Swap: ${draggedWindow.get_id()} → zone ${targetZone} (occupied by ${targetWindow.get_id()})`);
    
    // Check if dragging to same window (no-op)
    if (draggedWindow.get_id() === targetWindow.get_id()) {
        console.log('[MOSAIC WM] DnD Swap: dragging to same window, ignoring');
        return false;
    }
    
    const draggedState = edgeTiling.getWindowState(draggedWindow);
    const isDraggedTiled = draggedState && draggedState.zone !== edgeTiling.TileZone.NONE;
    
    if (isDraggedTiled) {
        // Tiling ↔ Tiling swap
        console.log(`[MOSAIC WM] DnD Swap: Tiling ↔ Tiling (${draggedState.zone} ↔ ${targetZone})`);
        return swapTiledWindows(draggedWindow, draggedState.zone, targetWindow, targetZone, workspace, monitor);
    } else {
        // Mosaic → Tiling swap
        console.log(`[MOSAIC WM] DnD Swap: Mosaic → Tiling (zone ${targetZone})`);
        return swapMosaicWithTiled(draggedWindow, targetWindow, targetZone, workspace, monitor);
    }
}

/**
 * Swap two mosaic windows
 * @private
 */
function swapMosaicWindows(window1, window2, workspace, monitor) {
    console.log(`[MOSAIC WM] Swapping mosaic windows: ${window1.get_id()} ↔ ${window2.get_id()}`);
    
    const id1 = window1.get_id();
    const id2 = window2.get_id();
    
    // Use existing swap system
    tiling.setTmpSwap(id1, id2);
    tiling.applyTmpSwap(workspace);
    
    // IMPORTANT: Clear tmp_swap to prevent it from being reapplied
    // This ensures the swap is permanent and won't be reverted
    tiling.clearTmpSwap();
    
    tiling.tileWorkspaceWindows(workspace, null, monitor, false);
    
    return true;
}

/**
 * Swap mosaic window with tiled window
 * @private
 */
function swapMosaicWithTiled(mosaicWindow, tiledWindow, tiledZone, workspace, monitor) {
    console.log(`[MOSAIC WM] Swapping mosaic ${mosaicWindow.get_id()} with tiled ${tiledWindow.get_id()} (zone ${tiledZone})`);
    
    // 1. Remove tiled window from tiling
    edgeTiling.removeTile(tiledWindow);
    
    // 2. Tile mosaic window to the zone (skip overflow check for swaps)
    const workArea = workspace.get_work_area_for_monitor(monitor);
    edgeTiling.applyTile(mosaicWindow, tiledZone, workArea, true);
    
    // Note: skipOverflowCheck=true prevents unwanted workspace moves during swap
    
    return true;
}

/**
 * Swap tiled window with mosaic window
 * @private
 */
function swapTiledWithMosaic(tiledWindow, tiledZone, mosaicWindow, workspace, monitor) {
    // Same as swapMosaicWithTiled, just reversed
    return swapMosaicWithTiled(mosaicWindow, tiledWindow, tiledZone, workspace, monitor);
}

/**
 * Swap two tiled windows
 * @private
 */
function swapTiledWindows(window1, zone1, window2, zone2, workspace, monitor) {
    console.log(`[MOSAIC WM] Swapping tiled windows: ${window1.get_id()} (zone ${zone1}) ↔ ${window2.get_id()} (zone ${zone2})`);
    
    const workArea = workspace.get_work_area_for_monitor(monitor);
    
    // Swap zones
    edgeTiling.applyTile(window1, zone2, workArea);
    edgeTiling.applyTile(window2, zone1, workArea);
    
    return true;
}

/**
 * Tile mosaic window to empty zone
 * @private
 */
function tileToEmptyZone(window, zone, workspace, monitor) {
    console.log(`[MOSAIC WM] Tiling window ${window.get_id()} to empty zone ${zone}`);
    
    const workArea = workspace.get_work_area_for_monitor(monitor);
    edgeTiling.applyTile(window, zone, workArea);
    
    return true;
}

/**
 * Expand quarter tile to FULL
 * @private
 */
function expandQuarterToFull(window, currentZone, targetZone, workspace, monitor) {
    console.log(`[MOSAIC WM] Expanding quarter tile ${window.get_id()} from zone ${currentZone} to ${targetZone}`);
    
    const workArea = workspace.get_work_area_for_monitor(monitor);
    edgeTiling.applyTile(window, targetZone, workArea);
    
    return true;
}
