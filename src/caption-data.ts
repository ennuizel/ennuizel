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

import * as audioData from "./audio-data";
import * as id36 from "./id36";
import * as select from "./select";
import * as store from "./store";
import { EZStream, WSPReadableStream } from "./stream";
import * as track from "./track";
import * as ui from "./ui";
import * as util from "./util";

import * as webvttParser from "webvtt-parser";

/**
 * Vosk-style caption data.
 */
export interface VoskWord {
    /**
     * The actual word represented.
     */
    word: string;

    /**
     * Start time.
     */
    start: number;

    /**
     * End time.
     */
    end: number;

    /**
     * Confidence (optional).
     */
    conf?: number;
}

/**
 * A caption track. A CaptionTrack is stored in an array of CaptionDatas, each
 * of which is a "line" of caption words, associated with their HTML nodes. The
 * CaptionTrack itself holds a link to the associated AudioTrack by ID, if
 * there is one. CaptionTracks are stored as caption-track-id.
 */
export class CaptionTrack implements track.Track {
    /**
     * Make a CaptionTrack.
     * @param id  ID for this track. Must be unique in the store.
     * @param project  Project for this track. Note that the track is not
     *                 automatically added to the project's track list; this
     *                 parameter is just to know the store.
     * @param opts  Other options.
     */
    constructor(public id: string, public project: {store: store.UndoableStore}, opts: {
        name?: string,
        fixedDuration?: number,
        audioTrack?: string
    } = {}) {
        // Main properties
        this.data = [];
        this.name = opts.name || "";
        this.fixedDuration = opts.fixedDuration || 0;
        this.audioTrack = opts.audioTrack || null;

        // UI
        this.spacer = ui.mk("div", ui.ui.main, {className: "track-spacer"});
        this.info = ui.mk("div", ui.ui.main, {className: "track-info"});
        this.display = ui.mk("div", ui.ui.main, {className: "track-display"});
        this.box = ui.mk("div", this.display, {className: "track-caption-box"});

        select.addSelectable({
            track: this,
            wrapper: this.display,
            duration: this.duration.bind(this)
        });
    }

    /**
     * CaptionTracks are track type Caption.
     */
    type() { return track.TrackType.Caption; }

    /**
     * Save this track to the store.
     * @param opts  Other options, in particular whether to perform a deep save
     *              (save all CaptionDatas too).
     */
    async save(opts: {
        deep?: boolean
    } = {}) {
        const t = {
            name: this.name,
            fixedDuration: this.fixedDuration,
            audioTrack: this.audioTrack ? this.audioTrack : null,
            data: <string[]> []
        };

        // Fill in the data
        for (const el of this.data)
            t.data.push(el.id);

        // Save the track itself
        await this.project.store.setItem("caption-track-" + this.id, t);

        // Save the data itself
        if (opts.deep) {
            for (const el of this.data)
                await el.save();
        }
    }

    /**
     * Load this track from the store.
     */
    async load() {
        // Load the main data
        const t: any = await this.project.store.getItem("caption-track-" + this.id);
        if (!t) return;
        this.name = t.name || "";
        this.fixedDuration = t.fixedDuration || 0;
        this.audioTrack = t.audioTrack || null;

        // Load each CaptionData chunk
        for (const dataId of t.data) {
            const part = new CaptionData(dataId, this);
            await part.load();
            this.data.push(part);
        }
    }

    /**
     * Delete this track.
     */
    async del() {
        // First delete all the data
        for (const d of this.data)
            await d.del();

        // Then delete this
        await this.project.store.removeItem("caption-track-" + this.id);

        // Remove it from the DOM
        try {
            this.spacer.parentNode.removeChild(this.spacer);
            this.info.parentNode.removeChild(this.info);
            this.display.parentNode.removeChild(this.display);
        } catch (ex) {}

        // Remove it as a selectable
        select.removeSelectable(this);
    }

    /**
     * Append data from a stream of raw data. The chunks must be arrays of
     * VoskWords.
     * @param rstream  The stream to read from.
     */
    async append(rstream: EZStream<VoskWord[]>) {
        while (true) {
            const chunk = await rstream.read();
            await this.appendRaw(chunk);
        }

        await this.save();
    }

    /**
     * Append a single chunk of raw data.
     * @param words  The single chunk of data.
     * @param opts  Other options, really only intended to be used by append.
     */
    async appendRaw(words: VoskWord[], opts: {
        noSave?: boolean
    } = {}) {
        const store = this.project.store;
        const data = new CaptionData(await id36.genFresh(store, "caption-data-"), this);
        await data.setData(words);
        this.data.push(data);

        if (!opts.noSave)
            await this.save();
    }

    /**
     * Get the duration, in seconds, of this track.
     */
    duration() {
        if (this.fixedDuration)
            return this.fixedDuration;
        if (this.data.length === 0)
            return 0;
        return this.data[this.data.length - 1].end();
    }

    /**
     * Get this data as a ReadableStream. Packets are set as lines (arrays of
     * VoskWords).
     * @param opts  Options. In particular, you can set the start and end time
     *              here.
     */
    stream(opts: {
        start?: number,
        end?: number
    } = {}): ReadableStream<VoskWord[]> {
        const self = this;
        const startTime = (typeof opts.start === "number") ? opts.start : 0;
        const endTime = (typeof opts.end === "number") ? opts.end : Infinity;
        let idx = 0;

        // Create the stream
        return new WSPReadableStream({
            async pull(controller) {
                for (; idx < self.data.length; idx++) {
                    const part = await self.data[idx].slice(startTime, endTime);
                    if (part.length) {
                        controller.enqueue(part);
                        return;
                    }
                }
                controller.close();
            }
        });
    }

    /**
     * Replace a segment of caption data with the caption data from another
     * track. The other track will be deleted. Can clip (by not giving a
     * replacement) or insert (by replacing no time) as well.
     * @param start  Start time, in seconds.
     * @param end  End time, in seconds.
     * @param replacement  Track containing replacement data.
     */
    async replace(start: number, end: number, replacement: CaptionTrack) {
        // First, eliminate the relevant section
        const ndata: CaptionData[] = [];
        for (let idx = this.data.length - 1; idx >= 0; idx--) {
            const d = this.data[idx];
            const ds = d.start();
            const de = d.end();
            let elim = false;

            if (start >= ds && start <= de) {
                // Start within the range
                const p = await d.slice(0, start);
                if (p.length) {
                    const pd = new CaptionData(
                        await id36.genFresh(this.project.store, "caption-data-"),
                        this);
                    await pd.setData(p);
                    ndata.push(pd);
                }
                elim = true;
            }

            if (end >= ds && end <= de) {
                // End within the range
                const p = await d.slice(end);
                if (p.length) {
                    const pd = new CaptionData(
                        await id36.genFresh(this.project.store, "caption-data-"),
                        this);
                    await pd.setData(p);
                    ndata.push(pd);
                }
                elim = true;
            }

            if (ds >= start && de <= end) {
                // Node entirely within eliminated time
                elim = true;
            }

            if (elim)
                this.data.splice(idx, 1);
        }

        this.data = this.data.concat(ndata);

        // Fix timestamps
        const adjUp = replacement ? replacement.duration() : 0;
        for (const d of this.data)
            await d.adjustTimes(end, start - end + adjUp);

        // Add the replacement
        if (replacement) {
            const rdata = replacement.data;
            replacement.data = [];
            for (const d of rdata)
                await d.adjustTimes(0, start);
            this.data = this.data.concat(rdata);
        }

        // Sort out the order
        this.data.sort((a, b) => a.start() - b.start());

        // And save
        await this.save();
    }

    /**
     * Convert this track to WebVTT.
     */
    toVTT() {
        const lines =
            ["WEBVTT", "", "NOTE This file generated by Ennuizel.", ""];

        for (const line of this.data) {
            lines.push(util.timestamp(line.start()) + " --> " +
                util.timestamp(line.end()));

            // Convert each word
            let txt = "";
            for (let idx = 0; idx < line.data.length; idx++) {
                const word = line.data[idx];
                if (idx !== 0)
                    txt += "<" + util.timestamp(word.start) + ">";
                txt += "<c>" + word.word;
                if (idx !== line.data.length - 1)
                    txt += " ";
                txt += "</c>";
            }

            lines.push(txt);
            lines.push("");
        }

        return lines.join("\n");
    }

    /**
     * Caption data.
     */
    private data: CaptionData[];

    /**
     * Display name for this track.
     */
    name: string;

    /**
     * The fixed duration, if not implied by caption data.
     */
    fixedDuration: number;

    /**
     * The associated audio track.
     */
    audioTrack: string;

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
     * UI caption box.
     */
    box: HTMLElement;
}

/**
 * Caption data. Each CaptionData is a "line" of caption data, so contains an
 * array of Vosk words.
 */
class CaptionData {
    /**
     * Build a CaptionData.
     * @param id  The ID, which must be unique in the store.
     * @param track  The associated track.
     */
    constructor(public id: string, public track: CaptionTrack) {
        this.data = [];
        this.nodes = [];
    }

    /**
     * Save this caption data.
     */
    async save() {
        await this.track.project.store.setItem("caption-data-" + this.id, {
            data: this.data
        });
    }

    /**
     * Load this caption data.
     */
    async load() {
        const d =
            await this.track.project.store.getItem("caption-data-" + this.id);
        if (!d) return;
        this.data = d.data;
        this.makeNodes();
    }

    /**
     * Delete this caption data.
     */
    async del() {
        this.clearNodes();
        await this.track.project.store.removeItem("caption-data-" + this.id);
    }

    /**
     * Set the underlying data.
     */
    async setData(data: VoskWord[]) {
        this.clearNodes();
        this.data = data;
        this.makeNodes();
        await this.save();
    }

    /**
     * The start time of this line.
     */
    start() {
        if (this.data.length)
            return this.data[0].start;
        return 0;
    }

    /**
     * The end time of this line.
     */
    end() {
        if (this.data.length)
            return this.data[this.data.length-1].end;
        return 0;
    }

    /**
     * Create a slice of this data.
     */
    async slice(start = 0, end = Infinity) {
        return this.data.filter(w =>
            (w.start <= start && w.end >= start) ||
            (w.start >= start && w.start <= end));
    }

    /**
     * Adjust all times greater than start by the given offset.
     */
    async adjustTimes(start: number, offset: number) {
        function adj(n) {
            if (n < start)
                return n;
            return Math.max(start, n + offset);
        }

        for (const word of this.data) {
            word.start = adj(word.start);
            word.end = adj(word.end);
        }

        this.clearNodes();
        this.makeNodes();

        await this.save();
    }

    /**
     * Make the HTML nodes for this data.
     */
    private makeNodes() {
        let y = 0;
        for (const word of this.data) {
            const node = ui.mk("div", this.track.box, {
                className: "caption",
                innerText: word.word
            });
            const x = word.start * ui.pixelsPerSecond;
            const w = (word.end - word.start) * ui.pixelsPerSecond;
            Object.assign(node.style, {
                left: "calc(" + x + "px * var(--zoom-wave))",
                top: y*20 + "px",
                minWidth: "calc(" + w + "px * var(--zoom-wave))"
            });
            this.nodes.push(node);
            y = (y+1)%5;
        }
    }

    /**
     * Clear the HTML nodes for this data.
     */
    private clearNodes() {
        for (const node of this.nodes) {
            try {
                node.parentNode.removeChild(node);
            } catch (ex) {}
        }
        this.nodes = [];
    }

    /**
     * The underlying data.
     */
    data: VoskWord[];

    /**
     * The HTML nodes corresponding to the data.
     */
    nodes: HTMLElement[];
}

/**
 * Convert WebVTT to Vosk-style lines.
 * @param webvtt  The WebVTT input.
 */
function webvttToVosk(webvtt: string) {
    const parser = new webvttParser.WebVTTParser();
    const parsed = parser.parse(webvtt).cues;

    // Find the end time, by looking for a timestamp
    function findEnd(cues: any[], idx: number, def: number) {
        for (; idx < cues.length; idx++) {
            const cue = cues[idx];
            if (cue.type === "timestamp")
                return cue.value;
        }
        return def;
    }

    // Convert this tree into a VoskWord array
    function convertTree(
        into: VoskWord[], cues: any[], groupStart: number, groupEnd: number
    ) {
        let start = groupStart;
        let end = findEnd(cues, 0, groupEnd);

        for (let idx = 0; idx < cues.length; idx++) {
            const cue = cues[idx];
            switch (cue.type) {
                case "text":
                    into.push({start, end, word: cue.value.trim()});
                    break;

                case "timestamp":
                    start = cue.value;
                    end = findEnd(cues, idx + 1, groupEnd);
                    break;

                case "object":
                    convertTree(into, cue.children, start, end);
                    break;
            }
        }
    }

    // Go line by line
    const ret: VoskWord[][] = [];
    for (const line of parsed) {
        const voskLine: VoskWord[] = [];
        convertTree(voskLine, line.tree.children, line.startTime, line.endTime);
        ret.push(voskLine);
    }

    return ret;
}

/**
 * Load a caption file into tracks (UI).
 */
export async function uiLoadFile(
    project: {store: store.UndoableStore}, d: ui.Dialog
) {
    let res: (x: CaptionTrack[]) => void;
    const promise = new Promise<CaptionTrack[]>(r => res = r);

    ui.dialog(async function(d, show) {
        ui.lbl(d.box, "load-file", "Caption file:&nbsp;");
        const file = ui.mk("input", d.box, {id: "load-file", type: "file"});

        file.onchange = async function() {
            if (!file.files.length)
                return;

            await ui.loading(async function(ld) {
                // Make sure we can undo
                project.store.undoPoint();

                // Load it, expecting failure
                try {
                    res(await loadFile(project, file.files[0].name, file.files[0]));
                } catch (ex) {
                    if (ex.stack)
                        await ui.alert(ex + "<br/>" + ex.stack);
                    else
                        await ui.alert(ex + "");
                    res([]);
                }
            }, {
                reuse: d
            });
        };

        show(file);

    }, {
        reuse: d,
        closeable: true
    });

    return await promise;
}

/**
 * Load a caption file into tracks.
 * @param project  Project, just for the store.
 * @param fileName  The name of the file.
 * @param raw  The file, as a Blob.
 */
async function loadFile(
    project: {store: store.UndoableStore}, fileName: string, raw: Blob
) {
    const text = await raw.text();

    // Check if it's our only supported format
    if (text.slice(0, 6) !== "WEBVTT")
        throw new Error("File is not WebVTT");

    // Convert it
    const vosk = webvttToVosk(text);

    // Make the track
    const track = new CaptionTrack(
        await id36.genFresh(project.store, "caption-track-"),
        project,
        {name: fileName.replace(/\..*/, "")}
    );

    // Import it
    for (const line of vosk)
        await track.appendRaw(line, {noSave: true});
    await track.save();

    return [track];
}
