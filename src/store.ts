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

import * as status from "./status";
import * as ui from "./ui";

import * as bytes from "bytes";

import type * as localforageT from "localforage";
type LocalForage = typeof localforageT;
declare let localforage : LocalForage;

/**
 * For now, an Ennuizel store is just LocalForage, but eventually it will wrap
 * it with other things.
 */
export class Store {
    constructor(public localForage: LocalForage) {}

    static createInstance(opts: {name: string}) {
        return new Store(localforage.createInstance(opts));
    }

    static dropInstance(opts: {name: string}) {
        return localforage.dropInstance(opts);
    }

    async getItem(name: string): Promise<any> {
        return await this.localForage.getItem(name);
    }

    async setItem(name: string, value: any) {
        const ret = await this.localForage.setItem(name, value);
        await updateIndicator();
        return ret;
    }

    async removeItem(name: string) {
        const ret = await this.localForage.removeItem(name);
        await updateIndicator();
        return ret;
    }
}

/**
 * An undoable store is a store with the ability to undo. Only one undoable
 * store can exist at any time.
 */
export class UndoableStore extends Store {
    constructor(localForage: LocalForage) {
        super(localForage);
        localForage.dropInstance({name: "ez-undo"});
        this.undoStore = localForage.createInstance({name: "ez-undo"});
        this.undos = [];
        this.ct = 0;
    }

    /**
     * Create an undoable store.
     */
    static createInstance(opts: {name: string}) {
        return new UndoableStore(localforage.createInstance(opts));
    }

    /**
     * Set this as an undo point (i.e., if you undo, you'll undo to here)
     */
    undoPoint() {
        this.undos.push({c: "undo"});
    }

    /**
     * Drop the undo store.
     */
    dropUndo() {
        localforage.dropInstance({name: "ez-undo"});
    }

    /**
     * Set an item and remember the undo steps.
     */
    async setItem(name: string, value: any): Promise<any> {
        // Get the original value
        const orig = await this.getItem(name);

        // Make the undo
        if (orig !== null) {
            const ct = this.ct++;
            await this.undoStore.setItem(ct + "", orig);
            this.undos.push({c: "setItem", n: name, v: ct});
        } else {
            this.undos.push({c: "removeItem", n: name});
        }

        // Then perform the replacement
        return await super.setItem(name, value);
    }

    /**
     * Remove an item and remember the undo steps.
     */
    async removeItem(name: string) {
        // Get the original value
        const orig = await this.getItem(name);

        // Make the undo
        if (orig !== null) {
            const ct = this.ct++;
            await this.undoStore.setItem(ct + "", orig);
            this.undos.push({c: "setItem", n: name, v: ct});
        }

        // Then remove it
        return await super.removeItem(name);
    }

    /**
     * Perform an undo.
     */
    async undo() {
        let undo: any;
        while (undo = this.undos.pop()) {
            if (undo.c === "undo") {
                // An undo point, we're done
                break;

            } else if (undo.c === "setItem") {
                const val = await this.undoStore.getItem(undo.v + "");
                await super.setItem(undo.n, val);

            } else if (undo.c === "removeItem") {
                await super.removeItem(undo.n);

            }
        }
    }

    /**
     * Store for undo values.
     */
    undoStore: LocalForage;

    /**
     * The undo steps themselves.
     */
    undos: any[];

    /**
     * A counter for unique undo "names".
     */
    ct: number;
}

/**
 * A main, global store.
 */
export let store: Store = null;

/**
 * Load storage.
 */
export async function load() {
    store = new Store(localforage);
    await updateIndicator();
}

// Update the storage space indicator.
async function updateIndicator() {
    if (!navigator.storage || !navigator.storage.estimate)
        return;

    const estimate = await navigator.storage.estimate();
    status.pushStatus("storage",
        "Storage: " + Math.round(estimate.usage / estimate.quota * 100) + "% (" +
        bytes(estimate.usage) + "/" +
        bytes(estimate.quota) + ")"
    );
}
