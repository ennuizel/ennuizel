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

import * as ui from "./ui";

const threads = navigator.hardwareConcurrency ? navigator.hardwareConcurrency * 2 : 8;

// Multiple parallel libav instances
const libavPromises: Promise<unknown>[] = [];
const libavs: any[] = [];
const users: Promise<unknown>[] = [];
const queue: ((x:any)=>unknown)[] = [];

/**
 * Load all our libavs.
 */
export async function load() {
    while (libavs.length < threads) {
        const idx = libavs.length;
        libavs.push(null);
        libavPromises.push(LibAV.LibAV().then((libav: any) => libavs[idx] = libav));
    }
    while (users.length < threads)
        users.push(null);
}

/**
 * Enqueue a task. enqueue itself returns when the task *starts* running. The
 * task takes the assigned libav as an argument.
 * @param task  The task to be enqueued.
 */
export async function enqueue(task: (libav: any) => Promise<unknown>) {
    while (true) {
        // Check for any free slots
        let idx = 0;
        for (idx = 0; idx < threads; idx++) {
            if (!users[idx])
                break;
        }

        // No free slots
        if (idx >= threads) {
            await new Promise(res => queue.push(res));
            continue;
        }

        // Check that we have a libav
        let libav = libavs[idx];
        if (!libav) {
            await libavPromises[idx];
            libav = libavs[idx];
        }

        // OK, take the slot
        users[idx] = task(libav).then(() => {
            users[idx] = null;
            if (queue.length)
                queue.shift()(null);
        });
        break;
    }
}

/**
 * Enqueue a task and wait for its completion.
 * @params task  The task.
 */
export async function enqueueSync(task: (libav: any) => Promise<unknown>) {
    // Set the promise to wait on
    let syncRes: (x:any)=>unknown, syncRej: (x:any)=>unknown;
    const p = new Promise((res, rej) => {
        syncRes = res;
        syncRej = rej;
    });

    // Enqueue as normal
    enqueue(async function(libav) {
        // Signal after completion
        try {
            await task(libav);
        } catch (ex) {
            syncRej(ex);
            return;
        }
        syncRes(null);
    });

    // Now wait for p
    await p;
}

/**
 * Wait for the queue of libav tasks to finish. You should usually do this at
 * the end of any processing, to make sure you don't create race conditions
 * with later processing.
 */
export async function flush() {
    // First wait for something, to make sure we empty the queue
    await new Promise(res => {
        enqueue(async function() { res(null); });
    });

    // Then wait for anything remaining
    await Promise.all(users);
}
