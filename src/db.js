/*
 * Copyright (c) 2019, 2020 Yahweasel
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

// Are we logged into Drive?
var driveLoggedIn = false;

// Have we rejected Drive (don't ask again)?
var driveRejected = false;

// The root Drive DB directory for Ennuizel
var dbDriveRoot;

// Our current Drive DB (directory), used for the current project overflow
var dbDrive;

// To avoid Drive requests for stuff we already know, we cache the filename->ID associations
var dbDriveCache;

/* Because flushes can happen on any access, we need to serialize our database
 * acceses */
var dbPromise = Promise.all([]);

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

// Wait for sequential DB access
function dbWait() {
    return new Promise(function(res) {
        dbPromise = dbPromise.then(function() {
            return new Promise(function(unlock) {
                res(unlock);
            });
        });
    });
}

// Get an item out of the cache, no locking
function dbCacheGetUnlocked(item) {
    return Promise.all([]).then(function() {
        if (item in dbCache.cache) {
            // Put it at the end of the LRU list
            var idx = dbCache.ids.indexOf(item);
            if (idx >= 0)
                dbCache.ids.splice(idx, 1);
            dbCache.ids.push(item);

            // Then return the cached value
            return dbCache.cache[item];
        }

        var limit = ((projectProperties && projectProperties.trackOrder) ?
            projectProperties.trackOrder.length : 0) + 3;

        if (dbCache.ids.length >= limit) {
            // Dump something from the cache
            var d = dbCache.ids.shift();
            var v = dbCache.cache[d];
            delete dbCache.cache[d];
            var c = dbCache.changed[d];
            delete dbCache.changed[d];

            if (c) {
                // Flush it to the database
                return dbSetSomewhere(d, v).then(function() { return null; });
            }
        }

    }).then(function(val) {
        if (!val) {
            // Try local storage
            return dbCurrent.getItem(item);
        } else {
            return val;
        }

    }).then(function(val) {
        if (!val && dbDrive) {
            // Check if it was in Drive
            return driveReadFile(item);
        } else {
            return val;
        }

    }).then(function(val) {
        dbCache.ids.push(item);
        dbCache.cache[item] = val;
        dbCache.changed[item] = false;
        return val;

    });
}

// Get an item out of the cache, locked
function dbCacheGet(item) {
    var unlock;
    return dbWait().then(function(unl) {
        unlock = unl;
        return dbCacheGetUnlocked(item);

    }).catch(function(ex) {
        unlock();
        throw ex;

    }).then(function(val) {
        unlock();
        return val;

    });
}
ez.dbCacheGet = dbCacheGet;

// Set an item via the cache, unlocked
function dbCacheSetUnlocked(item, value) {
    // If it's in the cache, just update it
    if (item in dbCache.cache) {
        var idx = dbCache.ids.indexOf(item);
        if (idx >= 0)
            dbCache.ids.splice(idx, 1);
        dbCache.ids.push(item);
        dbCache.cache[item] = value;
        dbCache.changed[item] = true;
        return Promise.all([]);
    }

    // Get it to bring it into the cache first
    return dbCacheGetUnlocked(item).then(function() {
        dbCache.cache[item] = value;
        dbCache.changed[item] = true;
    });
}
ez.dbCacheSetUnlocked = dbCacheSetUnlocked;

// Set an item via the cache
function dbCacheSet(item, value) {
    var unlock;
    return dbWait().then(function(unl) {
        unlock = unl;
        return dbCacheSetUnlocked(item, value);

    }).catch(function(ex) {
        unlock();
        throw ex;

    }).then(function() {
        unlock();

    });
}
ez.dbCacheSet = dbCacheSet;

// Flush the cache to the DB
function dbCacheFlush() {
    var unlock;
    return dbWait().then(function(unl) {
        unlock = unl;

        var p = Promise.all([]);

        dbCache.ids.forEach(function(item) {
            if (dbCache.changed[item]) {
                var value = dbCache.cache[item];
                dbCache.changed[item] = false;
                p = p.then(function() {
                    return dbSetSomewhere(item, value);
                });
            }
        });

        return p;

    }).catch(function(ex) {
        unlock();
        throw ex;

    }).then(function() {
        unlock();

    });
}
ez.dbCacheFlush = dbCacheFlush;

// Try very hard to set this SOMEWHERE
function dbSetSomewhere(item, value) {
    return dbCurrent.setItem(item, value).catch(function(ex) {
        // Set to Drive instead
        return driveLogIn().then(function() {
            if (dbDrive) {
                return dbCurrent.removeItem(item).then(function() {
                    return driveCreateFile(item, value);
                });
            } else {
                // Unrecoverable
                throw error(ex);
            }
        });
    });
}

// Remove data from the current DB
function dbRemove(item) {
    var unlock;
    return dbWait().then(function(unl) {
        unlock = unl;

        // First from the cache
        if (item in dbCache.cache) {
            var idx = dbCache.ids.indexOf(item);
            if (idx >= 0)
                dbCache.ids.splice(idx, 1);
            delete dbCache.cache[item];
            delete dbCache.changed[item];
        }

        // Then from local storage
        return dbCurrent.removeItem(item);

    }).then(function() {
        // Then from Drive
        if (dbDrive) {
            return driveDeleteFile(item);
        }

    }).catch(function(ex) {
        unlock();
        throw ex;

    }).then(function() {
        unlock();

    });
}
ez.dbRemove = dbRemove;

// Create a new project (dialog)
function newProjectDialog() {
    var nmbox;
    return modalWait().then(function(unlock) {
        // Show the name request
        modalDialog.innerHTML = "";
        mke(modalDialog, "label", {text: l("projectname") + ": ", "for": "projectname"});
        nmbox = mke(modalDialog, "input", {id: "projectname"});
        mke(modalDialog, "div", {text: "\n"});
        var ok = mke(modalDialog, "button", {text: l("ok")});
        mke(modalDialog, "span", {text: "  "});
        var cancel = mke(modalDialog, "button", {text: l("cancel")});

        modalToggle(true);
        nmbox.focus();

        // Now wait for acknowledgement
        return new Promise(function(res, rej) {
            nmbox.onkeypress = function(ev) {
                if (nmbox.value.length > 0 && ev.keyCode === 13) {
                    unlock();
                    res();
                }
            };

            ok.onclick = function() {
                if (nmbox.value.length > 0) {
                    unlock();
                    res();
                }
            };

            cancel.onclick = rej;
        });

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
    modal(l("loadinge"));

    menuTitle.innerText = l("project") + ": " + projectName;
    resetElements();

    return dbCacheFlush().then(function() {
        // Fresh DB cache and DB
        dbCache = {
            cache: {},
            changed: {},
            ids: []
        };

        ez.dbCurrent = dbCurrent = localforage.createInstance({name:"ennuizel-project-" + projectName});

        /* Debugging fake DB for Drive testing:
        ez.dbCurrent = dbCurrent = {
            getItem: function(item) {
                if (item === "overflow")
                    return Promise.resolve("drive");
                return Promise.resolve(null);
            },
            setItem: function(item) {
                if (item === "overflow")
                    return Promise.resolve(void 0);
                return Promise.reject({});
            },
            removeItem: function() {
                return Promise.resolve();
            },
            dropInstance: function() {
                return Promise.resolve();
            }
        }; // */

        dbDrive = dbDriveCache = null;

        // Check if we need to use Drive
        return dbCurrent.getItem("overflow");

    }).then(function(ret) {
        if (ret === "drive") {
            return driveLogIn().then(function() {
                if (!dbDrive)
                    throw new Error(l("driveerror"));
            });
        }

    }).then(function() {
        // Check if the global properties already exist
        return dbCacheGet("properties");

    }).then(function(ret) {
        if (ret === null) {
            // Make basic global properties
            ret = {
                name: projectName,
                tracks: {},
                trackOrder: [],
                sampleRate: 48000
            };
        }

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

// Reduce a track selection by choosing only nonempty tracks
function nonemptyTracks(sel) {
    var out = [];
    sel.forEach(function(id) {
        var track = tracks[id];
        if (track.parts.length > 0) out.push(id);
    });
    return out;
}
ez.nonemptyTracks = nonemptyTracks;

// Delete the current project (dialog)
function deleteProjectDialog() {
    return modalWait().then(function(unlock) {
        // Give them a chance to assert
        modalDialog.innerHTML = "";

        mke(modalDialog, "div", {text: l("areyousure") + "\n\n"});
        var no = mke(modalDialog, "button", {text: l("cancel")});
        mke(modalDialog, "span", {text: "  "});
        var yes = mke(modalDialog, "button", {text: l("deleteproject")});

        modalToggle(true);
        no.focus();

        return new Promise(function(res, rej) {
            yes.onclick = function() {
                unlock();
                modal(l("deletinge"));
                deleteProject().then(res).catch(rej);
            };
            no.onclick = function() {
                unlock();
                rej();
            };
        });
    }).then(restart).catch(function() { modal(); });
}

// Delete the current project
function deleteProject() {
    // Clear the screen
    trackSpace.innerHTML = "";

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

    }).then(function() {
        // And possibly the Drive directory
        if (dbDrive)
            return driveDelete();

    });
}
ez.deleteProject = deleteProject;

// Attempt to log into Drive
function driveLogIn() {
    if (driveLoggedIn) {
        if (!dbDrive)
            return driveProject();
        return Promise.all([]);
    } else if (driveRejected)
        return Promise.all([]);

    var credentials, xhr, scr, modalWasVisible = modalVisible;

    return new Promise(function(res, rej) {
        // Tell them we're loading
        if (!modalWasVisible)
            modal(l("loadingdrivee"));

        // Load the credentials
        xhr = new XMLHttpRequest();

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            try {
                credentials = JSON.parse(xhr.responseText);
            } catch (ex) {
                rej(ex);
            }
            res(credentials);
        };

        xhr.open("GET", "google-drive.json");
        xhr.send();

    }).then(function() {
        // Load the script
        return loadLibrary("https://apis.google.com/js/api.js");

    }).then(function() {
        // Load the API
        return new Promise(function(res, rej) {
            gapi.load("client:auth2", res);
        });

    }).then(function() {
        // Initialize the client
        return gapi.client.init({
            apiKey: credentials.apiKey,
            clientId: credentials.clientId,
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
            scope: "https://www.googleapis.com/auth/drive.file"
        });

    }).then(function() {
        if (!gapi.auth2.getAuthInstance().isSignedIn.get()) {
            // Tell them they need to sign in
            return warn(l("mustdrive"));
        }

    }).then(function() {
        // Request sign-in
        if (!gapi.auth2.getAuthInstance().isSignedIn.get()) {
            modal(l("loadingdrivee"));
            return gapi.auth2.getAuthInstance().signIn();
        }

    }).then(function() {
        driveLoggedIn = gapi.auth2.getAuthInstance().isSignedIn.get();
        if (!driveLoggedIn)
            driveRejected = true;

        // Find or create dbDriveRoot
        dbDriveRoot = null;
        if (driveLoggedIn) {
            return gapi.client.drive.files.list({
                pageSize: 1000,
                fields: "files(id, name)",
                q: "mimeType = 'application/vnd.google-apps.folder'"
            }).then(function(page) {
                page = page.result;
                var ezDir = page.files.find(function(file) {
                    return (file.name.toLowerCase() === "ennuizel");
                });
                if (ezDir) {
                    dbDriveRoot = ezDir.id;
                    return null;

                } else {
                    return gapi.client.drive.files.create({
                        resource: {name: "Ennuizel", mimeType: "application/vnd.google-apps.folder"},
                        fields: "id"
                    });

                }

            }).then(function(dir) {
                if (dir)
                    dbDriveRoot = dir.result.id;

            });
        }

    }).then(function() {
        // And find or create dbDrive
        if (dbCurrent)
            return driveProject();

    }).then(function () {
        if (!modalWasVisible)
            modalToggle(false);

    }).catch(function(ex) {
        console.error(ex);
        if (!modalWasVisible)
            modalToggle(false);

    });
}

// Find or create the project in Drive
function driveProject() {
    dbDrive = dbDriveCache = null;
    var dname = ("project-" + projectName).replace(/'/g, "_");

    return gapi.client.drive.files.list({
        pageSize: 1000,
        fields: "files(id)",
        q: "mimeType = 'application/vnd.google-apps.folder' and name = '" + dname + "'"

    }).then(function(page) {
        if (page.result.files.length) {
            dbDrive = page.result.files[0].id;

            // The existing directory may not be empty
            return driveList().then(function(l) {
                dbDriveCache = l;
                return null;
            });

        } else {
            return gapi.client.drive.files.create({
                resource: {name: dname, mimeType: "application/vnd.google-apps.folder", parents: [dbDriveRoot]},
                fields: "id"
            });

        }

    }).then(function(dir) {
        if (dir) {
            dbDrive = dir.result.id;
            dbDriveCache = {};
        }

        if (dbDrive) {
            // Indicate that we've used Drive for this project
            return dbCurrent.setItem("overflow", "drive").catch(function(){});
        }

    });
}

// List all the files on Drive
function driveList() {
    var ret = {};

    function listSome(token) {
        return gapi.client.drive.files.list({
            pageToken: token,
            pageSize: 1000,
            fields: "nextPageToken, files(name, id)",
            q: "'" + dbDrive + "' in parents"

        }).then(function(page) {
            page.result.files.forEach(function(file) {
                ret[file.name] = file.id;
            });

            if (page.result.nextPageToken)
                return listSome(page.result.nextPageToken);
            else
                return ret;
        });
    }

    return listSome();
}

// Get the content of a file on Drive
function driveReadFile(name) {
    name = name.replace(/'/g, "_");

    if (!(name in dbDriveCache))
        return Promise.resolve(null);

    var id = dbDriveCache[name];
    var mime;

    // Read its metadata
    return gapi.client.drive.files.get({
        fileId: id,
        fields: "mimeType"
    }).then(function(response) {
        mime = response.result.mimeType;

        // Then read the content manually
        return new Promise(function(res, rej) {
            var xhr = new XMLHttpRequest();

            xhr.onreadystatechange = function() {
                if (xhr.readyState !== 4) return;

                if (mime === "application/json") {
                    var j, des = false;
                    try {
                        j = deserialize(xhr.responseText);
                        des = true;
                    } catch (ex) {
                        rej(ex);
                    }
                    if (des)
                        res(j);

                } else {
                    // Raw data
                    res(new Uint8Array(xhr.response));

                }
            };

            xhr.open("GET", "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media");
            xhr.setRequestHeader("Authorization", "Bearer " + gapi.auth.getToken().access_token);
            if (mime !== "application/json") {
                // Raw data
                xhr.responseType = "arraybuffer";
            }
            xhr.send();
        });
    });
}

// Delete a file on Drive
function driveDeleteFile(name) {
    name = name.replace(/'/g, "_");

    if (!(name in dbDriveCache))
        return Promise.all([]);

    var id = dbDriveCache[name];
    delete dbDriveCache[name];

    return gapi.client.drive.files.delete({fileId: id});
}

// Create a file on Drive, deleting the existing one first if necessary
function driveCreateFile(name, content) {
    name = name.replace(/'/g, "_");

    // Make the content into the appropriate blob type
    var mime = "application/json";
    var file;
    if (typeof content == "object" && "buffer" in content && content.buffer instanceof ArrayBuffer)
        content = content.buffer;
    if (content instanceof ArrayBuffer)
        mime = "application/octet-stream";
    else
        content = serialize(content);
    file = new Blob([content], {type: mime});

    // First check for an existing file
    return driveDeleteFile(name).then(function() {
        return driveTryUpload(name, mime, file, 3);
    });
}

// Try to upload a file to Drive [times] times
function driveTryUpload(name, mime, file, times) {
    // We use the manual method because the API doesn't suffice
    return new Promise(function(res, rej) {
        var xhr = new XMLHttpRequest();

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;

            if (xhr.status !== 200) {
                // Unusual response, maybe try again
                if (times > 1)
                    res(driveTryUpload(name, mime, file, times - 1));
                else
                    rej(new Error(xhr.responseText));
                return;
            }

            // Should just be the result
            var id;
            try {
                id = JSON.parse(xhr.responseText);
            } catch (ex) {
                rej(ex);
            }
            if (id) {
                dbDriveCache[name] = id.id;
                res(id.id);
            }
        }

        xhr.open("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id");
        xhr.setRequestHeader("Authorization", "Bearer " + gapi.auth.getToken().access_token);

        var metadata = {name: name, parents: [dbDrive]};
        metadata = new Blob([JSON.stringify(metadata)], {type: "application/json"});

        var form = new FormData();
        form.append("metadata", metadata);
        form.append("file", file);

        xhr.send(form);
    });
}

/* Delete all our Drive files. Although Drive *seems* to work by just deleting
 * the directory, if we try that, we'll end up with phantom files in the next
 * round, so just delete everything. */
function driveDelete() {
    function deleteSome() {
        return gapi.client.drive.files.list({
            pageSize: 1000,
            fields: "files(id)",
            q: "'" + dbDrive + "' in parents"

        }).then(function(page) {
            page = page.result;
            if (page.files.length === 0)
                return;

            // Make a promise per file
            var p = Promise.all([]);
            page.files.forEach(function(file) {
                p = p.then(function() {
                    return gapi.client.drive.files.delete({fileId: file.id});
                });
            });

            return p.then(deleteSome);

        });
    }

    return deleteSome().then(function() {
        return gapi.client.drive.files.delete({
            fileId: dbDrive
        });
    });
}
