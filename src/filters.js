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

// Dialog for the given libav filter
function libAVFilterDialog(filter) {
    var paramEls = [];
    return modalWait().then(function(unlock) {
        // First we need to make the options
        modalDialog.innerHTML = "";

        mke(modalDialog, "div", {text: filter.name});

        var form = mke(modalDialog, "div", {"class": "modalform"});

        filter.params.forEach(function(param) {
            var label = mke(form, "label", {"class": "inputlabel", text: param.name, "for": param.ff});
            var el = mke(form, "input", {id: param.ff});
            el.value = param["default"];

            // Limit it if applicable
            if (param.type === "number") {
                el.onchange = function() {
                    var val = +el.value;
                    if (""+val !== el.value) el.value = val;
                    if (val < param.min) el.value = param.min;
                    if (val > param.max) el.value = param.max;
                };

            } else if (param.type === "boolean") {
                el.type = "checkbox";

            }

            paramEls.push(el);

            mke(form, "br");
        });

        mke(modalDialog, "br");
        var no = mke(modalDialog, "button", {text: l("cancel")});
        mke(modalDialog, "span", {text: "  "});
        var yes = mke(modalDialog, "button", {text: l("filter")});

        modalToggle(true);
        yes.focus();

        return new Promise(function(res, rej) {
            yes.onclick = function() {
                unlock();
                res(true);
            };
            no.onclick = function() {
                unlock();
                res(false);
            };
        });

    }).then(function(go) {
        if (go) {
            modal(l("filteringe"));

            // Get our parameter values
            var paramVals = [];
            paramEls.forEach(function(param) {
                paramVals.push(param.value);
            });

            return applyLibAVFilter(filter, paramVals);
        }

    }).then(function() {
        modal();

    }).catch(warn);
}

// Apply the given libav filter with the given parameter values
function applyLibAVFilter(filter, paramVals) {
    var libav;
    var p = LibAV.LibAV().then(function(ret) {
        libav = ret;
    });

    // Apply one-by-one to each selected track
    nonemptyTracks(selectedTracks()).forEach(function(trackId) {
        var track = tracks[trackId];
        var outTrack, filterGraph, srcCtx, sinkCtx;
        var frame;

        // To apply a filter, we make a new track, filter into that new track, then delete the old one
        p = p.then(function() {
            return createTrack(track.name);

        }).then(function(ret) {
            outTrack = ret;

            // Create the filter description
            var descr = "";
            if (filter.ff)
                descr += filter.ff + "=";
            for (var pi = 0; pi < filter.params.length; pi++) {
                var param = filter.params[pi];
                if (pi !== 0)
                    descr += ":";
                if (param.ff)
                    descr += param.ff + "=";
                descr += paramVals[pi];
            }

            // Create the filter itself
            var props = {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout: track.channelLayout
            };

            return Promise.all([
                libav.ff_init_filter_graph(descr, props, props),
                libav.av_frame_alloc()
            ]);

        }).then(function(ret) {
            filterGraph = ret[0][0];
            srcCtx = ret[0][1];
            sinkCtx = ret[0][2];
            frame = ret[1];

            if (frame === 0)
                throw new Error("Failed to allocate filtering frame!");

            function filterPart(t, track, i, part, frames) {
                modal(l("filteringx", track.name) + ": " + Math.round(i/track.parts.length*100) + "%");
                return libav.ff_filter_multi(srcCtx, sinkCtx, frame, frames, i === track.parts.length-1).then(function(frames) {
                    // Append it all
                    var p = Promise.all([]);
                    frames.forEach(function(frame) {
                        p = p.then(function() {
                            return trackAppend(outTrack, frame, libav);
                        });
                    });
                    return p;
                });
            }

            return fetchTracks([trackId], {wholeParts: true}, filterPart);

        }).then(function() {
            modal(l("filteringe"));

            // Free our leftovers and delete the old track's content
            return Promise.all([
                libav.avfilter_graph_free_js(filterGraph),
                libav.av_frame_free_js(frame),
                emptyTrack(track)
            ]);

        }).then(function() {
            // Now transfer the new track's content to the old track
            ["parts", "format", "channelLayout", "channels", "sampleRate", "length"].forEach(function(k) {
                track[k] = outTrack[k];
            });

            // Clear out any leftover view
            if (trackViews[trackId]) {
                trackViews[trackId].partsContainer.innerHTML = "";
                trackViews[trackId].parts = [];
            }

            // And delete the temporary new track (also saves the project properties)
            outTrack.parts = [];
            return deleteTrack(outTrack);

        });
    });

    return p.then(dbCacheFlush).then(updateTrackViews);
}
ez.applyLibAVFilter = applyLibAVFilter;

// Mixing with various options
function mixSimple() {
    return mix();
}

function mixLevel() {
    return mix({fin: "dynaudnorm", fout: "dynaudnorm"});
}

function mixSimpleKeep() {
    return mix({keep: true}).then(function(track) {
        selectNone();
        selectTrack(track.id, true);
    });
}

function mixLevelKeep() {
    return mix({fin: "dynaudnorm", fout: "dynaudnorm", keep: true}).then(function(track) {
        selectNone();
        selectTrack(track.id, true);
    });
}

// The actual mixer
function mix(opts) {
    var libav;
    opts = opts || {};
    opts.fin = opts.fin || "anull";
    var outTrack;
    var filterGraph, srcCtxs, sinkCtx, frame;
    var descr, inp, outp;

    // Figure out which tracks we're mixing
    var trackList = nonemptyTracks(selectedTracks());

    // Maximum part number
    var max = trackList.map(function(x) {
        return tracks[x].parts.length;
    }).reduce(function(a, b) {
        return Math.max(a, b);
    });

    modal(l("mixing") + "...");

    // We create a new track, filter into it, then delete all the old tracks
    return LibAV.LibAV().then(function(ret) {
        libav = ret;
        return createTrack("Mix");

    }).then(function(ret) {
        outTrack = ret;

        // Create the mix descriptor
        descr = "";
        var mixpart = "";
        var ii = 0;
        var ct = 0;
        trackList.forEach(function() {
            descr += "[in" + ii + "]" + opts.fin + "[ain" + ii + "];";
            mixpart += "[ain" + ii + "]";
            ii++;
            ct++;

            if (ct === 16) {
                // Can't mix more than 16 at a time
                descr += mixpart + "amix=16,";
                if (opts.fout)
                    descr += opts.fout;
                else
                    descr += "alimiter=limit=0.0625";
                descr += "[tmp" + ii + "];";
                mixpart = "[tmp" + ii + "]";
                ct = 1;
            }
        });
        descr += mixpart + "amix=" + ct + ",";
        if (opts.fout)
            descr += opts.fout;
        else
            descr += "alimiter=limit=" + (1/ct);
        descr += "[out]";

        // Create the input and output descriptors
        inp = [];
        outp = {
            sample_rate: -1,
            sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
            channel_layout: 0,
            channels: -1
        };

        trackList.forEach(function(trackId) {
            var track = tracks[trackId];
            inp.push({
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout: track.channelLayout
            });
            if (track.sampleRate > outp.sample_rate)
                outp.sample_rate = track.sampleRate;
            if (track.channels > outp.channels) {
                outp.channels = track.channels;
                outp.channel_layout = track.channelLayout;
            }
        });
        delete outp.channels;

        // And the filter
        return Promise.all([
            libav.ff_init_filter_graph(descr, inp, outp),
            libav.av_frame_alloc()
        ]);

    }).then(function(ret) {
        filterGraph = ret[0][0];
        srcCtxs = ret[0][1];
        sinkCtx = ret[0][2];
        frame = ret[1];

        if (frame === 0)
            throw new Error("Failed to allocate filtering frame!");

        var lastT = -1;
        var trackFrames;
        var trackFins;

        function ingestPart(t, track, i, part, frames) {
            modal(l("mixing") + ": " + Math.round(i/max*100) + "%");
            var p;
            if (t <= lastT)
                p = filterPart();
            else
                p = Promise.all([]);
            lastT = t;
            return p.then(function() {
                trackFrames[t] = frames;
                trackFins[t] = (i === track.parts.length-1);
            });
        }

        function filterPart() {
            return libav.ff_filter_multi(srcCtxs, sinkCtx, frame, trackFrames, trackFins).then(function(frames) {
                var p = Promise.all([]);
                frames.forEach(function(frame) {
                    p = p.then(function() {
                        return trackAppend(outTrack, frame, libav);
                    });
                });
                return p.then(reset);
            });
        }

        function reset() {
            trackFrames = new Array(trackList.length);
            trackFins = new Array(trackList.length);
            for (var i = 0; i < trackList.length; i++) {
                trackFrames[i] = [];
                trackFins[i] = false;
            }
        }

        reset();
        return fetchTracks(trackList, {wholeParts: true}, ingestPart).then(filterPart);

    }).then(function() {
        modal(l("mixing") + "...");

        var p = Promise.all([
            libav.avfilter_graph_free_js(filterGraph),
            libav.av_frame_free_js(frame)
        ]);

        // Delete all the other tracks
        if (!opts.keep) {
            trackList.forEach(function(trackId) {
                p = p.then(function() { return deleteTrack(tracks[trackId]); });
            });
        }

        return p;

    }).then(dbCacheFlush).then(updateTrackViews).then(function() {
        modal();
        return outTrack;
    });
}
ez.mix = mix;

// Dialog for noise-repellent
function noiseRepellentDialog() {
    var params = [
        {
            name: "AMOUNT",
            desc: "Amount of noise reduction to apply (dB)",
            def: 10,
            min: 0,
            max: 48
        },
        {
            name: "NOFFSET",
            desc: "Thresholds offset (dB)",
            def: 0,
            min: -12,
            max: 12
        },
        {
            name: "RELEASE",
            desc: "Release time (ms)",
            def: 150,
            min: 0,
            max: 1000
        },
        {
            name: "MASKING",
            desc: "Masking",
            def: 5,
            min: 1,
            max: 10
        },
        {
            name: "T_PROTECT",
            desc: "Transient protection",
            def: 1,
            min: 1,
            max: 6
        },
        {
            name: "WHITENING",
            desc: "Residual whitening %",
            def: 25,
            min: 0,
            max: 100
        }
    ];
    var paramEls = [];

    // Build the dialog
    return modalWait().then(function(unlock) {
        // First we need to make the options
        modalDialog.innerHTML = "";

        mke(modalDialog, "div", {text: "Noise repellent adaptive"});

        var form = mke(modalDialog, "div", {"class": "modalform"});

        // Add each parameter
        params.forEach(function(param) {
            var label = mke(form, "label", {"class": "inputlabel", text: param.desc, "for": "nr_" + param.name});
            var el = mke(form, "input", {id: "nr_" + param.name});
            el.name = param.name;
            el.value = param.def;

            // Limit it
            el.onchange = function() {
                var val = +el.value;
                if (""+val !== el.value) el.value = val;
                if (val < param.min) el.value = param.min;
                if (val > param.max) el.value = param.max;
            };

            paramEls.push(el);

            mke(form, "br");
        });

        // Plus the mode switch
        var label = mke(form, "label", {"class": "inputlabel", text: "Adaptive?", "for": "nr_adaptive"});
        var el = mke(form, "input", {id: "nr_adaptive"});
        el.name = "adaptive";
        el.type = "checkbox";
        el.checked = false;
        paramEls.push(el);

        mke(modalDialog, "br");
        var no = mke(modalDialog, "button", {text: l("cancel")});
        mke(modalDialog, "span", {text: "  "});
        var yes = mke(modalDialog, "button", {text: l("filter")});

        modalToggle(true);
        yes.focus();

        return new Promise(function(res, rej) {
            yes.onclick = function() {
                unlock();
                res(true);
            };
            no.onclick = function() {
                unlock();
                res(false);
            };
        });

    }).then(function(go) {
        if (go) {
            modal(l("loadinge")); // Since we might be downloading

            // Get our parameter values
            var paramVals = {};
            paramEls.forEach(function(param) {
                if (param.type === "checkbox")
                    paramVals[param.name] = param.checked;
                else
                    paramVals[param.name] = +param.value;
            });

            // And apply it
            return applyNoiseRepellentFilter(paramVals);
        }


    }).then(function() {
        modal();

    }).catch(warn);
}
ez.noiseRepellentDialog = noiseRepellentDialog;

// Apply the noise-repellent filter based on these options
function applyNoiseRepellentFilter(opt) {
    var libav;
    var p = LibAV.LibAV().then(function(ret) {
        libav = ret;
    });

    // First, load it
    p = p.then(function() {
        // Make sure it's loaded
        if (typeof NoiseRepellent === "undefined") {
            NoiseRepellent = {"base": "noise-repellent"};
            return loadLibrary("noise-repellent/noise-repellent-m.js");
        }

    });

    // Figure out the tracks we care about
    var targetTracks = nonemptyTracks(selectedTracks());

    // Maybe get noise samples
    var noiseSamples;
    if (!opt.adaptive) {
        p = p.then(function() {
            return getNoiseSamples(targetTracks);
        }).then(function(ns) {
            noiseSamples = ns;
        });
    }

    // Apply one-by-one to each selected track
    targetTracks.forEach(function(trackId) {
        var track = tracks[trackId];
        var outTrack, filterGraph, srcCtx, sinkCtx;
        var frame;
        var nrepels = [];

        // To apply a filter, we make a new track, filter into that new track, then delete the old one
        p = p.then(function() {
            return createTrack(track.name);

        }).then(function(ret) {
            outTrack = ret;

            // Create the noise-repellent filter per channel
            for (var c = 0; c < track.channels; c++)
                nrepels.push(NoiseRepellent.NoiseRepellent(track.sampleRate));

            return Promise.all(nrepels);

        }).then(function(ret) {
            nrepels = ret;

            // And apply their options
            nrepels.forEach(function(nrepel) {
                for (var o in opt) {
                    if (o !== "adaptive")
                        nrepel.set(NoiseRepellent[o], opt[o]);
                }
                if (opt.adaptive) {
                    nrepel.set(NoiseRepellent.N_ADAPTIVE, 1);
                    nrepel.run([0]); // To get the latency
                }
            });

            // If we're not adaptive, learn
            if (!opt.adaptive) {
                var ns = noiseSamples[trackId];
                for (var c = 0; c < track.channels; c++) {
                    var nrepel = nrepels[c];
                    nrepel.set(NoiseRepellent.N_LEARN, 1);
                    var nsc = ns[c];
                    for (var rep = 0; rep < 128; rep++)
                        nrepel.run(nsc);
                    nrepel.set(NoiseRepellent.N_LEARN, 0);
                }
            }

            // Create the filter to convert to F32
            var propsIn = {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout: track.channelLayout
            };
            var propsOut = {
                sample_rate: track.sampleRate,
                sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
                channel_layout: track.channelLayout
            };

            return Promise.all([
                libav.ff_init_filter_graph("aresample,apad=pad_len=" + nrepels[0].latency, propsIn, propsOut),
                libav.av_frame_alloc()
            ]);

        }).then(function(ret) {
            filterGraph = ret[0][0];
            srcCtx = ret[0][1];
            sinkCtx = ret[0][2];
            frame = ret[1];
            var first = 1;

            if (frame === 0)
                throw new Error("Failed to allocate filtering frame!");

            function filterPart(t, track, i, part, frames) {
                modal(l("filteringx", track.name) + ": " + Math.round(i/track.parts.length*100) + "%");
                return libav.ff_filter_multi(srcCtx, sinkCtx, frame, frames, (i === track.parts.length - 1)).then(function(frames) {
                    // Go through each frame
                    var p = Promise.all([]);
                    for (var fi = 0; fi < frames.length; fi++) (function() {
                        var frame = frames[fi];
                        p = p.then(function() {
                            // Perform the real filtering
                            for (var c = 0; c < track.channels; c++) {
                                var nrepel = nrepels[c];
                                frame.data[c] = nrepel.run(frame.data[c]).slice(first*nrepel.latency);
                            }

                            // And append it to the new track
                            return trackAppend(outTrack, frame);
                        });
                        if (first && fi === 0)
                            p = p.then(function() { first = 0; });
                    })();
                    return p;
                });
            }

            return fetchTracks([trackId], {wholeParts: true}, filterPart);

        }).then(function() {
            modal(l("filteringe"));

            // Delete our nrepel filters
            nrepels.forEach(function(nrepel) {
                nrepel.cleanup();
            });

            // Free our leftovers and delete the old track's content
            return Promise.all([
                libav.avfilter_graph_free_js(filterGraph),
                libav.av_frame_free_js(frame),
                emptyTrack(track)
            ]);

        }).then(function() {
            // Now transfer the new track's content to the old track
            ["parts", "format", "channelLayout", "channels", "sampleRate", "length"].forEach(function(k) {
                track[k] = outTrack[k];
            });

            // Clear out any leftover view
            if (trackViews[trackId]) {
                trackViews[trackId].partsContainer.innerHTML = "";
                trackViews[trackId].parts = [];
            }

            // And delete the temporary new track (also saves the project properties)
            outTrack.parts = [];
            return deleteTrack(outTrack);

        });
    });

    return p.then(dbCacheFlush).then(updateTrackViews);
}
ez.applyNoiseRepellentFilter = applyNoiseRepellentFilter;

// Get noise samples for the given tracks
function getNoiseSamples(targetTracks) {
    var libav;
    var p = LibAV.LibAV().then(function(ret) {
        libav = ret;
    });
    var ret = {};

    // Detect one-by-one for each selected track
    targetTracks.forEach(function(trackId) {
        var track = tracks[trackId];

        /* The basic idea is to select a one-second sample with the minimum
         * volume, for each track */
        var selectedSample = new Array(track.channels);
        var currentSample = new Array(track.channels);
        var selectedVolume = new Array(track.channels);
        var currentVolume = new Array(track.channels);

        for (var c = 0; c < track.channels; c++) {
            selectedSample[c] = new Float32Array(48000);
            currentSample[c] = [];
            selectedVolume[c] = 48000;
            currentVolume[c] = 0;
        }

        var filterGraph, srcCtx, sinkCtx;
        var frame;

        // First convert to F32
        p = p.then(function() {
            // Create the filter to convert to F32
            var propsIn = {
                sample_rate: track.sampleRate,
                sample_fmt: track.format,
                channel_layout: track.channelLayout
            };
            var propsOut = {
                sample_rate: track.sampleRate,
                sample_fmt: libav.AV_SAMPLE_FMT_FLTP,
                channel_layout: track.channelLayout
            };

            return Promise.all([
                libav.ff_init_filter_graph("aresample", propsIn, propsOut),
                libav.av_frame_alloc()
            ]);

        }).then(function(ret) {
            filterGraph = ret[0][0];
            srcCtx = ret[0][1];
            sinkCtx = ret[0][2];
            frame = ret[1];

            if (frame === 0)
                throw new Error("Failed to allocate filtering frame!");

            // For each part...
            function handlePart(t, track, i, part, frames) {
                modal(l("filteringx", track.name) + ": " + Math.round(i/track.parts.length*100) + "%");
                return libav.ff_filter_multi(srcCtx, sinkCtx, frame, frames, i === track.parts.length-1).then(function(frames) {
                    var p = Promise.all([]);

                    // For each frame...
                    frames.forEach(function(frame) {
                        p = p.then(function() {
                            var updated = false;

                            // For each channel...
                            for (var c = 0; c < track.channels; c++) {
                                // For each sample...
                                var data = frame.data[c];
                                for (var s = 0; s < data.length; s++) {
                                    var v = data[s];
                                    var va = Math.abs(v);
                                    if (va === 0) va = 1;

                                    // Count it
                                    currentSample[c].push(v);
                                    currentVolume[c] += va;

                                    // Drop if we're longer than 48k samples
                                    if (currentSample[c].length > 48000) {
                                        var da = Math.abs(currentSample[c].shift());
                                        if (da === 0) da = 1;
                                        currentVolume[c] -= da;
                                    }

                                    // Perhaps take this one
                                    if (currentSample[c].length === 48000 &&
                                        currentVolume[c] < selectedVolume[c]) {
                                        updated = true;
                                        selectedSample[c].set(currentSample[c]);
                                        selectedVolume[c] = currentVolume[c];
                                    }
                                }
                            }

                            // Avoid stalling the browser
                            if (updated) {
                                return new Promise(function(res) {
                                    setTimeout(res, 0);
                                });
                            }
                        });
                    });
                    return p;
                });
            }

            return fetchTracks([trackId], {wholeParts: true}, handlePart);

        }).then(function() {
            modal(l("filteringe"));

            // Keep the currently-selected sample
            ret[trackId] = selectedSample;

            // Free our leftovers and delete the old track's content
            return Promise.all([
                libav.avfilter_graph_free_js(filterGraph),
                libav.av_frame_free_js(frame)
            ]);

        });
    });

    return p.then(function() { return ret; });
}
