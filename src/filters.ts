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
declare let LibAV: any;

import * as audioData from "./audio-data";
import * as avthreads from "./avthreads";
import * as hotkeys from "./hotkeys";
import * as select from "./select";
import * as track from "./track";
import * as ui from "./ui";

import { ReadableStream } from "web-streams-polyfill/ponyfill";

/**
 * Simple name-value pair.
 */
interface NameValuePair {
    name: string;
    value: string;
}

/**
 * FFMpeg filter options.
 */
export interface FFMpegFilterOptions {
    /**
     * Filter name.
     */
    name: string;

    /**
     * Arguments.
     */
    args: NameValuePair[];

    /**
     * Set if the filter produces a different amount of output data than input data.
     */
    changesDuration?: boolean;
}

/**
 * An FFMpeg filter's description, for display.
 */
export interface FFMpegFilter {
    /**
     * Human-readable display name.
     */
    name: string;

    /**
     * FFMpeg filter name.
     */
    ffName: string;

    /**
     * Does this filter change duration? Either a simple boolean or a function
     * to determine based on arguments. Default false.
     */
    changesDuration?: boolean | ((args: NameValuePair[]) => boolean);

    /**
     * Parameters.
     */
    params: FFMpegParameter[];
}

/**
 * A single parameter for an ffmpeg filter.
 */
export interface FFMpegParameter {
    /**
     * Human-readable display name.
     */
    name: string;

    /**
     * FFMpeg name.
     */
    ffName: string;

    /**
     * Type, in terms of <input/> types, or "number".
     */
    type: string;

    /**
     * Default value for text.
     */
    defaultText?: string;

    /**
     * Default value for number.
     */
    defaultNumber?: number;

    /**
     * Default value for checkbox.
     */
    defaultChecked?: boolean;

    /**
     * Suffix (e.g. dB) to add to the given value.
     */
    suffix?: string;

    /**
     * Minimum value for numeric ranges.
     */
    min?: number;

    /**
     * Maximum value for numeric ranges.
     */
    max?: string;
}

/**
 * Load filtering options.
 */
export async function load() {
    ui.ui.menu.filters.onclick = filterMenu;
    hotkeys.registerHotkey(ui.ui.menu.filters, null, "f");
}

/**
 * Standard FFMpeg filters.
 */
const standardFilters: FFMpegFilter[] = (function() {
    function num(name: string, ffName: string, defaultNumber: number, opts: any = {}) {
        return Object.assign({name, ffName, type: "number", defaultNumber}, opts);
    }

    return [
    {
        name: "_Volume",
        ffName: "volume",
        params: [
            num("_Volume (dB)", "volume", 0, {suffix: "dB"})
        ]
    },

    {
        name: "_Compressor",
        ffName: "acompressor",
        params: [
            num("_Input gain (dB)", "level_in", 0, {suffix: "dB", min: -36, max: 36}),
            // FIXME: Mode
            num("_Threshold to apply compression (dB)", "threshold", -18, {suffix: "dB", min: -60, max: 0}),
            num("_Ratio to compress signal", "ratio", 2, {min: 1, max: 20}),
            num("_Attack time (ms)", "attack", 20, {min: 0.01, max: 2000}),
            num("Re_lease time (ms)", "release", 250, {min: 0.01, max: 9000}),
            num("_Output gain (dB)", "makeup", 0, {suffix: "dB", min: 0, max: 36}),
            num("Curve of compressor _knee", "knee", 2.82843, {min: 1, max: 8})
            // FIXME: Link
            // FIXME: Detection
        ]
    }
    ];
})();

/**
 * Apply an FFMpeg filter with the given options.
 * @param filter  The filter and options.
 * @param sel  The selection to filter.
 * @param d  (Optional) The dialog in which to show the status, if applicable.
 *           This dialog will *not* be closed.
 */
export async function ffmpegFilter(
    filter: FFMpegFilterOptions, sel: select.Selection, d: ui.Dialog
) {
    if (sel.els.size === 0) {
        // Well that was easy
        return;
    }

    // Get the audio tracks
    const tracks = <audioData.AudioTrack[]> Array.from(sel.els)
        .map(x => x.track)
        .filter(x => x.type() === track.TrackType.Audio);

    if (d)
        d.box.innerHTML = "Filtering...";

    // Make the filter string
    let fs = filter.name;
    if (filter.args.length)
        fs += "=";
    fs += filter.args.map(x => x.name + "=" + x.value).join(":");

    // Make the stream options
    const streamOpts = {
        start: sel.range ? sel.start : void 0,
        end: sel.range ? sel.end : void 0
    };

    // Make the status
    const status = tracks.map(x => ({
        name: x.name,
        filtered: 0,
        duration: x.sampleCount()
    }));

    // Function to show the current status
    function showStatus() {
        if (d) {
            let statusStr = status.map(x =>
                x.name + ": " + Math.round(x.filtered / x.duration * 100) + "%")
            .join("<br/>");
            d.box.innerHTML = "Filtering...<br/>" + statusStr;
        }
    }

    // The filtering function for each track
    async function filterThread(track: audioData.AudioTrack, idx: number) {
        // Make a libav instance
        const libav = await LibAV.LibAV();

        // Make the filter thread
        const channelLayout = (track.channels === 1) ? 4 : ((1<<track.channels)-1);
        const frame = await libav.av_frame_alloc();
        const [filter_graph, buffersrc_ctx, buffersink_ctx] =
            await libav.ff_init_filter_graph(fs, {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout: channelLayout
            }, {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout: channelLayout
            });

        // Input stream
        const inStream = track.stream(Object.assign({keepOpen: true}, streamOpts)).getReader();

        // Filter stream
        const filterStream = new ReadableStream({
            async pull(controller) {
                while (true) {
                    // Get some data
                    const inp = await inStream.read();
                    if (inp.value)
                        inp.value.node = null;

                    // Filter it
                    const outp = await libav.ff_filter_multi(
                        buffersrc_ctx, buffersink_ctx, frame,
                        inp.done ? [] : [inp.value], inp.done);

                    // Update the status
                    if (inp.done)
                        status[idx].filtered = status[idx].duration;
                    else
                        status[idx].filtered += inp.value.data.length;
                    showStatus();

                    // Write it out
                    if (outp.length) {
                        for (const part of outp) {
                            controller.enqueue(part.data);
                        }
                    }

                    // Maybe end it
                    if (inp.done)
                        controller.close();

                    if (outp.length || inp.done)
                        break;
                }
            }
        });

        // Write it out (FIXME: changesDuration)
        await track.overwrite(filterStream, Object.assign({closeTwice: true}, streamOpts));

        // And get rid of the libav instance
        libav.terminate();
    }

    // Number of threads to run at once
    const threads = navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;

    // Current state
    const running: Promise<unknown>[] = [];
    const toRun = tracks.map((x, idx) => <[audioData.AudioTrack, number]> [x, idx]);

    // Run
    while (toRun.length) {
        // Get the right number of threads running
        while (running.length < threads && toRun.length) {
            const [sel, idx] = toRun.shift();
            running.push(filterThread(sel, idx));
        }

        // Wait for one to finish to make room for more
        const fin = await Promise.race(running.map((x, idx) => x.then(() => idx)));
        running.splice(fin, 1);
    }

    // Wait for them all to finish
    await Promise.all(running);
}

/**
 * Show the main filter menu.
 */
async function filterMenu() {
    await ui.dialog(async function(d, show) {
        let first: HTMLElement = null;

        // Make a button for each filter in the standard list
        for (const filter of standardFilters) {
            const b = hotkeys.btn(d, filter.name, {className: "row"});
            if (!first)
                first = b;
            b.onclick = () => uiFilter(d, filter);
        }

        show(first);
    }, {
        closeable: true
    });
}

/**
 * Show the user interface for a particular filter.
 * @param d  The dialog to reuse for the filter display.
 * @param filter  The filter itself.
 */
async function uiFilter(d: ui.Dialog, filter: FFMpegFilter) {
    await ui.dialog(async function(d, show) {
        let first: HTMLElement = null;
        const pels: Record<string, HTMLInputElement> = Object.create(null);

        // Show each of the filter parameters
        for (const param of filter.params) {
            const id = "ez-filter-param-" + filter.ffName + "-" + param.ffName;
            const div = ui.mk("div", d.box, {className: "row"});
            const lbl = hotkeys.mk(d, param.name + ":&nbsp;",
                lbl => ui.lbl(div, id, lbl, {className: "ez"}));
            const inp = pels[param.ffName] = ui.mk("input", div, {
                id,
                type: param.type === "number" ? "text" : param.type
            });

            if (!first)
                first = inp;

            // Set any type-specific properties
            if (param.type === "number") {
                // Default
                if (typeof param.defaultNumber === "number")
                    inp.value = param.defaultNumber + "";

                // Range
                if (typeof param.min === "number" ||
                    typeof param.max === "number") {
                    inp.addEventListener("change", () => {
                        const val = +inp.value;
                        if (typeof param.min === "number" && val < param.min)
                            inp.value = param.min + "";
                        else if (typeof param.max === "number" && val > param.max)
                            inp.value = param.max + "";
                    });
                }

            } else if (param.type === "text") {
                // Default
                if (param.defaultText)
                    inp.value = param.defaultText;

            } else if (param.type === "checkbox") {
                // Default
                inp.checked = !!param.defaultChecked;

            }

            if (param.type === "number" || param.type === "text") {
                // Support enter to submit
                inp.addEventListener("keydown", ev => {
                    if (ev.key === "Enter") {
                        ev.preventDefault();
                        doIt();
                    }
                });
            }

        }

        // And an actual "filter" button
        const btn = hotkeys.btn(d, "_Filter", {className: "row"});
        btn.onclick = doIt;

        // Perform the actual filter
        function doIt() {
            uiFilterGo(d, filter, pels);
        }

        show(first);
    }, {
        closeable: true,
        reuse: d
    });
}

/**
 * Perform an actual filter (from the UI).
 * @param d  The dialog to reuse for the filter display.
 * @param filter  The filter itself.
 * @param pels  Elements corresponding to the parameters.
 */
async function uiFilterGo(
    d: ui.Dialog, filter: FFMpegFilter, pels: Record<string, HTMLInputElement>
) {
    console.log(pels);
    await ui.loading(async function(d) {
        // Convert the parameter elements into arguments
        const args: NameValuePair[] = [];
        for (const param of filter.params) {
            let val: string = "";

            // Get out the value
            switch (param.type) {
                case "number": {
                    // Check the range
                    let v = +pels[param.ffName].value;
                    if (typeof param.min === "number" && v < param.min)
                        v = param.min;
                    else if (typeof param.max === "number" && v > param.max)
                        v = param.max;
                    val = v + "";
                    break;
                }

                case "checkbox":
                    val = pels[param.ffName].checked ? "1" : "0";
                    break;

                default:
                    val = pels[param.ffName].value;
            }

            // Add any suffix
            if (param.suffix)
                val += param.suffix;

            // Add it to the list
            args.push({name: param.ffName, value: val});
        }

        // Join that into options
        // FIXME: changesDuration
        const opts: FFMpegFilterOptions = {
            name: filter.ffName,
            args
        };

        // Get the selection
        const sel = select.getSelection();
        if (sel.els.size === 0) {
            // Nothing to do!
            return;
        }

        // Prepare for undo
        Array.from(sel.els)[0].track.project.store.undoPoint();

        // And perform the filter
        await ffmpegFilter(opts, sel, d);

    }, {
        reuse: d
    });
}
