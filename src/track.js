/*
 * Copyright (c) 2019 Yahweasel 
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

/*
 * TRACK FORMAT:
 *
 * In the project, each track has an ID. project.tracks[id] is a track
 * structure, with sampleRate etc, and parts.
 *
 * Each part in parts represents a segment of audio. It has an id, a start and
 * a length (in sample rate units). The actual data is in the DB in data-id. In
 * addition, each part has a 'raw' field, which is true if the data is
 * uncompressed, and false if it's compressed. If it's uncompressed, the data
 * in the DB is an array of LibAV frames. If not, it's an ArrayBuffer of a
 * WavPack file.
 */

// Import a track from a local file (dialog)
function importTrackDialog() {
    var input;
    return modalWait().then(function(unlock) {
        modalDialog.innerHTML = "";

        input = mke(modalDialog, "input");
        input.type = "file";
        var cancel = mke(modalDialog, "button", {text: l("cancel")});

        modalToggle(true);
        input.focus();

        return new Promise(function(res, rej) {
            input.onchange = function() {
                if (input.files.length) {
                    unlock();
                    res(input);
                }
            };
            cancel.onclick = function() {
                unlock();
                res(null);
            };
        });

    }).then(function(ret) {
        if (!ret) {
            // They canceled
            modal();
            return;
        }

        // Read in the file
        modal(l("importinge"));
        var fr = new FileReader();

        return new Promise(function(res, rej) {
            fr.onload = res;
            fr.onabort = rej;
            fr.onerror = rej;
            fr.readAsArrayBuffer(input.files[0]);

        }).then(function() {
            return importTrackData(input.files[0].name.replace(/\.[^\.]*$/, ""), fr.result);

        }).then(function() {
            modal();

        });

    });
}

// Import a track from an ArrayBuffer
function importTrackData(name, ab) {
    var fmt_ctx, streams, aidxs, durations, cs = [], pkts = [], frames = [];
    var buf = new Uint8Array(ab);

    // Create a temporary import name for it
    var imName = "input-" + randomId() + ".dat";

    return libav.writeFile(imName, buf).then(function() {
        return libav.ff_init_demuxer_file(imName);

    }).then(function(ret) {
        fmt_ctx = ret[0];
        streams = ret[1];

        // Find all audio streams
        var si;
        var astreams = [];
        aidxs = [];
        durations = [];
        for (si = 0; si < streams.length; si++) {
            var stream = streams[si];
            if (stream.codec_type === libav.AVMEDIA_TYPE_AUDIO) {
                astreams.push(stream);
                aidxs.push(si);
                var d = stream.duration_time_base;
                if (d < 0) d = 0;
                durations.push(d);
            }
        }
        if (astreams.length === 0)
            throw new Error(l("noaudio"));

        // Initialize all their decoders
        var p = Promise.all([]);

        astreams.forEach(function(stream) {
            p = p.then(function() {
                return libav.ff_init_decoder(stream.codec_id, stream.codecpar);
            }).then(function(ret) {
                cs.push(ret[1]);
                pkts.push(ret[2]);
                frames.push(ret[3]);
            });
        });

        return p;

    }).then(function() {
        // Now import it all
        return importTrackLibAV(name, fmt_ctx, aidxs, durations, cs, pkts, frames);

    }).then(function() {
        return cleanup();

    }).catch(function(ex) {
        return warn(ex).then(cleanup);

    });

    function cleanup() {
        var p = Promise.all([]);
        for (var i = 0; i < cs.length; i++) (function(i) {
            p = p.then(function() {
                return libav.ff_free_decoder(cs[i], pkts[i], frames[i]);
            });
        })(i);
        return p.then(function() {
            if (fmt_ctx)
                return libav.avformat_close_input_js(fmt_ctx);
        }).then(function() {
            return libav.unlink(imName);
        });
    }
}
ez.importTrackData = importTrackData;

// Utility function (DOES NOT BELONG HERE)
function timestamp(time) {
    var ts = ~~(time % 60) + "";
    time /= 60;
    if (time > 0) {
        if (ts.length === 1) ts = "0"+ts;
        var min = ~~(time % 60);
        ts = min + ":" + ts;
        time /= 60;

        if (time > 0) {
            if (min < 10) ts = "0"+ts;
            ts = ~~time + ":" + ts;
        }
    }
    return ts;
}

/* Import one or more tracks once we're already prepared in libav.js. This
 * function can use an alternative libav.js worker, so that plugins can import
 * with multithreading, by setting opts.libav. If an alt libav is set, then
 * tracks will not be rendered, since that isn't threadable (for the moment). */
function importTrackLibAV(name, fmt_ctx, stream_idxs, durations, cs, pkts, frameptrs, opts) {
    opts = opts || {};
    var la = opts.libav || libav;
    var report = opts.report || modal;
    var tracks = [];
    var needFilter = [];
    var filterGraphs = {}, buffersrcCtxs = {}, buffersinkCtxs = {};
    var ptss = [];
    var multitrack = (stream_idxs.length > 1);

    // Start by making all the tracks
    stream_idxs.forEach(function(idx) {
        var post = multitrack ? (" " + (idx+1)) : "";
        tracks.push(createTrack(name + post));
        needFilter.push(true);
        ptss.push(0);
    });

    return Promise.all(tracks).then(function(ret) {
        tracks = ret;

        function handlePackets(ret) {
            var err = ret[0];
            var packets = ret[1];
            if (err !== -libav.EAGAIN && err !== libav.AVERROR_EOF)
                throw new Error("Error reading: " + err);

            if (err === -libav.EAGAIN && Object.keys(packets).length === 0 && opts.againCb) {
                // Nothing to read, request more
                return opts.againCb().then(function() {
                    return la.ff_read_multi(fmt_ctx, pkts[0], opts.devfile, maxReadSize);
                }).then(handlePackets);
            }

            // For each stream we care about...
            var p = Promise.all([]);
            var si;
            for (si = 0; si < tracks.length; si++) (function(si) {
                var stream_idx = stream_idxs[si];
                var spackets = packets[stream_idx];
                if (!spackets) return;
                var track = tracks[si];
                var duration = durations[si];
                var c = cs[si];
                var pkt = pkts[si];
                var frames;
                var frame = frameptrs[si];
                var filterGraph = filterGraphs[si];
                var buffersrcCtx = buffersrcCtxs[si];
                var buffersinkCtx = buffersinkCtxs[si];

                p = p.then(function() {
                    return la.ff_decode_multi(c, pkt, frame, spackets, {
                        ignoreErrors: !!opts.ignoreErrors,
                        fin: (err === libav.AVERROR_EOF)
                    });
                }).then(function(ret) {
                    frames = ret;
                    if (!filterGraph && needFilter[si] && frames.length) {
                        // Find the needed filter for a format supported by wavpack
                        var target = frames[0].format;
                        switch (target) {
                            case libav.AV_SAMPLE_FMT_U8:
                                target = libav.AV_SAMPLE_FMT_U8P;
                                break;

                            case libav.AV_SAMPLE_FMT_S16:
                                target = libav.AV_SAMPLE_FMT_S16P;
                                break;

                            case libav.AV_SAMPLE_FMT_S32:
                                target = libav.AV_SAMPLE_FMT_S32P;
                                break;

                            case libav.AV_SAMPLE_FMT_FLT:
                                target = libav.AV_SAMPLE_FMT_FLTP;
                                break;

                            case libav.AV_SAMPLE_FMT_U8P:
                            case libav.AV_SAMPLE_FMT_S16P:
                            case libav.AV_SAMPLE_FMT_S32P:
                            case libav.AV_SAMPLE_FMT_FLTP:
                                needFilter[si] = ("filter" in opts);
                                break;

                            default:
                                target = libav.AV_SAMPLE_FMT_S32P;
                                break;
                        }

                        if (!needFilter[si])
                            return null;

                        var channelLayout = frames[0].channelLayout;
                        if (!channelLayout) {
                            // Unknown channel layout, so just invent it
                            var channels = frames[0].channels;
                            switch (channels) {
                                case 1:
                                    channelLayout = 4;
                                    break;

                                default:
                                    channelLayout = (1<<channels)-1;
                            }
                        }

                        return la.ff_init_filter_graph(opts.filter ? opts.filter : "anull", {
                            sample_rate: frames[0].sample_rate,
                            sample_fmt: frames[0].format,
                            channel_layout: channelLayout
                        }, {
                            sample_rate: frames[0].sample_rate,
                            sample_fmt: target,
                            channel_layout: channelLayout,
                            frame_size: Math.floor(frames[0].sample_rate / frames[0].channels)
                        });

                    } else return null;
                    
                }).then(function(ret) {
                    if (ret) {
                        // We initialized a filter graph
                        filterGraphs[si] = filterGraph = ret[0];
                        buffersrcCtxs[si] = buffersrcCtx = ret[1];
                        buffersinkCtxs[si] = buffersinkCtx = ret[2];
                    }

                    // Possibly transform it
                    if (filterGraph)
                        return la.ff_filter_multi(buffersrcCtx, buffersinkCtx, frame, frames, (err === libav.AVERROR_EOF));
                    return null;

                }).then(function(ret) {
                    if (ret) {
                        // Transformed
                        frames = ret;
                    }

                    // Append it all
                    var p = Promise.all([]);
                    frames.forEach(function(frame) {
                        ptss[si] += frame.nb_samples;
                        p = p.then(function() {
                            return trackAppend(track, frame, la);
                        });
                    });

                    // Display status
                    p = p.then(function() {
                        if (duration)
                            report(l("loadingx", name) + ": " + Math.round(ptss[si] / duration * 100) + "%");
                        else
                            report(l("loadingx", name) + ": " + timestamp(ptss[si] / track.sampleRate));
                    });

                    return p;

                });
            })(si);

            // Either we're done, or we need to loop again
            if (err === -libav.EAGAIN) {
                p = p.then(function() {
                    return la.ff_read_multi(fmt_ctx, pkts[0], opts.devfile, maxReadSize).then(handlePackets);
                });
            }

            return p;
        }

        return la.ff_read_multi(fmt_ctx, pkts[0], opts.devfile, maxReadSize).then(handlePackets);

    }).then(function() {
        // Free our filters
        var p = Promise.all([]);
        for (var si = 0; si < tracks.length; si++) (function(si) {
            if (filterGraphs[si]) {
                p = p.then(function() {
                    return la.avfilter_graph_free_js(filterGraphs[si]);
                });
            }
        })(si);
        return p;

    }).then(dbCacheFlush).then(function() {
        if (!opts.libav)
            return updateTrackViews();
    });
}
ez.importTrackLibAV = importTrackLibAV;

// Create a fresh new track
function createTrack(name) {
    // Make sure there's a name
    if (typeof name === "undefined")
        name = l("trackx", (projectProperties.trackOrder.length+1));

    // Find an unused ID
    var trackId = randomId();
    while (trackId in tracks)
        trackId = randomId();

    // Claim it
    var track = tracks[trackId] = {
        name: name,
        id: trackId,
        length: 0,
        parts: [],
        format: -1, // Unset
        channelLayout: -1,
        channels: -1,
        sampleRate: -1
    };
    projectProperties.trackOrder.push(trackId);

    // And update
    return projectPropertiesUpdate().then(dbCacheFlush).then(function() {
        return Promise.resolve(track);
    });
}
ez.createTrack = createTrack;

// Append a frame to a track (does not flush)
function trackAppend(track, frame, la) {
    la = la || libav;
    var parts = track.parts;
    var part, data;

    // First make sure the track itself is initialized
    var p;
    if (track.format < 0) {
        track.format = frame.format;
        track.channelLayout = frame.channel_layout;
        track.channels = frame.channels;
        track.sampleRate = frame.sample_rate;
        p = projectPropertiesUpdate();
    } else {
        p = Promise.all([]);
    }

    // Append its duration
    track.length += frame.nb_samples;

    return p.then(function() {
        // Check if we need to add a new part
        var newPart = false;
        var start = 0;
        if (parts.length === 0) {
            // 'course we do!
            newPart = true;
        } else {
            var lastPart = parts[parts.length - 1];
            start = lastPart.start + lastPart.length;
            if (!lastPart.raw)
                newPart = true;
        }

        // Create the new part if needed
        if (newPart) {
            function checkId(id) {
                return dbCacheGet("data-" + id).then(function(ret) {
                    if (ret === null) {
                        // Good, we'll take this!
                        return dbCacheSet("data-" + id, []).then(function() {
                            parts.push({raw: true, id: id, start: start, length: 0});
                        });
                    }

                    // Already taken, choose a new ID
                    return checkId(randomId());
                });
            }

            return checkId(randomId());
        }

        // No new part needed

    }).then(function() {
        // The last part is appendable
        part = parts[parts.length-1];
        return dbCacheGet("data-" + part.id);

    }).then(function(ret) {
        data = ret;

        // Add the data
        data.push(frame);
        part.length += frame.nb_samples;

        // Possibly compress the data
        if (part.length >= maxFragment*track.sampleRate) {
            // Time to compress this part
            var c, frm, pkt, oc, pb;
            return la.ff_init_encoder("wavpack", {
                sample_fmt: track.format,
                sample_rate: track.sampleRate,
                channel_layout: track.channelLayout
            }, 1, track.sampleRate).then(function(ret) {
                c = ret[1];
                frm = ret[2];
                pkt = ret[3];

                return la.ff_init_muxer({filename: "data-" + part.id + ".wv", open: true}, [[c, 1, track.sampleRate]]);

            }).then(function(ret) {
                oc = ret[0];
                pb = ret[2];

                return la.avformat_write_header(oc, 0);

            }).then(function() {
                return la.ff_encode_multi(c, frm, pkt, data, true);

            }).then(function(packets) {
                return la.ff_write_multi(oc, pkt, packets, false);

            }).then(function() {
                return la.av_write_trailer(oc);

            }).then(function() {
                return Promise.all([
                    la.readFile("data-" + part.id + ".wv"),
                    la.ff_free_muxer(oc, pb),
                    la.ff_free_encoder(c, frm, pkt)
                ]);

            }).then(function(ret) {
                data = ret[0];
                part.raw = false;

                return la.unlink("data-" + part.id + ".wv");
            }).catch(warn);
        }

    }).then(function() {
        // data and part are both ready
        return dbCacheSet("data-" + part.id, data);

    }).then(function() {
        return projectPropertiesUpdate();

    }).catch(warn);
}

/* Fetch the content of a list of tracks (by ID), with options for how to fetch
 * and a callback.  If opts.wholeParts, callback is called every part, with
 * (track no, track, part no, part, frames). Otherwise, callback is called
 * every frame, with just (track no, track, frame).  Options may also have a
 * "skip" callback. If present, it's called and should return (thru promise)
 * true or false for whether to skip this part. */
function fetchTracks(trackList, opts, cb) {
    if (!opts) opts = {};
    var track, part;

    // Maximum part number
    var max = trackList.map(function(x) {
        return tracks[x].parts.length;
    }).reduce(function(a, b) {
        return Math.max(a, b);
    });

    // Current PART number
    var i = ("start" in opts) ? opts.start : 0;

    // Current TRACK number
    var t = 0;

    function fetchPart() {
        if (t >= trackList.length) {
            // Loop back
            t = 0;
            i++;
        }
        track = tracks[trackList[t]];

        while (i >= track.parts.length) {
            if (i >= max) {
                // We're done!
                return Promise.all([]);
            }

            // Try the next track
            t++;
            if (t >= trackList.length) {
                t = 0;
                i++;
            }
            track = tracks[trackList[t]];
        }
        part = track.parts[i];

        var p;

        // Only do it at all if we should
        if (opts.skip) {
            p = opts.skip(t, track, i, part);
        } else {
            p = Promise.resolve(false);
        }

        // Do the right step
        p = p.then(function(skip) {
            if (skip) {
                // Just skip it!
                return;
            }

            if (part.raw)
                return fetchPartRaw();
            else
                return fetchPartCooked();
        });

        // And step
        p = p.then(function() {
            t++;
            return fetchPart();
        });

        return p;
    }

    function fetchPartRaw() {
        // Easy, just get it out of the DB and call the callback on each part
        return dbCacheGet("data-" + part.id).then(function(frames) {
            if (opts.wholeParts) {
                return cb(t, track, i, part, frames);
            } else {
                var p = Promise.all([]);
                frames.forEach(function(frame) {
                    p = p.then(function() {
                        return cb(t, track, frame);
                    });
                });
                return p;
            }
        });
    }

    function fetchPartCooked() {
        // We'll need to actually decode it
        var fmt_ctx, c, pkt, frame, frames;
        return dbCacheGet("data-" + part.id).then(function(data) {
            return libav.writeFile("data-" + part.id + ".wv", data);
        }).then(function() {
            return libav.ff_init_demuxer_file("data-" + part.id + ".wv");
        }).then(function(ret) {
            fmt_ctx = ret[0];
            var stream = ret[1][0];
            return libav.ff_init_decoder(stream.codec_id, stream.codecpar);
        }).then(function(ret) {
            c = ret[1];
            pkt = ret[2];
            frame = ret[3];
            return libav.ff_read_multi(fmt_ctx, pkt);
        }).then(function(ret) {
            return libav.ff_decode_multi(c, pkt, frame, ret[1][0], true);
        }).then(function(ret) {
            frames = ret;
            return Promise.all([
                libav.ff_free_decoder(c, pkt, frame),
                libav.avformat_close_input_js(fmt_ctx),
                libav.unlink("data-" + part.id + ".wv")
            ]);
        }).then(function() {
            if (opts.wholeParts) {
                return cb(t, track, i, part, frames);
            } else {
                var p = Promise.all([]);
                frames.forEach(function(frame) {
                    p = p.then(function() {
                        return cb(t, track, frame);
                    });
                });
                return p;
            }
        });
    }

    return fetchPart();

}
ez.fetchTracks = fetchTracks;


/* Delete a track's *content*, without deleting the track. NOTE: Does not flush
 * properties changes */
function emptyTrack(track) {
    var p = dbCacheFlush();
    track.parts.forEach(function(part) {
        p = p.then(function() {
            return Promise.all([
                dbRemove("data-" + part.id),
                dbRemove("waveform-" + part.id)
            ]);
        });
    });

    return p.then(function() {
        // Clear now-irrelevant info
        track.format = track.channelLayout = track.channels = track.sampleRate = -1;
        track.parts = [];
    });
}
ez.emptyTrack = emptyTrack;

// Delete a whole track
function deleteTrack(track) {
    var id = track.id;
    return emptyTrack(track).then(function() {
        // Remove it from the project properties
        delete tracks[id];
        if (id in trackViews) {
            trackSpace.removeChild(trackViews[id].div);
            delete trackViews[id];
        }
        var idx = projectProperties.trackOrder.indexOf(id);
        if (idx >= 0)
            projectProperties.trackOrder.splice(idx, 1);

        // And remember our changes
        return projectPropertiesUpdate();
    }).then(dbCacheFlush);
}
ez.deleteTrack = deleteTrack;

// The formats we can export to
var exportFormats;
function setExportFormats() {
    exportFormats =
    [{format: "flac", codec: "flac", sample_fmt: libav.AV_SAMPLE_FMT_S32, name: "FLAC"},
     {format: "ipod", ext: "m4a", codec: "aac", sample_fmt: libav.AV_SAMPLE_FMT_FLTP, name: "M4A (MPEG-4 audio)"},
     {format: "ogg", codec: "libvorbis", sample_fmt: libav.AV_SAMPLE_FMT_FLTP, name: "Ogg Vorbis"},
     {format: "ogg", ext: "opus", codec: "libopus", sample_fmt: libav.AV_SAMPLE_FMT_FLT, sample_rate: 48000, name: "Opus"},
     {format: "ipod", ext: "m4a", codec: "alac", sample_fmt: libav.AV_SAMPLE_FMT_S32P, name: "ALAC (Apple Lossless)"},
     {format: "wv", codec: "wavpack", sample_fmt: libav.AV_SAMPLE_FMT_FLTP, name: "wavpack"},
     {format: "wav", codec: "pcm_s16le", sample_fmt: libav.AV_SAMPLE_FMT_S16, name: "wav"}];
    ez.exportFormats = exportFormats;
}

// Since we export the project just by exporting each track, this actually belongs here
function exportProjectDialog() {
    var nm, fmtSelect;

    return modalWait().then(function(unlock) {
        modalDialog.innerHTML = "";

        var form = mke(modalDialog, "div", {"class": "modalform"});

        mke(form, "label", {text: l("filename") + ":", "class": "inputlabel", "for": "filename"});
        nm = mke(form, "input", {id: "filename"});
        nm.value = projectName;
        mke(form, "br");
        mke(form, "label", {text: l("format") + ":", "class": "inputlabel", "for": "format"});
        fmtSelect = mke(form, "select", {id: "format"});
        for (var fi = 0; fi < exportFormats.length; fi++) {
            var opt = mke(fmtSelect, "option", {text: exportFormats[fi].name});
            opt.value = fi;
        }

        mke(modalDialog, "div", {text: "\n\n"});

        var cancel = mke(modalDialog, "button", {text: l("cancel")});
        mke(modalDialog, "span", {text: "  "});
        var ok = mke(modalDialog, "button", {text: l("export")});

        modalToggle(true);
        ok.focus();

        return new Promise(function(res, rej) {
            ok.onclick = function() {
                unlock();
                res(true);
            };
            cancel.onclick = function() {
                unlock();
                res(false);
            };
        });

    }).then(function(conf) {
        if (conf) {
            modal(l("exportinge"));
            return exportProject(nm.value, exportFormats[+fmtSelect.value]);
        }
    }).then(function() {
        modal();
    }).catch(error);
}

// Our actual track-by-track export
function exportProject(name, format) {
    var trackList = nonemptyTracks(selectedTracks());
    var ext = format.ext?format.ext:format.format;

    function exportTrack(track) {
        // Figure out the name
        var trackName = name;
        if (trackList.length > 1)
            trackName += "-" + track.name.replace(/[^a-zA-Z0-9]/g, "_");
        trackName += "." + ext;

        // Set up the device to mux
        var bpp = 8*1024*1024;
        var maxBlock = -1;
        var size = -1;
        var writep = Promise.all([]);
        libav.onwrite = function(name, pos, buf) {
            var sz = pos + buf.length;
            if (sz > size) size = sz;
            writep = dowrite(writep, name, pos, buf);
        }

        function dowrite(p, name, pos, buf) {
            // Figure out which block to write this to
            var block = Math.floor(pos/bpp);
            if (block > maxBlock)
                maxBlock = block;
            var sub = pos%bpp;
            var len = bpp - sub;
            if (len > buf.length) len = buf.length;

            // Get the current data
            return p.then(function() {
                return dbCacheGet("export-" + block);
            }).then(function(data) {
                var dataLen = sub + len;
                if (data === null) data = new Uint8Array(dataLen);
                if (data.length < dataLen) {
                    var newData = new Uint8Array(dataLen);
                    newData.set(data);
                    data = newData;
                }
                if (buf.length > len)
                    data.set(buf.subarray(0, len), sub);
                else
                    data.set(buf, sub);
                return dbCacheSet("export-" + block, data);
            }).then(function() {
                // There may be more
                if (buf.length > len)
                    return dowrite(Promise.all([]), name, pos + len, buf.slice(len));
            });
        }

        // Start the actual muxing
        var c, frame, fframe, pkt, frameSize, oc, pb;
        var filterGraph, srcCtx, sinkCtx;
        var sampleRate = format.sample_rate ? format.sample_rate : track.sampleRate;
        return libav.ff_init_encoder(format.codec, {
            sample_fmt: format.sample_fmt,
            sample_rate: sampleRate,
            channel_layout: track.channelLayout,
            channels: track.channels
        }, 1, sampleRate).then(function(ret) {

            c = ret[1];
            frame = ret[2];
            pkt = ret[3];
            frameSize = ret[4] ? ret[4] : Math.floor(sampleRate / track.channels);
            return libav.ff_init_muxer({filename: trackName, format_name: format.format, open: true, device: true}, [[c, 1, sampleRate]]);

        }).then(function(ret) {
            oc = ret[0];
            pb = ret[2];

            // Also create the filter to convert to the right format/rate
            return libav.ff_init_filter_graph("anull", {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout: track.channelLayout
            }, {
                sample_rate: sampleRate,
                sample_fmt: format.sample_fmt,
                channel_layout: track.channelLayout,
                frame_size: frameSize
            });

        }).then(function(ret) {
            filterGraph = ret[0];
            srcCtx = ret[1];
            sinkCtx = ret[2];

            return libav.av_frame_alloc();

        }).then(function(ret) {
            fframe = ret;

            return libav.avformat_write_header(oc, 0);

        }).then(function() {
            var pts = 0;

            function handlePart(t, track, i, part, frames) {
                var fin = (i === track.parts.length-1);
                // Filter it
                return libav.ff_filter_multi(srcCtx, sinkCtx, fframe, frames, fin).then(function(frames) {
                    // Update the pts
                    frames.forEach(function(frame) {
                        frame.pts = ~~pts;
                        frame.ptshi = ~~(pts/0x100000000);
                        pts += frame.nb_samples;
                    });

                    // Display it
                    modal(l("exportingx", trackName) + ": " + Math.round(pts/track.length*100) + "%");

                    // Encode it
                    return libav.ff_encode_multi(c, frame, pkt, frames, fin);
                }).then(function(packets) {
                    // Mux it
                    return libav.ff_write_multi(oc, pkt, packets, false);
                }).then(function() {
                    // Wait for the write callbacks
                    return writep;
                }).then(function() {
                    writep = Promise.all([]);
                });
            }

            return fetchTracks([track.id], {wholeParts: true}, handlePart);

        }).then(function() {
            return libav.av_write_frame(oc, 0);

        }).then(function() {
            return libav.av_write_trailer(oc);

        }).then(function() {
            // We have now fully muxed the file. First free everything
            return Promise.all([
                libav.ff_free_muxer(oc, pb),
                libav.ff_free_encoder(c, frame, pkt),
                libav.avfilter_graph_free_js(filterGraph),
                libav.av_frame_free_js(fframe)
            ]);

        }).then(function() {
            // Wait for the writer
            return writep;

        }).then(function() {
            // Then unlink the export file
            return libav.unlink(trackName);

        }).then(function() {
            // Now stream it out
            var p = Promise.all([]);

            var fileStream = streamSaver.createWriteStream(trackName, size);
            var writer = fileStream.getWriter();

            for (var bi = 0; bi <= maxBlock; bi++) {
                (function(bi) {
                    p = p.then(function() {
                        return dbCacheGet("export-" + bi);
                    }).then(function(data) {
                        writer.write(data);
                    });
                })(bi);
            }

            return p.then(function() {
                writer.close();
            });

        }).then(function() {
            // Delete all the tidbits
            var p = dbCacheFlush();
            for (var bi = 0; bi <= maxBlock; bi++) {
                (function(bi) {
                    p = p.then(function() {
                        return dbRemove("export-" + bi);
                    });
                })(bi);
            }
            return p;

        });
    }

    var p = Promise.all([]);

    /* ALAC + WebAssembly = bugs! Our insane solution is to *reload* libav with
     * plain asm.js if it's requested */
    if (format.codec === "alac" && !libav.nowasm) {
        LibAV = {base: "libav", nowasm: true};
        p = p.then(function() {
            return loadLibrary(libavSrc);
        }).then(function() {
            return new Promise(function(res, rej) {
                if (LibAV.ready)
                    res();
                else
                    LibAV.onready = res;
            });
        }).then(function() {
            libav = LibAV;
        });
    }

    trackList.forEach(function(trackId) {
        var track = tracks[trackId];
        p = p.then(function() {
            return exportTrack(track);
        });
    });
    return p;
}
ez.exportProject = exportProject;
