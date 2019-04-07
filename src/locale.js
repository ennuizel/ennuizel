/*
 * Copyright (c) 2018, 2019 Yahweasel
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
 * Support for localization.
 */

// All supported languages
var langs = ["en", "it"];

// Our localized strings in each supported language (usually just en+native)
var locale = {};

// The preferred langauge
var language = "en";

// On startup we have to load the appropriate languages
function loadLocale() {
    var loadLangs = ["en"];
    var langSel = null;

    var url = new URL(window.location);
    var params = new URLSearchParams(url.search);
    var urlLang = params.get("lang");

    // We have a number of possible sources of language info
    if (ez.lang) {
        // It was requested by a plugin
        langSel = ez.lang;

    } else if (urlLang !== null) {
        // Use the URL language
        langSel = urlLang;

    } else if (navigator.language) {
        // Check whether the requested language is supported
        var navLang = navigator.language.substring(0, 2);
        if (langs.includes(navLang))
            langSel = navLang;

    }

    // Make sure we load the selected language
    if (langSel !== null && langSel !== "en")
        loadLangs.push(langSel);

    // If we didn't select a language, use English
    if (langSel === null)
        langSel = "en";
    ez.language = language = langSel;

    // Load the languages
    var p = Promise.all([]);
    loadLangs.forEach(function(lang) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "locale/" + lang + ".json");
        p = p.then(function() {
            return new Promise(function(res, rej) {
                xhr.onreadystatechange = function() {
                    if (xhr.readyState < 4) return;
                    res(xhr.status);
                };
                xhr.send();
            }).then(function(status) {
                if (status === 200)
                    locale[lang] = JSON.parse(xhr.responseText);
                else
                    locale[lang] = {};
            });
        });
    });

    return p;
}

// Localize a string
function l(string) {
    var ret;
    var ll = locale[language];
    if (string in ll)
        ret = ll[string];
    else
        ret = locale.en[string];
    if (!ret) return "(MISSING STRING)";

    for (var i = 1; i < arguments.length; i++) {
        ret = ret.replace(new RegExp("%" + i, "g"), arguments[i]);
    }

    return ret;
}
ez.l = l;
