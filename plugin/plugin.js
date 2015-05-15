/**
 * @fileoverview Sets up a Meteor build plugin that compiles entrypoints into
 * bundles. The code of the entrypoints can use module syntax (f.e. ES6, CJS,
 * or AMD). Currently the plugin uses Webpack to compile entrypoints.
 *
 * TODO: Make webpack watch files for changes while in dev mode? Or is this handled by Meteor
 * already?
 */

// builtin modules
var path          = Npm.require('path')
var fs            = Npm.require('fs')

// npmjs modules
var rndm          = Npm.require('rndm')
var webpack       = Npm.require('webpack')
var _             = Npm.require('lodash')
var glob          = Npm.require('glob')
var userHome      = Npm.require('user-home')
var semver        = Npm.require('semver')

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
 *
 * @param {CompileStep} compileStep The given CompileStep.
 */
function packageDir(compileStep) {
    return path.resolve(compileStep.fullInputPath.replace(compileStep.inputPath, ''))
}

/**
 * @typedef PackageInfo
 *
 * An object containing info about a package installed in the current
 * application. Besides the below described properties you'll also find the
 * properties that `Package.describe` accepts in it's first argument.
 * See http://docs.meteor.com/#/full/packagedescription
 *
 * @type {Object}
 * @property {string} name The name of the package.
 * @property {string} path The full path of the package.
 * @property {Array.string} dependencies An array of package names that are the
 * dependencies of this package. The array is empty if there are no dependencies.
 */

/**
 * Get a list of the packages depending on the named package in the current application.
 *
 * @param {string} packageName The name of the package to check dependents for.
 * @return {Array.PackageInfo|null} An array of objects, each object containing
 * info on a dependent of the specified package. The array is empty if no
 * dependents are found.
 *
 * TODO: The result of this should instead be in the `dependents` key of the
 * result of `getPackageInfo()`. This means we'll have to take out the
 * logic for finding a package's dependencies out of the `getPackageInfo`
 * function into it's own `getPackageDependencies` function. We can then *not*
 * use `getPackageInfo` inside of this `getDependents` function.
 */
function dependentsOf(packageName) {
    var packages = installedPackages()
    return _.reduce(packages, function(result, package) {
        package = getPackageInfo(package)
        if (package && _.find(package.dependencies, function(dep) { return dep.match(packageName) })) {
            result.push(package)
        }
        return result
    }, [])
}

//console.log(dependentsOf('rocket:module'))

/**
 * Get info about a package if it exists in the local application or in
 * ~/.meteor/packages. Unless specified, info will be for the currently
 * installed version of the package that is found in the current application
 * falling back to the latest version found in ~/.meteor/packages. If a version
 * is specified but doesn't exist, or if no version is specified and no version
 * exists at all, null is returned.
 *
 * @param {string} name The name of a package.
 * @param {string} [version] The version of the package to get info for.
 * Defaults to (in the following order) the version installed in the
 * application, or the latest version found if not installed in the
 * application.
 * @return {PackageInfo|null} An object containing details about the specified
 * package, or null if the package is not found.
 */
function getPackageInfo(name, version) {

    // TODO: replace many of the packageDotJs uses below with meaningful names for readability.
    var packageDotJs, packageDotJsPath, versions, foundVersion

    var packageFound = false
    var nameParts = name.split(':')

    // If the package is made by MDG, it has no username or organization prefix (vendor name).
    var packageName = nameParts[nameParts.length === 1 ? 0 : 1]
    var packageCacheName = nameParts.join('_')

    // First check the app's local packages directory. If the package
    // exists locally and either the user didn't specify a version or the user
    // specified a version that happens to be the version of the local package
    //
    // TODO: Handle same-name packages with different vendor names?
    packageDotJsPath = path.resolve(appDir(), 'packages', packageName, 'package.js')
    if (
        (fs.existsSync(packageDotJsPath) && !version) ||
        (fs.existsSync(packageDotJsPath) && version && semver.eq(getInstalledVersion(name), version))
    ) {
        packageDotJs = fs.readFileSync(packageDotJsPath).toString()
        packageFound = true
    }

    // Otherwise check ~/.meteor/packages, and either find the package with the
    // version specified, or the max version of the specified package if no
    // version was specified.
    //
    // TODO: Find dependencies for packages in ~/.meteor/packages by
    // looking at the *.json files there instead of package.js.
    else {

        // If the package exists in ~/.meteor/packages
        packageDotJs = path.join(userHome, '.meteor/packages', packageCacheName, '**', 'package.js')
        if (glob.sync(packageDotJs, {nonull: true})[0] !== packageDotJs) {

            // Get the valid semver versions.
            packageDotJs = path.join(userHome, '.meteor/packages', packageCacheName, '*')
            packageDotJs = glob.sync(packageDotJs)
            versions = _.reduce(packageDotJs, function(result, path) {
                var version = fileName(path)
                if (semver.valid(version)) result.push(version)
                return result
            }, [])

            // Find the specified version, or find the max version if version wasn't specified.
            if (versions.length > 0) {
                if (version && _.contains(versions, version))
                    foundVersion = version
                else if (!version)
                    foundVersion = semver.maxSatisfying(versions, '*')

                if (foundVersion) {
                    packageDotJsPath = path.join(userHome, '.meteor/packages', packageCacheName, foundVersion, 'unipackage.json')
                    packageDotJs = fs.readFileSync(packageDotJsPath).toString()
                    packageFound = true
                }
            }
        }
    }

    function parseInfoFromPackageDotJs(source, path) {
        var apiDotUseRegex = /api\s*\.\s*use\s*\(\s*(['"][^'"]*['"]|\[(\s*(['"][^'"]*['"]\s*,?)\s*)*\])/g
        var packageDotDescribeRegex = /Package\s*\.\s*describe\s*\(\s*{[^{}]*}\s*\)/g
        var stringRegex = /['"][^'"]*['"]/g
        var objectRegex = /{[^{}]*}/

        var dependencies = []

        // Get the dependencies based on api.use calls.
        // TODO: Also include in the result which architecture each dependency is for.
        var apiDotUseCalls = source.match(apiDotUseRegex)
        if (apiDotUseCalls) {
            dependencies = _.reduce(apiDotUseCalls, function(result, apiDotUseCall) {
                var packageStrings = apiDotUseCall.match(stringRegex)
                if (packageStrings) {
                    packageStrings = _.map(packageStrings, function(packageString) {
                        return packageString.replace(/['"]/g, '')
                    })
                    result = result.concat(packageStrings)
                }
                return result
            }, dependencies)
        }

        // Get the package description from the Package.describe call.
        var packageDescription = packageDotDescribeRegex.exec(source)
        if (packageDescription) {
            packageDescription = objectRegex.exec(packageDescription[0])
            if (packageDescription) {
                eval("packageDescription = "+packageDescription[0])
            }
        }

        return _.assign({
            path: path,
            dependencies: dependencies // empty array if no dependencies are found
        }, packageDescription)
    }

    // If a package was found, get the package info, otherwise return null.
    if (packageFound) {
        console.log('\n --- A PACKAGE WAS FOUND --- \n', packageDotJs, packageDotJsPath)
        console.log('\n --------------------------- \n')
        return parseInfoFromPackageDotJs(packageDotJs, packageDotJsPath)
    }
    else return null
}

/**
 * Get the version of an installed package.
 *
 * @param {string} name The name of the package.
 * @return {string|null} The version of the package or null if the package
 * isn't installed.
 *
 * XXX: Handle wrapper numbers? f.e. 0.2.3_3 with the underscore
 */
function getInstalledVersion(name) {
    var packagesFile = path.resolve(appDir(), '.meteor', 'versions')
    var lines = getLines(packagesFile)
    var line = _.find(lines, function(line) {
        console.log(' -------------------- MATCH 1 ----------------------- \n')
        return line.match(new RegExp(name))
    })
    if (line) return line.split('@')[1]
    else return null
}

/**
 * Get a list of installed packages in the current application. If
 * explicitlyInstalled is truthy, then only explicitly installed package names
 * are returned.
 *
 * @param {boolean} [explicitlyInstalled] If true, get only explicitly installed packages.
 * @return {Array.string} An array of package names.
 */
function installedPackages(explicitlyInstalled) {
    var fileName = explicitlyInstalled ? 'packages' : 'versions'
    var packagesFile = path.resolve(appDir(), '.meteor', fileName)
    var lines = getLines(packagesFile)
    lines = _.reduce(lines, function(result, line) {
        console.log(' -------------------- MATCH 2 ----------------------- \n')
        if (!line.match(/^#/) && line.length !== 0) {
            result.push(line.split('@')[0])
        }
        return result
    }, [])
    return lines
}

/**
 * Get the lines of a file as an array.
 * @param {string} file A file to read.
 * @return {Array.string} An array of the lines in the file.
 */
function getLines(file) {
    return fs.readFileSync(file).toString().split('\n')
}

/**
 * Get the last part of a path (the file name).
 *
 * @param {string} path A path to a file.
 * @return {string} The file name.
 */
function fileName(fullPath) {
    var parts = fullPath.split(path.sep)
    console.log('&&&&&&&&&&&&&&&&&&&&&&&&', path.sep, parts)
    return parts[parts.length-1]
}

/**
 * A CompileManager keeps track of code splitting for dependency sharing across
 * bundles within the same Meteor package or across Meteor packages.
 *
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
     *
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
