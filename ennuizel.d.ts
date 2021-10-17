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

    interface Ennuizel {
        /**
         * The UI.
         */
        ui: ui.UI;

        /**
         * Create (and load) a new project with the given name.
         * @param name  Name for the project.
         */
        newProject(name: string): Promise<Project>;
    }
}

/**
 * The entry point for plugins.
 */
declare var Ennuizel: ennuizel.Ennuizel;
