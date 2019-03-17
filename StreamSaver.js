/*
 * Copyright (c) 2016 Jimmy Karl Roland Wärting
 * Copyright (c) 2019 Yahweasel
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/* Yahweasel's only changes to this file are to make it more portable */

/* global location WritableStream ReadableStream define MouseEvent MessageChannel TransformStream */
(function(name, definition) {
  typeof module !== 'undefined'
    ? module.exports = definition()
    : typeof define === 'function' && typeof define.amd === 'object'
      ? define(definition)
      : this[name] = definition()
})('streamSaver', function() {
  'use strict'

  var secure = location.protocol === 'https:' ||
                 location.protocol === 'chrome-extension:' ||
                 location.hostname === 'localhost'
  var iframe
  var loaded
  var transfarableSupport = false
  var streamSaver = {
    createWriteStream: createWriteStream,
    supported: false,
    version: {
      full: '1.2.0',
      major: 1,
      minor: 2,
      dot: 0
    }
  }

  streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=' +
    streamSaver.version.full

  try {
    // Some browser has it but ain't allowed to construct a stream yet
    streamSaver.supported = 'serviceWorker' in navigator && !!new ReadableStream() && !!new WritableStream()
  } catch (err) {}

  try {
    var readable = new TransformStream().readable
    var mc = new MessageChannel()
    mc.port1.postMessage(readable, [readable])
    mc.port1.close()
    mc.port2.close()
    transfarableSupport = readable.locked === true
  } catch (err) {
    // Was first enabled in chrome v73
  }

  function createWriteStream (filename, queuingStrategy, size) {
    // normalize arguments
    if (Number.isFinite(queuingStrategy)) {
      var tmp = size;
      size = queuingStrategy;
      queuingStrategy = tmp;
    }

    var channel = new MessageChannel()
    var popup
    var setupChannel = function(readableStream) { return new Promise(function(resolve) {
      var args = [ { filename: filename, size: size }, '*', [ channel.port2 ] ]

      // Pass along transfarable stream
      if (readableStream) {
        args[0].readableStream = readableStream
        args[2].push(readableStream)
      }

      channel.port1.onmessage = function(evt) {
        // Service worker sent us a link from where
        // we recive the readable link (stream)
        if (evt.data.download) {
          resolve() // Signal that the writestream are ready to recive data
          if (!secure) popup.close() // don't need the popup any longer
          if (window.chrome && chrome.extension &&
              chrome.extension.getBackgroundPage &&
              chrome.extension.getBackgroundPage() === window) {
            chrome.tabs.create({ url: evt.data.download, active: false })
          } else {
            window.location = evt.data.download
          }

          // Cleanup
          if (readableStream) {
            // We don't need postMessages now when stream are transferable
            channel.port1.close()
            channel.port2.close()
          }

          channel.port1.onmessage = null
        }
      }

      if (secure && !iframe) {
        iframe = document.createElement('iframe')
        iframe.src = streamSaver.mitm
        iframe.hidden = true
        document.body.appendChild(iframe)
      }

      if (secure && !loaded) {
        var fn
        iframe.addEventListener('load', fn = function() {
          loaded = true
          iframe.removeEventListener('load', fn)
          iframe.contentWindow.postMessage.apply(iframe.contentWindow, args)
        })
      }

      if (secure && loaded) {
        iframe.contentWindow.postMessage.apply(iframe.contentWindow, args)
      }

      if (!secure) {
        popup = window.open(streamSaver.mitm, Math.random())
        var onready = function(evt) {
          if (evt.source === popup) {
            popup.postMessage.apply(popup, args)
            window.removeEventListener('message', onready)
          }
        }

        // Another problem that cross origin don't allow is scripting
        // so popup.onload() don't work but postMessage still dose
        // work cross origin
        window.addEventListener('message', onready)
      }
    });};

    if (transfarableSupport) {
      var ts = new TransformStream({
        start () {
          return new Promise(function(resolve) {
            setTimeout(function() { return setupChannel(ts.readable).then(resolve); })
          })
        }
      }, queuingStrategy)

      return ts.writable
    }

    return new WritableStream({
      start () {
        // is called immediately, and should perform any actions
        // necessary to acquire access to the underlying sink.
        // If this process is asynchronous, it can return a promise
        // to signal success or failure.
        return setupChannel()
      },
      write (chunk) {
        // is called when a new chunk of data is ready to be written
        // to the underlying sink. It can return a promise to signal
        // success or failure of the write operation. The stream
        // implementation guarantees that this method will be called
        // only after previous writes have succeeded, and never after
        // close or abort is called.

        // TODO: Kind of important that service worker respond back when
        // it has been written. Otherwise we can't handle backpressure
        // EDIT: Transfarable streams solvs this...
        channel.port1.postMessage(chunk)
      },
      close () {
        channel.port1.postMessage('end')
      },
      abort () {
        channel.port1.postMessage('abort')
      }
    }, queuingStrategy)
  }

  return streamSaver
})
