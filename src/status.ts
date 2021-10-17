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

// Current status items
const statusKeys: string[] = [];
const statusItems: Record<string, string> = Object.create(null);

/**
 * Add a status item.
 * @param key  Name of the status item. If this name already exists, the data
 *             will be replaced.
 * @param value  The text of the status item.
 */
export function pushStatus(key: string, value: string) {
    if (statusKeys.indexOf(key) < 0)
        statusKeys.push(key);
    statusItems[key] = value;
    updateStatus();
}

/**
 * Remove a status item.
 * @param key  Name of the status item to remove.
 */
export function popStatus(key: string) {
    delete statusItems[key];
    const idx = statusKeys.indexOf(key);
    if (idx >= 0)
        statusKeys.splice(idx, 1);
    updateStatus();
}

// Update the status bar
function updateStatus() {
    // Make the full text
    const cont: string[] = [];
    for (const key of statusKeys)
        cont.push(statusItems[key]);
    if (cont.length === 0)
        cont.push("&nbsp;");

    // And display it
    ui.ui.status.innerHTML = cont.join("<br/>");
}
