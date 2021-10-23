PREFIX=inst

all: \
	localforage.min.js \
	ennuizel.js ennuizel-player.js sw.js

ennuizel.js: node_modules/.bin/browserify src/*.ts *.d.ts
	./src/build.js > $@.tmp
	mv $@.tmp $@

sw.js: src/sw.ts node_modules/.bin/browserify
	./node_modules/.bin/tsc --lib es2015,dom $< --outFile $@

ennuizel-player.js: src/ennuizel-player.ts node_modules/.bin/browserify
	./node_modules/.bin/tsc -t es2015 --lib es2015,dom $< --outFile $@

src/ui-code.ts: src/ui.html
	( cd src ; ./mk-ui-code.js > ui-code.ts )

localforage.min.js: node_modules/.bin/browserify
	cp node_modules/localforage/dist/localforage.min.js .

node_modules/.bin/browserify:
	npm install

install:
	mkdir -p $(PREFIX)
	for i in index.html localforage.min.js \
		ennuizel.js ennuizel.css ennuizel-player.js sw.js ; do \
		install -m 0622 $$i $(PREFIX)/$$i; \
	done

clean:
	rm -f localforage.min.js
	rm -f ennuizel.js ennuizel-player.js sw.js

distclean: clean
	rm -rf node_modules
