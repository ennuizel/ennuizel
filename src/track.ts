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

import * as store from "./store";

/**
 * All supported track types.
 */
export enum TrackType {
    Audio = 1
}

/**
 * A unifying track type for all tracks.
 */
export interface Track {
    /**
     * Return the type of this track.
     */
    type: () => number;

    /**
     * Internal (saved) ID for this track.
     */
    id: string;

    /**
     * The only thing a track knows about the project is that it has a store.
     */
    project: {store: store.UndoableStore};

    /**
     * All tracks must support saving, but loading is type-specific.
     */
    save: (opts?: {deep?: boolean}) => Promise<unknown>;

    /**
     * All tracks must support deletion.
     */
    del: () => Promise<unknown>;

    /**
     * The name for this track.
     */
    name: string;

    /**
     * The info box for this track.
     */
    info: HTMLElement;
}
