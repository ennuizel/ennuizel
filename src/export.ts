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
import * as captionData from "./caption-data";
import * as downloadStream from "./download-stream";
import * as hotkeys from "./hotkeys";
import * as select from "./select";
import { WSPReadableStream } from "./stream";
import * as track from "./track";
import * as ui from "./ui";

import * as zip from "../client-zip/src/index";

/**
 * Format options for exporting.
 */
export interface ExportOptionsBase {
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

    /**
     * Return the actual stream(s), rather than saving them.
     */
    returnStreams?: boolean;
}

/**
 * Standard export formats.
 */
export const standardExports: {name: string, options: ExportOptionsBase}[] = [
    {name: "_FLAC", options: {format: "flac", codec: "flac", sampleFormat: audioData.LibAVSampleFormat.S32}},
    {name: "_M4A (MPEG-4 audio)", options: {format: "ipod", ext: "m4a", codec: "aac", sampleFormat: audioData.LibAVSampleFormat.FLTP}},
    {name: "Ogg _Vorbis", options: {format: "ogg", codec: "libvorbis", sampleFormat: audioData.LibAVSampleFormat.FLTP}},
    {name: "_Opus", options: {format: "ogg", ext: "opus", codec: "libopus", sampleFormat: audioData.LibAVSampleFormat.FLT, sampleRate: 48000}},
    {name: "A_LAC (Apple Lossless)", options: {format: "ipod", ext: "m4a", codec: "alac", sampleFormat: audioData.LibAVSampleFormat.S32P}},
    {name: "wav_pack", options: {format: "wv", codec: "wavpack", sampleFormat: audioData.LibAVSampleFormat.FLTP}},
    {name: "_wav", options: {format: "wav", codec: "pcm_s16le", sampleFormat: audioData.LibAVSampleFormat.S16}}
];

/**
 * Given a set of tracks and a particular track, generate a unique name for
 * this track. Simply returns track.name if the name is already unique. Not
 * guaranteed correct, since you can make something ambiguous with its
 * autogenerated unique name too, just an attempt.
 * @param tracks  All tracks.
 * @param track  Track to be uniquely named.
 */
export function uniqueName(tracks: track.Track[], track: track.Track) {
    if (tracks.filter(x => x.name === track.name).length > 1)
        return (tracks.indexOf(track) + 1) + "-" + track.name;
    else
        return track.name;
}

/**
 * Export selected audio with the given options.
 * @param opts  Export options.
 * @param sel  The selection to export.
 * @param d  A dialog in which to show progress, if desired.
 */
export async function exportAudio(
    opts: ExportOptions, sel: select.Selection, d: ui.Dialog
): Promise<Promise<ReadableStream<Uint8Array>>[]> {
    // Get the audio tracks
    const tracks = <audioData.AudioTrack[]>
        sel.tracks.filter(x => x.type() === track.TrackType.Audio);

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
            const statusStr = status.map(x =>
                x.name + ": " + Math.round(x.exported / x.duration * 100) + "%")
            .join("<br/>");
            d.box.innerHTML = "Exporting...<br/>" + statusStr;
        }
    }

    // Delete any existing export info
    {
        const keys = await store.keys();
        for (const key of keys) {
            if (/^export-/.test(key))
                await store.removeItem(key);
        }
    }

    // The export function for each track
    async function exportThread(track: audioData.AudioTrack, idx: number) {
        const channel_layout = audioData.toChannelLayout(track.channels);
        const sample_rate = opts.sampleRate || track.sampleRate;

        // Figure out the file name
        const fname = opts.prefix +
            ((tracks.length > 1 || opts.suffixTrackName) ? "-" + uniqueName(tracks, track) : "") +
            "." + (opts.ext || opts.format);
        const safeName = "tmp." + (opts.ext || opts.format);

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
        const [, c, frame, pkt, frame_size] = await libav.ff_init_encoder(opts.codec, {
            sample_fmt: opts.sampleFormat,
            sample_rate,
            channel_layout
        });

        const [oc] = await libav.ff_init_muxer(
            {filename: safeName, format_name: opts.format, open: true, device: true},
            [[c, 1, sample_rate]]);
        await libav.avformat_write_header(oc, 0);

        // Prepare the filter
        const [, buffersrc_ctx, buffersink_ctx] =
            await libav.ff_init_filter_graph("anull", {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout
            }, {
                sample_rate,
                sample_fmt: opts.sampleFormat,
                channel_layout,
                frame_size
            });

        // Encode
        let pts = 0;
        while (true) {
            // Convert a chunk
            const inFrame = await inStream.read();
            if (inFrame.value)
                inFrame.value.node = null;
            const fFrames = await libav.ff_filter_multi(buffersrc_ctx,
                buffersink_ctx, frame, inFrame.done ? [] : [inFrame.value],
                inFrame.done);
            for (const frame of fFrames) {
                frame.pts = frame.dts = pts;
                frame.ptshi = frame.dtshi = 0;
                pts += frame.nb_samples;
            }
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

        // Make our data stream
        const lastNum = ~~(fileLen / bufLen);
        const lastLen = fileLen % bufLen;
        let eidx = 0;
        const exportStream = new WSPReadableStream({
            async pull(controller) {
                const storeName = "export-" + fname + "-" + eidx;
                const part = await store.getItem(storeName);
                await store.removeItem(storeName);
                if (eidx === lastNum) {
                    controller.enqueue(part.subarray(0, lastLen));
                    controller.close();
                } else {
                    controller.enqueue(part);
                }
                eidx++;
            }
        });

        if (opts.returnStreams)
            return exportStream;

        // And stream it out
        await downloadStream.stream(fname, exportStream, {
            "content-length": fileLen + ""
        });
        return null;
    }

    if (opts.returnStreams) {
        // Just get all the streams at once
        return tracks.map((x, idx) => Promise.all([]).then(()=>exportThread(x, idx)));
    }
    // The rest relates to saving to disk

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
    return null;
}

/**
 * Export an Audacity project from this audio.
 * @param opts  Export options.
 * @param sel  The selection to export.
 * @param d  A dialog in which to show progress, if desired.
 */
export async function exportAudacity(
    opts: ExportOptions, sel: select.Selection, d: ui.Dialog
) {
    const tracks = <audioData.AudioTrack[]>
        sel.tracks.filter(x => x.type() === track.TrackType.Audio);
    if (tracks.length === 0)
        return;

    const projName = opts.prefix.replace(/[^A-Za-z0-9]/g, "_");
    const trackNames = tracks.map((x, idx) =>
        (idx + 1) + "-" + x.name.replace(/[^A-Za-z0-9]/g, "_"));

    // Make our actual project file
    let aup = `<?xml version="1.0" standalone="no" ?>
<!DOCTYPE project PUBLIC "-//audacityproject-1.3.0//DTD//EN" "http://audacity.sourceforge.net/xml/audacityproject-1.3.0.dtd" >
<project xmlns="http://audacity.sourceforge.net/xml/" projname="@PROJNAME@" version="1.3.0" audacityversion="2.2.2" rate="48000.0">
	<tags/>
`;
    for (const trackName of trackNames) {
        aup += '\t<import filename="' + projName + '_data/' + trackName + '.ogg" offset="0.00000000" mute="0" solo="0" height="150" minimized="0" gain="1.0" pan="0.0"/>\n';
    }
    aup += "</project>\n";
    let zstreams: any[] = [{name: projName + ".aup", input: aup}];

    // Get all the streams
    const streams = await exportAudio(
        Object.assign({returnStreams: true}, opts),
        sel, d
    );

    // Put them all in the format that client-zip wants
    zstreams = zstreams.concat(streams.map(async function(x, idx) {
        return {
            name: projName + "_data/" + trackNames[idx] + ".ogg",
            input: await x
        };
    }));

    // And generate the ZIP file
    const z = zip.downloadZip(<any> zstreams);
    await downloadStream.stream(projName + ".aup.zip",
        z.body, {});
}

/**
 * Export selected captions.
 * @param opts  Export options.
 * @param sel  The selection to export.
 * @param d  A dialog in which to show progress, if desired.
 */
export async function exportCaption(
    opts: {prefix: string}, sel: select.Selection, d: ui.Dialog
) {
    // Get the caption tracks
    const tracks = <captionData.CaptionTrack[]>
        sel.tracks.filter(x => x.type() === track.TrackType.Caption);

    if (tracks.length === 0) {
        // Easy!
        return;
    }
    const store = tracks[0].project.store;

    if (d)
        d.box.innerHTML = "Exporting...";

    // For each track
    for (const track of tracks) {
        // Figure out the file name
        const fname = opts.prefix +
            ((tracks.length > 1) ? "-" + uniqueName(tracks, track) : "") +
            ".vtt";

        // Convert to WebVTT
        const vtt = track.toVTT();

        // Convert to Uint8Array stream
        const enc = new TextEncoder();
        const vttu8 = enc.encode(vtt);
        const stream = new WSPReadableStream({
            start(controller) {
                controller.enqueue(vttu8);
                controller.close();
            }
        });

        // And stream it out
        await downloadStream.stream(fname, stream, {
            "content-length": vttu8.length + ""
        });
    }
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

            if (format.options.format === "flac") {
                // Show Audacity export here
                const aup = hotkeys.btn(d, "_Audacity project", {className: "row small"});
                aup.onclick = () => {
                    ui.loading(async function(d) {
                        await exportAudacity({
                            prefix: name,
                            format: "flac",
                            codec: "flac",
                            ext: "ogg",
                            sampleFormat: audioData.LibAVSampleFormat.S32
                        }, select.getSelection(), d);
                    }, {
                        reuse: d
                    });
                };
            }
        }

        show(first);
    }, {
        closeable: true,
        reuse: d
    });
}

/**
 * Show the user interface to export captions.
 * @param d  The dialog to reuse.
 * @param name  Name prefix for export.
 */
export async function uiExportCaption(d: ui.Dialog, name: string) {
    await ui.loading(async function(d) {
        await exportCaption({prefix: name}, select.getSelection(), d);
    }, {
        reuse: d
    });
}
