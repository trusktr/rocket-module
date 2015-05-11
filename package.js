Package.describe({
    name: 'rocket:module',
    version: '0.0.1',
    // Brief, one-line summary of the package.
    summary: 'ES6 Modules for Meteor.',
    // URL to the Git repository containing the source code for this package.
    git: 'https://github.com/trusktr/rocket-module',
    // By default, Meteor will default to using README.md for documentation.
    // To avoid submitting documentation, set this field to null.
    documentation: 'README.md'
})

Package.registerBuildPlugin({
    name: 'rocket:module',
    use: ['meteor', 'velocity:meteor-internals'],
    sources: ['plugin/plugin.js'],
    npmDependencies: {
        'webpack': '1.8.11',
        'rndm': '1.1.0',
        'babel-loader': '5.0.0',
        'css-loader': '0.12.0',
        'style-loader': '0.12.1',
        'lodash': '3.8.0'
    }
})

Package.onTest(function(api) {
    api.use('tinytest')
    api.use('rocket:module')
    api.addFiles('module-tests.js')
})
