all: \
	localforage.min.js StreamSaver/mitm.html StreamSaver/sw.js \
	ennuizel.js awp/ennuizel-player.js

ennuizel.js: node_modules/.bin/browserify src/*.ts
	./src/build.js > $@.tmp
	mv $@.tmp $@

awp/ennuizel-player.js: awp/ennuizel-player.ts node_modules/.bin/browserify
	./node_modules/.bin/tsc -t es2015 --lib es2015,dom $<

src/ui-code.ts: src/ui.html
	( cd src ; ./mk-ui-code.js > ui-code.ts )

localforage.min.js: node_modules/.bin/browserify
	cp node_modules/localforage/dist/localforage.min.js .

StreamSaver/mitm.html: node_modules/.bin/browserify
	mkdir -p StreamSaver
	cp node_modules/streamsaver/mitm.html $@

StreamSaver/sw.js: node_modules/.bin/browserify
	mkdir -p StreamSaver
	cp node_modules/streamsaver/sw.js $@

node_modules/.bin/browserify:
	npm install

clean:
	rm -f localforage.min.js
	rm -rf StreamSaver
	rm -f ennuizel.js awp/ennuizel-player.js

distclean: clean
	rm -rf node_modules
