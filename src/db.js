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

// Our global localforage DB, used to remember which projects exist
var dbGlobal;

// Our current localforage DB, used for the current project
var dbCurrent;

// The name of our current project
var projectName;

// The cached global properties of this project. If you change this, you MUST update the DB
var projectProperties;

// All of the tracks, by ID, in the current project. Just an alias of projectProperties.tracks
var tracks;

// Caching-based DB access
var dbCache = {
    cache: {},
    changed: {},
    ids: []
};

// Get an item out of the cache
function dbCacheGet(item) {
    if (item in dbCache.cache)
        return Promise.resolve(dbCache.cache[item]);

    var limit = ((projectProperties && projectProperties.trackOrder) ?
        projectProperties.trackOrder.length : 0) + 3;

    var p;
    if (dbCache.ids.length >= limit) {
        // Dump something from the cache
        var d = dbCache.ids.shift();
        var v = dbCache.cache[d];
        var c = dbCache.changed[d];
        delete dbCache.cache[d];
        if (c)
            p = dbCurrent.setItem(d, v);
        else
            p = Promise.all([]);
    } else
        p = Promise.all([]);

    return p.then(function() {
        return dbCurrent.getItem(item);
    }).then(function(val) {
        dbCache.ids.push(item);
        dbCache.cache[item] = val;
        dbCache.changed[item] = false;
        return Promise.resolve(val);
    });
}
ez.dbCacheGet = dbCacheGet;

// Set an item via the cache
function dbCacheSet(item, value) {
    if (item in dbCache.cache) {
        dbCache.cache[item] = value;
        dbCache.changed[item] = true;
        return Promise.all([]);
    }

    // Get it to bring it into the cache first
    return dbCacheGet(item).then(function() {
        dbCache.cache[item] = value;
    });
}
ez.dbCacheSet = dbCacheSet;

// Flush the cache to the DB
function dbCacheFlush() {
    function flush() {
        if (dbCache.ids.length === 0)
            return Promise.all([]);

        var item = dbCache.ids.shift();
        var value = dbCache.cache[item];
        delete dbCache.cache[item];
        return dbCurrent.setItem(item, value).then(flush);
    }

    return flush();
}
ez.dbCacheFlush = dbCacheFlush;

// Create a new project (dialog)
function newProjectDialog() {
    // Show the name request
    modalDialog.innerHTML = "";
    mke(modalDialog, "label", {text: "Project name: ", "for": "projectname"});
    var nmbox = mke(modalDialog, "input", {id: "projectname"});
    mke(modalDialog, "div", {text: "\n"});
    var ok = mke(modalDialog, "button", {text: "OK"});
    mke(modalDialog, "span", {text: "  "});
    var cancel = mke(modalDialog, "button", {text: "Cancel"});

    modalToggle(true);
    nmbox.focus();

    // Now wait for acknowledgement
    return new Promise(function(res, rej) {
        nmbox.onkeypress = function(ev) {
            if (nmbox.value.length > 0 && ev.keyCode === 13)
                res();
        };

        ok.onclick = function() {
            if (nmbox.value.length > 0)
                res();
        };

        cancel.onclick = rej;

    }).then(function() {
        ez.projectName = nmbox.value;

        return createProject().catch(error);

    }).catch(restart);
}

// Create a project with name ez.projectName
function createProject() {
    projectName = ez.projectName;

    // Add it to our global projects list
    return dbGlobal.getItem("projects").then(function(projects) {

        if (projects === null) projects = [];
        if (!projects.includes(projectName))
            projects.push(projectName);
        return dbGlobal.setItem("projects", projects);

    }).then(function() {
        return loadProject();

    });
}
ez.createProject = createProject;

// Load an existing (or empty) project
function loadProject() {
    projectName = ez.projectName;
    modal("Loading...");

    menuTitle.innerText = "Project: " + projectName;
    resetElements();
    dbCacheFlush();
    ez.dbCurrent = dbCurrent = localforage.createInstance({name:"ennuizel-project-" + projectName});

    // Check if the global properties already exist
    return dbCacheGet("properties").then(function(ret) {
        if (ret === null) {
            // Make basic global properties
            ez.projectProperties = projectProperties = {
                name: projectName,
                tracks: {},
                trackOrder: [],
                sampleRate: 48000
            };

            // Update it
            return projectPropertiesUpdate().then(dbCacheFlush);
        }

        // Just get the properties
        ez.projectProperties = projectProperties = ret;

    }).then(function() {
        ez.tracks = tracks = projectProperties.tracks;
        trackViews = {};
        return updateTrackViews();

    }).then(function() {
        modal();

    }).catch(error);
}
ez.loadProject = loadProject;

// Call this whenever project properties are updated
function projectPropertiesUpdate() {
    return dbCacheSet("properties", projectProperties);
}
ez.projectPropertiesUpdate = projectPropertiesUpdate;

// Get a list of all selected tracks
function selectedTracks() {
    var sel = [];
    projectProperties.trackOrder.forEach(function(id) {
        var track = tracks[id];
        if (track.selected) sel.push(id);
    });
    if (sel.length)
        return sel;
    else
        return projectProperties.trackOrder.slice(0);
}
ez.selectedTracks = selectedTracks;

// Delete the current project (dialog)
function deleteProjectDialog() {
    // Give them a chance to assert
    modalDialog.innerHTML = "";

    mke(modalDialog, "div", {text: "Are you sure?\n\n"});
    var no = mke(modalDialog, "button", {text: "Cancel"});
    mke(modalDialog, "span", {text: "  "});
    var yes = mke(modalDialog, "button", {text: "Delete the project"});

    modalToggle(true);
    no.focus();

    return new Promise(function(res, rej) {
        yes.onclick = function() {
            modal("Deleting...");
            deleteProject().then(res).catch(rej);
        };
        no.onclick = rej;
    }).then(restart).catch(function() { modal(); });
}

// Delete the current project
function deleteProject() {
    // First delete it from the global projects list
    return dbGlobal.getItem("projects").then(function(projects) {
        if (projects === null) projects = [];

        // Remove it
        var idx = projects.indexOf(projectName);
        if (idx >= 0)
            projects.splice(idx, 1);

        return dbGlobal.setItem("projects", projects);

    }).then(function() {
        // Now delete the database itself
        return dbCurrent.dropInstance();

    });
}
ez.deleteProject = deleteProject;
