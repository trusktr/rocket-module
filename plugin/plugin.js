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
    return parts[parts.length-1]
}

/**
 * Get a list of installed packages in the current application. If
 * explicitlyInstalled is truthy, then only explicitly installed package names
 * are returned.
 *
 * @param {boolean} [explicitlyInstalled] If true, get only explicitly installed packages.
 * @return {Array.string} An array of package names.
 */
function getInstalledPackages(explicitlyInstalled) {
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
 * @typedef PackageInfo
 *
 * An object containing info about a package installed in the current
 * application. Besides the below described properties you'll also find the
 * properties that `Package.describe` accepts in it's first argument when the
 * package is found locally. Packages in ~/.meteor/packages don't have info
 * obtainable from a package.js file.
 * See http://docs.meteor.com/#/full/packagedescription
 *
 * @type {Object}
 * @property {string} name The name of the package.
 * @property {string} path The full path of the package.
 * @property {Array.string} dependencies An array of package names that are the
 * dependencies of this package, each name appended with @<version> if a
 * version is found. The array is empty if there are no dependencies.
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
 * use `getPackageInfo` inside of this `getDependentsOf` function.
 */
function getDependentsOf(packageName) {
    var packages = getInstalledPackages()
    return _.reduce(packages, function(result, package) {
        package = getPackageInfo(package)
        if (package && _.find(package.dependencies, function(dep) { return dep.match(packageName) })) {
            result.push(package)
        }
        return result
    }, [])
}

console.log(' ------------------- DEPENDENTS ----------------- \n', getDependentsOf('rocket:module'))
//console.log(' ------------------- PACKAGE INFO ----------------- \n', getPackageInfo('rocket:module'))

function parseInfoFromPackageDotJs(packageDotJsSource, packagePath) {
    var apiDotUseRegex = /api\s*\.\s*use\s*\(\s*(['"][^'"]*['"]|\[(\s*(['"][^'"]*['"]\s*,?)\s*)*\])/g
    var packageDotDescribeRegex = /Package\s*\.\s*describe\s*\(\s*{[^{}]*}\s*\)/g
    var stringRegex = /['"][^'"]*['"]/g
    var objectRegex = /{[^{}]*}/

    var dependencies = []

    // Get the dependencies based on api.use calls.
    // TODO: Also include in the result which architecture each dependency is for.
    var apiDotUseCalls = packageDotJsSource.match(apiDotUseRegex)
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
    var packageDescription = packageDotDescribeRegex.exec(packageDotJsSource)
    if (packageDescription) {
        packageDescription = objectRegex.exec(packageDescription[0])
        if (packageDescription) {
            eval("packageDescription = "+packageDescription[0])
        }
    }

    return _.assign(packageDescription, {
        path: packagePath,
        dependencies: dependencies // empty array if no dependencies are found
    })
}

// Get the JSON result from isopack.json if it exists, then
// unipackage.json if it exists, otherwise null if neither
// exist.
//
function isoOrUni(packagePath) {
    var isoUniPath = path.join(packagePath, 'isopack.json')
    var result

    // if the isopack.json path doesn't exist
    if (!fs.existsSync(isoUniPath))
        isoUniPath = path.join(packagePath, 'unipackage.json')

    // if the unipackage.json path doesn't exist
    if (!fs.existsSync(isoUniPath))
        isoUniPath = null


    // if one of the two files was found, return the parsed JSON result, otherwise null.
    if (isoUniPath) {
        result = JSON.parse(fs.readFileSync(isoUniPath).toString())

        // If we're using isopack.json, get the isopack-1 object.
        // XXX: Is the top-most key in isopack.json always "isopack-1"? If
        // not, handle the possiblity of a different key name.
        if (isoUniPath.match(/isopack\.json/)) {
            if (typeof result['isopack-1'] !== 'undefined')
                result = result['isopack-1']
            else
                // XXX: If it happens, let's catch it. Someone will complain and we'll fix it. x)
                throw new Error('isopack-1 is undefined. Please report this issue. Thanks!')
        }

        return result
    }
    return null
}

// Get the dependencies from a cache package's os.json, web.browser.json,
// or web.cordova.json files.
//
// TODO: Make this less naive. The result doesn't show which deps are for which
// architectures, and assumes the versions are the same across
// architectures. I made this for rocket:module only needed to detect if a
// package uses rocket:module.
function getDependenciesFromPlatformFiles(packagePath) {
    var platformFileNames = [
        'os.json',
        'web.browser.json',
        'web.cordova.json'
    ]

    var dependencies = []

    dependencies = _.map(platformFileNames, function(file) {
        var info = JSON.parse(fs.readFileSync(path.join(packagePath, file)).toString())
        return _.pick(info, 'uses')
    })

    dependencies = _.reduce(dependencies, function(result, usesObj) {
        return _.merge(result, usesObj, function(a, b) {
            if (_.isArray(a) && _.isArray(b)) {
                return _.unique(_.union(a, b), 'package')
            }
        })
    }, {})

    dependencies = _.map(dependencies.uses, function(use) {
        return use.package + (typeof use.constraint !== 'undefined' ? '@'+use.constraint : '')
    })

    return dependencies
}

// get PackageInfo from a package in the package cache (a package in the
// ~/.meteor/packages).
function getInfoFromCachePackage(packagePath) {
    var isoUniResult = isoOrUni(packagePath)
    var result = {}
    var dependencies = []


    if (isoUniResult) {
        result = _.assign(result, _.pick(isoUniResult, 'name', 'summary', 'version'))
    }

    dependencies = getDependenciesFromPlatformFiles(packagePath)

    result = _.assign(result, {
        path: packagePath,
        dependencies: dependencies
    })

    return result
}

/**
 * Get the version of an installed package.
 *
 * @param {string} packageName The name of the package.
 * @return {string|null} The version of the package or null if the package
 * isn't installed.
 *
 * XXX: Handle wrapper numbers? f.e. 0.2.3_3 with the underscore
 */
function getInstalledVersion(packageName) {
    var packagesFile = path.resolve(appDir(), '.meteor', 'versions')
    var lines = getLines(packagesFile)
    var line = _.find(lines, function(line) {
        return line.match(new RegExp(packageName))
    })
    if (line) return line.split('@')[1]
    return null
}

/**
 * Get info about a package if it exists in the local application or in
 * ~/.meteor/packages. Unless specified, info will be for the currently
 * installed version of the package that is found in the current application
 * falling back to the latest version found in ~/.meteor/packages. If a version
 * is specified but doesn't exist, or if no version is specified and no version
 * exists at all, null is returned.
 *
 * @param {string} packageName The name of a package, including the username:
 * prefix if not an MDG package.
 * @param {string} [packageVersion] The version of the package to get info for.
 * Defaults to (in the following order) the version installed in the
 * application, or the latest version found if not installed in the
 * application.
 * @return {PackageInfo|null} An object containing details about the specified
 * package, or null if the package is not found.
 *
 * TODO: This is assuming that local packages are in the default location in
 * the packages folder of the application, but this might not be the case if a
 * different path is specified with the PACKAGE_DIRS environment variable.
 */
function getPackageInfo(packageName, packageVersion) {

    var packageDotJsSource, packageDotJsPath, packagePath,
        versions, foundVersion, packageInfo

    var packageFound = false
    var nameParts = packageName.split(':')

    // If the package is made by MDG, it has no username or organization prefix (vendor name).
    var packageLocalName = nameParts[nameParts.length === 1 ? 0 : 1]
    var packageCacheName = nameParts.join('_')

    // First check the app's local packages directory. If the package
    // exists locally and either the user didn't specify a version or the user
    // specified a version that happens to be the version of the local package
    //
    // TODO: Handle same-name packages with different vendor names?
    packageDotJsPath = path.resolve(appDir(), 'packages', packageLocalName, 'package.js')
    if (
        (fs.existsSync(packageDotJsPath) && !packageVersion) ||
        (fs.existsSync(packageDotJsPath) && packageVersion && semver.eq(getInstalledVersion(packageName), packageVersion))
    ) {
        packageDotJsSource = fs.readFileSync(packageDotJsPath).toString()
        packageInfo = parseInfoFromPackageDotJs(packageDotJsSource, packageDotJsPath.replace(path.sep+fileName(packageDotJsPath), ''))
    }

    // Otherwise check ~/.meteor/packages, and either find the package with the
    // version specified, or the max version of the specified package if no
    // version was specified.
    //
    // TODO: Find dependencies for packages in ~/.meteor/packages by
    // looking at the *.json files there instead of package.js.
    else {

        // If the package exists in ~/.meteor/packages
        packagePath = path.join(userHome, '.meteor/packages', packageCacheName)
        if (fs.existsSync(packagePath)) {

            // Get the valid semver versions.
            versions = path.join(userHome, '.meteor/packages', packageCacheName, '*')
            versions = glob.sync(versions)
            versions = _.reduce(versions, function(result, versionPath) {
                var version = fileName(versionPath)
                if (semver.valid(version)) result.push(version)
                return result
            }, [])

            // If any versions exist, find the specified version, or find the
            // maximum version if a specific version wasn't specified.
            if (versions.length > 0) {
                if (packageVersion && _.contains(versions, packageVersion))
                    foundVersion = packageVersion
                else if (!packageVersion)
                    foundVersion = semver.maxSatisfying(versions, '*')

                if (foundVersion) {
                    packageInfo = getInfoFromCachePackage(path.join(userHome, '.meteor/packages', packageCacheName, foundVersion))
                }
            }
        }
    }

    // If a package was found, get the package info, otherwise return null.
    if (packageInfo) return packageInfo
    return null
}

/**
 * A CompileManager keeps track of code splitting for dependency sharing across
 * bundles within the same Meteor package or across Meteor packages.
 *
 * @class CompileManager
 */
function CompileManager(extentions) {
    this.extentions = extentions
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
        _.forEach(this.extentions, function(extension) {
            Plugin.registerSourceHandler(extension, this.sourceHandler.bind(this))
        }.bind(this))
    },

    sourceHandler: function sourceHandler(compileStep) {
        var modulesLink, modulesSource, output, tmpLocation, appId,
            pathToConfig, config, webpackCompiler, webpackResult,
            currentPackage

        /*
         * Link the node_modules directory so modules can be resolved.
         *
         * TODO: Work entirely in the /tmp folder instead of writing in the
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
            fileName(currentPackage), 'webpack.config.js')
        config = fs.existsSync(path.resolve(currentPackage, 'module.config.js')) ?
            Npm.require(pathToConfig) : {}
        config = _.merge(this.defaultConfig(compileStep, output), config)
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

// TODO: code splitting among all file types
new CompileManager([
    // also catches module.ts files compiled by mologie:typescript
    'module.js',

    // in case there was a module.coffee file compiled by coffeescript
    'module.coffee.js',

    // in case there was a module.ts compiled by meteortypescript:compiler or jasonparekh:tsc
    'module.ts.js',

    // in case there was a module.ls compiled by dessix:livescript-compiler or vasaka:livescript-compiler
    'module.ls.js'
])
