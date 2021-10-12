all: localforage.min.js ennuizel.js awp/ennuizel-player.js

localforage.min.js: node_modules/.bin/browserify
	cp node_modules/localforage/dist/localforage.min.js .

ennuizel.js: node_modules/.bin/browserify src/*.ts
	./src/build.js > $@.tmp
	mv $@.tmp $@

awp/ennuizel-player.js: awp/ennuizel-player.ts node_modules/.bin/browserify
	./node_modules/.bin/tsc -t es2015 --lib es2015,dom $<

node_modules/.bin/browserify:
	npm install

src/ui-code.ts: src/ui.html
	( cd src ; ./mk-ui-code.js > ui-code.ts )

clean:
	rm -f localforage.min.js
	rm -f ennuizel.js awp/ennuizel-player.js

mrproper: clean
	rm -rf node_modules
