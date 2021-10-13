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

// extern
declare let LibAV: any, localforage: any;

import * as audio from "./audio";
import * as avthreads from "./avthreads";
import * as ui from "./ui";
import * as project from "./project";
import * as select from "./select";
import * as store from "./store";

(async function() {
    ui.load();
    await ui.loading(async function(d) {
        // Load our core libraries

        // localforage
        if (typeof localforage === "undefined")
            await ui.loadLibrary("localforage.min.js");

        // libav.js
        if (typeof LibAV === "undefined") {
            LibAV = {base: "libav/"};
            await ui.loadLibrary("libav/libav-2.4.4.4-fat.js");
        }

        /* The technique to get persistence (which also implies larger/no
         * quota) is complicated. On Firefox, if you request persitence, it
         * will simply pop up a dialog asking the user for persistence. On
         * Chrome, no such dialog exists, and instead it's a convoluted mess of
         * "if the page has this other property, I'll give them persistence".
         * To deal with this, we:
         * (1) Ask for persistence
         * (2) If we don't have persistence, ask for notifications, which are one
         *     feature that Chrome will turn into persistence permission
         * (3) Ask for persistence again
         */
        let persistent = false;
        if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
            persistent = await navigator.storage.persisted();
            if (!persistent) {
                await ui.alert("To handle large projects, this tool must have permission for persistent local storage. On some browsers, this permission is given through the notifications permission, so please accept that request if it is asked.");
                persistent = await navigator.storage.persist();
            }
            if (!persistent && typeof Notification !== "undefined" && Notification.requestPermission) {
                await Notification.requestPermission();
                persistent = await navigator.storage.persist();
            }

            if (!persistent)
                await ui.alert("Failed to acquire permission for persistent storage. Large projects will fail.");
        }

        await avthreads.load();
        await project.load();
        await select.load();
        await store.load();

    });

    // Now handle errors
    let errorDialog: ui.Dialog = null;
    async function onError(msg: string) {
        let html = msg
            .replace(/\&/g, "&nbsp;")
            .replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\n/g, "<br/>");

        ui.dialog(async function(d) {
            errorDialog = d;
            d.box.innerHTML = html;
        }, {
            reuse: errorDialog,
            closeable: false,
            keepOpen: true
        });
    }

    window.addEventListener("error", ev => {
        onError(ev.message + " @ " + ev.filename + ":" + ev.lineno);
    });
    window.addEventListener("unhandledrejection", ev => {
        onError(
            (typeof ev.reason === "object" && ev.reason !== null && ev.reason.stack) ?
            ("" + ev.reason + "\n" + ev.reason.stack) :
            ("" + ev.reason)
        );
    });

})();

export {ui, project};
