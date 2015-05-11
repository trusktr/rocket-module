// builtin modules
var path    = Npm.require('path')
var fs      = Npm.require('fs')

// npmjs modules
var rndm    = Npm.require('rndm')
var webpack = Npm.require('webpack')
var _       = Npm.require('lodash')

/**
 * Get the current app's path.
 * See: https://github.com/meteor-velocity/meteor-internals/blob/e33c84d768af087f94a16820107c97bfc6c8a587/tools/files.js#L72
 *
 * @return {string} The path to the application we are in.
 */
function appDir() {
    return VelocityMeteorInternals.files.findAppDir()
}

/**
 * Get the current app's packages directory.
 */
function packagesDir() {
    return path.resolve(appDir(), 'packages')
}

/*
 * This is how to get to the packages folder of an app from the
 * node_modules folder of a locally installed package.
 *
 * The reason I'm using this is because Npm.require looks relative to
 * .npm/plugin/node_modules or .npm/package/node_modules inside a package, so
 * we have to provide the backsteps to get to the package directory in order to
 * `Npm.require` devs' codes relative to their packages since the normal
 * `require` isn't available.
 *
 * TODO: How do we get to the packages directory of an app if we're not in a
 * local package node_modules folder? It might depend on the 'official' way of
 * getting the app path if it exists.
 */
function packagesDirRelativeToNodeModules() {
    return '../../../../..'
}

/**
 * Returns the path of the package in the given CompileStep.
 * @param {CompileStep} compileStep The given CompileStep.
 */
function packageDir(compileStep) {
    console.log(' %%%%%%%%%%%%%%%%%%%%%%%% ', VelocityMeteorInternals.files.findPackageDir())
    return path.resolve(compileStep.fullInputPath.replace(compileStep.inputPath, ''))
}

function dependentsOf(package) {
    return []
}

function fileName(fullPath) {
    var parts = fullPath.split(path.sep)
    return parts[parts.length-1]
}

/**
 * A CompileManager keeps track of code splitting for dependency sharing across
 * bundles within the same Meteor package or across Meteor packages.
 * @class CompileManager
 */
function CompileManager(extension) {
    this.extension = extension
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
        var modulesLink, modulesSource, output, files, fileMatch, tmpLocation,
            appId, pathToConfig, config, webpackCompiler, webpackResult,
            currentPackage

        /*
         * Link the node_modules directory so modules can be resolved.
         * TODO: Work entirely out of the /tmp folder instead of writing in the
         * currentPackage.
         */
        currentPackage = packageDir(compileStep)
        modulesLink = path.resolve(currentPackage, 'node_modules')
        modulesSource = path.resolve(currentPackage, '.npm/package/node_modules')
        if (fs.existsSync(modulesLink)) fs.unlinkSync(modulesLink)
        fs.symlinkSync(modulesSource, modulesLink)

        /*
         * Choose a temporary output location that doesn't exist yet.
         * TODO: Get the app id (from .meteor/.id) a legitimate way.
         */
        tmpLocation = '/tmp'
        appId = fs.readFileSync(
            path.resolve(appDir(), '.meteor', '.id')
        ).toString().trim().split('\n').slice(-1)[0]
        do output = path.resolve(tmpLocation, 'meteor-'+appId, 'bundle-'+rndm(24))
        while ( fs.existsSync(output) )
        output = path.resolve(output, compileStep.pathForSourceMap)

        /*
         * Extend the default Webpack configuration with the user's
         * configuration and get a Webpack compiler. Npm.require loads modules
         * relative to packages/<package-name>/.npm/plugin/<plugin-name>/node_modules
         * so we need to go back 5 dirs into the packagesDir then go into the
         * target packageDir.
         */
        pathToConfig = path.join(packagesDirRelativeToNodeModules(),
            fileName(currentPackage), 'module.config.js')
        console.log(' -- path to config file: ', pathToConfig)
        config = fs.existsSync(path.resolve(currentPackage, 'module.config.js')) ?
            Npm.require(pathToConfig) : {}
        config = _.merge(this.defaultConfig(compileStep, output), config)
        console.log(' ------------------------ Config \n', config)
        webpackCompiler = webpack(config)

        /*
         * Run the Webpack compiler synchronously and give the result back to Meteor.
         */
        webpackResult = Meteor.wrapAsync(webpackCompiler.run, webpackCompiler)()
        compileStep.addJavaScript({
            path: compileStep.inputPath,
            data: fs.readFileSync(output).toString(),
            sourcePath: compileStep.inputPath,
            bare: true
        })
    }
})

new CompileManager('main.js')
new CompileManager('main.coffee.js') // in case there was a main.coffee
