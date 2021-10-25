# Ennuizel

This is Ennuizel, an audio editor for web browsers! You can find the main
installation at https://ennuizel.github.io . Ennuizel is based on
[libav.js](https://github.com/Yahweasel/libav.js/), which is in turn based on
[FFmpeg](https://ffmpeg.org/).

Although Ennuizel is perfectly usable as an interactive audio editor, its
design intent is to be used as middleware for platforms providing other
web-based audio systems. For instance, [Ennuicastr](https://ecastr.com) uses
Ennuizel to provide automatic mastering.

Ennuizel uses plugins to provide functionality, as well as to add "wizards".
The plugin API is documented in `ennuizel.d.ts`. Plugins do not have to be
written in TypeScript, but it is recommended. The [better normalization
plugin](https://github.com/ennuizel/ennuizel-better-normalization-plugin) is a
simple demonstration of how plugins work, and the [Noise Repellent
plugin](https://github.com/ennuizel/ennuizel-noise-repellent-plugin)
demonstrates how to integrate non-FFmpeg filters.
[ennuizel-ennuicastr-plugin](https://github.com/Yahweasel/ennuizel-ennuicastr-plugin)
connects Ennuizel to Ennuicastr, and serves as en example of how to make a
wizard.
