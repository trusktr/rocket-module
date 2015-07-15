Package.describe({
    name: 'rocket:module',
    version: '0.1.5_5',
    // Brief, one-line summary of the package.
    summary: 'ES6 Modules for Meteor. (And CJS/AMD too!)',
    // URL to the Git repository containing the source code for this package.
    git: 'https://github.com/trusktr/rocket-module.git',
    // By default, Meteor will default to using README.md for documentation.
    // To avoid submitting documentation, set this field to null.
    documentation: 'README.md'
})

Package.registerBuildPlugin({
    name: 'rocket:module',
    use: [
        'meteor',
        'sanjo:meteor-files-helpers@1.1.0_6',
        'rocket:webpack@1.9.10',
        'package-version-parser@3.0.3',
        'grigio:babel@0.1.4'
    ],
    sources: ['plugin/plugin.es6.js'],
    npmDependencies: {
        'lodash': '3.8.0',
        'glob': '5.0.5',
        'user-home': '1.1.1',
        'fs-extra': '0.18.4',
        'async': '1.2.0',
        'regexr': '1.1.1',
        'mkdirp': '0.5.1',
        'npm': '2.13.0',
        'shelljs': '0.5.1'
    }
})

Package.onUse(function(api) {
    api.addFiles('shared-modules.js')
})

Package.onTest(function(api) {
    api.use('tinytest')
    api.use('rocket:module')
    api.addFiles('module-tests.js')
})
