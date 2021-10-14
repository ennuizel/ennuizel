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

// Support for alt hotkeys

import * as ui from "./ui";

// A hotkey registration
interface Hotkey {
    el: HTMLElement,
    dialog: ui.Dialog
}

// Currently registered hotkeys
const hotkeys: Record<string, Hotkey[]> = Object.create(null);

// Currently registered objects
const hotkeyObjects: Map<HTMLElement, string> = new Map();

// A global mutation observer removes hotkeys when objects disappear
const observer = new MutationObserver(muts => {
    for (const mut of muts) {
        for (let ei = 0; ei < mut.removedNodes.length; ei++) {
            const el = <HTMLElement> mut.removedNodes[ei];
            const key = hotkeyObjects.get(el);
            if (key)
                unregisterHotkey(el);
        }
    }
});

/**
 * Register a hotkey.
 * @param el  The element to click when the hotkey is pressed.
 * @param dialog  The dialog that the hotkey element is contained in, or null
 *                if it's not in a dialog.
 * @param key  The hot key itself.
 */
export function registerHotkey(
    el: HTMLElement, dialog: ui.Dialog, key: string
) {
    if (!(key in hotkeys))
        hotkeys[key] = [];
    hotkeys[key].unshift({el, dialog});
    hotkeyObjects.set(el, key);
    observer.observe(el.parentNode, { childList: true });
}

/**
 * Unregister an element's hotkey.
 * @param el  The element.
 */
export function unregisterHotkey(el: HTMLElement) {
    const key = hotkeyObjects.get(el);
    if (!key)
        return;

    const hks = hotkeys[key];
    if (!hks)
        return;

    const idx = hks.findIndex(x => x.el === el);
    if (idx >= 0)
        hks.splice(idx, 1);
    hotkeyObjects.delete(el);
}

/**
 * Make a button with a hotkey.
 * @param parent  The dialog to place the button in.
 * @param lbl  The label for the button, including an _ before the letter
 *             representing the hotkey.
 * @param opts  Other options.
 */
export function btn(parent: ui.Dialog, lbl: string, opts: any = {}) {
    // Find the hotkey
    let hotkey: string = null;
    const idx = lbl.indexOf("_");
    if (idx >= 0) {
        hotkey = lbl[idx+1].toLowerCase();
        lbl = lbl.slice(0, idx) + "<u>" + lbl[idx+1] + "</u>" + lbl.slice(idx+2);
    }

    // Make the button
    const ret = ui.btn(parent.box, lbl, opts);

    // Make the hotkey
    if (hotkey)
        registerHotkey(ret, parent, hotkey);

    return ret;
}

// The actual hotkey handler
document.body.addEventListener("keydown", ev => {
    if (!ev.altKey || ev.ctrlKey || ev.shiftKey)
        return;

    // Look for a matching hotkey
    const hks = hotkeys[ev.key];
    if (!hks)
        return;

    // Look for a matching element
    for (const hk of hks) {
        if (hk.dialog) {
            // Make sure it's the topmost dialog
            if (ui.ui.dialogs.length === 0 ||
                ui.ui.dialogs[ui.ui.dialogs.length-1] !== hk.dialog)
                continue;

        } else {
            // Make sure there is no dialog
            if (ui.ui.dialogs.length !== 0)
                continue;

        }

        // Perform this hotkey
        ev.preventDefault();
        hk.el.click();
        break;
    }
});
