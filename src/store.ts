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

import * as ui from "./ui";

import type * as localforageT from "localforage";
type LocalForage = typeof localforageT;
declare let localforage : LocalForage;

/**
 * For now, an Ennuizel store is just LocalForage, but eventually it will wrap
 * it with other things.
 */
export class Store {
    constructor(public localForage: LocalForage) {}

    createInstance(opts: {name: string}) {
        return new Store(this.localForage.createInstance(opts));
    }

    dropInstance(opts: {name: string}) {
        return this.dropInstance(opts);
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
    ui.ui.storageIndicator.innerHTML =
        "Storage: " + Math.round(estimate.usage / estimate.quota * 100) + "%&nbsp;";
}
