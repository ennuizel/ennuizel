/*
 * Copyright (c) 2021 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// Components related to selecting parts of a track

import * as ui from "./ui";

/**
 * A selectable entity. Should be a track.
 */
export interface Selectable {
    /**
     * The underlying track.
     */
    track: any;

    /**
     * The <div> over which a selection box can be overlain.
     */
    wrapper: HTMLElement;

    /**
     * The actual selection box. Use addSelectable to fill this in.
     */
    display?: HTMLCanvasElement;

    /**
     * Get the duration of this track, in seconds.
     */
    duration: () => number;
}

/**
 * All of the selectable entities currently known.
 */
let selectables: Selectable[] = [];

/**
 * When durations change and such, it's not necessary for the client to wait
 * for the async function, but it *is* necessary for us to synchronize
 * everything, so we have a single global Promise to do so.
 */
let selPromise: Promise<unknown> = Promise.all([]);

/**
 * The current selection range, in time, plus the anchor, used during selection
 * to decide whether to switch to range-selection mode.
 */
let selectStart = 0, selectEnd = 0,
    selectAnchor: number = null, selectAnchorTime = 0;

/**
 * Set if we're currently selecting a range.
 */
let activeSelectingRange = false;

/**
 * The current selected selectable(s).
 */
let selectedEls: Set<Selectable> = new Set();

/**
 * The play head, only visible while playing audio.
 */
export let playHead: number = null;

/**
 * Add a selectable.
 * @param sel  Selectable to add.
 */
export async function addSelectable(sel: Selectable) {
    // Make the selection canvas
    const c = sel.display = ui.mk("canvas", sel.wrapper, {
        width: 1280, // Will be updated automatically
        height: ui.trackHeight
    });
    Object.assign(c.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        height: ui.trackHeight + "px"
    });
    selectables.push(sel);
    if (selectedEls.size === 0)
        selectedEls.add(sel);

    // Make sure it actually is selectable
    c.addEventListener("mousedown", ev => {
        selectStart = selectEnd = selectAnchorTime =
            ev.offsetX / (ui.pixelsPerSecond * ui.ui.zoom);
        selectAnchor = ev.offsetX;
        selectedEls.clear();
        selectedEls.add(sel);
        activeSelectingRange = false;
        console.log("Select start: " + selectStart);
        updateDisplay();
    });

    c.addEventListener("mousemove", ev => {
        if (selectAnchor === null)
            return;

        // Make sure we're in the selection
        if (!selectedEls.has(sel))
            selectedEls.add(sel);

        // Decide whether to do range selection
        if (!activeSelectingRange && Math.abs(ev.offsetX - selectAnchor) >= 16)
            activeSelectingRange = true;

        // Update the range selection
        const time = ev.offsetX / (ui.pixelsPerSecond * ui.ui.zoom);
        if (activeSelectingRange) {
            if (time < selectAnchorTime) {
                selectStart = time;
                selectEnd = selectAnchorTime;
            } else {
                selectStart = selectAnchorTime;
                selectEnd = time;
            }

        } else {
            selectStart = selectEnd = time;

        }

        updateDisplay();
    });

    await updateDurations();
}

// When we lift the mouse *anywhere*, unanchor
document.body.addEventListener("mouseup", ev => {
    if (selectAnchor !== null)
        selectAnchor = null;
});

// Home and end should set the start and end times
document.body.addEventListener("keydown", async function(ev) {
    if (selectAnchor !== null)
        return;

    if (ev.key === "Home") {
        selectStart = selectEnd = 0;
        updateDisplay();

    } else if (ev.key === "End") {
        selectStart = selectEnd = await updateDurations();
        updateDisplay();

    } else if (ev.key === "a" && ev.ctrlKey) {
        ev.preventDefault();
        selectEnd = selectStart;
        for (const sel of selectables)
            selectedEls.add(sel);
        updateDisplay();

    }
});

/**
 * Remove a selectable, based on the underlying track.
 * @param track  Track to remove.
 */
export async function removeSelectable(track: any) {
    const [sel] = selectables.filter(x => x.track === track);
    if (sel) {
        const idx = selectables.indexOf(sel);
        selectables.splice(idx, 1);
        await updateDurations();
    }
}

/**
 * Clear all selectables.
 */
export async function clearSelectables() {
    selectables = [];
    selectStart = selectEnd = 0;
    selectedEls.clear();
}

/**
 * Interface for the current selection.
 */
export interface Selection {
    range: boolean;
    start: number;
    end: number;
    els: Set<Selectable>;
}

/**
 * Get the current selection.
 */
export function getSelection(): Selection {
    return {
        range: (selectStart !== selectEnd),
        start: selectStart,
        end: selectEnd,
        els: new Set(selectedEls)
    };
}

/**
 * Update our durations, and with them, the width of all our selectables. You
 * usually don't need to await the result of this, unless you want the total
 * duration.
 */
export async function updateDurations() {
    let duration = 0;

    // Make sure we only run one updateDurations at a time
    await selPromise;

    selPromise = (async function() {
        // Get the max duration (plus a bit of buffer for floating point madness)
        for (const sel of selectables)
            duration = Math.max(duration, sel.duration());

        // Convert to pixels
        const width = Math.round((duration+1) * ui.pixelsPerSecond * ui.ui.zoom);

        // And make all our canvases the right size
        for (const sel of selectables)
            sel.display.width = width;
    })();

    // Update the display when we update the durations
    await updateDisplay();

    return duration;
}

/**
 * Set the play head.
 * @param to  Value to set the play head to.
 */
export async function setPlayHead(to: number) {
    playHead = to;
    await updateDisplay();
}

// The animation frame currently being awaited
let animationFrame: number = null;

/**
 * Update the selection display.
 */
async function updateDisplay() {
    await selPromise;

    if (animationFrame !== null) {
        // Somebody else is handling this already
        return;
    }

    // Wait for an animation frame
    await new Promise(res => {
        animationFrame = window.requestAnimationFrame(() => {
            animationFrame = null;
            res(null);
        });
    });

    selPromise = (async function() {
        console.log("Updating display");

        // Figure out where we're drawing
        const selectingRange = (selectStart !== selectEnd);
        const startPx = Math.floor(selectStart * ui.pixelsPerSecond * ui.ui.zoom);
        const endPx = Math.max(
            Math.ceil(selectEnd * ui.pixelsPerSecond * ui.ui.zoom),
            startPx + 1
        );
        const playHeadPx = (playHead === null) ? null : Math.floor(
            playHead * ui.pixelsPerSecond * ui.ui.zoom
        );

        // And draw it
        for (const sel of selectables) {
            const ctx = sel.display.getContext("2d");
            const w = sel.display.width;
            ctx.clearRect(0, 0, w, ui.trackHeight);

            // Don't show the selection if we're not selected
            if (selectedEls.has(sel)) {
                if (selectingRange) {
                    // Highlight whatever is selected
                    ctx.fillStyle = "rgba(255,255,255,0.5)";
                    ctx.fillRect(startPx, 0, endPx - startPx, ui.trackHeight);

                } else {
                    // Just draw a line for the point selected
                    ctx.fillStyle = "#fff";
                    ctx.fillRect(startPx, 0, 1, ui.trackHeight);

                }
            }

            // Also draw the play head
            if (playHeadPx !== null) {
                ctx.fillStyle = "#fff";
                ctx.fillRect(playHeadPx, 0, 1, ui.trackHeight);
            }
        }
    })();

    await selPromise;
}
