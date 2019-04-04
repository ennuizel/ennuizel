Ennuizel is a web-based audio editor based (principally) on
[ffmpeg](https://ffmpeg.org) by way of
[libav.js](https://bitbucket.org/Yahweasel/libav.js/src). For the time being it
is *strictly* an audio editor—in fact, it can't play audio at all!—but it can
import, export, filter and mix audio in many useful ways.

Ennuizel is licensed under the ISC license. Its dependencies are all liberally
licensed, with the exception of ffmpeg which is under the LGPL.

Ennuizel is mainly intended as a baseline platform for other tools, and has a
plugin system to enable that. A plugin should load before Ennuizel itself,
assert that the global value 'Ennuizel' refers to an object, and that
'Ennuizel.plugins' refers to an array, and add a function to that array which
will be called upon loading. Ennuizel is entirely based on promises, so that
function should do anything it needs to in a promise. If that promise
eventually resolve to 'false', then the rest of Ennuizel will not be loaded,
and the plugin is effectively in charge, which is the expected, normal
operating procedure. This allows the creation of 'wizards'.
