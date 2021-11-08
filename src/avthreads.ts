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

const threads = navigator.hardwareConcurrency || 2;

// Multiple parallel libav instances
const libavPromises: Promise<unknown>[] = [];
const libavs: any[] = [];
let libavCur = 0;

/**
 * Load all our libavs.
 */
export async function load() {
    while (libavs.length < threads) {
        const idx = libavs.length;
        libavs.push(null);
        libavPromises.push(LibAV.LibAV().then((libav: any) => libavs[idx] = libav));
    }
}

/**
 * Get a libav instance.
 */
export async function get() {
    let cur = libavCur;
    libavCur = (libavCur + 1) % threads;

    if (!libavs[cur]) {
        // Wait for it to be available
        await libavPromises[cur];
    }

    return libavs[cur];
}
