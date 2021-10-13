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

import * as audio from "./audio";
import * as audioData from "./audio-data";
import * as hotkeys from "./hotkeys";
import * as id36 from "./id36";
import * as select from "./select";
import * as store from "./store";
import { EZStream } from "./stream";
import * as ui from "./ui";
import * as util from "./util";

import { ReadableStream } from "web-streams-polyfill/ponyfill";

/**
 * An Ennuizel project.
 */
export class Project {
    /**
     * Create a Project.
     * @param id  The ID of the project. Must be unique in the global store.
     * @param opts  Other options.
     */
    constructor(public id: string, opts: {
        name?: string,
        store?: store.UndoableStore
    } = {}) {
        if (opts.store) {
            this.store = opts.store;
        } else {
            this.store = store.UndoableStore.createInstance({name: "ez-project-" + id});
        }
        this.name = opts.name || "";
        this.tracks = [];
    }

    /**
     * Save this project to the store.
     * @param opts  Other options.
     */
    async save(opts: {
        deep?: boolean
    } = {}) {
        // Save the project itself
        await this.store.setItem("project-" + this.id, {
            name: this.name,
            tracks: this.tracks.map(t => t.id)
        });

        // Save the tracks
        if (opts.deep) {
            for (const track of this.tracks) {
                await track.save({deep: true});
            }
        }
    }

    /**
     * Load this project from the store.
     */
    async load() {
        // Load the main info
        const p: any = await this.store.getItem("project-" + this.id);
        if (!p) return;
        this.name = p.name;

        this.tracks = [];
        for (const trackId of p.tracks) {
            const track = new audioData.AudioTrack(trackId, this);
            await track.load();
            this.addTrack(track);
        }
    }

    /**
     * Add a track.
     * @param track  The track to add.
     */
    async addTrack(track: Track) {
        const self = this;

        // Set up its info box
        const name = ui.txt(track.info, {
            className: "row",
            value: track.name
        });

        let timeout: number = null;
        name.oninput = ev => {
            if (timeout !== null)
                clearTimeout(timeout);
            timeout = setTimeout(async function() {
                timeout = null;
                await project.store.undoPoint();
                track.name = (<HTMLInputElement> ev.target).value;
                await track.save();
            }, 1000);
        };

        const del = ui.btn(track.info, "Delete", {className: "row small"});

        del.onclick = function() {
            ui.dialog(async function(d, show) {
                ui.mk("div", d.box, {innerHTML: "Are you sure?<br/><br/>"});
                const yes = ui.btn(d.box, "<u>Y</u>es, delete this track", {className: "row"});
                hotkeys.registerHotkey(yes, d, "y");
                const no = ui.btn(d.box, "<u>N</u>o, cancel", {className: "row"});
                hotkeys.registerHotkey(no, d, "n");

                no.onclick = () => {
                    ui.dialogClose(d);
                };

                yes.onclick = () => {
                    ui.loading(async function(d) {
                        await project.store.undoPoint();
                        await self.removeTrack(track);
                    }, {
                        reuse: d
                    });
                };

                show(no);
            }, {
                closeable: true
            });
        };

        // And add it to the list
        this.tracks.push(track);
    }

    /**
     * Remove a track.
     */
    async removeTrack(track: Track) {
        await track.del();
        const idx = this.tracks.indexOf(track);
        if (idx >= 0)
            this.tracks.splice(idx, 1);
        await this.save();
    }

    /**
     * Data *within* this project is stored within its own store.
     */
    store: store.UndoableStore;

    /**
     * Name of the project.
     */
    name: string;

    /**
     * Tracks in this project.
     */
    tracks: Track[];
}

export type Track = audioData.AudioTrack;

/**
 * The current project, if there is one.
 */
export let project: Project = null;

/**
 * Load project-related behavior and UI.
 */
export async function load() {
    const menu = ui.ui.menu;
    menu.project.onclick = projectMenu;
    hotkeys.registerHotkey(menu.project, null, "p");
    menu.edit.onclick = editMenu;
    hotkeys.registerHotkey(menu.edit, null, "e");
    menu.tracks.onclick = tracksMenu;
    hotkeys.registerHotkey(menu.tracks, null, "t");
    await unloadProject();
}

/**
 * Get the list of projects.
 */
async function getProjects() {
    let ids: string[] = await store.store.getItem("ez-projects") || [];
    let ret: {id: string, name: string}[] = [];
    for (const id of ids) {
        const project: any = await store.store.getItem("ez-project-" + id);
        if (project)
            ret.push({id, name: project.name});
    }
    return ret;
}

/**
 * Show the main project menu.
 */
function projectMenu() {
    ui.dialog(async function(d, show) {
        const newb = ui.btn(d.box, "<u>N</u>ew project", {className: "row"});
        hotkeys.registerHotkey(newb, d, "n");
        newb.onclick = () => uiNewProject(d);

        // Show the load projects button if there are any to load
        if ((await getProjects()).length) {
            const loadb = ui.btn(d.box, "<u>L</u>oad project", {className: "row"});
            hotkeys.registerHotkey(loadb, d, "l");
            loadb.onclick = () => uiLoadProject(d);
        }

        // Only shown if there's a current project
        if (project) {
            const deleteb = ui.btn(d.box, "<u>D</u>elete project", {className: "row"});
            hotkeys.registerHotkey(deleteb, d, "d");
            deleteb.onclick = () => uiDeleteProject(d);
        }

        show(newb);
    }, {
        closeable: true
    });
}

/**
 * Create a new project (UI).
 */
function uiNewProject(d: ui.Dialog) {
    ui.dialog(async function(d, show) {
        ui.lbl(d.box, "project-name", "Project name:&nbsp;");
        let nm = ui.txt(d.box, {id: "project-name"});
        let neww = ui.btn(d.box, "<u>N</u>ew project");
        hotkeys.registerHotkey(neww, d, "n");

        nm.onkeydown = ev => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                doIt();
                return;
            }
        };

        neww.onclick = ev => {
            doIt();
        };

        show(nm);

        async function doIt() {
            if (nm.value.trim() === "") {
                nm.focus();
                return;
            }

            await ui.loading(async function(ld) {
                await unloadProject();

                const name = nm.value.trim();

                // Check for an existing project with the same name
                let existing = false;
                for (const project of await getProjects()) {
                    if (project.name.toLowerCase() === name.toLowerCase()) {
                        existing = true;
                        break;
                    }
                }

                if (existing) {
                    await ui.alert("There's already a project with that name!");

                } else {
                    await newProject(name);

                }
            }, {
                reuse: d
            });
        }

    }, {
        reuse: d,
        closeable: true
    });
}

/**
 * Create a new project.
 * @param name  Name for the project.
 */
async function newProject(name: string) {
    await unloadProject();

    // Create this project
    project = new Project(await id36.genFresh(store.store, "ez-project-"));
    const id = project.id;
    await store.store.setItem("ez-project-" + id, {name});
    project.name = name;
    await project.save();

    // Add it to the list
    const projects: string[] = await store.store.getItem("ez-projects") || [];
    projects.push(project.id);
    await store.store.setItem("ez-projects", projects);

    // Then load it (since loading knows how to open it)
    project = null;
    return await loadProject(id);
}

/**
 * Load a project (UI).
 */
function uiLoadProject(d?: ui.Dialog) {
    ui.dialog(async function(d, show) {
        const projects = await getProjects();
        let first: HTMLElement = null;

        for (const project of projects) (function(project) {
            const btn = ui.btn(d.box, project.name, {className: "row nouppercase"});
            if (!first)
                first = btn;
            btn.onclick = async function() {
                await ui.loading(async function(ld) {
                    await loadProject(project.id);
                }, {
                    reuse: d
                });
            };
        })(project);

        show(first);
    }, {
        reuse: d,
        closeable: true
    });
}

/**
 * Load a project by ID.
 * @param id  ID of the project.
 */
async function loadProject(id: string, store?: store.UndoableStore) {
    await unloadProject();

    // Create and load this project
    project = new Project(id, {store});
    await project.load();

    // Free up the buttons
    const tracks = ui.ui.menu.tracks;
    tracks.classList.remove("off");
    tracks.disabled = false;
    const edit = ui.ui.menu.edit;
    edit.classList.remove("off");
    edit.disabled = false;

    return project;
}

/**
 * Unload the current project, if one is loaded.
 */
async function unloadProject() {
    if (project) {
        // Remove the undo info
        project.store.dropUndo();

        project = null;
    }

    // Clear out the former selections
    select.clearSelectables();

    // Clear out the UI
    ui.ui.main.innerHTML = "";
    const tracks = ui.ui.menu.tracks;
    tracks.classList.add("off");
    tracks.disabled = true;
    const edit = ui.ui.menu.edit;
    edit.classList.add("off");
    edit.disabled = true;
}

/**
 * Reload the current project. Useful for undos.
 */
async function reloadProject() {
    const id = project.id;
    const store = project.store;
    project = null;
    await unloadProject();
    await loadProject(id, store);
}

/**
 * Show the edit menu.
 */
function editMenu() {
    ui.dialog(async function(d, show) {
        const undo = ui.btn(d.box, "<u>U</u>ndo (Ctrl+Z)", {className: "row"});
        hotkeys.registerHotkey(undo, d, "u");
        const selAll = ui.btn(d.box, "Select <u>a</u>ll (Ctrl+A)", {className: "row"});
        hotkeys.registerHotkey(selAll, d, "a");

        undo.onclick = async function() {
            await performUndo();
            ui.dialogClose(d);
        };

        selAll.onclick = async function() {
            await select.selectAll();
            ui.dialogClose(d);
        };

        show(undo);

    }, {
        closeable: true
    });
}

/**
 * Perform an undo.
 */
async function performUndo() {
    await ui.loading(async function(d) {
        await project.store.undo();
        await reloadProject();
    });
}

/**
 * Show the "tracks" menu.
 */
function tracksMenu() {
    ui.dialog(async function(d, show) {
        const load = ui.btn(d.box, "<u>L</u>oad track(s) from file", {className: "row"});
        hotkeys.registerHotkey(load, d, "l");
        load.onclick = () => uiLoadFile(d);
        show(load);
    }, {
        closeable: true
    });
}

/**
 * Load a file into tracks (UI).
 */
function uiLoadFile(d: ui.Dialog) {
    ui.dialog(async function(d, show) {
        const lbl = ui.lbl(d.box, "load-file", "Audio file:&nbsp;");
        const file = ui.mk("input", d.box, {id: "load-file", type: "file"});

        file.onchange = async function() {
            if (!file.files.length)
                return;

            await ui.loading(async function(ld) {
                // Make sure we can undo
                project.store.undoPoint();

                // Load it, expecting failure
                try {
                    await loadFile(file.files[0].name, file.files[0], {
                        status(cur, duration) {
                            let txt = "Loading... " + util.timestamp(cur);
                            if (duration) {
                                txt += "/" + util.timestamp(duration) +
                                    " (" + ~~(cur/duration*100) + "%)";
                            }
                            ld.box.innerHTML = txt;
                        }
                    });
                } catch (ex) {
                    if (ex.stack)
                        await ui.alert(ex.stack);
                    else
                        await ui.alert(ex + "");
                    await performUndo();
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
}

/**
 * Load a file into tracks.
 * @param fileName  The name of the file.
 * @param raw  The file, as a Blob.
 * @param opts  Other options.
 */
async function loadFile(fileName: string, raw: Blob, opts: {
    status?: (loaded: number, duration: number) => unknown
} = {}) {
    const fileReader = raw.stream().getReader();

    // Get the first 1MB so we can read the header info
    let header = new Uint8Array(0);
    while (header.length < 1024*1024) {
        const chunk = await fileReader.read();
        if (chunk.done)
            break;
        const h2 = new Uint8Array(header.length + chunk.value.length);
        h2.set(header);
        h2.set(chunk.value, header.length);
        header = h2;
    }

    // Create our libav reader
    const libav = await LibAV.LibAV();
    await libav.mkreaderdev("tmp.in");
    await libav.ff_reader_dev_send("tmp.in", header);
    const [fmt_ctx, streams] = await libav.ff_init_demuxer_file("tmp.in");
    const pkt = await libav.av_packet_alloc();
    const libavReader = new ReadableStream({
        async pull(controller) {
            while (true) {
                const [res, packets] = await libav.ff_read_multi(fmt_ctx, pkt, "tmp.in", {devLimit: 1024*1024});
                let done = false;
                if (packets && Object.keys(packets).length) {
                    controller.enqueue(packets);
                    done = true;

                }

                if (res === -libav.EAGAIN) {
                    if (!done) {
                        // First we need more data from input!
                        const chunk = await fileReader.read();
                        await libav.ff_reader_dev_send("tmp.in", chunk.done ? null : chunk.value);
                    }

                } else if (res === libav.AVERROR_EOF) {
                    // EOF
                    controller.close();
                    done = true;

                } else if (res !== 0) {
                    throw new Error("Error reading: " + res);

                }

                if (done)
                    break;
            }
        }
    }, {
        highWaterMark: 4
    }).getReader();

    // Make a *demuxer* stream for each audio track
    let duration = 0;
    const audioStreams: any[] = [];
    const demuxerControllers: Record<number, ReadableStreamDefaultController> = Object.create(null);
    const demuxers: Record<number, ReadableStreamDefaultReader> = Object.create(null);
    for (const stream of streams) {
        if (stream.codec_type !== libav.AVMEDIA_TYPE_AUDIO)
            continue;

        duration = Math.max(stream.duration, duration);

        audioStreams.push(stream);

        demuxers[stream.index] = new ReadableStream({
            start(controller) {
                demuxerControllers[stream.index] = controller;
            },

            async pull() {
                // Pull everything until we get the stream we care about
                while (true) {
                    const packets = await libavReader.read();

                    if (packets.done) {
                        demuxerControllers[stream.index].close();
                        break;

                    } else {
                        // Send out these packets
                        let gotThis = false;
                        for (const idx in packets.value) {
                            if (demuxerControllers[idx])
                                demuxerControllers[idx].enqueue(packets.value[idx]);
                            if (idx === stream.index)
                                gotThis = true;
                        }
                        if (gotThis)
                            break;

                    }
                }
            }
        }, {
            highWaterMark: 4
        }).getReader();
    }

    // Then make a track and *decoder* stream for each audio track
    const baseName = fileName.replace(/\..*/, "");
    const audioTracks: Record<number, audioData.AudioTrack> = Object.create(null);
    const trackPromises: Promise<unknown>[] = [];
    for (const stream of audioStreams) {
        // Make a track
        const trackName = baseName + ((audioStreams.length <= 1) ? "" : ("-" + (stream.index+1)));
        const track = new audioData.AudioTrack(
            await id36.genFresh(project.store, "audio-track-"),
            project,
            {name: trackName}
        );
        project.addTrack(track);
        audioTracks[stream.index] = track;

        // Make the decoder
        const [ignore, c, pkt, frame] = await libav.ff_init_decoder(stream.codec_id, stream.codecpar);

        // Resampler will be made once we know our input
        let filter_graph, buffersrc_ctx, buffersink_ctx;

        // Make the stream
        const reader = new EZStream(new ReadableStream({
            async pull(controller) {
                while (true) {
                    // Get data from the demuxer
                    const packets = await demuxers[stream.index].read();

                    // And decode it
                    const frames = await libav.ff_decode_multi(c, pkt, frame, packets.done ? [] : packets.value, packets.done);

                    if (frames.length) {
                        // Possibly make the resampler
                        if (!filter_graph) {
                            track.format = await audioData.fromPlanar(frames[0].format);
                            track.sampleRate = frames[0].sample_rate;
                            track.channels = frames[0].channels;
                            const channel_layout = (track.channels === 1) ? 4 : ((1 << track.channels) - 1);

                            [filter_graph, buffersrc_ctx, buffersink_ctx] =
                                await libav.ff_init_filter_graph("anull", {
                                    sample_rate: track.sampleRate,
                                    sample_fmt: frames[0].format,
                                    channel_layout
                                }, {
                                    sample_rate: track.sampleRate,
                                    sample_fmt: track.format,
                                    channel_layout
                                });
                        }

                        // Resample
                        const rframes =
                            await libav.ff_filter_multi(buffersrc_ctx,
                                buffersink_ctx, frame, frames, packets.done);

                        for (const frame of rframes)
                            controller.enqueue(frame.data);

                        // Tell the host
                        if (opts.status) {
                            opts.status(
                                frames[frames.length-1].pts *
                                stream.time_base_num / stream.time_base_den,
                                duration
                            );
                        }

                        if (rframes.length) {
                            if (packets.done)
                                controller.close();
                            break;
                        }
                    }

                    if (packets.done) {
                        controller.close();
                        break;
                    }
                }
            }
        }));

        // And start it reading
        trackPromises.push(track.append(reader));
    }

    // Now wait for all the tracks
    await Promise.all(trackPromises);

    libav.terminate();

    // And save it
    await project.save();
    for (const idx in audioTracks)
        await audioTracks[idx].save();
}

/**
 * Delete a project (UI).
 */
function uiDeleteProject(d: ui.Dialog) {
    ui.dialog(async function(d, show) {
        ui.mk("div", d.box, {innerHTML: "Are you sure? This will delete project data in the browser (but will not delete any saved files or data on any servers).<br/><br/>"});
        const yesb = ui.btn(d.box, "<u>Y</u>es, delete the project", {className: "row"});
        hotkeys.registerHotkey(yesb, d, "y");
        const nob = ui.btn(d.box, "<u>N</u>o, cancel", {className: "row"});
        hotkeys.registerHotkey(nob, d, "n");

        show(nob);

        const yes = await new Promise(res => {
            yesb.onclick = () => res(true);
            nob.onclick = () => res(false);
        });

        if (yes) {
            await ui.loading(async function(d) {
                await deleteProject();
            }, {
                reuse: d
            });
        }
    }, {
        reuse: d
    });
}

/**
 * Delete a project.
 */
async function deleteProject() {
    // First drop the store
    await store.Store.dropInstance({name: "ez-project-" + project.id});

    // Then drop the ref in the main store
    await store.store.removeItem("ez-project-" + project.id);

    // Then drop it from the projects list
    const projects: string[] = await store.store.getItem("ez-projects");
    const idx = projects.indexOf(project.id);
    if (idx >= 0) {
        projects.splice(idx, 1);
        await store.store.setItem("ez-projects", projects);
    }

    // Then drop it from the live interface
    project = null;
    await unloadProject();
}

/**
 * Callback to stop the current playback, if there is one.
 */
let stopPlayback: () => unknown = null;

/**
 * Play the selected audio.
 */
export async function play() {
    // Override stopPlayback during loading
    stopPlayback = () => {};

    await ui.loading(async function() {
        // Make sure to get the AudioContext first so it's on the event
        const ac = await audio.getAudioContext();

        // Get our selection
        const sel = select.getSelection();

        // Make our stream options from the selection
        let streamOpts: any = {
            start: sel.start
        };
        if (sel.range)
            streamOpts.end = sel.end;

        // Find the longest track to be the play head sentinel
        let longest: audioData.AudioTrack = null;
        let longestLen = 0;
        for (const track of project.tracks) {
            const dur = track.duration();
            if (dur > longestLen) {
                longest = track;
                longestLen = dur;
            }
        }

        // Now make all the streams
        const streams = await Promise.all(
            project.tracks.map(x => x.stream(streamOpts))
        );

        // How many are currently ready to play?
        let readyCt = 0;
        let readyRes: (x:any)=>unknown = null;
        const readyPromise = new Promise(res => readyRes = res);

        // How many are currently playing?
        let playing = streams.length;

        // Convert them to sources
        const sourcePromises: Promise<any>[] = [];
        for (let i = 0; i < streams.length; i++) {
            const track = project.tracks[i];
            const stream = streams[i];

            // Callbacks
            const ready = () => {
                if (++readyCt === streams.length)
                    readyRes(null);
            };

            const end = () => {
                if (playing) {
                    playing--;
                    if (!playing && stopPlayback)
                        stopPlayback();
                }
            };

            if (track === longest) {
                // This is the longest track, so use its timestamps
                sourcePromises.push(audio.createSource(stream, {
                    status: ts => {
                        if (playing)
                            select.setPlayHead(sel.start + ts / ac.sampleRate);
                    },

                    ready,
                    end
                }));

            } else {
                sourcePromises.push(audio.createSource(stream, {ready, end}));

            }
        }

        const sources = await Promise.all(sourcePromises);

        // Wait until they're all ready
        await readyPromise;

        // Prepare to *stop* playback
        stopPlayback = () => {
            playing = 0;
            for (const source of sources) {
                source.node.disconnect(ac.destination);
                source.stop();
            }
            select.setPlayHead(null);
            stopPlayback = null;
        };

        // Connect them all
        for (const source of sources)
            source.node.connect(ac.destination);

        // And play them all
        for (const source of sources)
            source.start();
    });
}

// Project-level hotkeys
window.addEventListener("keydown", async function(ev) {
    if (!project)
        return;

    // No hotkeys if dialogs are up
    if (ui.ui.dialogs.length)
        return;

    if (ev.key === " ") {
        // Play or stop
        const el = <HTMLElement> ev.target;
        if (el.tagName === "BUTTON" ||
            el.tagName === "A" ||
            el.tagName === "INPUT")
            return;

        ev.preventDefault();

        if (stopPlayback)
            stopPlayback();
        else
            await play();

    } else if (ev.key === "z" && ev.ctrlKey) {
        // Undo
        ev.preventDefault();
        performUndo();

    }
});
