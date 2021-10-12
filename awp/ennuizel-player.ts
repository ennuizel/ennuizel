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

/* These declarations are from https://github.com/joanrieu at
 * https://github.com/microsoft/TypeScript/issues/28308#issuecomment-650802278 */
interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}

declare const AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

declare function registerProcessor(
    name: string,
    processorCtor: (new (
        options?: AudioWorkletNodeOptions
    ) => AudioWorkletProcessor) & {
        parameterDescriptors?: any[];
    }
);

// Buffering playback processor
class EnnuizelPlayer extends AudioWorkletProcessor {
    // Incoming audio data buffers
    buf: Float32Array[][];

    // Size of the buffer in samples
    bufSz: number;

    // How much we've played
    played: number;

    // Threshold for getting more data
    threshold: number;

    // Set when we're done reading data
    done: boolean;

    // Call to resume requesting data
    resume: (x:unknown)=>unknown;

    constructor(options?: AudioWorkletNodeOptions) {
        super(options);

        this.buf = [];
        this.bufSz = 0;
        this.played = 0;
        this.threshold = options.parameterData.sampleRate * 30;
        this.done = false;
        this.resume = null;

        this.reader();
    }

    async reader() {
        let recv: (x:unknown)=>unknown = null;

        // Our message handler
        this.port.onmessage = ev => {
            if (!ev.data) {
                // No more data!
                recv(false);
                return;
            }
            const len = ev.data.map(x => x[0].length).reduce((x, y) => x + y);
            this.buf = this.buf.concat(ev.data);
            this.bufSz += len;
            recv(true);
        };

        // Expect our first piece of data
        await new Promise(res => recv = res);

        // We expect data at the start
        while (true) {
            if (this.bufSz < this.threshold) {
                // Too little data. Request more.
                this.port.postMessage({c: "read"});
                if (!(await new Promise(res => recv = res))) {
                    // No more data!
                    this.done = true;
                    return;
                }
            } else {
                // Enough data. Wait until we've played down.
                await new Promise(res => this.resume = res);
                this.resume = null;
            }
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        const output = outputs[0];
        let offset = 0;
        let remaining = output[0].length;
        while (remaining) {
            if (!this.buf.length) {
                // Not enough data!
                break;
            }

            const d = this.buf[0];
            if (d[0].length > remaining) {
                // More than enough data
                for (let i = 0; i < d.length; i++) {
                    output[i].set(d[i].subarray(0, remaining), offset);
                    d[i] = d[i].subarray(remaining);
                }
                this.bufSz -= remaining;
                this.played += remaining;
                remaining = 0;

            } else {
                // Not enough (or exactly enough) data
                for (let i = 0; i < d.length; i++)
                    output[i].set(d[i], offset);
                this.bufSz -= d[0].length;
                this.buf.shift();
                offset += d[0].length;
                this.played += d[0].length;
                remaining -= d[0].length;

            }
        }

        // Tell the host where we are
        this.port.postMessage({c: "time", d: this.played});

        // Maybe ask for more
        if (this.bufSz < this.threshold && this.resume) {
            this.resume(null);
            
        } else if (this.done && this.buf.length === 0) {
            // We're done!
            this.port.postMessage({c: "done"});
            return false;

        }

        return true;
    }
}

registerProcessor("ennuizel-player", EnnuizelPlayer);
