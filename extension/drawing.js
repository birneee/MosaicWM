import * as Logger from './logger.js';
/**
 * Drawing Manager
 * 
 * Handles visual feedback elements like:
 * - Debug rectangles (for drag debugging)
 * - Tile preview overlays (for edge tiling validation)
 */

import st from 'gi://St';
import * as main from 'resource:///org/gnome/shell/ui/main.js';

export class DrawingManager {
    constructor() {
        // Array of currently displayed feedback boxes
        this._boxes = [];
        
        // Tile preview overlay for edge tiling
        this._tilePreview = null;
        
        this._edgeTilingManager = null;
    }

    setEdgeTilingManager(manager) {
        this._edgeTilingManager = manager;
    }

    /**
     * Creates a visual feedback rectangle at the specified position.
     */
    rect(x, y, w, h) {
        // Hide edge tiling preview when showing mosaic preview
        this.hideTilePreview();
        
        const box = new st.Widget({ 
            style_class: "mosaic-preview",
            opacity: 200 // Ensure it's visible
        });
        box.set_position(x, y);
        box.set_size(w, h);
        
        this._boxes.push(box);
        main.uiGroup.add_child(box);
    }

    /**
     * Removes all visual feedback boxes from the screen.
     */
    removeBoxes() {
        for(let box of this._boxes) {
            main.uiGroup.remove_child(box);
        }
        this._boxes = [];
    }

    /**
     * Show edge tiling preview overlay
     */
    showTilePreview(zone, workArea, window = null) {
        // Hide mosaic preview when showing edge tiling preview
        this.removeBoxes();
        
        if (!this._edgeTilingManager) {
            Logger.warn('[MOSAIC WM] showTilePreview: EdgeTilingManager not set');
            return;
        }
        
        const rect = this._edgeTilingManager.getZoneRect(zone, workArea, window);
        if (!rect) return;
        
        if (!this._tilePreview) {
            this._tilePreview = new st.Widget({
                style_class: 'tile-preview',
                opacity: 128
            });
            main.uiGroup.add_child(this._tilePreview);
        }
        
        this._tilePreview.set_position(rect.x, rect.y);
        this._tilePreview.set_size(rect.width, rect.height);
        this._tilePreview.show();
    }

    /**
     * Hide edge tiling preview overlay
     */
    hideTilePreview() {
        if (this._tilePreview) {
            this._tilePreview.hide();
        }
    }

    /**
     * Clears all visual actors created by this module.
     */
    clearActors() {
        this.removeBoxes();
        if (this._tilePreview) {
            main.uiGroup.remove_child(this._tilePreview);
            this._tilePreview = null;
        }
        this._edgeTilingManager = null;
    }
}