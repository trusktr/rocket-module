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
 * An object containing info about a package installed in the current application.
 * @typedef PackageInfo
 * @type {Object}
 * @property {string} name The name of the package.
 * @property {string} path The full path of the package.
 * @property {Array.string} dependencies An array of package names that are the
 * dependencies of this package.
 */

/**
 * Get a list of the packages depending on the named package in the current application.
 *
 * @param {string} package The name of the package to check dependents for.
 * @return {Array.PackageInfo} An array of objects, each object containing info on a
 * dependent of the specified package.
 */
function dependentsOf(packageName) {
    var packages = installedPackages()
    return _.reduce(packages, function(result, package) {
        package = getPackageInfo(package)
        if (_.find(package.dependencies, function(dep) { return dep.match(packageName) })) {
            result.push(package)
        }
        return result
    }, [])
}

/**
 * Get info about a package if it exists in the local application or in
 * ~/.meteor/packages. Unless specified, info will be for the currently
 * installed version of the package that is found in the current application
 * falling back to the latest version found in ~/.meteor/packages. If a version
 * is specified but doesn't exist, or if no version is specified and no version
 * exists at all, null is returned.
 *
 * @param {string} package The name of a package.
 * @param {string} [version] The version the package to get info for.
 * @return {PackageInfo|null} An object containing details about the specified
 * package, or null if the package is not found.
 *
 * TODO: Clean up the duplicate logic.
 */
function getPackageInfo(name, version) {
    var packageDotJs, packageDotJsPath, versions, foundVersion
    var packageFound = false
    var nameParts = name.split(':')

    // If the package is made by MDG, it has no username or organization prefix (vendor name).
    var packageName = nameParts[nameParts.length === 1 ? 0 : 1]
    var packageCacheName = nameParts.join('_')

    // If no version was specified
    if (!version) {

        // First check the app's local packages directory.
        // TODO: Handle same-name packages with different vendor names?
        packageDotJsPath = path.resolve(appDir(), 'packages', packageName, 'package.js')
        if (fs.existsSync(packageDotJsPath)) {
            packageDotJs = fs.readFileSync(packageDotJsPath).toString()
            packageFound = true
        }

        // Then check ~/.meteor/packages
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

                // Find the max version.
                if (versions.length > 0) {
                    foundVersion = semver.maxSatisfying(versions, '*')

                    packageDotJsPath = path.join(userHome, '.meteor/packages', packageCacheName, foundVersion, 'package.js')
                    packageDotJs = fs.readFileSync(packageDotJsPath).toString()
                    packageFound = true
                }
            }
        }
    }

    // If a valid version was specified
    else if (semver.valid(version)) {

        // First check the app's local packages directory.
        packageDotJsPath = path.resolve(appDir(), 'packages', packageName, 'package.js')
        if (fs.existsSync(packageDotJsPath) && semver.eq(getInstalledVersion(name), version)) {
            packageDotJs = fs.readFileSync(packageDotJsPath).toString()
            packageFound = true
        }

        // Then check ~/.meteor/packages
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

                // Find the specified version.
                if (versions.length > 0 && _.contains(versions, version)) {
                    foundVersion = version

                    packageDotJsPath = path.join(userHome, '.meteor/packages', packageCacheName, foundVersion, 'package.js')
                    packageDotJs = fs.readFileSync(packageDotJsPath).toString()
                    packageFound = true
                }
            }
        }
    }

    function parseInfoFromPackageDotJs(source, path) {
        var apiDotUseRegex = /api\s*\.\s*use\s*\(\s*(['"][^'"]*['"]|\[(\s*(['"][^'"]*['"]\s*,?)\s*)*\])/g
        var packageDotDescribeRegex = /Package\s*\.\s*describe\s*\(\s*{[^{}]*}\s*\)/g
        var stringRegex = /['"][^'"]*['"]/
        var objectRegex = /{[^{}]*}/

        // Get the dependencies based on api.use calls.
        var apiUses = apiDotUseRegex.exec(source)
        var dependencies = _.reduce(apiUses, function(result, apiUse) {
            var packages = stringRegex.exec(apiUse)
            packages = _.map(function(package) {
                return package.replace(/['"]/g, '')
            })
            return result.concat(packages)
        }, [])

        // Get the package description from the Package.describe call.
        var packageDescription = packageDotDescribeRegex.exec(source)[0]
        packageDescription = objectRegex.exec(packageDescription)[0]
        packageDescription = eval(packageDescription)

        return _.assign({
            path: path,
            dependencies: dependencies
        }, packageDescription)
    }

    if (packageFound) return parseInfoFromPackageDotJs(packageDotJs, packageDotJsPath)
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
        return line.match(new RegExp(name))
    })
    if (line) return line.split('@')[1]
    else return null
}

/*
 * Directions to Greg's:
 *
 * take 80
 * then 505 20-30 mi
 * 27a/27
 * another 6 miles to Highway 16 (Madison) overpass
 * pass esparto (stop sign, turn left to stay on 16)
 * go onto 20
 * pass rumsey
 * pass cache creek casino.
 * end of 16 see sign that says clearlake, turn left.
 * go 20 miles.
 * clearlake oaks.
 */

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
