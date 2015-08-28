rocket:module
=============

[![Join the chat at https://gitter.im/trusktr/rocket-module](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/trusktr/rocket-module?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

ES6 Modules for Meteor. (And CJS/AMD too!)

**NOTE: This isn't ready yet! It'll be ready at v1.0.0. It's in a usable state
if you'd like to provide early feedback, but note that the [usage
instructions](https://github.com/meteor-rocket/module-example-app) might change
a little before 1.0.0. :)**

Installation
------------

```sh
meteor add rocket:module
```

Roadmap/tasks until first release
---------------------------------

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
- [ ] Use Webpack's caching feature so that only modified files are rebuilt.
      Make sure to write the replacement of `window` by `RocketModule` to the built
      files if Webpack's cache reads the built files.
  - [ ] Make sure that files that are no longer in the project are also not
        present in rocket:module build cache.
  - [ ] Does Meteor tell you which files have changed? If so, update only those
        files on the disk, leaving other files unchanged.
- [ ] Add sub-node_modules folders to the resolve/resolveLoader root option if
      there are any (it happens with dependency forks, but most of the time the
      first level node_modules folder will be flat).
- [ ] Add useful Webpack loaders: babel, coffeescript, typescript, jsx, glslify,
      css, less, sass, and stylus.
  - [x] babel
  - [ ] coffeescript
  - [ ] typescript
  - [x] jsx (via babel)
  - [ ] glslify
  - [ ] css
  - [ ] less
  - [ ] sass
  - [ ] stylus
- [ ] Get code splitting working (webpack/webpack issue #1296). Currently each
      entry point is having duplicate code, which is the same as Meteor's
      dependency handling.
- [ ] Handle source maps.
- [ ] Use `npm outdated` to detect if we need to run `npm update`. We'll need
      to run the update command when dependencies listed in npm.json files have
      changed in order to update the local packages.
- [ ] Make a `enforceModules` option that, when true, doesn't hand files unused
      by Webpack back to Meteor. This makes it so that files are only in your
      project if they are required or imported into another file, otherwise their
      code is completely ignored.
- [x] Don't hand back files in a `modules` folder. This can be used similarly
      to the `enforceModules` option to tell rocket:module that these files are
      meant only to be required or imported into other files, and if they are not,
      they won't be handed back to Meteor.
- [ ] Test in Windows.
- [ ] Report file-specific Webpack errors using corresponding InputFile.error() calls.
- [ ] Finish commented TODOs that are left in rocket:module.
- [ ] Update README with usage and configuration documentation.
  - [ ] Describe how to use npm dependencies.
  - [ ] Describe client/server file naming.
- [ ] Celebrate! Wooooo!

### post v1.0.0

- [ ] Install Webpack locally instead of using rocket:module, which will prevent architecture-specific builds of rocket:module.
- [ ] Add support for browserify transforms.
