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

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../ennuizel.d.ts" />

import * as audioData from "./audio-data";
import * as filters from "./filters";
import * as hotkeys from "./hotkeys";
import * as project from "./project";
import * as select from "./select";
import { WSPReadableStream } from "./stream";
import * as track from "./track";
import * as ui from "./ui";

// If we have user-defined plugins, say so
export let haveUserDefinedPlugins = false;

// All loaded plugins
let plugins: Record<string, ennuizel.Plugin> = Object.create(null);

// The URL of the plugin currently being loaded
let currentPluginURL: string = null;

// Most recently registered plugin
let registeredPlugin: ennuizel.Plugin = null;

/**
 * Load the plugin API.
 */
export async function load() {
    Ennuizel = {
        registerPlugin,
        loadPlugin,
        getPlugin,

        ReadableStream: WSPReadableStream,

        filters,
        hotkeys,
        ui,
        select,

        TrackType: track.TrackType,
        LibAVSampleFormat: audioData.LibAVSampleFormat,

        newProject: project.newProject,
        getProjects: project.getProjects,
        loadProject: project.loadProject,
        unloadProject: project.unloadProject
    };
}

/**
 * Call this to register your plugin. Every plugin *must* call this.
 * @param plugin  The plugin to register.
 */
function registerPlugin(plugin: ennuizel.Plugin) {
    registeredPlugin = plugin;
    plugin.url = currentPluginURL;
}

/**
 * Load a plugin by URL. Returns null if the plugin cannot be loaded.
 * @param url  The absolute URL (protocol optional) from which to load
 *             the plugin.
 * @param opts  Other options.
 */
export async function loadPlugin(url: string, opts: {
    userDefined?: boolean
} = {}) {
    if (opts.userDefined)
        haveUserDefinedPlugins = true;

    // Sanitize the URL
    if (url.indexOf("://") < 0)
        url = "https://" + url;

    // In case this is nested, remember the previous registration
    let prevPlugin = registeredPlugin;
    let prevURL = currentPluginURL;
    currentPluginURL = url;

    // Force the cache on the script to refresh
    try {
        const response = await fetch(url, {
            cache: "no-cache"
        });
        await response.text();
    } catch (ex) {}

    // Load the script
    try {
        await ui.loadLibrary(url);
    } catch (ex) {
        // Report what went wrong
        await ui.alert("Error loading plugin " + url + ": " + ex);
    }

    // Get the plugin
    let ret = registeredPlugin;
    registeredPlugin = prevPlugin;
    currentPluginURL = prevURL;

    // Load it
    if (ret) {
        if (ret.load) {
            try {
                await ret.load();
            } catch (ex) {
                await ui.alert("Error loading plugin " + ret.name + ": " + ex);
            }
        }
    } else {
        await ui.alert("Plugin " + url + " failed to register itself!");
    }

    plugins[ret.id] = ret;
    return ret;
}

/**
 * Get the loaded plugin with this ID, if such a plugin has been
 * loaded.
 * @param id  The ID of the plugin.
 */
function getPlugin(id: string) {
    return plugins[id] || null;
}
