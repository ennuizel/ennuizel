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
    serializeParts([], obj, t);
    return JSON.stringify({d: obj, t: t});
}

// Serialize one level of depth
function serializeParts(path, obj, types) {
    var baseType = Object.prototype.toString.call(obj);

    if (baseType === "[object Array]") {
        // Serialize an array
        for (var i = 0; i < obj.length; i++)
            serializeParts(path.concat([i]), obj[i], types);

    } else if (typeof obj === "object") {
        // Some object type, maybe be careful of the type
        var typedArray = /^\[object ([A-Za-z0-9]+Array)\]$/.exec(baseType);

        if (typedArray) {
            // It was a typed array!
            types.push({p: path, t: typedArray[1], l: obj.length});
            return;
        }

        // Follow through
        for (var key in obj)
            serializeParts(path.concat([key]), obj[key], types);

    }
}

// Deserialize
function deserialize(str) {
    var dat = JSON.parse(str);

    // Apply each type conversion
    dat.t.forEach(function(conv) {
        var val = serget(dat, conv.p);
        val.length = conv.l;
        serset(dat, conv.p, new (window[conv.t])(val));
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
