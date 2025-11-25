/**
 * Drawing Module
 * 
 * This module provides visual feedback during window operations.
 * It creates temporary visual boxes (masks) to show where windows will be positioned
 * during drag-and-drop reordering operations.
 */

import st from 'gi://St';
import * as main from 'resource:///org/gnome/shell/ui/main.js';

// Array of currently displayed feedback boxes
var boxes = [];

/**
 * Creates a visual feedback rectangle at the specified position.
 * Used to show where a window will be positioned during drag operations.
 * The box uses the 'feedforward' CSS class from stylesheet.css.
 * 
 * @param {number} x - X position of the box
 * @param {number} y - Y position of the box
 * @param {number} width - Width of the box
 * @param {number} height - Height of the box
 */
export function rect(x, y, width, height) {
    const box = new st.BoxLayout({ style_class: "feedforward" });
    box.x = x;
    box.y = y;
    box.width = width;
    box.height = height;
    boxes.push(box);
    main.uiGroup.add_child(box);
}

/**
 * Removes all visual feedback boxes from the screen.
 * Called when a drag operation ends or is cancelled.
 */
export function removeBoxes() {
    for(let box of boxes)
        main.uiGroup.remove_child(box);
    boxes = [];
}

/**
 * Clears all visual actors created by this module.
 * Called during extension disable to clean up.
 */
export function clearActors() {
    removeBoxes();
}