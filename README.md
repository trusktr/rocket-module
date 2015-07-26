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

### v0.2.0
- [x] Register a new compiler with Plugin.registerCompiler.
- [x] Redo everything but with the files handed to rocket:module by Meteor,
      thus eliminating the two previous month's worth of work. (:

### v1.0.0
- [ ] Finish commented TODOs that are left in rocket:module.
- [ ] Update README with usage and configuration documentation.
  - [ ] Describe how to use npm dependencies in an app directly, using a spare
        local package (basically like what meteorhacks:npm does).
- [ ] Celebrate! Wooooo!

### v1.x.x (in order of importance)
- [ ] Handle web.cordova builds on the app-side.
- [ ] Output errors encountered by Webpack when compiling entry points.
- [ ] Detect and deal with certain conditions.
  - [ ] When recompiling a local package during an app-rebuild (meteor is already
        running, not its first run), detect if the package's dependencies have
        changed. If so, other packages that share the same dependencies need to be
        recompiled too, so that shared libraries through code splitting works.
  - [ ] What happens if an app doesn't depend on rocket:module and has only
        non-local packages depending on rocket:module? Will rocket:module's build
        plugin run during app build? If not, how will we get it to run?
- [ ] Support npm dependencies for apps that already use meteorhacks:npm.
 - [ ] Simply detect meteorhacks:npm alongside dependents of rocket:module and
       install those dependencies.
- [ ] Test in Windows.
- [ ] Also make new source .map files for each isopack's output file.
- [ ] Code split for each architecture instead of all at once (each
      architecture may possibly have different shared modules).
