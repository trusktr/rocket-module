rocket:module
=============

ES6 Modules for Meteor. (And CJS/AMD too!)

**NOTE: This isn't ready yet! It'll be ready at v1.0.0.**

Installation
------------

```sh
meteor add rocket:module
```

Roadmap
-------

These steps are in the order that they'll be developed. *Semver rules won't
apply until version 1.0.0.*

### v0.1.0
- [x] Move webpack into a separate Meteor package since it is a binary package,
      then rocket:module doesn't need to be built for every architecture every
      time it is updated.

### v0.2.0
- [ ] If this plugin provider script is running on the publish side, make the
      source handler simply comment out all the entrypoint codes of packages
      that use rocket:module.
- [ ] When this plugin provider script is running on the app side, we won't
      use a source handler any more. We'll have to take out the webpack from
      the current source handler and use it in our own function that runs at
      this time. Define a new batch handler method for the CompileManager
      class.
- [ ] In the batch handler, choose a new temporary location to handle the
      output of all the entry points all at once on a per-batch basis instead
      of on a per-file basis.
- [ ] In the batch handler, link a node_modules folder to the npm/node_modules
      folder of each isopack. This replaces the current code that create a
      node_modules link to a local package's .npm node_modules folder. I'm
      hoping that webpack can have multiple node_modules folders to look in.
      This feature is temporary, to be replaced in a following step with a
      custom dependencies file that rocket:module will use to install all npm
      dependencies in a single place in preparation for code splitting.
      Packages won't use Npm.depends anymore.
- [ ] batch handler: Detect all the files from the previous step and list them in the
      webpack config's entry option as an array of file names. We'll have to
      modify the defaultConfig function.
- [ ] Make sure we still to override the defaultConfig using each package's config.
- [ ] Run webpack.
- [ ] Instead of using compileStep.addJavaScript, we'll now loop through all
      the output files and write each one back to the original entry point
      files that were in the isopacks. We need to make sure to handle each
      one on a per architecture basis, and we also need to update each arch
      json file to contain the result files byte lengths.

### v0.3.0
- [ ] Now we'll go back and modify the node_modules handling so that
      rocket:module will get all dependencies at once and handle code splitting.
      This item will be split into a series of steps once we ge here.

### v1.0.0
- [ ] Fine tune anything? Make sure final API is carefully chosen.
- [ ] Release v1.0.0
