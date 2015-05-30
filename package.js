Package.describe({
    name: 'rocket:module',
    version: '0.0.2',
    // Brief, one-line summary of the package.
    summary: 'ES6 Modules for Meteor. (And CJS/AMD too!)',
    // URL to the Git repository containing the source code for this package.
    git: 'https://github.com/trusktr/rocket-module',
    // By default, Meteor will default to using README.md for documentation.
    // To avoid submitting documentation, set this field to null.
    documentation: 'README.md'
})

Package.registerBuildPlugin({
    name: 'rocket:module',
    use: ['meteor', 'sanjo:meteor-files-helpers@1.1.0_4'],
    sources: ['plugin/plugin.js'],
    npmDependencies: {
        'rndm': '1.1.0',
        'babel-loader': '5.0.0',
        'css-loader': '0.12.0',
        'style-loader': '0.12.1',
        'lodash': '3.8.0',
        'glob': '5.0.5',
        'user-home': '1.1.1',
        'semver': '4.3.4'
    }
})

Package.onTest(function(api) {
    api.use('tinytest')
    api.use('rocket:module')
    api.addFiles('module-tests.js')
})
