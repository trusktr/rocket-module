rocket:module
=============

NPM packages and ES6 Modules (CJS/AMD too!) for Meteor, on the client and server.

**NOTE: This isn't completely ready yet! It'll be fully ready at v1.0.0. It's
in a usable state right now if you'd like to provide early feedback, but note
that the usage instructions might change a little before 1.0.0. :)**

Installation
------------

```sh
meteor update --release 1.2-rc.7
meteor add rocket:module
```

Note, a manual update to the release candidate of Meteor (version 1.2-rc.7 or
greater) is required until 1.2 is officialy released.

Meteor and `rocket:module`
==========================

Many useful React components and React-related modules are available on NPM,
and can be bundled for the client or the server with `rocket:module`.
`rocket:module` also allows you to write CommonJS, AMD, or ES6 modules.
`rocket:module` can be used for packages too, not just apps, and it will share
(as much as possible) NPM dependencies across packages in an app (and the app
itself).

Using NPM packages with `rocket:module`
---------------------------------------

You can use `rocket:module` to load NPM modules on the client or the server. Here's how:

### 1. Add `rocket:module`

```sh
meteor update --release 1.2-rc.7
meteor add rocket:module
```

Note that the update command is only temporary until Meteor 1.2 is released.

### 2. Add the NPM packages that you want to `npm.json`

Create an `npm.json` file in your app or package that specifies the
dependencies you'd like from NPM. In most cases, you should leave the carrot
(`^`) in front of the version number to ensure that the most compatible
versions of your dependencies can be found. If you need more control of the
versions in your package for whatever reason, you can (but try to avoid)
[plucking the carrot](https://docs.npmjs.com/misc/semver#caret-ranges-1-2-3-0-2-5-0-0-4).

If you're making a package, be sure to add your `npm.json` file via
`api.addFiles()`.

> `/path/to/your/app/npm.json`
> ```js
> {
>   "react": "^0.13.1",
>   "famous": "^0.7.0",
>   "async": "^1.4.0"
> }
> ```

### 3. Write code with ES6, CommonJS, or AMD modules.

`rocket:module` handles all the JavaScript files in your app. JavaScript files
that end with `.entry.js` or are entirely named `"entry.js"` are entry points
into your application. You'll need at least one entrypoint file. In each
entrypoint you can begin importing whatever you need, like in the following ES6
examples:

> `/path/to/your/app/entry.js`
> ```js
> import React from 'react'
> import Node  from 'famous/core/Node'
> import async from 'async'
>
> ...
> ```

or

> `/path/to/your/app/main.entry.js`
> ```js
> import React from 'react'
> import Node  from 'famous/core/Node'
> import async from 'async'
>
> ...
> ```

Note, these last two entry point examples would run on boths sides, the client
and the server.

Use CommonJS module syntax if you feel more comfortable with that:

> `/path/to/your/app/server/entry.js`
> ```js
> let React = require('react')
> let Node  = require('famous/core/Node')
> let async = require('async')
>
> ...
> ```

Heck. If you really like AMD, use it:

> `/path/to/your/app/server/entry.js`
> ```js
> define([
>     'react',
>     'famous/core/Node',
>     'async',
> ], function(
>     React,
>     Node,
>     async,
> ) {
>     ...
> })
> ```

You've just imported React, Famous, and async from NPM.

Note, `rocket:module` works on both sides, client and server! The last two
entry point examples run on the server because they're in a `server` folder.
Now *that's* something to feel good about.

You can also import local files!

> `/path/to/your/app/client/entry.js`
> ```js
> import somethingLocal from './path/to/local/file'
>
> ...
> ```

Note, this last one loads on the client only because it's in a `client` folder.

That's basically it! See the [example
app](https://github.com/meteor-rocket/module-example-app) for an actual
example. See the [example
package](https://github.com/meteor-rocket/module-example-package) to learn how
to use `rocket:module` in a Meteor package.

Module load order
-----------------

All your entrypoint files load in the same order as normal files would, based
on Meteor's [load order rules](http://docs.meteor.com/#/full/fileloadorder).

Note that Meteor's load order rules don't apply to any files that you've ever
`import`ed or `require`d into any other file. In this case, the order is
defined by you, and loading starts from your entrypoint files. Imported or
required files are completely ignored by Meteor's load order mechanism.

Files that are not entrypoint files and that are never imported into any other
file are ignored by `rocket:module`. Those files are handled exclusively by
Meteor's load order mechanism, not by `rocket:module`.

Caveats
-------

### Modifying `npm.json`

If you make a change to `npm.json`, the server will reload as expected, but
will fail to update your NPM dependencies. This will be fixed in
`rocket:module` v1.0.0. For now, there are two ways you can work around this (choose one):

1. Relative to your app, run `npm install` inside of both
   `./meteor/local/rocket-module/platform-builds/web.browser` and
   `./meteor/local/rocket-module/platform-builds/os`.
2. Stop your Meteor server, remove `.meteor/local/rocket-module` relative to
   your app, restart Meteor. This option is easier to do, but takes longer
   because `rocket:module` will have to re-install all NPM dependencies again.

### Build lag

You may experience a build delay (sometimes around a minute long) due to a
possible bug in the release candidate of Meteor. I hope we can get to the
bottom of it soon. See https://github.com/meteor/meteor/issues/5067.

### Using generator functions or async/await

If you plan to use
[async](http://pouchdb.com/2015/03/05/taming-the-async-beast-with-es7.html)/[await](http://code.tutsplus.com/tutorials/a-primer-on-es7-async-functions--cms-22367)
or [generator
functions](http://jlongster.com/Taming-the-Asynchronous-Beast-with-CSP-in-JavaScript),
you should import the regenerator runtime in your entrypoint like this if you're using ES6 Modules:

```js
import regeneratorRuntime from 'regenerator/runtime'
window.regeneratorRuntime = regeneratorRuntime
```

Like this if you're using CommonJS modules:

```js
let regeneratorRuntime = require('regenerator/runtime')
window.regeneratorRuntime = regeneratorRuntime
```

Or like this if using AMD modules (untested, and there's other ways to do it in
AMD as well):

```js
define(function(require) {
    let regeneratorRuntime = require('regenerator/runtime')
    window.regeneratorRuntime = regeneratorRuntime
})
```

Otherwise you'll get an error saying that `regeneratorRuntime` is not defined
when you run your app. The error will happen only if you're using generators or
async/await in your code, otherwise the app will work just fine.

Future improvements
-------------------

- ~~`rocket:module` will have a cache before reaching 1.0.0. Until then, your app
  may take a long time to build if you've got lots of files.~~ Added in `rocket:module` v0.8.1.
- Some more speed improvements around NPM package handling.
- Version 1.0.0 of `rocket:module` will handle source maps.
- Fix npm.json live reload.
- Cross-package imports/exports (ES6, CommonJS, or AMD).

Roadmap/tasks until 1.0.0
-------------------------

These steps are mostly in the order that they'll be developed. Semver rules
apply starting from v0.2.0.

### v0.2.0 (first usable version)
- [x] Register a new compiler with Plugin.registerCompiler.
- [x] Redo everything but with the files handed to rocket:module by Meteor,
      thus eliminating the two previous month's worth of work. (:

### v1.0.0
- [x] Switch to npm CLI instead of programmatic usage to see if that fixes
      random NPM bugs that don't happen when I try from CLI.
- [x] Ensure that files that aren't handled by Webpack (for applications) are
      given back to Meteor so they can be executed.
- [x] Let users specify rocket:module configs in rocket-module.json of the app.
  - [x] Allow an `aliases` config option that works like that of Webpack's
        `resolve.alias` config option.
- [x] Only read npm.json at the root level of a package or app, and same
      with rocket-module.js of an app.
- [x] Use Webpack's caching feature so that only modified files are rebuilt.
      Make sure to write the replacement of `window` by `RocketModule` to the built
      files if Webpack's cache reads the built files.
- [ ] Make sure that files that are no longer in the project are also not
      present in rocket:module build cache.
- [ ] Does Meteor tell you which files have changed? If so, update only those
      files on the disk, leaving other files unchanged.
- [ ] Add sub-node_modules folders to the resolve/resolveLoader root option if
      there are any (it happens with dependency forks, but most of the time the
      first level node_modules folder will be flat because we're using NPM v3).
- [ ] Add useful Webpack loaders: babel, coffeescript, typescript, jsx, glslify,
      css, less, sass, and stylus.
  - [x] babel
  - [ ] coffeescript
  - [ ] typescript
  - [x] jsx (via babel)
  - [x] glslify
  - [x] css
  - [ ] less
  - [ ] sass
  - [ ] stylus
  - [x] PNG/JPEG
- [ ] Get code splitting working (webpack/webpack issue #1296). Currently each
      entry point is having duplicate code, which is the same as Meteor's
      dependency handling.
- [ ] Handle source maps.
- [ ] Use `npm outdated` to detect if we need to run `npm update`. We'll need
      to run the update command when dependencies listed in npm.json files have
      changed in order to update the local packages.
- [ ] Make a `enforceModules` option that, when true, doesn't handle files unused
      by Webpack back to Meteor. This makes it so that files are only in your
      project if they are explicitly required or imported into another file,
      otherwise their code is completely ignored.
- [x] Don't hand files in a `modules` folder back to Meteor. This can be used
      similarly to the `enforceModules` option to tell rocket:module that these
      files are meant only to be required or imported into other files, and if they
      are not, they won't be handed back to Meteor.
- [ ] Test in Windows.
- [ ] Report file-specific Webpack errors using corresponding InputFile.error() calls.
- [ ] Finish commented TODOs that are left in rocket:module.
- [x] Update README with usage and configuration documentation.
  - [x] Describe how to use npm dependencies.
  - [x] Describe client/server file naming.
- [ ] Celebrate! Wooooo!

Post v1.0.0
-----------

- [ ] Install Webpack locally instead of using `rocket:webpack`, which will
      prevent architecture-specific builds of `rocket:module`.
- [ ] Add support for browserify transforms.
