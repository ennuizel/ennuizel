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
        }
    }

    /**
     * The interface the plugin writer must provide.
     */
    interface Plugin {
        /**
         * Name of the plugin.
         */
        readonly name: string;

        /**
         * URL for *information* on the plugin (not for the plugin itself)
         */
        readonly infoURL: string;

        /**
         * A full description of the plugin, in HTML.
         */
        readonly description: string;

        /**
         * License information.
         */
        readonly licenseInfo: string;

        /**
         * A "wizard" (optional) to use in place of the normal Ennuizel flow.
         */
        wizard?: (d: ui.Dialog) => Promise<void>;
    }

    interface Ennuizel {
        /**
         * web-streams-polyfill's ReadableStream.
         */
        ReadableStream: typeof ReadableStream;

        /**
         * The UI.
         */
        ui: ui.UI;

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
