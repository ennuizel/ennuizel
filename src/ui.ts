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

import * as uiCode from "./ui-code";

export const gebi = document.getElementById.bind(document);
export const dce = document.createElement.bind(document);

/**
 * The UI elements.
 */
export const ui = {
    // Main menu
    menu: {
        project: <HTMLButtonElement> null,
        tracks: <HTMLButtonElement> null,
        filters: <HTMLButtonElement> null
    },

    // Storage space indicator
    storageIndicator: <HTMLElement> null,

    // Main project space
    main: <HTMLElement> null,

    // Closers for dialogs
    closeable: <Dialog[]> [],

    // Zoomability
    utilityCSS: <HTMLStyleElement> null,
    zoom: 0.1
};

/**
 * Height of (audio) tracks.
 */
export const trackHeight = 128;

/**
 * Middle of the height of audio tracks.
 */
export const trackMiddle = trackHeight / 2;

/**
 * Pixels per second at zoom 1.
 */
export const pixelsPerSecond = 128;

/**
 * Load the UI.
 */
export function load() {
    // Load the UI
    document.body.innerHTML = uiCode.code;

    // And export it
    ui.menu = {
        project: gebi("b-project"),
        tracks: gebi("b-tracks"),
        filters: gebi("b-filters")
    };
    ui.storageIndicator = gebi("storage-indicator");
    ui.main = gebi("project");

    ui.utilityCSS = mk("style", document.body, {type: "text/css"});
    zoom();
}

/**
 * Load a library.
 * @param name  URL of the library to load.
 */
export function loadLibrary(name: string) {
    return new Promise((res, rej) => {
        const scr = dce("script");
        scr.addEventListener("load", res);
        scr.addEventListener("error", rej);
        scr.src = name;
        scr.async = true;
        document.body.appendChild(scr);
    });
}

// Set the zoom in CSS
function zoom() {
    ui.utilityCSS.innerText =
        ":root {" +
        "--zoom-wave: " + ui.zoom + ";" +
        "}";
}

/**
 * The parts of an open dialog.
 */
export interface Dialog {
    layerSeparator: HTMLElement;
    wrapper: HTMLElement;
    box: HTMLElement;
}

/**
 * Options for opening a dialog.
 */
export interface DialogOptions {
    reuse?: Dialog;
    closeable?: boolean;
    keepOpen?: boolean;
    forceClose?: boolean;
}

/**
 * Create a dialog box. Closes after the promise resolves.
 * @param callback  Function to call with the dialog box.
 * @param opts  Other options.
 */
export async function dialog<T>(callback: (x:Dialog) => Promise<T>,
    opts: DialogOptions = {}): Promise<T> {

    /* Create the parts. There's a layer separator, then some deeply nested
     * wrappers to make flexboxes center the dialog. */
    let d: Dialog;
    if (opts.reuse) {
        d = opts.reuse;
        d.box.innerHTML = "";

    } else {
        const layerSeparator = mk("div", document.body, {className: "layer-separator"});
        const wrapper1 = mk("div", document.body, {className: "dialog-wrapper"});
        mk("div", wrapper1, {className: "stretch"});
        const wrapper2 = mk("div", wrapper1, {className: "dialog-wrapper-inner"});
        mk("div", wrapper2, {className: "stretch"});
        const box = mk("div", wrapper2, {className: "dialog"});
        mk("div", wrapper2, {className: "stretch"});
        mk("div", wrapper1, {className: "stretch"});
        d = {layerSeparator, wrapper: wrapper1, box};

    }

    // Remove any previous closeability metadata
    if (opts.reuse) {
        const clIdx = ui.closeable.indexOf(d);
        if (clIdx >= 0)
            ui.closeable.splice(clIdx, 1);
    }

    // Make it closeable, if applicable
    if (opts.closeable) {
        const close = btn(d.box, "X", {className: "close-button"});
        close.onclick = () => dialogClose(d);
        mk("div", d.box).style.height = "2em";
        ui.closeable.push(d);
    }

    // Let the callback do its things
    let ret = await callback(d);

    /* Close it (closeable things are assumed to be kept open and closed by the
     * user) */
    if ((!opts.closeable && !opts.keepOpen) || opts.forceClose) {
        const idx = ui.closeable.indexOf(d);
        if (idx >= 0)
            ui.closeable.splice(idx, 1);
        try {
            document.body.removeChild(d.layerSeparator);
            document.body.removeChild(d.wrapper);
        } catch (ex) {}
    }

    return ret;
}

/**
 * Wrapper to quickly close a dialog box that's been kept open.
 */
export async function dialogClose(d: Dialog) {
    await dialog(async function() {}, {reuse: d});
}

// Handle closing with escape
document.body.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && ui.closeable.length) {
        dialogClose(ui.closeable.pop());
        ev.preventDefault();
    }
});

/**
 * Show a loading screen while performing some task.
 */
export function loading<T>(callback: (x:Dialog) => Promise<T>,
    opts: DialogOptions = {}): Promise<T> {

    return dialog(async function(d) {
        d.box.innerText = "Loading...";
        return await callback(d);
    }, Object.assign({
        closeable: false
    }, opts));
}

/**
 * Show an OK-only alert box.
 * @param html  innerHTML of the dialog.
 */
export async function alert(html: string) {
    await dialog(async function(d) {
        mk("div", d.box, {innerHTML: html + "<br/><br/>"});
        const ok = btn(d.box, "OK", {className: "row"});
        ok.focus();
        await new Promise(res => ok.onclick = res);
    });
}

// Standard interface elements

/**
 * Make an element.
 * @param el  Element type.
 * @param parent  Element to add it to.
 * @param opts  Attributes to set.
 */
export function mk(el: string, parent: HTMLElement, opts: any = {}) {
    const ret = dce(el);
    if (parent)
        parent.appendChild(ret);
    Object.assign(ret, opts);
    return ret;
}

/**
 * Make a <br/>
 * @param parent  Element to add it to.
 */
export function br(parent: HTMLElement) {
    return mk("br", parent);
}

/**
 * Make a <button/>
 * @param parent  Element to add it to.
 * @param innerHTML  Text of the button.
 * @param opts  Other options.
 */
export function btn(parent: HTMLElement, innerHTML: string, opts: any = {}) {
    return mk("button", parent, Object.assign({innerHTML}, opts));
}

/**
 * Make a <label/>
 * @param parent  Element to add it to.
 * @param htmlFor  ID of the element this label corresponds to.
 * @param innerHTML  Text of the label.
 * @param opts  Other options.
 */
export function lbl(parent: HTMLElement, htmlFor: string, innerHTML: string, opts: any = {}) {
    return mk("label", parent, Object.assign({htmlFor, innerHTML}, opts));
}

/**
 * Make an <input type="text"/>
 * @param parent  Element to add it to.
 * @param opts  Other options.
 */
export function txt(parent: HTMLElement, opts: any = {}) {
    return mk("input", parent, Object.assign({
        type: "text"
    }, opts));
}
