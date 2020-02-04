/*
 * Copyright (c) 2020 Yahweasel 
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

// Serialize an object which may contain typed arrays
function serialize(obj) {
    var t = [];
    return JSON.stringify({d: serializeParts([], obj, t), t: t});
}

// Serialize one level of depth
function serializeParts(path, obj, types) {
    var baseType = Object.prototype.toString.call(obj);

    if (baseType === "[object Array]") {
        // Serialize an array
        var dup = null;
        for (var i = 0; i < obj.length; i++) {
            var oel = obj[i];
            var nel = serializeParts(path.concat([i]), obj[i], types);
            if (oel !== nel) {
                if (!dup)
                    dup = new Array(obj.length)
                dup[i] = nel;
            }
        }
        if (dup) {
            for (var i = 0; i < obj.length; i++) {
                if (!dup[i])
                    dup[i] = obj[i];
            }
        }
        return dup || obj;

    } else if (typeof obj === "object") {
        // Some object type, maybe be careful of the type
        var typedArray = /^\[object ([A-Za-z0-9]+Array)\]$/.exec(baseType);

        if (typedArray) {
            // It was a typed array, so serialize it as a string
            types.push({p: path, t: typedArray[1]});
            var u8 = new Uint8Array(obj.buffer);
            var s = "";
            for (var i = 0; i < u8.length; i++)
                s += String.fromCharCode(u8[i] + 0x20);
            return s;
        }

        // Follow through
        var dup = null;
        for (var key in obj) {
            var oel = obj[key];
            var nel = serializeParts(path.concat([key]), obj[key], types);
            if (oel !== nel) {
                if (!dup)
                    dup = {};
                dup[key] = nel;
            }
        }
        if (dup) {
            for (var key in obj) {
                if (!(key in dup))
                    dup[key] = obj[key];
            }
        }

        return dup || obj;

    } else return obj;
}

// Deserialize
function deserialize(str) {
    var dat = JSON.parse(str);

    // Apply each type conversion
    dat.t.forEach(function(conv) {
        var s = serget(dat, conv.p);

        // Convert the string to a Uint8Array
        var u8 = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++)
            u8[i] = s.charCodeAt(i) - 0x20;

        // Then the proper type
        var v = new (window[conv.t])(u8.buffer);

        serset(dat, conv.p, v);
    });

    return dat.d;
}

// Get a value by path
function serget(obj, path) {
    obj = obj.d;
    for (var i = 0; i < path.length; i++)
        obj = obj[path[i]];
    return obj;
}

// Set a value by path
function serset(obj, path, val) {
    if (path.length === 0) {
        obj.d = val;
        return;
    }

    obj = obj.d;
    var i;
    for (i = 0; i < path.length - 1; i++)
        obj = obj[path[i]];
    obj[path[i]] = val;
}
