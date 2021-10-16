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
import * as hotkeys from "./hotkeys";
import * as select from "./select";
import * as track from "./track";
import * as ui from "./ui";

import * as streamsaver from "streamsaver";

/**
 * Base options for exporting.
 */
interface ExportOptionsBase {
    /**
     * File format for export.
     */
    format: string;

    /**
     * Codec, in libav terms.
     */
    codec: string;

    /**
     * Sample format, in libav terms.
     */
    sampleFormat: number;

    /**
     * Sample rate, if not variable.
     */
    sampleRate?: number;

    /**
     * Filename extension, if not the same as format.
     */
    ext?: string;
}

/**
 * Per-export options for exporting.
 */
export interface ExportOptions extends ExportOptionsBase {
    /**
     * Filename prefix.
     */
    prefix: string;

    /**
     * Export all audio on selected tracks, not just selected audio.
     */
    allAudio?: boolean;

    /**
     * Export with the track name suffixed, even if only exporting one track.
     */
    suffixTrackName?: boolean;
}

/**
 * Standard export formats.
 */
const standardExports: {name: string, options: ExportOptionsBase}[] = [
    {name: "_FLAC", options: {format: "flac", codec: "flac", sampleFormat: 2 /* S32 */}},
    {name: "_M4A (MPEG-4 audio)", options: {format: "ipod", ext: "m4a", codec: "aac", sampleFormat: 8 /* FLTP */}},
    {name: "Ogg _Vorbis", options: {format: "ogg", codec: "libvorbis", sampleFormat: 8 /* FLTP */}},
    {name: "_Opus", options: {format: "ogg", ext: "opus", codec: "libopus", sampleFormat: 3 /* FLT */, sampleRate: 48000}},
    // FIXME: ALAC not working
    //{name: "_ALAC (Apple Lossless)", options: {format: "ipod", ext: "m4a", codec: "alac", sampleFormat: 7 /* S32P */}},
    {name: "wav_pack", options: {format: "wavpack", ext: "wv", codec: "wavpack", sampleFormat: 8 /* FLTP */}},
    {name: "_wav", options: {format: "wav", codec: "pcm_s16le", sampleFormat: 1 /* S16 */}}
];

/**
 * Export selected audio with the given options.
 * @param opts  Export options.
 * @param sel  The selection to export.
 * @param d  A dialog in which to show progress, if desired.
 */
export async function exportAudio(
    opts: ExportOptions, sel: select.Selection, d: ui.Dialog
) {
    // Get the audio tracks
    const tracks = <audioData.AudioTrack[]> Array.from(sel.els)
        .map(x => x.track)
        .filter(x => x.type() === track.TrackType.Audio);

    if (tracks.length === 0) {
        // Easy!
        return;
    }
    const store = tracks[0].project.store;

    if (d)
        d.box.innerHTML = "Exporting...";

    // Make the stream options
    const range = sel.range && !opts.allAudio;
    const streamOpts = {
        start: range ? sel.start : void 0,
        end: range ? sel.end : void 0
    };

    // Make the status
    const status = tracks.map(x => ({
        name: x.name,
        exported: 0,
        duration: x.sampleCount()
    }));

    // Function to show the current status
    function showStatus() {
        if (d) {
            let statusStr = status.map(x =>
                x.name + ": " + Math.round(x.exported / x.duration * 100) + "%")
            .join("<br/>");
            d.box.innerHTML = "Exporting...<br/>" + statusStr;
        }
    }

    // Delete any existing export info
    /*
    {
        const keys = await store.keys();
        for (const key of keys) {
            if (/^export-/.test(key))
                await store.removeItem(key);
        }
    }
    */

    // The export function for each track
    async function exportThread(track: audioData.AudioTrack, idx: number) {
        const channel_layout = (track.channels === 1) ? 4 : ((1<<track.channels)-1);

        // Figure out the file name
        const fname = opts.prefix +
            ((tracks.length > 1 || opts.suffixTrackName) ? "-" + track.name : "") +
            "." + (opts.ext || opts.format);

        // Make the stream
        const inStream = track.stream(streamOpts).getReader();

        // Get our libav instance
        const libav = await LibAV.LibAV();

        // Prepare for writes
        const bufLen = 1024*1024;
        let fileLen = 0;
        let writePromise: Promise<unknown> = Promise.all([]);
        let cacheName = "";
        let cacheNum = -1;
        let cache: Uint8Array = null;
        libav.onwrite = function(name: string, pos: number, buf: Uint8Array) {
            writePromise = writePromise.then(() => write(pos, buf));

            async function write(pos: number, buf: Uint8Array) {
                // Make sure our length is right
                fileLen = Math.max(fileLen, pos + buf.length);

                // Figure out where we fall within one store
                const storeNum = ~~(pos / bufLen);
                const storeName = "export-" + fname + "-" + storeNum;
                const storeStart = storeNum * bufLen;
                const storeEnd = storeStart + bufLen;
                let nextBuf: Uint8Array = null;
                if (pos + buf.length > storeEnd) {
                    nextBuf = buf.subarray(storeEnd - pos);
                    buf = buf.subarray(0, storeEnd - pos);
                }
                const storeOff = pos - storeStart;

                // Get this part
                let part: Uint8Array;
                if (cacheNum === storeNum) {
                    part = cache;
                } else {
                    if (cacheNum >= 0)
                        await store.setItem(cacheName, cache);
                    cacheName = storeName;
                    cacheNum = storeNum;
                    part = cache = await store.getItem(storeName);
                    if (!part)
                        part = cache = new Uint8Array(bufLen);
                }

                // Save what we're writing to it
                part.set(buf, storeOff);

                // Maybe write more
                if (nextBuf)
                    await write(storeEnd, nextBuf);
            }
        };

        // Prepare the encoder
        const [codec, c, frame, pkt, frame_size] = await libav.ff_init_encoder(opts.codec, {
            sample_fmt: opts.sampleFormat,
            sample_rate: opts.sampleRate || track.sampleRate,
            channel_layout
        });
        const [oc, fmt, pb, st] = await libav.ff_init_muxer(
            {filename: fname, format_name: opts.format, open: true, device: true},
            [[c, 1, track.sampleRate]]);
        await libav.avformat_write_header(oc, 0);

        // Prepare the filter
        const [filter_graph, buffersrc_ctx, buffersink_ctx] =
            await libav.ff_init_filter_graph("anull", {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout
            }, {
                sample_rate: opts.sampleRate || track.sampleRate,
                sample_fmt: opts.sampleFormat,
                channel_layout,
                frame_size
            });

        // Encode
        let pts = 0;
        while (true) {
            // Convert a chunk
            const inFrame = await inStream.read();
            if (inFrame.value) {
                const f = inFrame.value;
                f.node = null;
                f.ptshi = f.dtshi = 0;
                f.pts = f.dts = pts;
                pts += f.data.length / track.channels;
            }
            const fFrames = await libav.ff_filter_multi(buffersrc_ctx,
                buffersink_ctx, frame, inFrame.done ? [] : [inFrame.value],
                inFrame.done);
            const packets = await libav.ff_encode_multi(c, frame, pkt, fFrames,
                inFrame.done);
            await libav.ff_write_multi(oc, pkt, packets);
            await writePromise;

            // Update the status
            if (inFrame.done)
                status[idx].exported = status[idx].duration;
            else
                status[idx].exported += inFrame.value.data.length;
            showStatus();

            if (inFrame.done)
                break;
        }
        await libav.av_write_trailer(oc);
        await writePromise;
        libav.terminate();

        // Finish the cache
        if (cacheNum >= 0) {
            await store.setItem(cacheName, cache);
            cache = null;
        }

        // Get our output writer
        const writer = streamsaver.createWriteStream(fname).getWriter();

        // And stream it out
        const lastNum = ~~(fileLen / bufLen);
        const lastLen = fileLen & bufLen;
        for (let i = 0; i <= lastNum; i++) {
            const storeName = "export-" + fname + "-" + i;
            const part = await store.getItem(storeName);
            if (i === lastNum)
                await writer.write(part.subarray(0, lastLen));
            else
                await writer.write(part);
            await store.removeItem(storeName);
        }
        await writer.close();
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
            running.push(exportThread(sel, idx));
        }

        // Wait for one to finish to make room for more
        const fin = await Promise.race(running.map((x, idx) => x.then(() => idx)));
        running.splice(fin, 1);
    }

    // Wait for them all to finish
    await Promise.all(running);
}

/**
 * Show the user interface to export audio.
 * @param d  The dialog to reuse.
 * @param name  Name prefix for export.
 */
export async function uiExport(d: ui.Dialog, name: string) {
    await ui.dialog(async function(d, show) {
        let first: HTMLElement = null;

        // Label
        ui.mk("div", d.box, {innerHTML: "Format:", className: "row"}).style.textAlign = "center";

        // Show each format
        for (const format of standardExports) {
            const btn = hotkeys.btn(d, format.name, {className: "row small"});
            if (!first)
                first = btn;
            btn.onclick = () => {
                ui.loading(async function(d) {
                    await exportAudio(Object.assign({prefix: name}, format.options), select.getSelection(), d);
                }, {
                    reuse: d
                });
            };
        }

        show(first);
    }, {
        closeable: true,
        reuse: d
    });
}
