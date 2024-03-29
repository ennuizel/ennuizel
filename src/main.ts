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

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../ennuizel.d.ts" />

// License info (for the about box)
const licenseInfo =
`
The licenses below cover software which is compiled into ennuizel.js. For other
included software, consult the licenses in their files.


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
FileSaver (https://github.com/eligrey/FileSaver.js/)
===

The MIT License

Copyright © 2016 [Eli Grey][1].

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

  [1]: http://eligrey.com


===
client-zip
===

Copyright 2020 David Junger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

// extern
declare let LibAV: any, localforage: any;

import * as avthreads from "./avthreads";
import * as downloadStream from "./download-stream";
import * as filters from "./filters";
import * as plugins from "./plugins";
import * as project from "./project";
import * as select from "./select";
import * as store from "./store";
import * as ui from "./ui";

import * as wsp from "web-streams-polyfill/ponyfill";

/* Ennuizel itself, as interpreted as a plugin, to make the about box easier to
 * fill */
const ennuizelPlugin: ennuizel.Plugin = {
    name: "Ennuizel",
    id: "ennuizel",
    infoURL: "https://github.com/ennuizel/ennuizel",

    description: 'This is Ennuizel, an audio editor in your web browser! Ennuizel is not “cloud”-based: everything is saved locally in your browser\'s local storage space. Ennuizel is <a href="https://github.com/ennuizel/ennuizel">open source</a>.',

    licenseInfo
};

(async function() {
    ui.load();

    // General-purpose error handler
    let errorDialog: ui.Dialog = null;
    async function onError(msg: string) {
        const html = msg
            // eslint-disable-next-line no-useless-escape
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

    await ui.loading(async function(d) {
        // Load our core libraries

        // libav.js
        if (typeof LibAV === "undefined") {
            LibAV = {base: "libav/"};
            await ui.loadLibrary("libav/libav-2.5.4.4-fat.js");
        }

        // localforage
        if (typeof localforage === "undefined")
            await ui.loadLibrary("localforage.min.js");

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
        await downloadStream.load();
        await filters.load();
        await project.load();
        await select.load();
        await store.load();

        await plugins.load();

        // Load any plugins specified by the configuration file
        let wizard: (d: ui.Dialog) => Promise<void> = null;
        let postWizard: (project: project.Project) => Promise<void> = null;
        try {
            const response = await fetch("ennuizel.json", {
                cache: "no-cache"
            });
            const config = await response.json();
            for (const url of <string[]> config.plugins) {
                const plugin = await plugins.loadPlugin(url);
                if (plugin) {
                    if (plugin.wizard)
                        wizard = plugin.wizard;
                    if (plugin.postWizard)
                        postWizard = plugin.postWizard;
                }
            }
        } catch (ex) {
            console.error(ex);
        }

        /* The visibility of the wizard button depends on the existence of a
         * post-wizard */
        if (postWizard) {
            ui.ui.menu.wizard.style.display = "";
            ui.ui.menu.wizard.onclick = function() {
                postWizard(project.project);
            };
        }

        // Run any wizard
        if (wizard)
            await wizard(d);
    });

    // And make an about screen
    ui.ui.menu.about.onclick = () => {
        const plugs = plugins.getPlugins();
        if (plugs.length === 0) {
            // No plugins, just show the help for Ennuizel itself
            about(null, ennuizelPlugin);
            return;
        }

        // Make a dialog to ask which plugin they're querying
        ui.dialog(async function(d, show) {
            const ez = ui.btn(d.box, "About Ennuizel", {className: "row small"});
            ez.onclick = () => about(d, ennuizelPlugin);

            for (const plug of plugs) {
                const btn = ui.btn(d.box, "About " + plug.name, {className: "row small"});
                btn.onclick = () => about(d, plug);
            }

            show(ez);
        }, {
            closeable: true
        });
    };

})();

// Handler for "about" screens
function about(d: ui.Dialog, plugin: ennuizel.Plugin) {
    ui.dialog(async function(d, show) {
        const header = ui.mk("h2", d.box);
        ui.mk("a", header, {
            href: plugin.infoURL,
            innerText: plugin.name
        });

        const about = ui.mk("div", d.box, {
            innerHTML: plugin.description + "<br/><br/>License info:"
        });
        about.style.maxWidth = "45rem";

        const li = ui.mk("textarea", d.box, {
            readOnly: true,
            innerHTML: plugin.licenseInfo,
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
        closeable: true,
        reuse: d
    });
}

export {ui, project};
