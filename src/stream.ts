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

import { ReadableStream } from "web-streams-polyfill/ponyfill";

/**
 * A ReadableStream paired with the ability to push back data.
 */
export class EZStream<R> {
    /**
     * Create an EZStream.
     * @param readableStream  The underlying ReadableStream.
     */
    constructor(public readableStream: ReadableStream<R>) {
        this.buf = [];

        if (readableStream) {
            this.reader = readableStream.getReader();
            this.done = false;
        } else {
            this.reader = null;
            this.done = true;
        }
    }

    /**
     * Read an element. Returns null if the stream has ended.
     */
    async read(): Promise<R> {
        if (this.buf.length)
            return this.buf.pop();

        if (this.done)
            return null;

        const chunk = await this.reader.read();
        if (chunk.done) {
            this.done = true;
            return null;
        }
        return chunk.value;
    }

    /**
     * Cancel the stream.
     */
    cancel() {
        this.readableStream.cancel();
    }

    /**
     * Push this chunk back. It will be returned eagerly by the next read.
     */
    push(chunk: R) {
        this.buf.push(chunk);
    }

    /**
     * Is this stream finished?
     */
    isDone(): boolean {
        if (this.buf.length)
            return false;
        return this.done;
    }

    /**
     * The underlying ReadableStreamDefaultReader.
     */
    reader: ReadableStreamDefaultReader<R>;

    // Buffer of returned items
    private buf: R[];

    // Set when the underlying ReadableStream has ended.
    private done: boolean;
}

// Create an EZStream from a single item
export function ezStreamFrom<R>(x: R): EZStream<R> {
    let ret = new EZStream<R>(null);
    ret.push(x);
    return ret;
}
