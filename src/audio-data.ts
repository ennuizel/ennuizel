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

import * as avthreads from "./avthreads";
import * as id36 from "./id36";
import * as select from "./select";
import * as store from "./store";
import { EZStream, ezStreamFrom } from "./stream";
import * as ui from "./ui";

import { ReadableStream } from "web-streams-polyfill/ponyfill";

type TypedArray =
    Int8Array |
    Uint8Array |
    Int16Array |
    Uint16Array |
    Int32Array |
    Uint32Array |
    Float32Array |
    Float64Array;

const log2 = Math.log(2);

// libav instance used for audio data encoding
let libav: any = null;

async function loadLibAV() {
    if (!libav)
        libav = await LibAV.LibAV();
}

/**
 * Convert a (libav) format to its planar equivalent.
 * @param format  The input format, which may or may not be planar.
 */
export async function toPlanar(format: number): Promise<number> {
    await loadLibAV();
    switch (format) {
        case libav.AV_SAMPLE_FMT_U8:
        case libav.AV_SAMPLE_FMT_U8P:
            return libav.AV_SAMPLE_FMT_U8P;

        case libav.AV_SAMPLE_FMT_S16:
        case libav.AV_SAMPLE_FMT_S16P:
            return libav.AV_SAMPLE_FMT_S16P;

        case libav.AV_SAMPLE_FMT_S32:
        case libav.AV_SAMPLE_FMT_S32P:
            return libav.AV_SAMPLE_FMT_S32P;

        case libav.AV_SAMPLE_FMT_FLT:
        case libav.AV_SAMPLE_FMT_FLTP:
            return libav.AV_SAMPLE_FMT_FLTP;

        case libav.AV_SAMPLE_FMT_DBL:
        case libav.AV_SAMPLE_FMT_DBLP:
            return libav.AV_SAMPLE_FMT_DBLP;

        default:
            throw new Error("Unsupported format (to planar) " + format);
    }
}

/**
 * Convert a (libav) format to its non-planar equivalent.
 * @param format  The input format, which may or may not be planar.
 */
export async function fromPlanar(format: number): Promise<number> {
    await loadLibAV();
    switch (format) {
        case libav.AV_SAMPLE_FMT_U8:
        case libav.AV_SAMPLE_FMT_U8P:
            return libav.AV_SAMPLE_FMT_U8;

        case libav.AV_SAMPLE_FMT_S16:
        case libav.AV_SAMPLE_FMT_S16P:
            return libav.AV_SAMPLE_FMT_S16;

        case libav.AV_SAMPLE_FMT_S32:
        case libav.AV_SAMPLE_FMT_S32P:
            return libav.AV_SAMPLE_FMT_S32;

        case libav.AV_SAMPLE_FMT_FLT:
        case libav.AV_SAMPLE_FMT_FLTP:
            return libav.AV_SAMPLE_FMT_FLT;

        case libav.AV_SAMPLE_FMT_DBL:
        case libav.AV_SAMPLE_FMT_DBLP:
            return libav.AV_SAMPLE_FMT_DBL;

        default:
            throw new Error("Unsupported format (to planar) " + format);
    }
}

/**
 * An audio track. Audio data is stored in a tree of AudioData nodes. The
 * AudioTrack itself holds information such as the format (in libav format
 * codes), sample rate, and number of channels. AudioTracks are stored as
 * audio-track-id.
 */
export class AudioTrack {
    /**
     * Make an AudioTrack.
     * @param id  ID for this track. Must be unique in the store.
     * @param project  Project for this track. Note that the track is not
     *                 automatically added to the project's track list; this
     *                 parameter is just to know the store.
     * @param opts  Other options.
     */
    constructor(public id: string, public project: {store: store.Store}, opts: {
        id?: string,
        format?: number,
        sampleRate?: number,
        channels?: number
    } = {}) {
        this.root = null;
        this.format = opts.format || 4; // DBL
        this.sampleRate = opts.sampleRate || 48000;
        this.channels = opts.channels || 1;

        this.spacer = ui.mk("div", ui.ui.main, {className: "track-spacer"});
        this.info = ui.mk("div", ui.ui.main, {className: "track-info"});
        this.display = ui.mk("div", ui.ui.main, {className: "track-display"});
        this.waveform = ui.mk("div", this.display, {className: "track-waveform"});

        select.addSelectable({
            track: this,
            wrapper: this.display,
            duration: this.duration.bind(this)
        });
    }

    /**
     * Save this track to the store.
     * @param opts  Other options, in particular whether to perform a deep save
     *              (save all AudioDatas too).
     */
    async save(opts: {
        deep?: boolean
    } = {}) {
        const t = {
            format: this.format,
            sampleRate: this.sampleRate,
            channels: this.channels,
            data: []
        };
        const d: AudioData[] = [];
        if (this.root)
            this.root.fillArray(d);

        // Fill in the data
        for (const el of d)
            t.data.push(el.id);

        // Save the track itself
        await this.project.store.setItem("audio-track-" + this.id, t);

        // Save the data itself
        if (opts.deep) {
            for (const el of d)
                await el.save();
        }
    }

    /**
     * Load this track from the store.
     */
    async load() {
        // Load the main data
        const t: any = await this.project.store.getItem("audio-track-" + this.id);
        if (!t) return;
        this.format = t.format;
        this.sampleRate = t.sampleRate;
        this.channels = t.channels;

        // Load each AudioData chunk
        const d: AudioData[] = [];
        for (const dataId of t.data) {
            const part = new AudioData(dataId, this);
            await part.load();
            d.push(part);
        }

        // Then make them a tree
        this.root = AudioData.balanceArray(d);
        select.updateDurations();
    }

    /**
     * Append data from a stream of raw data chunks. The type of the chunks
     * must correspond to the format specified in the format field.
     * @param stream  The stream to read from.
     */
    async append(stream: EZStream<TypedArray>) {
        const store = this.project.store;

        // Current AudioData we're appending to
        let cur: AudioData = null, raw: TypedArray;

        let chunk: TypedArray;
        while (chunk = await stream.read()) {
            if (!cur) {
                // Append a new audio chunk to the tree
                if (!this.root) {
                    // As the root
                    cur = this.root = new AudioData(
                        await id36.genFresh(store, "audio-data-"),
                        this
                    );
                } else {
                    // As the rightmost child
                    cur = this.root;
                    while (cur.right)
                        cur = cur.right;
                    cur.right = new AudioData(
                        await id36.genFresh(store, "audio-data-"),
                        this
                    );
                    cur.right.parent = cur;
                    cur = cur.right;
                }

                // Allocate space
                raw = await cur.initRaw(chunk);
                await cur.save();
            }

            const remaining = raw.length - cur.len;

            if (remaining >= chunk.length) {
                // There's enough space for this chunk in full
                raw.set(chunk, cur.len);
                cur.len += chunk.length;

            } else {
                // Need to take part of the chunk
                raw.set(chunk.subarray(0, remaining), cur.len);
                cur.len = raw.length;
                if (chunk.length !== remaining)
                    stream.push(chunk.slice(remaining));
                await cur.closeRaw(true);
                await cur.save();
                cur = null;
                raw = null;

            }
        }

        // Close the last part
        if (cur) {
            await cur.closeRaw(true);
            await cur.save();
        }

        // Rebalance the tree now that we're done
        if (this.root)
            this.root = this.root.rebalance();

        // Redisplay.
        select.updateDurations();

        await avthreads.flush();
    }

    /**
     * Append a single chunk of raw data.
     * @param data  The single chunk of data.
     */
    appendRaw(data: TypedArray) {
        this.append(ezStreamFrom(data));
    }

    /**
     * Get the duration, in seconds, of this track.
     */
    duration() {
        if (!this.root)
            return 0;
        return this.root.subtreeDuration() / this.channels / this.sampleRate;
    }

    /**
     * Get this data as a ReadableStream. Packets are sent roughly in libav.js
     * format, but with the AudioData node specified in a `node` field.
     * @param opts  Options. In particular, you can set the start and end time
     *              here.
     */
    stream(opts: {
        start?: number,
        end?: number,
        keepOpen?: boolean
    } = {}) {
        // Calculate times
        const startSec = ("start" in opts) ? opts.start : 0;
        const endSec = ("end" in opts) ? opts.end : this.duration() + 2;
        const start = Math.floor(startSec * this.sampleRate) * this.channels;
        const end = Math.ceil(endSec * this.sampleRate) * this.channels;
        let remaining = end - start;

        // Now find the AudioData for this time
        const sd = this.root ? this.root.find(start) : null;

        if (!sd) {
            // No data, just give an empty stream
            return new ReadableStream({
                start(controller) {
                    controller.close();
                }
            });
        }

        let cur = sd.node;

        // Buffer the metadata
        const meta = {
            format: this.format,
            sample_rate: this.sampleRate,
            channels: this.channels,
            channel_layout: (this.channels === 1) ? 4 : ((1 << this.channels) - 1)
        };

        // Create the stream
        return new ReadableStream({
            async start(controller) {
                // Read the first part
                let buf = await cur.openRaw();
                if (!opts.keepOpen)
                    await cur.closeRaw();

                // Chop it to the right offset
                buf = buf.subarray(sd.offset);

                // Possibly chop it off at the end
                if (remaining < buf.length)
                    buf = buf.subarray(0, remaining);

                // And send it
                controller.enqueue(Object.assign({
                    data: buf,
                    node: cur
                }, meta));

                remaining -= buf.length;
                if (remaining <= 0)
                    controller.close();
            },

            async pull(controller) {
                // Move to the next part
                if (cur.right) {
                    // Down the right subtree
                    cur = cur.right;
                    while (cur.left)
                        cur = cur.left;

                } else {
                    // Have to move up the tree
                    while (true) {
                        let next = cur.parent;
                        if (!next) {
                            controller.close();
                            return;
                        }
                        if (next.left === cur) {
                            // Continue with this node
                            cur = next;
                            break;
                        } else /* next.right === cur */ {
                            // Already did this node, so keep going up
                            cur = next;
                        }
                    }

                }

                // Now give some data from this part
                let buf = await cur.openRaw();
                if (!opts.keepOpen)
                    await cur.closeRaw();

                if (buf.length > remaining)
                    buf = buf.subarray(0, remaining);

                controller.enqueue(Object.assign({
                    data: buf,
                    node: cur
                }, meta));

                // And move on
                remaining -= buf.length;
                if (remaining <= 0)
                    controller.close();
            }
        });
    }

    /**
     * Overwrite a specific range of data from a ReadableStream. The stream
     * must give TypedArray chunks.
     * @param opts  Options. In particular, you can set the start and end time
     *              here.
     */
    async overwrite(data: ReadableStream<TypedArray>, opts: {
        start?: number,
        end?: number,
        closeTwice?: boolean
    } = {}) {
        const dataRd = data.getReader();

        // We have two streams, so we need to coordinate both of them
        let curOutNode: AudioData = null;
        let curOutRaw: TypedArray = null;
        let curOutPos = 0;
        let curOutRem = 0;
        let curInRaw: TypedArray = null;
        let curInPos = 0;
        let curInRem = 0;

        /* The stream we're overwriting is actually an *input* stream; it gives
         * us a raw view into the buffer */
        const outStream = this.stream({
            start: opts.start,
            end: opts.end,
            keepOpen: true
        });
        const outRd = outStream.getReader();

        while (true) {
            // Get our output
            if (!curOutNode) {
                const curOut = await outRd.read();
                if (curOut.done) {
                    // We read all we could
                    break;
                }
                curOutNode = curOut.value.node;
                curOutRaw = curOut.value.data;
                curOutPos = 0;
                curOutRem = curOutRaw.length;

            }

            // Get our input
            if (!curInRaw) {
                const curIn = await dataRd.read();
                if (curIn.done) {
                    // End of input
                    if (curOutNode) {
                        curOutNode.closeRaw(true);
                        if (opts.closeTwice)
                            curOutNode.closeRaw();
                        curOutNode = curOutRaw = null;
                    }
                    break;
                }
                curInRaw = curIn.value;
                curInPos = 0;
                curInRem = curInRaw.length;
            }

            // Now we can transfer some data
            if (curInRem >= curOutRem) {
                // Finish an out buffer
                curOutRaw.set(
                    curInRaw.subarray(curInPos, curInPos + curOutRem),
                    curOutPos
                );
                curInPos += curOutRem;
                curInRem -= curOutRem;
                curOutRem = 0;

            } else {
                // Finish an in buffer
                curOutRaw.set(
                    curInRaw.subarray(curInPos),
                    curOutPos
                );
                curOutPos += curInRem;
                curOutRem -= curInRem;
                curInRem = 0;

            }

            // Close our input
            if (curInRem === 0)
                curInRaw = null;

            // Close our output
            if (curOutRem === 0) {
                curOutNode.closeRaw(true);
                if (opts.closeTwice)
                    curOutNode.closeRaw();
                curOutNode = null;
            }
        }

        // Make sure we finish off both streams
        while (true) {
            const curOut = await outRd.read();
            if (curOut.done)
                break;
            curOutNode = curOut.value.node;
            curOutNode.closeRaw();
            if (opts.closeTwice)
                curOutNode.closeRaw();
        }

        while (true) {
            const curIn = await dataRd.read();
            if (curIn.done)
                break;
        }
    }

    /**
     * Root of the AudioData tree.
     */
    private root: AudioData;

    /**
     * Format of samples in this track, in libav format code.
     */
    format: number;

    /**
     * Sample rate of this track.
     */
    sampleRate: number;

    /**
     * Number of channels in this track.
     */
    channels: number;

    /**
     * UI spacer.
     */
    spacer: HTMLElement;

    /**
     * UI info box.
     */
    info: HTMLElement;

    /**
     * UI display box.
     */
    display: HTMLElement;

    /**
     * UI waveform wrapper within the display box.
     */
    waveform: HTMLElement;
}

/**
 * A single piece of audio data. Stored in the store as audio-data-id,
 * audio-data-compressed-id, and audio-data-wave-id.
 */
export class AudioData {
    /**
     * Create an AudioData.
     * @param id  ID for this AudioData. Must be unique in the store.
     * @param track  Track this AudioData belongs to. Note that setting it here
     *               does not actually add it to the track.
     */
    constructor(public id: string, public track: AudioTrack) {
        this.pos = this.len = 0;
        this.raw = this.img = this.waveform = null;
        this.rawModified = false;
        this.readers = 0;
        this.parent = this.left = this.right = null;
    }

    /**
     * Save this AudioData. *Never* recurses: only saves *this* AudioData.
     */
    async save() {
        await this.track.project.store.setItem("audio-data-" + this.id, {
            len: this.len
        });
    }

    /**
     * Load this AudioData. Does not load the raw data, which will be loaded on
     * demand.
     */
    async load() {
        const store = this.track.project.store;
        const d: any = await store.getItem("audio-data-" + this.id);
        this.len = d.len;

        // Waveform gets displayed immediately if applicable
        this.waveform = await store.getItem("audio-data-wave-" + this.id);
        if (this.waveform) {
            // FIXME: Duplication
            const w = ~~(this.len / this.track.channels / this.track.sampleRate * ui.pixelsPerSecond);
            this.img = ui.mk("img", this.track.display, {
                src: URL.createObjectURL(this.waveform)
            });
            this.img.style.width = "calc(" + w + "px * var(--zoom-wave))";
            this.img.style.height = ui.trackHeight + "px";
        }
    }

    /**
     * Rebalance the tree rooted at this node.
     */
    rebalance(): AudioData {
        // Convert the whole tree to an array
        let tarr: AudioData[] = [];
        this.fillArray(tarr);

        // Then turn the array back into a tree
        return AudioData.balanceArray(tarr);
    }

    /**
     * Convert this tree into an array, by filling the parameter.
     * @param arr  Array to fill.
     */
    fillArray(arr: AudioData[]) {
        if (this.left)
            this.left.fillArray(arr);
        arr.push(this);
        if (this.right)
            this.right.fillArray(arr);
    }

    /**
     * Create a balanced tree from an array of AudioData.
     */
    static balanceArray(arr: AudioData[]): AudioData {
        if (arr.length === 0)
            return null;

        // Find the middle node
        let mid = ~~(arr.length / 2);
        let root = arr[mid];
        root.parent = null;

        // Sort out its left
        root.left = AudioData.balanceArray(arr.slice(0, mid));
        if (root.left)
            root.left.parent = root;

        // Figure out the left duration to get its position
        root.pos = root.left ? root.left.subtreeDuration() : 0;

        // Then sort out the right
        root.right = AudioData.balanceArray(arr.slice(mid + 1));
        if (root.right)
            root.right.parent = root;

        return root;
    }

    /**
     * Get the duration, in samples, of the subtree rooted at this node. Note
     * that since this is just in raw, non-planar samples, if there's more than
     * one track, this number will effectively be multiplied by the number of
     * tracks.
     */
    subtreeDuration(): number {
        let cur: AudioData = this;
        let res = 0;
        while (cur) {
            res += cur.pos + cur.len;
            cur = cur.right;
        }
        return res;
    }

    /**
     * Get the audio node and offset for the desired sample.
     * @param sample  The sample to find.
     */
    find(sample: number) {
        let cur: AudioData = this;
        let offset = 0;
        while (cur) {
            if (cur.pos + offset <= sample) {
                // In this node or to the right
                if (cur.pos + offset + cur.len > sample) {
                    // In this node
                    return {
                        offset: sample - offset - cur.pos,
                        node: cur
                    };

                } else {
                    // To the right
                    offset += cur.pos + cur.len;
                    cur = cur.right;

                }

            } else {
                // To the left
                cur = cur.left;

            }
        }

        // Not found!
        return null;
    }

    /**
     * Get the raw audio data for this chunk. If it's not in memory, this will
     * involve uncompressing it. Each openRaw must be balanced with a closeRaw.
     */
    async openRaw(): Promise<TypedArray> {
        if (this.raw) {
            // Already exists
            this.readers++;
            return this.raw;
        }

        const self = this;
        let rframes: any[];

        await avthreads.enqueueSync(async function(libav) {
            // Otherwise, we need to decompress it. First, read it all in.
            let buf: TypedArray = null;
            const wavpack = await self.track.project.store.getItem("audio-data-compressed-" + self.id);
            await loadLibAV();
            const fn = "tmp-" + self.id + ".wv"
            await libav.writeFile(fn, wavpack);
            const [fmt_ctx, [stream]] = await libav.ff_init_demuxer_file(fn);
            const [ignore, c, pkt, frame] = await libav.ff_init_decoder(stream.codec_id, stream.codecpar);
            const [read_res, packets] = await libav.ff_read_multi(fmt_ctx, pkt);
            const frames = await libav.ff_decode_multi(c, pkt, frame, packets[stream.index], true);

            // Then convert it to a non-planar format
            const toFormat = await fromPlanar(frames[0].format);
            const [filter_graph, buffersrc_ctx, buffersink_ctx] =
                await libav.ff_init_filter_graph("anull", {
                    sample_rate: frames[0].sample_rate,
                    sample_fmt: frames[0].format,
                    channel_layout: frames[0].channel_layout
                }, {
                    sample_rate: frames[0].sample_rate,
                    sample_fmt: toFormat,
                    channel_layout: frames[0].channel_layout
                });
            rframes = await libav.ff_filter_multi(buffersrc_ctx, buffersink_ctx, frame, frames, true);

            // Clean up
            await libav.avfilter_graph_free_js(filter_graph);
            await libav.ff_free_decoder(c, pkt, frame);
            await libav.avformat_close_input_js(fmt_ctx);
            await libav.unlink(fn);
        });

        // And merge it into a single buffer
        let len = 0;
        for (const frame of rframes)
            len += frame.data.length;
        const ret = new (<any> rframes[0].data.constructor)(len);
        let offset = 0;
        for (const frame of rframes) {
            ret.set(frame.data, offset);
            offset += frame.data.length;
        }

        this.raw = ret;
        this.readers++;
        return ret;
    }

    /**
     * Initialize a new raw buffer for this AudioData, of the type of the
     * buffer given. Use when an AudioData is created completely fresh, or is
     * about to be wholly overwritten. Also opens the raw, so make sure you
     * closeRaw when you're done.
     * @param exa  Example of the correct TypedArray format.
     */
    async initRaw(exa?: TypedArray) {
        this.raw = new (<any> exa.constructor)(
            this.track.channels * this.track.sampleRate * 30
        );
        return await this.openRaw();
    }

    /**
     * Close the raw data associated with this AudioData. When the last reader
     * closes, the data is compressed and rendered.
     * @param modified  Set to true if you've modified the data.
     */
    async closeRaw(modified: boolean = false) {
        this.rawModified = this.rawModified || modified;

        if (--this.readers <= 0) {
            this.readers = 0;
            if (this.rawModified)
                await this.compress();
            this.raw = null;
            this.rawModified = false;
        }
    }

    // Compress and render this data, and store it
    private async compress() {
        if (!this.img)
            this.img = ui.mk("img", this.track.display);
        await avthreads.enqueue(libav => this.wavpack(libav, this.raw));
        await avthreads.enqueue(libav => this.render(libav, this.raw));
    }

    // wavpack-compress this data
    private async wavpack(libav: any, raw: TypedArray) {
        const track = this.track;
        const toFormat = await toPlanar(track.format);
        const channel_layout = (track.channels === 1) ? 4 : ((1 << track.channels) - 1);

        // Prepare the encoder
        const [codec, c, frame, pkt, frame_size] = await libav.ff_init_encoder("wavpack", {
            sample_fmt: toFormat,
            sample_rate: track.sampleRate,
            channel_layout
        });
        const [oc, fmt, pb, st] =
            await libav.ff_init_muxer({filename: this.id + ".wv", open: true},
                [[c, 1, track.sampleRate]]);
        await libav.avformat_write_header(oc, 0);

        // We also need to convert to the right sample format
        const [filter_graph, buffersrc_ctx, buffersink_ctx] =
            await libav.ff_init_filter_graph("anull", {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout
            }, {
                sample_rate: track.sampleRate,
                sample_fmt: toFormat,
                channel_layout,
                frame_size: frame_size
            });

        const frames = await libav.ff_filter_multi(buffersrc_ctx, buffersink_ctx, frame, [{
            data: raw.subarray(0, this.len),
            channel_layout,
            format: track.format,
            pts: 0,
            sample_rate: track.sampleRate
        }], true);

        const packets = await libav.ff_encode_multi(c, frame, pkt, frames, true);
        await libav.ff_write_multi(oc, pkt, packets);
        await libav.av_write_trailer(oc);

        await libav.avfilter_graph_free_js(filter_graph);
        await libav.ff_free_muxer(oc, pb);
        await libav.ff_free_encoder(c, frame, pkt);

        // Now it's been converted, so read it
        const u8 = await libav.readFile(this.id + ".wv");
        await libav.unlink(this.id + ".wv");

        // And save it to the store
        await track.project.store.setItem("audio-data-compressed-" + this.id, u8);
    }

    // Render the waveform for this data
    private async render(libav: any, raw: TypedArray) {
        const track = this.track;
        const channel_layout = (track.channels === 1) ? 4 : ((1 << track.channels) - 1);
        const frame = await libav.av_frame_alloc();

        // Convert it to floating-point
        const [filter_graph, buffersrc_ctx, buffersink_ctx] =
            await libav.ff_init_filter_graph("anull", {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout
            }, {
                sample_rate: track.sampleRate,
                sample_fmt: libav.AV_SAMPLE_FMT_FLT,
                channel_layout: 4,
                frame_size: this.len
            });

        const [frameD] = await libav.ff_filter_multi(buffersrc_ctx, buffersink_ctx, frame, [{
            data: raw.subarray(0, this.len),
            channel_layout,
            format: track.format,
            pts: 0,
            sample_rate: track.sampleRate
        }], true);

        await libav.avfilter_graph_free_js(filter_graph);
        await libav.av_frame_free(frame);

        const data = frameD.data;

        // Figure out the image size
        const spp = ~~(track.sampleRate / ui.pixelsPerSecond);
        const w = ~~(data.length / track.sampleRate * ui.pixelsPerSecond);

        // Make the canvas
        const canvas = ui.mk("canvas", null, {width: w, height: ui.trackHeight});
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 63, w, 2);
        ctx.fillStyle = "#0f0";

        // And draw it
        let max = -Infinity, min = Infinity;
        let x = 0, step = 0;
        for (let i = 0; i < data.length; i++) {
            max = Math.max(max, data[i]);
            min = Math.min(min, data[i]);

            if (++step === spp) {
                // Time to draw a column
                const dbishMax = Math.sign(max) * Math.log(Math.abs(max) + 1) / log2;
                const dbishMin = Math.sign(min) * Math.log(Math.abs(min) + 1) / log2;
                ctx.fillRect(x, ~~(ui.trackMiddle - dbishMax * ui.trackMiddle),
                    1, Math.max(~~((dbishMax - dbishMin) * ui.trackMiddle), 2));

                // Reset
                max = -Infinity;
                min = Infinity;
                x++;
                step = 0;
            }
        }

        // Now make it a PNG and save it
        this.waveform = await new Promise(res => canvas.toBlob(res));
        await this.track.project.store.setItem("audio-data-wave-" + this.id, this.waveform);

        // And make it an image
        const ourl = URL.createObjectURL(this.waveform);
        this.img.style.width = "calc(" + w + "px * var(--zoom-wave))";
        this.img.style.height = ui.trackHeight + "px";
        this.img.src = ourl;
    }

    /**
     * Position of this AudioData *within this subtree*. Should be the same as
     * left.subtreeDuration().
     */
    pos: number;

    /**
     * Length of this AudioData in samples. The raw data may be overallocated,
     * so this is the true length.
     */
    len: number;

    /**
     * Raw data. May be overallocated, often unallocated. Will be set when
     * needed.
     */
    private raw: TypedArray;

    /**
     * Set if the raw data has been modified, to ensure that it's saved.
     */
    private rawModified: boolean;

    // Waveform segment image
    private img: HTMLImageElement;

    // Waveform, as a png (blob)
    private waveform: Blob;

    // Number of raw audio readers
    private readers: number;

    // The tree itself
    parent: AudioData;
    left: AudioData;
    right: AudioData;
}
