rocket:module
=============

ES6 Modules for Meteor. (And CJS/AMD too!)

**NOTE: This isn't ready yet! It'll be ready at v1.0.0.**

Installation
------------

```sh
meteor add rocket:module
```

Roadmap/tasks until first release
---------------------------------

These steps are mostly in the order that they'll be developed. *Semver rules won't
apply until version 1.0.0.*

### v0.1.0
- [x] Move webpack into a separate Meteor package since it is a binary package,
      then rocket:module doesn't need to be built for every architecture every
      time it is updated.

### v0.1.1
- [x] Move the css, style, and babel loaders into rocket:webpack too. This will
      allow it to binary build along with Webpack. It's lame that we need to do
      this.
- [x] Make rocket:module find the `npm/node_modules` folder of the
      rocket:webpack isopack and add that to Webpack's config so that loaders can
      be found by Webpack.

### v0.1.2
- [x] ~~Override semver methods so they work with Meteor versions~~, or use Meteor's
      package-version-parser package that has some similar functions.

### v0.2.0
- [x] Make rocket:module's source handler simply prepend a comment that the
      file is in need of compiling.

- [x] Detect if the build plugin provider script is running for the first time
      at the initial execution of the meteor command, or if it's running due to a file
      change.

- [x] On first run of `meteor`, detect and count how many files need to be
      compiled on the app side for local packages and the app itself, then add a
      hook that allows a function to run once local files have been handled by the
      source handler. This won't be needed once Plugin.registerBatchHandler or Plugin.registerCompiler is
      released (I think).
  - [x] Turns out we don't know which isopacks have to be compiled even on
        first run, so for the next step to work, we need to remove the local isopacks
        that are dependents of rocket:module from the app's .meteor/local/isopacks/.
  - [x] ~~Also delete the builds of the app's module.js files.~~ We don't have
        to since apparently the build plugin handles the app files every time
        regardless.
  - [x] If the plugin provider is running during Meteor's first run, then get
        the local dependents of rocket:module, and based on that determine how many
        times the source handler will execute (once for each module.js in the app, and
        once for each module.js in each local package).
    - [x] Add a list of files added with api.addFiles to PackageInfo of a given package.

- [ ] If the plugin provider is running due to a file change, use the first execution of
      the source handler to detect what package (including the app itself) is being
      recompiled, then based on that find out how many source handler executions
      are left.

- [ ] Create the new batch handler method for the CompileManager class. (When
      this plugin provider script is running on the app side, we won't use a source
      handler any more for any compiling, instead the handler will do it's simple
      task of marking app-side handled files as in need of compiling with a comment.
      We'll have to take out the webpack functionality from the current source
      handler and use it in a new function, the batchHandler, that runs after all
      app-side files have been handled. The batch handler will compile all modules.js
      files in all package (local or not) of the application. In the future this
      batchHandler will be replaced by Meteor's Plugin.registerBatchHandler or
      Plugin.registerCompiler, whenever that gets introduced.)
  - [x] In the batch handler, choose a new temporary location to handle the
        output of all the entry points all at once (on a per-batch basis instead
        of on a per-file basis).
  - [ ] Get all the sources of module.js files of all the packages of the current app that depend
        on rocket:module. Get the sources from the isopacks (local or not).
  - [ ] Write these sources to the temporary location in some structure that
        organizes the files by package.
  - [ ] List all the files from the previous step in the webpack config's entry
        option as an array of file names. We'll have to modify the defaultConfig
        function.
  - [ ] link a node_modules folder in each paackage folder of the temporary
        location to a respective npm/node_modules folder of each isopack. (This
        replaces the current code that creates a node_modules link to a local package's
        .npm/node_modules folder.)
  - [ ] List these node_modules folders as places to look for dependencies in
        the webpack config (I'm hoping that webpack can have multiple node_modules
        folders to look in. This feature is temporary, to be replaced in a following
        step with a custom dependencies file that rocket:module will use to install all
        npm dependencies in a single place in preparation for code splitting. Packages
        won't use Npm.depends anymore.)
  - [ ] Make sure we still override the defaultConfig using each package's config.
  - [ ] Specify an output filename format for each file, then run webpack.
  - [ ] Instead of using compileStep.addJavaScript, we'll now loop through all
        the output files and write each one back to their original locations in the
        isopacks. We need to make sure to handle each one on a per architecture basis,
        and we also need to update each arch json file to contain the result file's byte
        lengths.

### v0.3.0
- [ ] Now we'll go back and modify the node_modules handling so that
      rocket:module will get all dependencies at once and handle code splitting.
      This item will be split into a series of steps once we ge here.

### v1.0.0
- [ ] Move utility functions to a new package.
- [ ] Finish commented TODOs that are left in rocket:module.
- [ ] Fine tune anything? Finalize configuration API.
- [ ] Update README with usage and configuration documentation.
- [ ] Celebrate! Wooooo!

### v1.x.x
- [ ] Detect and deal with certain conditions.
  - [ ] When recompiling a local package during an app-rebuild (meteor is already
        running, not its first run), detect if the package's dependencies have
        changed. If so, other packages that share the same dependencies need to be
        recompiled too, so that shared libraries through code splitting works.
  - [ ] What happens if an app doesn't depend on rocket:module and has only
        non-local packages depending on rocket:module? Will rocket:module's build
        plugin run during app build? If not, how will we get it to run?
- [ ] Test in Windows.
