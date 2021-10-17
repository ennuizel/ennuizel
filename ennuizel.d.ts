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

/*
 * This file defines the API for plugins
 *
 * Note that more functionality is exposed than is documented in this file.
 * ANYTHING THAT IS NOT DOCUMENTED IN THIS FILE IS NOT PART OF THE PUBLIC API
 * AND IS SUBJECT TO CHANGE AT ANY TIME. Only use the listed functionality
 * here.
 */

declare namespace ennuizel {
    type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array |
                      Int32Array | Uint32Array | Float32Array | Float64Array;

    /**
     * An Ennuizel project. Only one project can be loaded at a time, so there
     * should only ever be one instance of this type at a time.
     */
    interface Project {
        /**
         * Delete this project.
         */
        del(): Promise<void>;

        /**
         * Internal ID for the project.
         */
        readonly id: string;

        /**
         * Name of the project.
         */
        readonly name: string;

        /**
         * Create a new audio track. The track is added to the project if it's not temporary.
         * @param opts  Options for creating the track.
         */
        newAudioTrack(opts?: {name?: string, temp?: boolean}): Promise<track.AudioTrack>;

        /**
         * Remove a track. The track is deleted even if it was never actually added
         * to the project, so this is also the way to delete a track.
         * @param track  The track to remove.
         */
        removeTrack(track: track.Track): Promise<void>;
    }

    namespace track {
        /**
         * All supported track types.
         */
        enum TrackType {
            Audio = 1
        }

        /**
         * A unifying track type for all tracks.
         */
        interface Track {
            /**
             * Return the type of this track.
             */
            type(): number;

            /**
             * The name for this track.
             */
            readonly name: string;
        }

        interface AudioTrack extends Track {
            /**
             * Append data from a stream of raw data chunks. The type of the chunks
             * must correspond to the format specified in the format field.
             * @param stream  The stream to read from.
             */
            append(stream: ReadableStream<TypedArray>): Promise<void>;

            /**
             * Append a single chunk of raw data.
             * @param data  The single chunk of data.
             */
            appendRaw(data: TypedArray): void;

            /**
             * Get the duration, in seconds, of this track.
             */
            duration(): number;

            /**
             * Get the number of samples in this track. This is, in essence, the
             * duration in samples times the number of channels.
             */
            sampleCount(): number;

            /**
             * Get this data as a ReadableStream. Packets are sent roughly in libav.js
             * format, but with the AudioData node specified in a `node` field.
             * @param opts  Options. In particular, you can set the start and end time
             *              here.
             */
            stream(opts?: {
                start?: number;
                end?: number;
                keepOpen?: boolean;
            }): ReadableStream<any>;

            /**
             * Overwrite a specific range of data from a ReadableStream. The stream
             * must give TypedArray chunks, and must be of the same length as is being
             * overwritten. A stream() with keepOpen and an overwrite() with closeTwice
             * creates an effective filter.
             * @param opts  Options. In particular, you can set the start and end time
             *              here.
             */
            overwrite(data: ReadableStream<TypedArray>, opts?: {
                start?: number;
                end?: number;
                closeTwice?: boolean;
            }): Promise<void>;

            /**
             * Replace a segment of audio data with the audio data from another track.
             * The other track will be deleted. Can clip (by not giving a replacement)
             * or insert (by replacing no time) as well.
             * @param start  Start time, in seconds.
             * @param end  End time, in seconds.
             * @param replacement  Track containing replacement data, which must be in
             *                     the same format, sample rate, number of tracks.
             */
            replace(start: number, end: number, replacement: AudioTrack): Promise<void>;

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
        }
    }

    namespace filters {
        /**
         * A custom (presumably non-FFmpeg) filter, provided by a plugin.
         */
        interface CustomFilter {
            /**
             * User-visible name for the filter. May include underscores for
             * hotkeyability, but beware overlaps.
             */
            name: string;

            /**
             * Function to run to perform the filter *from the UI*. If you want an
             * automated filter, expose it as part of your plugin API.
             */
            filter: (d: ui.Dialog) => Promise<void>;
        }

        interface Filters {
            /**
             * Apply an FFmpeg filter, given a filter string.
             * @param fs  The filter string.
             * @param changesDuration  Set if this filter changes duration, so the process
             *                         must use a temporary track.
             * @param sel  The selection to filter.
             * @param d  (Optional) The dialog in which to show the status, if applicable.
             *           This dialog will *not* be closed.
             */
            ffmpegFilterString(fs: string, changesDuration: boolean, sel: select.Selection, d: ui.Dialog): Promise<void>;

            /**
             * Register a custom filter.
             * @param filter  The filter.
             */
            registerCustomFilter(filter: CustomFilter): void;
        }
    }

    namespace ui {
        /**
         * A dialog box.
         */
        interface Dialog {
            readonly box: HTMLElement;
        }

        /**
         * Options for opening a dialog.
         */
        export interface DialogOptions {
            reuse?: Dialog;
            closeable?: boolean;
            keepOpen?: boolean;
            forceClose?: boolean;
        }

        /**
         * The UI API.
         */
        interface UI {
            /**
             * Create a dialog box. If it's not closeable by the user, will close
             * automatically after the callback finishes.
             * @param callback  Function to call with the dialog box.
             * @param opts  Other options.
             */
            dialog<T>(
                callback: (x: Dialog, y: (x: HTMLElement) => unknown) => Promise<T>,
                opts?: DialogOptions
            ): Promise<T>;

            /**
             * Wrapper to quickly close a dialog box that's been kept open.
             * @param d  The dialog.
             */
            dialogClose(d: Dialog): Promise<void>;

            /**
             * Show a loading screen while performing some task.
             * @param callback  The callback to run while the loading screen is shown.
             */
            loading<T>(
                callback: (x:Dialog) => Promise<T>, opts?: DialogOptions
            ): Promise<T>;

            /**
             * Show an OK-only alert box.
             * @param html  innerHTML of the dialog.
             */
            alert(html: string): Promise<void>;

            /**
             * Load a library.
             * @param name  URL of the library to load.
             */
            loadLibrary(name: string): Promise<void>;
        }
    }

    namespace select {
        /**
         * Interface for the current selection.
         */
        export interface Selection {
            range: boolean;
            start: number;
            end: number;
            tracks: track.Track[];
        }

        interface Select {
            /**
             * Get the current selection.
             */
            getSelection(): Selection;

            /**
             * Set the *time* of the selection. Don't set the end time to select all time.
             * @param start  Start time. Default 0.
             * @param end  Optional end time.
             */
            selectTime(start?: number, end?: number): Promise<void>;

            /**
             * Set the *tracks* currently selected. Does not update the time.
             * @param tracks  Array of tracks to select. May be empty.
             */
            selectTracks(tracks: track.Track[]): Promise<void>;

            /**
             * Select all selectables, and clear the range so that everything is selected.
             * @param opts  Selection options.
             */
            selectAll(opts: {tracksOnly?: boolean}): Promise<void>;
        }
    }

    /**
     * The interface the plugin writer must provide.
     */
    interface Plugin {
        /**
         * Public name of the plugin.
         */
        name: string;

        /**
         * API name of the plugin.
         */
        id: string;

        /**
         * URL for *information* on the plugin (not for the plugin itself)
         */
        infoURL: string;

        /**
         * A full description of the plugin, in HTML.
         */
        description: string;

        /**
         * License information.
         */
        licenseInfo: string;

        /**
         * The plugin's URL. This is set by registerPlugin, not the plugin.
         */
        url?: string;

        /**
         * An optional load function to finish loading the plugin.
         */
        load?: () => Promise<void>;

        /**
         * A "wizard" (optional) to use in place of the normal Ennuizel flow.
         */
        wizard?: (d: ui.Dialog) => Promise<void>;

        /**
         * The API for your plugin itself, which other plugins can use.
         */
        api?: any;
    }

    interface Ennuizel {
        /**
         * Call this to register your plugin. Every plugin *must* call this.
         * @param plugin  The plugin to register.
         */
        registerPlugin(plugin: Plugin): void;

        /**
         * Load a plugin by URL. Returns null if the plugin cannot be loaded.
         * @param url  The absolute URL (protocol optional) from which to load
         *             the plugin.
         */
        loadPlugin(url: string): Promise<Plugin>;

        /**
         * Get the loaded plugin with this ID, if such a plugin has been
         * loaded.
         * @param id  The ID of the plugin.
         */
        getPlugin(id: string): Plugin;

        /**
         * web-streams-polyfill's ReadableStream.
         */
        ReadableStream: typeof ReadableStream;

        /**
         * The filter interface.
         */
        filters: filters.Filters;

        /**
         * The UI.
         */
        ui: ui.UI;

        /**
         * Selection.
         */
        select: select.Select;

        /**
         * Create (and load) a new project with the given name.
         * @param name  Name for the project.
         */
        newProject(name: string): Promise<Project>;

        /**
         * Get the list of projects.
         */
        getProjects(): Promise<{id: string, name: string}[]>;

        /**
         * Load a project by ID.
         * @param id  The ID of the project to load.
         */
        loadProject(id: string): Promise<Project>;

        /**
         * Unload the current project from the user interface.
         */
        unloadProject(): Promise<void>;
    }
}

/**
 * The entry point for plugins.
 */
declare var Ennuizel: ennuizel.Ennuizel;
