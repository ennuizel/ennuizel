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
import * as select from "./select";
import * as track from "./track";
import * as ui from "./ui";

import { ReadableStream } from "web-streams-polyfill/ponyfill";

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
    args: {name: string, value: string}[];

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
     * Parameters.
     */
    param: FFMpegParameter[];
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
    ui.ui.menu.filters.onclick = () => {
        ui.loading(async function(d) {
            await ffmpegFilter({
                name: "volume",
                args: [{name: "volume", value: "0"}]
            }, select.getSelection(), d);
        });
    };
}

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

