Package.describe({
    name: 'rocket:module',
    version: '0.1.5_4',
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
        'package-version-parser@3.0.3'
    ],
    sources: ['plugin/plugin.js'],
    npmDependencies: {
        'rndm': '1.1.0',
        'lodash': '3.8.0',
        'glob': '5.0.5',
        'user-home': '1.1.1',
        'fs-extra': '0.18.4',
        'async': '1.2.0'
    }
})

Package.onUse(function(api) {
    api.versionsFrom('1.1.0.2')

    api.addFiles('blah.module.js', 'client')
})

//Package.onTest(function(api) {
//    api.use('tinytest')
//    api.use('rocket:module')
//    api.addFiles('module-tests.js')
//})
