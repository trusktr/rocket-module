// builtin modules
var path    = Npm.require('path')
var fs      = Npm.require('fs')

// npmjs modules
var rndm    = Npm.require('rndm')
var webpack = Npm.require('webpack')
var _       = Npm.require('lodash')

/**
 * Get the current app's absolute path.
 * TODO: Change this: walk up the tree until detecting the .meteor folder.
 * TODO: Is there an official way to get the path to the current app?
 */
function appDir() {
    var dir

    // If we're in a package inside a module in the app's packages directory.
    if (path.resolve(process.cwd(), '..').match(/packages$/)) {
        dir = path.resolve(process.cwd(), '../..')
    }

    // If we're in the app's packages directory.
    else if (process.cwd().match(/packages$/)) {
        dir = path.resolve(process.cwd(), '..')
    }

    // If we're in the app directory.
    else {
        dir = process.cwd()
    }
    return dir
}

/**
 * Get the current app's packages dir.
 */
function packagesDir() {
    return path.resolve(appDir(), 'packages')
}

/**
 * Returns the path of the package in the given CompileStep.
 * @param {CompileStep} compileStep The given CompileStep.
 */
function packageDir(compileStep) {
    return path.resolve(compileStep.fullInputPath.replace(compileStep.inputPath, ''))
}

/**
 * A CompileManager keeps track of code splitting for dependency sharing across
 * bundles within the same Meteor package or across Meteor packages.
 * @class CompileManager
 */
function CompileManager(extension) {
    this.extension = extension
    this.count = 0
    this.init()
}
_.assign(CompileManager.prototype, {
    constructor: CompileManager,

    /**
     * Get the default configuration.
     * @return {Object} Returns the default configuration used in the source
     * handler. Currently it's a Webpack configuration object.
     */
    defaultConfig: function defaultConfig(compileStep, output) {
        return {
            entry: compileStep.fullInputPath
                .replace(/\.[A-Za-z]*$/, ''), // remove the extension
            output: {
                filename: output
            },
            module: {
                loaders: [
                    { test: /\.css$/, loader: "style!css" }
                    // TODO: get babel-loader working.
                    //,{ test: /\.js$/, loader: "babel", exclude: /node_modules/ }
                ]
            }
        }
    },

    init: function init() {
        Plugin.registerSourceHandler(this.extension, this.sourceHandler.bind(this))
    },

    sourceHandler: function sourceHandler(compileStep) {
        console.log('\n ### ', ++this.count)
        console.log('\n')
        var package = packageDir(compileStep);

        /*
         * Link the node_modules directory so modules can be resolved.
         * TODO: Work entirely out of the /tmp folder instead of writing in the
         * package.
         */
        var modulesLink = path.resolve(package, 'node_modules')
        var modulesSource = path.resolve(package, '.npm/package/node_modules')
        if (fs.existsSync(modulesLink)) fs.unlinkSync(modulesLink)
        fs.symlinkSync(modulesSource, modulesLink)

        /*
         * Choose a temporary output location that doesn't exist yet.
         * TODO: Get the app id (from .meteor/.id) a legitimate way.
         */
        var output, files, fileMatch
        var tmpLocation = '/tmp'
        var appId = fs.readFileSync(
            path.resolve(appDir(), '.meteor', '.id')
        ).toString().trim().split('\n').slice(-1)[0]
        do output = path.resolve(tmpLocation, 'meteor-'+appId, 'bundle-'+rndm(24))
        while ( fs.existsSync(output) )
        output = path.resolve(output, compileStep.pathForSourceMap)

        // Extend the default Webpack configuration with the user's
        // configuration. Npm.require loads modules relative to
        // packages/<package-name>/.npm/plugin/<plugin-name>/node_modules so we need
        // to go back 5 dirs into the packagesDir then go into the target packageDir.
        var relativePathToConfig = path.join('../../../../..', package.replace(packagesDir(), ''), 'module.config.js')
        console.log(' -- path to config file: ', relativePathToConfig)
        var config = fs.existsSync(path.resolve(package, 'module.config.js')) ? Npm.require(relativePathToConfig) : {}
        config = _.merge(this.defaultConfig(compileStep, output), config)
        console.log(' ------------------------ Webpack Config \n', config)

        // Configure a Webpack compiler. Calling webpack() with no callback
        // returns a Webpack Compiler without running it.
        var webpackCompiler = webpack(config)

        // Run the Webpack compiler synchronously and give the result back to Meteor.
        var webpackResult = Meteor.wrapAsync(webpackCompiler.run, webpackCompiler)()
        console.log(' --------------- Webpack Result \n')
        compileStep.addJavaScript({
            path: compileStep.inputPath,
            data: fs.readFileSync(output).toString(),
            sourcePath: compileStep.inputPath,
            bare: true
        })

        // Do it asynchronously.
        //webpackCompiler.run(function() {
            //console.log(' --------------- webpack finished ------------- \n', arguments)
            //compileStep.addJavaScript({
                //path: compileStep.inputPath,
                //data: fs.readFileSync(output).toString(),
                //sourcePath: compileStep.inputPath
            //})
        //})
    }
})

new CompileManager('main.js')
new CompileManager('main.coffee.js') // in case it went through the coffee plugin first.
