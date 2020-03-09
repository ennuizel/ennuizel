/*
 * Copyright (c) 2019, 2020 Yahweasel
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

var body = document.body;
var dce = document.createElement.bind(document);

// All of the track views, by ID
var trackViews;

// The width and height of a fragment as *drawn*
var fragmentWidthPx = 512, fragmentHeightPx = 128;

// Blank anything that's already there
body.innerHTML = "";

// A utility function to make elements easily
function mke(cont, type, opts) {
    if (typeof opts === "undefined") opts = {};
    var ret = dce(type);
    if (opts["class"])
        ret.classList.add(opts["class"]);
    if (opts.classes)
        ret.classList.add.apply(ret.classList, opts.classes);
    if (opts.id)
        ret.id = opts.id;
    if (opts["for"])
        ret.htmlFor = opts["for"];
    if (opts.text)
        ret.innerText = opts.text;
    if (opts.html)
        ret.innerHTML = opts.html;
    if (cont)
        cont.appendChild(ret);
    return ret;
}
ez.mke = mke;

// Set up our overall layout
var utilityCSS = mke(document.head, "style");
var menuBar = mke(body, "div", {"class": "menu"});
var menuTitle = mke(menuBar, "div", {classes: ["menutitle", "menuline"]});
var mainMenu = mke(menuBar, "div", {"class": "menuline"});
var subMenu = mke(menuBar, "div", {"class": "menuline"});
var zoomerBox = mke(menuBar, "div");
var zoomer = mke(zoomerBox, "input");
zoomer.type = "range";
zoomer.min = 2;
zoomer.max = fragmentWidthPx;
zoomer.style.width = "100%";
zoomer.style.maxWidth = "20em";
zoomer.onchange = zoomer.oninput = doZoomer;

var trackContainer = mke(body, "div", {"class": "trackcontainer"});
var trackSpace = mke(trackContainer, "div", {"class": "trackspace"});

var modalPop = mke(body, "div", {"class": "modalpop"});
// NOTE: This loading message cannot be translated, as we haven't loaded the locale yet
var modalDialog = mke(body, "div", {"class": "modal", text: "Loading..."});
var modalVisible = true;
ez.modalDialog = modalDialog;

// Set all the elements to their correct locations/sizes
function resetElements() {
    // Track space needs to skip the menu bar
    trackContainer.style.paddingTop = menuBar.offsetHeight + "px";

    // Need the window size to fit the modal to it
    var w = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    // Start the modal dialog in a very open-ended mode to draw into
    var maxWidthSet = true;
    modalDialog.style.width = modalDialog.style.height = modalDialog.style.overflow = "";
    modalDialog.style.maxWidth = "30em";

    /* In order to get the modal dialog into the right place, we need to
     * actually let it draw, so we run this function as a timeout */
    function resetModal() {
        if (modalDialog.offsetHeight > h && maxWidthSet) {
            // We may have made it impossible to fit with the max width, so let it expand
            modalDialog.style.maxWidth = "";
            maxWidthSet = false;
            setTimeout(resetModal, 0);
            return;
        }

        if (modalDialog.offsetWidth > w || modalDialog.offsetHeight > h) {
            // It's too big, so make it fullscreen
            modalDialog.style.width = w + "px";
            modalDialog.style.height = h + "px";
            modalDialog.style.overflow = "auto";
        }

        // Center it
        var newX = Math.round((w - modalDialog.offsetWidth) / 2);
        var newY = Math.round((h - modalDialog.offsetHeight) / 2);
        modalDialog.style.left = newX + "px";
        modalDialog.style.top = newY + "px";
    }

    setTimeout(resetModal, 0);
}
resetElements();
ez.resetElements = resetElements;

/* We may have many promise chains going in parallel, but only want one modal
 * dialog at a time. So, we have a *separate* promise chain just for modal
 * dialogs, and you must wait on it to use a modal. */
var modalPromise = Promise.all([]);

// When the modal returns to a "default" state, it shows this text
var modalSimpleText = null;

/* Wait for the modal dialog. Returned promise resolves to a function which you
 * must call to unlock the next modal dialogue */
function modalWait() {
    return new Promise(function(res) {
        modalPromise = modalPromise.then(function() {
            return new Promise(function(unlock) {
                res(unlock);
            });
        }).then(modalAuto);
    });
}
ez.modalWait = modalWait;

// Show/hide the modal dialog. Only use while you own the modal dialog
function modalToggle(show) {
    if (typeof show === "undefined") show = !modalVisible;
    modalVisible = show;
    if (show) {
        modalPop.style.display = modalDialog.style.display = "block";
        resetElements();
    } else {
        modalPop.style.display = modalDialog.style.display = "none";
    }
}
ez.modalToggle = modalToggle;

// Show the modal simple text
function modalAuto() {
    if (modalSimpleText) {
        modalDialog.innerText = modalSimpleText;
        modalToggle(true);
    } else {
        modalToggle(false);
    }

    // Unlock immediately
}
ez.modalAuto = modalAuto;

// Show this modal text. Safe to use unsafely (?), ignoring the resulting promise.
function modal(txt) {
    return modalWait().then(function(unlock) {
        modalSimpleText = (txt || null);
        modalAuto();
        unlock();
    });
}
ez.modal = modal;

// Common case of showing an error
function error(ex) {
    // Intentionally not returned
    modalWait().then(function(unlock) {
        modalDialog.innerHTML = "";

        if (ex instanceof Error) {
            ex = ex + "\n\n" + ex.stack;
        } else if (typeof ex === "object") {
            try {
                ex = JSON.stringify(ex);
            } catch (err) {}
        }

        mke(modalDialog, "div", {text: l("error") + "\n\n" + l("errordetails") + ": " + ex + "\n\n"});
        var resB = mke(modalDialog, "button", {text: l("restart")});
        mke(modalDialog, "span", {text: "  "});
        var del = mke(modalDialog, "button", {text: l("deleteproject")});

        modalToggle(true);
        resB.focus();

        resB.onclick = function() {
            unlock();
            restart();
        };
        del.onclick = function() {
            unlock();
            deleteProjectDialog();
        };

    });

    // Kill the rest of this promise chain
    return new Promise(function(){});
}
ez.error = error;

// Common case of showing a hidable warning
function warn(ex) {
    return modalWait().then(function(unlock) {
        modalDialog.innerHTML = "";

        if (ex instanceof Error) {
            ex = ex + "\n\n" + ex.stack;
        } else if (typeof ex === "object") {
            try {
                ex = JSON.stringify(ex);
            } catch (err) {}
        }

        mke(modalDialog, "div", {text: ex + "\n\n"});
        var button = mke(modalDialog, "button", {text: l("ok")});

        modalToggle(true);
        button.focus();

        return new Promise(function(res, rej) {
            button.onclick = function() {
                unlock();
                modal();
                res();
            };
        });
    });
}
ez.warn = warn;

// The menu, not filled until we've loaded our locale
var menu = null;
var filterMenu = null;

function loadMenu() {
    ez.menu = menu = [
        {
            name: l("project"),
            sub: [
                {
                    name: l("importtrack"),
                    on: importTrackDialog
                },
                {
                    name: l("export"),
                    on: exportProjectDialog
                },
                {
                    name: l("switchproject"),
                    on: restart
                },
                {
                    name: l("deleteproject"),
                    on: deleteProjectDialog
                }
            ]
        },
        {
            name: l("filters"),
            sub: [],
            last: [
                {
                    name: l("mix"),
                    on: mixSimple
                },
                {
                    name: l("mixlevel"),
                    on: mixLevel
                },
                {
                    name: l("mixnew"),
                    on: mixSimpleKeep
                },
                {
                    name: l("mixlevelnew"),
                    on: mixLevelKeep
                }
            ]
        }
    ];

    ez.filterMenu = filterMenu = menu[1];

    // Get in the ff filters
    menuConvertFilters();

    // And add the rest
    filterMenu.sub = filterMenu.sub.concat(filterMenu.last);
    delete filterMenu.last;

}

var menuSelected = null;

// Display the main menu in its current state and update all elements
function showMenu() {
    mainMenu.innerHTML = "";

    menu.forEach(function(item) {
        var el;
        if (!item.el) {
            el = item.el = mke(null, "button", {
                "class": "menuitem",
                text: item.name
            });
            if (item.on)
                el.onclick = item.on;
            else
                el.onclick = function() {
                    menuClick(item);
                };
        } else {
            el = item.el;
        }
        mainMenu.appendChild(el);
    });

    showSubmenu();
}
ez.showMenu = showMenu;

// Update the current submenu
function showSubmenu() {
    // Now update all the subelements
    subMenu.innerHTML = "";
    menu.forEach(function(item) {
        var el;
        if (!item.on && !item.subel) {
            el = item.subel = mke(null, "div", {"class": "submenu"});
            item.sub.forEach(function(subitem) {
                var sel;
                if (!subitem.el) {
                    sel = subitem.el = mke(null, "button", {
                        classes: ["menuitem", "menusubitem"],
                        text: subitem.name
                    });
                    sel.onclick = function() {
                        submenuClick(item, subitem);
                    };
                } else {
                    sel = subitem.el;
                }
                el.appendChild(sel);
            });
        } else {
            el = item.subel;
        }
        if (menuSelected === item)
            subMenu.appendChild(el);
    });

    resetElements();
}

// Main menu click
function menuClick(item) {
    if (modalVisible)
        return;
    if (menuSelected === item) {
        item.el.classList.remove("menuselected");
        menuSelected = null;
    } else {
        if (menuSelected)
            menuSelected.el.classList.remove("menuselected");
        menuSelected = item;
        item.el.classList.add("menuselected");
    }
    showSubmenu();
}

// Sub-menu click
function submenuClick(item, subitem) {
    if (modalVisible)
        return;
    try {
        subitem.on().then(function() {
            if (menuSelected) {
                menuSelected.el.classList.remove("menuselected");
                menuSelected = null;
            }
            showMenu();
        }).catch(error);
    } catch (ex) {
        error(ex);
    }
}

// Built-in filters
function ffparam(nm, desc, db, def, min, max) {
    var ret = {
        name: desc,
        ff: nm,
        type: typeof def
    };
    switch (typeof def) {
        case "string":
        case "boolean":
            ret["default"] = def;
            break;

        default: // number
            ret.db = db;
            ret["default"] = def;
            ret.min = min;
            ret.max = max;
    }
    return ret;
}

// NOTE: For the time being, we never translate the ff filters
var fffilters = [
    {
        name: "Compressor",
        ff: "acompressor",
        params: [
            ffparam("level_in", "Pre-amplify", true, 1, 0.015625, 64),
            ffparam("threshold", "Threshold", true, 0.125, 0.00097563, 1),
            ffparam("ratio", "Ratio denominator", false, 2, 1, 20),
            ffparam("attack", "Attack time (ms)", false, 20, 0.01, 2000),
            ffparam("release", "Release time (ms)", false, 250, 0.01, 9000),
            ffparam("makeup", "Post-amplify", true, 2, 1, 64),
            ffparam("knee", "Threshold knee softening", false, 2.82843, 1, 8)
        ]
    },
    {
        name: "Echo",
        ff: "aecho",
        params: [
            ffparam("in_gain", "Pre-amplify", true, 0.6, 0.01, 64),
            ffparam("out_gain", "Post-amplify", true, 0.3, 0.01, 64),
            ffparam("delays", "Delays", false, "1000"),
            ffparam("decays", "Decays", false, "0.5")
        ]
    },
    {
        name: "Limiter",
        ff: "alimiter",
        params: [
            ffparam("level_in", "Pre-amplify", true, 1, 0.01, 64),
            ffparam("level_out", "Post-amplify", true, 1, 0.01, 64),
            ffparam("limit", "Limit", true, 1, 0, 1),
            ffparam("attack", "Attack time (ms)", false, 5, 0.01, 2000),
            ffparam("release", "Release time (ms)", false, 50, 0.01, 10000),
            ffparam("level", "Auto-level output?", false, true)
        ]
    },
    {
        name: "Tempo",
        ff: "atempo",
        params: [
            ffparam(null, "Tempo", false, 1, 0.5, 2)
        ]
    },
    {
        name: "Dynamic audio normalizer (leveler)",
        ff: "dynaudnorm",
        params: [
            ffparam("f", "Frame length (ms)", false, 500, 10, 8000),
            ffparam("g", "Gaussian filter window size", false, 31, 3, 301),
            ffparam("p", "Target peak", true, 0.95, 0, 1),
            ffparam("m", "Maximum gain", true, 10, 1, 100),
            ffparam("r", "Target RMS vs peak", false, 0, 0, 1),
            ffparam("s", "Compression factor", false, 0, 0, 30)
        ]
    },
    {
        name: "Volume",
        ff: "volume",
        params: [
            ffparam("volume", "Volume", true, 1, 0, 10)
        ]
    },
    {
        name: "FFmpeg filter graph (advanced)",
        ff: null,
        params: [
            ffparam(null, "Filter graph", false, "anull")
        ]
    }
];

// Convert fffilters into a the filters menu
function menuConvertFilters() {
    fffilters.forEach(function(filter) {
        if (filter.menu) return; // Don't re-create

        // Make a menu for this filter
        var menu = filter.menu = {
            name: filter.name,
            on: function() { return libAVFilterDialog(filter); }
        };

        // Add it to the menu
        filterMenu.sub.push(menu);
    });
}

// Zooming is done via CSS
var partWidth = 64;
var partHeight = 128;
function zoomBy(x, y) {
    if (x)
        partWidth *= x;
    if (y)
        partHeight *= y;
    zoom();
}

function zoom() {
    utilityCSS.innerText = ".trackpart { " +
        "width: " + partWidth + "px; " +
        "height: " + partHeight + "px; " +
        "}";
}

function doZoomer() {
    partWidth = zoomer.value;
    zoom();
}

// Allow plugins to force us to skip rendering entirely
ez.skipRendering = false;

// Update *all* of our track views
function updateTrackViews() {
    // Start with a blank slate
    trackSpace.innerHTML = "";

    var p = Promise.all([]);

    projectProperties.trackOrder.forEach(function(track) {
        // Create the view for it
        if (!(track in trackViews)) {
            var trackDiv = mke(trackSpace, "div", {"class": "trackdiv"});
            var container = mke(trackDiv, "span", {"class": "trackview"});
            var header = mke(container, "span", {"class": "trackheader"});
            var desc = mke(header, "div", {"class": "trackdesc"});
            var opts = mke(header, "button", {text: l("options")});
            opts.style.width = "90%";
            var partsContainer = mke(container, "span");
            trackViews[track] = {
                div: trackDiv,
                container: container,
                header: header,
                desc: desc,
                optsButton: opts,
                partsContainer: partsContainer,
                parts: []
            };
        } else {
            trackSpace.appendChild(trackViews[track].div);
        }
        p = p.then(function() { return updateTrackView(tracks[track]) });
    });

    return p;
}
ez.updateTrackViews = updateTrackViews;

// Update a particular track view
function updateTrackView(track) {
    var trackView = trackViews[track.id];
    var outer = trackView.container;
    var container = trackView.partsContainer;
    var outPart;

    var start = Math.max(
        Math.min(track.parts.length, trackView.parts.length), 0);

    trackView.desc.innerText = track.name;
    track.selected = false;
    trackView.select = function(sel) {
        if (typeof sel === "undefined")
            sel = !track.selected;
        track.selected = sel;
        if (sel)
            outer.classList.add("trackselected");
        else
            outer.classList.remove("trackselected");
    };
    trackView.header.onclick = function() {
        trackView.select();
    };

    // Set up the options menu
    trackView.optsButton.onclick = function(ev) {
        ev.stopPropagation();

        modalWait().then(function(unlock) {
            modalDialog.innerHTML = "";

            var del = mke(modalDialog, "button", {text: l("deletetrack")});
            mke(modalDialog, "div", {text: "\n\n"});
            var ren = mke(modalDialog, "button", {text: l("renametrack")});
            mke(modalDialog, "div", {text: "\n\n"});
            var cancel = mke(modalDialog, "button", {text: l("cancel")});

            modalToggle(true);
            cancel.focus();

            del.onclick = function() {
                unlock();
                return deleteTrackDialog(track);
            };

            ren.onclick = function() {
                unlock();
                return renameTrackDialog(track);
            };

            cancel.onclick = function() {
                unlock();
                modal();
            };
        });
    };

    // No need to redraw if it's already cached
    function skip(t, track, i, part) {
        // Generate outPart here since we might skip actually drawing it
        outPart = mke(container, "img", {"class": "trackpart"});
        outPart.src = "data:";
        outPart.width = fragmentWidthPx;
        outPart.height = fragmentHeightPx;
        trackView.parts.push(outPart);

        return dbCacheGet("waveform-" + part.id).then(function(ret) {
            if (ret === null) {
                // Not already drawn, so draw it ourselves
                return false;
            } else {
                // Just show it and skip on!
                outPart.src = ret;
                return true;
            }
        });

    }

    // Draw a part from its frames
    function drawPart(t, track, i, inPart, frames) {
        modal(l("renderingx", track.name) + ": " + Math.round(i/track.parts.length*100) + "%");

        var ln2 = Math.log2(2);
        var canvas = dce("canvas");
        canvas.width = fragmentWidthPx;
        canvas.height = fragmentHeightPx;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";

        if (frames.length === 0) {
            // Nothing to work with!
            i++;
            return updatePart();
        }

        var range = 1;
        switch (track.format) {
            case libav.AV_SAMPLE_FMT_U8P:   range = 0xFF; break;
            case libav.AV_SAMPLE_FMT_S16P:  range = 0x7FFF; break;
            case libav.AV_SAMPLE_FMT_S32P:  range = 0x7FFFFFFF; break;
        }

        var p = 0, z = 0;
        var max = 0;
        var x = 0, y = 0;
        var frame = frames[x];
        var data = frame.data[0];
        var len = maxFragment*data.length;
        var pixLen = Math.floor(len/512);
        while (true) {
            var v = 0;
            frame.data.forEach(function(data) {
                v += data[y];
            });
            v = Math.abs(v / frame.data.length / range);
            if (v > max) max = v;

            z++;
            if (z >= pixLen) {
                // End of a pixel, time to draw it
                max = Math.max(1, Math.ceil(Math.log2(max+1) / ln2 * 64));
                ctx.fillRect(p, 64 - max, 1, max*2);
                p++;
                z = 0;
                max = 0;
            }

            y++;
            if (y >= data.length) {
                // End of a frame, move on
                x++;
                if (x >= frames.length) {
                    // End of input
                    break;
                }
                frame = frames[x];
                data = frame.data[0];
                y = 0;
            }
        }

        // Done! Cache it and move on
        var png = canvas.toDataURL("image/png");
        outPart.src = png;
        i++;
        return dbCacheSet("waveform-" + inPart.id, png);
    }

    if (ez.skipRendering) {
        return dbCacheFlush();
    } else {
        return fetchTracks([track.id], {start: start, skip: skip, wholeParts: true}, drawPart).then(dbCacheFlush);
    }
}

// Deselect all tracks
function selectNone() {
    projectProperties.trackOrder.forEach(function(trackId) {
        selectTrack(trackId, false);
    });
}
ez.selectNone = selectNone;

// Select or deselect a track programmatically
function selectTrack(track, sel) {
    trackViews[track].select(sel);
}
ez.selectTrack = selectTrack;

// Dialog to delete a track
function deleteTrackDialog(track) {
    return modalWait().then(function(unlock) {
        modalDialog.innerHTML = "";

        mke(modalDialog, "div", {text: l("areyousure") + "\n\n"});
        var no = mke(modalDialog, "button", {text: l("cancel")});
        mke(modalDialog, "span", {text: "  "});
        var yes = mke(modalDialog, "button", {text: l("deletetrack")});

        modalToggle(true);
        no.focus();

        return new Promise(function(res, rej) {
            yes.onclick = function() {
                unlock();
                modal(l("deletinge"));
                deleteTrack(track).then(res).catch(rej);
            };

            no.onclick = function() {
                unlock();
                res();
            };
        });

    }).then(function() {
        modal();

    }).then(projectPropertiesUpdate).catch(error);
}

// Dialog to rename a track
function renameTrackDialog(track) {
    var nm;
    return modalWait().then(function(unlock) {
        modalDialog.innerHTML = "";

        mke(modalDialog, "label", {text: l("newname") + ":", "class": "inputlabel", "for": "trackname"});
        nm = mke(modalDialog, "input", {id: "trackname"});
        nm.value = track.name;
        mke(modalDialog, "div", {text: "\n\n"});
        var no = mke(modalDialog, "button", {text: l("cancel")});
        mke(modalDialog, "span", {text: "  "});
        var yes = mke(modalDialog, "button", {text: l("rename")});

        modalToggle(true);
        nm.focus();

        return new Promise(function(res, rej) {
            yes.onclick = function() {
                if (nm.value !== "") {
                    unlock();
                    modal(l("renaminge"));
                    res(true);
                } else {
                    nm.focus();
                }
            };

            no.onclick = function() {
                unlock();
                res(false);
            };
        });

    }).then(function(doit) {
        if (doit) {
            track.name = nm.value;
            return projectPropertiesUpdate().then(updateTrackViews);
        }

    }).then(function() {
        modal();

    }).catch(warn);
}
