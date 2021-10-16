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

// License info (for the about box)
const licenseInfo =
`
===
Ennuizel
===

Copyright (c) 2021 Yahweasel

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.


===
bytes (https://github.com/visionmedia/bytes.js)
===

(The MIT License)

Copyright (c) 2012-2014 TJ Holowaychuk <tj@vision-media.ca>
Copyright (c) 2015 Jed Watson <jed.watson@me.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


===
StreamSaver (https://github.com/jimmywarting/StreamSaver.js)
===

The MIT License (MIT)

Copyright (c) 2016-2021 Jimmy Karl Roland Wärting

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;


// extern
declare let LibAV: any, localforage: any;

import * as audio from "./audio";
import * as avthreads from "./avthreads";
import * as filters from "./filters";
import * as project from "./project";
import * as select from "./select";
import * as store from "./store";
import * as ui from "./ui";

import * as streamsaver from "streamsaver";
import { WritableStream } from "web-streams-polyfill/ponyfill";

(async function() {
    ui.load();
    await ui.loading(async function(d) {
        // Load our core libraries

        // libav.js
        if (typeof LibAV === "undefined") {
            LibAV = {base: "libav/"};
            await ui.loadLibrary("libav/libav-2.4.4.4-fat.js");
        }

        // localforage
        if (typeof localforage === "undefined")
            await ui.loadLibrary("localforage.min.js");

        // StreamSaver.js
        streamsaver.mitm = "StreamSaver/mitm.html";
        streamsaver.WritableStream = WritableStream;

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

        // Load all the components that need loading
        await avthreads.load();
        await filters.load();
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

        ui.dialog(async function(d, show) {
            errorDialog = d;
            d.box.innerHTML = html;
            show(null);
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

    // And make an about screen
    ui.ui.menu.about.onclick = () => {
        ui.dialog(async function(d, show) {
            const about = ui.mk("div", d.box, {
                innerHTML: 'This is Ennuizel, an audio editor in your web browser! Ennuizel is not “cloud”-based: everything is saved locally in your browser\'s local storage space. Ennuizel is <a href="https://github.com/Yahweasel/ennuizel">open source</a>.<br/><br/>License info:'
            });
            about.style.maxWidth = "45rem";

            const li = ui.mk("textarea", d.box, {
                readOnly: true,
                innerHTML: licenseInfo,
                className: "row"
            });
            Object.assign(li.style, {
                display: "block",
                width: "45rem",
                height: "20em"
            });

            const ok = ui.btn(d.box, "OK", {className: "row"});
            ok.style.width = "45rem";
            ok.onclick = () => ui.dialogClose(d);

            show(ok);
        }, {
            closeable: true
        });
    };

})();

export {ui, project};
