/**
 * @fileoverview Sets up a Meteor build plugin that compiles entrypoints into
 * bundles. The code of the entrypoints can use module syntax (f.e. ES6, CJS,
 * or AMD). Currently the plugin uses Webpack to compile entrypoints.
 *
 * TODO: Make webpack watch files for changes while in dev mode?
 */

// npm builtin modules
var path          = Npm.require('path')
var fs            = Npm.require('fs')

// npm modules
var rndm          = Npm.require('rndm')
var _             = Npm.require('lodash')
var glob          = Npm.require('glob')
var USER_HOME     = Npm.require('user-home')
var fse           = Npm.require('fs-extra')
var async         = Npm.require('async')
var regexr        = Npm.require('regexr')

// Meteor package imports
var webpack        = Package['rocket:webpack'].Webpack
var PackageVersion = Package['package-version-parser'].PackageVersion

var numberOfFilesToHandle = 0
var isFirstRun = !process.rocketModuleFirstRunComplete

// The regex to capture file names in built isopack files.
var PACKAGE_DIRS = _.get(process, 'env.PACKAGE_DIRS')
var FILENAME_REGEX = regexr`/\/+\n\/\/ +\/\/\n\/\/ (packages\/(?:\S+:)?\S+\/\S+).+((?:\n\/\/ (?:\S+).+)*)\n\/\/ +\/\/\n\/+\n +\/\//g`
                                                // └───┘  └─────────────────────┘
                                                //   ▴              ▴
                                                //   |              └── File info, if any. capture group #2
                                                //   └── File name. capture group #1

/**
 * Get the current app's path.
 * See: https://github.com/Sanjo/meteor-meteor-files-helpers/blob/71bbf71c1cae57657d79df4ac6c73defcdfe51d0/src/meteor_files_helpers.js#L11
 *
 * @return {string|null} The full path to the application we are in, or null if
 * we're not in an application.
 */
function getAppDir() {
    return MeteorFilesHelpers.getAppPath()
}

/**
 * Get the current app's packages path, even if it doesn't actually exist.
 *
 * @return {string|null} Return the path as a string, or null if we're not in an app.
 */
function packagesDir() {
    var app = getAppDir()
    if (app) return path.resolve(app, 'packages')
    return null
}

/**
 * This is how to get to the packages folder of an app from the
 * node_modules folder of a locally installed package.
 *
 * The reason I'm using this is because Npm.require looks relative to
 * .npm/plugin/node_modules or .npm/package/node_modules inside a package, so
 * we have to provide the backsteps to get to the package directory in order to
 * `Npm.require` devs' codes relative to their packages since the normal
 * `require` isn't available.
 *
 * @return {string} The relative path back to `packages/`.
 *
 * TODO: How do we get to the packages directory of an app if we're not in a
 * local package node_modules folder? It might depend on the 'official' way of
 * getting the app path if it exists.
 *
 * XXX: This will be removed when we make the custom handling of npm modules.
 */
function packagesDirRelativeToNodeModules() {
    return '../../../../..'
}

/**
 * Returns the path of the package in the given CompileStep.
 *
 * @param {CompileStep} compileStep The given CompileStep.
 * @return {string} The path to the package.
 */
function packageDir(compileStep) {
    return path.resolve(compileStep.fullInputPath.replace(compileStep.inputPath, ''))
}

/**
 * Get the lines of a file as an array.
 *
 * @param {string} file A file to read.
 * @return {Array.string} An array of the lines in the file.
 */
function getLines(file) {
    return fs.readFileSync(file).toString().split('\n')
}

/**
 * Get the last part of a path (the file name).
 *
 * @param {string} filePath A path to a file.
 * @return {string} The file name.
 */
function getFileName(filePath) {
    var parts = filePath.split(path.sep)
    return parts[parts.length-1]
}

/**
 * Get a list of installed packages in the current application. If
 * explicitlyInstalled is truthy, then only explicitly installed package names
 * are returned.
 *
 * TODO: Return package constraint strings when explicitlyInstalled is true.
 *
 * @param {boolean} [explicitlyInstalled] If true, get only explicitly installed packages.
 * @return {Array.string} An array of package names.
 */
function getInstalledPackages(explicitlyInstalled) {
    var fileName = explicitlyInstalled ? 'packages' : 'versions'
    var app = getAppDir()
    if (!app) throw new Error('getInstalledPackages is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    var packagesFile = path.resolve(app, '.meteor', fileName)
    var lines = getLines(packagesFile)
    var packages = []
    packages = _.reduce(lines, function(result, line) {
        if (!line.match(/^#/) && line.length !== 0) result.push(line.split('@')[0])
        return result
    }, packages)
    return packages
}

/**
 * @returns {boolean} Returns true if we're not running `meteor test-packages`
 * or `meteor publish` which means this file is being executed during an app's
 * build, not a package's build.
 */
function isAppBuild() {
  var unAcceptableCommands = {'test-packages': 1, 'publish': 1};
  if(process.argv.length > 2) {
    var command = process.argv[2];
    if(unAcceptableCommands[command]) {
      return false;
    }
  }

  return true;
}

/**
 * @typedef PackageInfo
 *
 * An object containing info about a package installed in the current
 * application. Besides the below described properties you'll also find the
 * properties that `Package.describe` accepts in it's first argument when the
 * package is found locally. Packages in ~/.meteor/packages don't have info
 * obtainable from a package.js file.  See
 * http://docs.meteor.com/#/full/packagedescription
 *
 * @type {Object}
 * @property {string} name The name of the package.
 * @property {string} isopackPath The full path of the package's isopack.
 * @property {Array.string} dependencies An array of package names that are the
 * dependencies of this package, each name appended with @<version> if a
 * version is found. The array is empty if there are no dependencies.
 * @property {Array.string} files An array of files that are added to the
 * package (the files of a package that are specified with api.addFiles)
 */

/**
 * Get a list of the packages depending on the named package in the current
 * application.
 *
 * @param {string} packageName The name of the package to check dependents for.
 * @return {Array.PackageInfo|null} An array of objects, each object containing
 * info on a dependent of the specified package. The array is empty if no
 * dependents are found.
 *
 * TODO: The result of this should instead be in the `dependents` key of the
 * result of `getPackageInfo()`. This means we'll have to take out the logic
 * for finding a package's dependencies out of the `getPackageInfo` function
 * into it's own `getPackageDependencies` function. We can then *not* use
 * `getPackageInfo` inside of this `getDependentsOf` function so that we can
 * use getDependentsOf inside of getPackageInfo and include that info in the
 * result.
 */
function getDependentsOf(packageName) {
    var app = getAppDir()
    if (!app) throw new Error('getDependentsOf is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    var packages = getInstalledPackages()
    return _.reduce(packages, function(result, package) {
        package = getPackageInfo(package)
        if (package && _.find(package.dependencies, function(dep) { return dep.match(packageName) }))
            result.push(package)
        return result
    }, [])
}

/**
 * @param {string} packageName The name of a package.
 * @return {string|null} Returns the local path of a package, null if not found.
 */
function getLocalPackagePath(packageName) {
    var localPath = path.resolve(getAppDir(), 'packages', toLocalPackageName(packageName))
    if (fs.existsSync(localPath)) return localPath
    else if (PACKAGE_DIRS) {
        localPath = path.resolve(PACKAGE_DIRS, toLocalPackageName(packageName))
        if (fs.existsSync(localPath)) return localPath
    }
    return null
}

/**
 * @param {string} packageName The name of a package.
 * @return {boolean} Returns true if the package is local to the app, false otherwise.
 */
function isLocalPackage(packageName) {
    return getLocalPackagePath(packageName) ? true : false
}

/**
 * Get the path to the isopack of a package. This is the path to the isopack
 * that is used in the current app.
 *
 * @param {string} packageName The name of the package.
 * @return {string} The path to the isopack.
 */
function getIsopackPath(packageName) {
    var app = getAppDir()
    if (!app) throw new Error('getIsopackPath is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    var isopackPath
    if (isLocalPackage(packageName)) {
        isopackPath = path.resolve(
            app, '.meteor', 'local', 'isopacks', toIsopackName(packageName))
    }
    else {
        isopackPath = path.resolve(
            USER_HOME, '.meteor', 'packages', toIsopackName(packageName),
            getInstalledVersion(packageName))
    }
    return isopackPath
}

/**
 * Get info about a package given it's package.js source.
 *
 * @param {string} packageDotJsSource The source code of a given package.js file.
 * @param {string} packagePath The path to a package.
 * @return {Object} A subset of the PackageInfo type that includes the `path` and
 * `dependencies` keys.
 *
 * TODO: Don't set localPath here, add it externally with _.assign.
 * TODO: Don't set isopackPath here, add it externally with _.assign.
 *
 * TODO: List the "meteor" dependency? It is listed in the isopack, so gotta
 * find out why (maybe because api.versionsFrom is used? Or maybe just all
 * packages always depend on "meteor"?).
 */
function getInfoFromPackageDotJs(packageDotJsSource, packagePath) {
    function apiDot(name, ...signature) {
        var r = regexr
        signature = _.reduce(signature, (result, signaturePiece, index) => {
            return r`${result}${
                index !== 0 ? r`\s*,\s*` : r``
            }(${signaturePiece})`
        }, '')
        return r`/(api\s*\.\s*${name}\s*\(\s*(${signature})\s*\)\s*;*)/g`
    }

    var r = regexr
    var stringRegex             = r`/['"][^'"]*['"]/g`
    var stringArrayRegex        = r`/\[(\s*(${stringRegex}\s*,?)\s*)*\]/g`
    var stringOrStringArrayRgx  = r`/${stringRegex}|${stringArrayRegex}/g`
    var singleLevelObjectRegex  = r`{[^{}]*}` // can be improved, but works for this purpose

    var apiDotVersionsFromRegex = apiDot('versionsFrom', stringOrStringArrayRgx)
    var apiDotUseRegex          = r`(${apiDot('use', stringOrStringArrayRgx)}|${apiDot('use', stringOrStringArrayRgx, stringOrStringArrayRgx)}|${apiDot('use', stringOrStringArrayRgx, singleLevelObjectRegex)}|${apiDot('use', stringOrStringArrayRgx, stringOrStringArrayRgx, singleLevelObjectRegex)})`
    var apiDotImplyRegex        = r`(${apiDot('imply', stringOrStringArrayRgx)}|${apiDot('imply', stringOrStringArrayRgx, stringOrStringArrayRgx)})`
    var apiDotExportRegex       = r`(${apiDot('export', stringOrStringArrayRgx)}|${apiDot('export', stringOrStringArrayRgx, stringOrStringArrayRgx)}|${apiDot('export', stringOrStringArrayRgx, singleLevelObjectRegex)}|${apiDot('use', stringOrStringArrayRgx, stringOrStringArrayRgx, singleLevelObjectRegex)})`
    var apiDotAddFilesRegex     = r`(${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx)}|${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx, stringOrStringArrayRgx)}|${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx, singleLevelObjectRegex)}|${apiDot(r`(addFiles|add_files)`, stringOrStringArrayRgx, stringOrStringArrayRgx, singleLevelObjectRegex)})`
                                                           // ^ also add_files for COMPAT WITH 0.8.x

    var apiCallRegex = r`(${apiDotVersionsFromRegex}|${apiDotUseRegex}|${apiDotImplyRegex}|${apiDotExportRegex}|${apiDotAddFilesRegex})`

    var packageDotDescribeRegex = r`/Package\s*\.\s*describe\s*\(\s*${singleLevelObjectRegex}\s*\)/g`
    var packageDotOnTestRegex   = r`/Package\s*\.\s*onTest\s*\(\s*function\s*\(\s*${r.identifier}\s*\)\s*{\s*(${apiCallRegex})+\s*}\s*\)/g`

    // Remove Package.onTest calls, for now.
    // TODO v1.0.0: Parse char by char instead of with regexes for package.* calls.
    packageDotJsSource = packageDotJsSource.replace(packageDotOnTestRegex, '')

    // Get the package description from the Package.describe call.
    var packageDescription = packageDotDescribeRegex.exec(packageDotJsSource)
    if (packageDescription) {
        packageDescription = new RegExp(singleLevelObjectRegex).exec(packageDescription[0])
        if (packageDescription) {
            // We have to eval the object literal string. We can't use
            // JSON.parse because it's not valid JSON.
            eval("packageDescription = "+packageDescription[0])
        }
    }

    // Get the dependencies based on api.use calls.
    // TODO: Also include in the result which architecture each dependency is for.
    var dependencies = []
    // TODO: Extend RegExp in regexr and add a .flags() method for easily changing the flags.
    var apiDotUseCalls = packageDotJsSource.match(r`/${apiDotUseRegex}/g`)
    if (apiDotUseCalls) {
        dependencies = _.reduce(apiDotUseCalls, function(result, apiDotUseCall) {
            var packageStrings = apiDotUseCall
                .match(r`/${stringOrStringArrayRgx}/g`)[0].match(r`/${stringRegex}/g`)
            if (packageStrings) {
                packageStrings = _.map(packageStrings, function(packageString) {
                    return packageString.replace(/['"]/g, '')
                })
                result = result.concat(packageStrings)
            }
            return result
        }, dependencies)
    }

    // get the added files based on api.addFiles calls.
    var apiDotAddFilesCalls = packageDotJsSource.match(r`/${apiDotAddFilesRegex}/g`)
    var addedFiles = []
    if (apiDotAddFilesCalls) {
        addedFiles = _.reduce(apiDotAddFilesCalls, function(result, apiDotAddFilesCall) {
            var fileNameStrings = apiDotAddFilesCall
                .match(r`/${stringOrStringArrayRgx}/g`)[0].match(r`/${stringRegex}/g`)
            if (fileNameStrings) {
                fileNameStrings = _.map(fileNameStrings, function(fileNameString) {
                    return fileNameString.replace(/['"]/g, '')
                })
                result = result.concat(fileNameStrings)
            }
            return result
        }, addedFiles)
    }

    var isopackPath = getIsopackPath(packageDescription.name)

    return _.assign(packageDescription, {
        localPath: packagePath,
        isopackPath: isopackPath,
        dependencies: dependencies, // empty array if no dependencies are found
        files: addedFiles // empty array if no files are added
    })
}

/**
 * Given an isopack, get the JSON result from isopack.json if it exists, then
 * unipackage.json if it exists, otherwise null if neither exist.
 *
 * @param {string} isopackPath The path to an isopack.
 * @return {Object|null} The JSON.parsed result, or null if the files are not
 * found.
 */
function isoOrUni(isopackPath) {
    var isoUniPath = path.join(isopackPath, 'isopack.json')
    var result

    // if the isopack.json path doesn't exist
    if (!fs.existsSync(isoUniPath))
        isoUniPath = path.join(isopackPath, 'unipackage.json')

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

var PLATFORM_NAMES = [
    'os',
    'web.browser',
    'web.cordova'
]

/**
 * Get the dependencies from an isopack's os.json, web.browser.json,
 * and web.cordova.json files.
 *
 * @param {string} isopackPath The path to an isopack.
 * @return {Array.string} An array of package constraint strings being the
 * dependencies of the given isopack.
 *
 * XXX: Make this less naive? The result doesn't show which deps are for which
 * architectures, and assumes the versions are the same across
 * architectures.
 *
 * XXX: Do we have to handle specific architectures like "os.linux"?
 */
function getDependenciesFromPlatformFiles(isopackPath) {
    // get the `uses` array of each platform file and merge them together uniquely.
    var dependencies = _.reduce(PLATFORM_NAMES, function(dependencies, name) {
        var pathToFile = path.resolve(isopackPath, name+'.json')
        if (fs.existsSync(pathToFile)) {
            var info = JSON.parse(fs.readFileSync(pathToFile).toString())
            dependencies = _.unique(_.union(dependencies, info.uses), 'package')
        }
        return dependencies
    }, [])

    // convert each use into a package constraint string.
    dependencies = _.map(dependencies, function(use) {
        return use.package + (typeof use.constraint !== 'undefined' ? '@'+use.constraint : '')
    })

    return dependencies
}

/**
 * Get the a list of files that were added to a package (using api.addFiles)
 * from its isopack.
 *
 * @param {string} isopackPath The path to an isopack.
 * @return {Array.string} An array containing the full names of added files.
 * Empty if there are none.
 *
 * TODO: Include which arches each file is added for.
 */
function getAddedFilesFromIsopack(isopackPath) {
    var isoUniResult = isoOrUni(isopackPath)
    if (!isoUniResult) throw new Error('isopack.json or unipackage.json not found!? Please report this at github.com/trusktr/rocket-module/issues')

    var packageName = isoUniResult.name
    var isopackName = toIsopackName(packageName)

    var files = _.reduce(PLATFORM_NAMES, function(files, platformName) {
        var compiledFilePath = path.resolve(
            isopackPath, platformName, 'packages', isopackName+'.js')

        if (fs.existsSync(compiledFilePath)) {
            var filenameSections = fs.readFileSync(compiledFilePath).toString().match(FILENAME_REGEX)

            _.each(filenameSections, function(filenameSection) {
                var fileName = filenameSection.match(
                    new RegExp(FILENAME_REGEX.source))[1] // capture #1 (without the g flag)

                // TODO: Does this work in Windows? I'm assuming the fileName
                // values here use unix forward slashes no matter what arch.
                files.push(fileName.replace('packages/'+packageName+'/', ''))
            })
        }

        return files
    }, [])

    return _.unique(files)
}

/**
 * Get PackageInfo from an isopack (usually a package in the global
 * ~/.meteor/packages directory or application's .meteor/local/isopacks
 * directory).
 *
 * @param {string} isopackPath The path to an isopack.
 * @return {Object} A subset of the PackageInfo type that includes the `path` and
 * `dependencies` keys.
 *
 * TODO: Don't add packagePath here, add it externally with _.assign.
 *
 * TODO: Get added files from platform files.
 */
function getInfoFromIsopack(isopackPath) {
    var isoUniResult = isoOrUni(isopackPath)
    if (!isoUniResult) throw new Error('isopack.json or unipackage.json not found!? Please report this at github.com/trusktr/rocket-module/issues')
    var result = {}
    var dependencies = []

    if (isoUniResult) {
        result = _.assign(result, _.pick(isoUniResult, 'name', 'summary', 'version'))
    }

    dependencies = getDependenciesFromPlatformFiles(isopackPath)
    addedFiles = getAddedFilesFromIsopack(isopackPath)

    result = _.assign(result, {
        isopackPath: isopackPath,
        dependencies: dependencies,
        files: addedFiles
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
    var app = getAppDir()
    if (!app) throw new Error('getInstalledVersion is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    var packagesFile = path.resolve(app, '.meteor', 'versions')
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
 * TODO: Account for PACKAGE_DIRS environment variable. This function assumes
 * that local packages are in the default location in the `packages` folder of
 * the application, but this might not be the case if a different path is
 * specified with the PACKAGE_DIRS environment variable.
 *
 * TODO: If no local packages, local isopacks, or global isopacks are found,
 * get info from online but if no internet connection, return null.
 *
 * TODO: Also include files added in Package.onTest in the `files` property of the returned PackageInfo.
 */
function getPackageInfo(packageName, packageVersion) {

    var packageDotJsPath, packageInfo

    var packageFound = false

    // If the package is made by MDG, it has no username or organization prefix (vendor name).
    var packageLocalName = toLocalPackageName(packageName)

    // First check the app's local packages directory. If the package
    // exists locally and either the user didn't specify a version or the user
    // specified a version that happens to be the version of the local package
    //
    // TODO?: Handle packages that have the same package name but with the same
    // vendor name since the folder names would be the same.
    //
    // TODO: For local packages, look in `.meteor/isopacks`/ instead of in
    // `packages/`. The logic will then be the same as in `else` block of this
    // conditional. This also eliminates the previous "TODO?". Perhaps keep
    // this first logic for the `packages/` directory, then first look in the
    // local `.meteor/local/isopacks/` before finally looking in
    // `~/.meteor/packages/`.
    var app = getAppDir()
    if (app) packageDotJsPath = path.resolve(app, 'packages', packageLocalName, 'package.js')
    if (
        app && (fs.existsSync(packageDotJsPath) && !packageVersion) ||
        app && (fs.existsSync(packageDotJsPath) && packageVersion &&
                    PackageVersion.compare(getInstalledVersion(packageName), packageVersion) === 0)
    ) {
        let packageDotJsSource = fs.readFileSync(packageDotJsPath).toString()
        packageInfo = getInfoFromPackageDotJs(packageDotJsSource, packageDotJsPath.replace(path.sep+getFileName(packageDotJsPath), ''))
    }

    // Otherwise check ~/.meteor/packages, and either find the package with the
    // version specified, or the max version of the specified package if no
    // version was specified.
    //
    // TODO: Find dependencies for packages in ~/.meteor/packages by
    // looking at the *.json files there instead of package.js.
    else {
        let packageIsopackName = toIsopackName(packageName)

        // If the package exists in ~/.meteor/packages
        let packagePath = path.join(USER_HOME, '.meteor/packages', packageIsopackName)
        if (fs.existsSync(packagePath)) {

            // Get the valid versions.
            let versions = path.join(USER_HOME, '.meteor/packages', packageIsopackName, '*')
            versions = glob.sync(versions)
            versions = _.reduce(versions, function(result, versionPath) {
                var version = getFileName(versionPath)
                var isValidVersion
                try { isValidVersion = PackageVersion.getValidServerVersion(version) } catch (e) {}
                if (isValidVersion) result.push(version)
                return result
            }, [])

            // If any versions exist, find the specified version, or find the
            // maximum version if a specific version wasn't specified. No
            // version is found if a version is specified but doesn't exist.
            if (versions.length > 0) {
                let foundVersion
                if (packageVersion && _.contains(versions, packageVersion))
                    foundVersion = packageVersion
                else if (!packageVersion)
                    foundVersion = _.max(versions, function(version) {
                        return PackageVersion.versionMagnitude(version)
                    })

                if (foundVersion) {
                    packageInfo = getInfoFromIsopack(path.join(USER_HOME, '.meteor/packages', packageIsopackName, foundVersion))
                }
            }
        }
    }

    // If a package was found, get the package info, otherwise return null.
    if (packageInfo) return packageInfo
    return null
}

/**
 * Gets the id of the current application.
 *
 * @return {string} The id.
 */
function getAppId() {
    var app = getAppDir()
    if (!app) throw new Error('getAppId is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
    return fs.readFileSync(
        path.resolve(app, '.meteor', '.id')
    ).toString().trim().split('\n').slice(-1)[0] // the last line of the file.
}

/**
 * @return {boolean} Returns truthy if rocket:module is explicitly installed in the current app.
 */
function appUsesRocketModule() {
    return _.contains(getInstalledPackages(true), "rocket:module")
}

/**
 * A CompileManager keeps track of code splitting for dependency sharing across
 * bundles within the same Meteor package or across Meteor packages.
 *
 * @class CompileManager
 */
function CompileManager(extentions) {
    this.handledSourceCount = 0
    this.extentions = extentions
    console.log('isopath', getPackageInfo('rocket:webpack').isopackPath)
    this.rocketWebpackNodeModules = path.resolve(getPackageInfo('rocket:webpack').isopackPath, 'npm', 'node_modules')
    console.log('\n ----------------------- rocket:webpack node_modules path:\n', this.rocketWebpackNodeModules)
}
_.assign(CompileManager.prototype, {

    /**
     * @param {Array.string} extentions An array of files extensions
     * determining which files the CompileManager will handle.
     */
    constructor: CompileManager,

    /**
     * Get the default configuration.
     *
     * @param {CompileStep} compileStep A compileStep needed to get info for
     * the current file.
     * @param {string} outputFile The output file. TODO: The logic can be moved
     * into here using the compileStep.
     * @return {Object} Returns the default configuration used in the source
     * handler. Currently it's a Webpack configuration object.
     */
    defaultConfig: function defaultConfig(compileStep, outputFile) {
        return {
            entry: compileStep.fullInputPath
                .replace(/\.[A-Za-z]*$/, ''), // remove the extension
            output: {
                filename: outputFile
            },
            module: {
                loaders: [
                    { test: /\.css$/, loader: "style!css" }
                    // TODO: get babel-loader working.
                    //,{ test: /\.js$/, loader: "babel", exclude: /node_modules/ }
                ]
            },
            resolveLoader: {
                root: [this.rocketWebpackNodeModules]
            }
        }
    },

    /**
     * Sets up the source handlers for rocket:module's build plugin.
     */
    initSourceHandlers: function initSourceHandlers() {
        _.forEach(this.extentions, function(extension) {
            Plugin.registerSourceHandler(extension, this.sourceHandler.bind(this))
        }.bind(this))
    },

    /**
     * This source handler simply marks entry points as in need of handling so
     * the batch handler can take over on the app-side.
     *
     * See https://github.com/meteor/meteor/wiki/CompileStep-API-for-Build-Plugin-Source-Handlers
     */
    sourceHandler: function sourceHandler(compileStep) {
        console.log(' --- Executing source handler on file: ', compileStep.fullInputPath, '\n')
        compileStep.addJavaScript({
            path: compileStep.inputPath,
            data: "/*_____rocket_module_____:not-compiled*/ throw new Error('Rocket:module needs to be installed in your app for some code to work: meteor add rocket:module') \n"+compileStep.read().toString(),
            sourcePath: compileStep.inputPath,
            bare: false
        })

        // keep track of this so when we run on the app side we can detect when
        // all local module.js files (those of the app and those of the app's
        // packages) have been handled.
        this.handledSourceCount += 1
        console.log('hello count:', this.handledSourceCount)
        if (isAppBuild() && getAppDir() && isFirstRun &&
            this.handledSourceCount === numberOfFilesToHandle) {

            this.onAppHandlingComplete()
        }
    },

    onAppHandlingComplete: function onAppHandlingComplete() {
        console.log(' -------- Handling complete! Number of handled source files: ', this.handledSourceCount)
        this.batchHandler()
    },

    /**
     * This will morph into the new batch handler...
     */
    batchHandler: function batchHandler() {
        var output, webpackCompiler, batchDir,
            currentPackage

        var app = getAppDir()
        if (!app) throw new Error('batchHandler is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')

        /*
         * Choose a temporary output location that doesn't exist yet.
         */
        ~function() {
            // TODO: handle tmpLocation for different platforms. Perhaps just
            // do it in a hidden folder in the application.
            var tmpLocation = path.sep+'tmp'

            do batchDir = path.resolve(tmpLocation, 'meteor-'+getAppId(), 'batch-'+rndm(24))
            while ( fs.existsSync(batchDir) )
        }()

        function getModuleSource(extendedPackageInfo, fileName) {
            var source

            for (var i = 0, len = PLATFORM_NAMES.length; i<len; i+=1) {
                compiledFilePath = path.resolve(extendedPackageInfo.isopackPath,
                    PLATFORM_NAMES[i], "packages", toIsopackName(extendedPackageInfo.name)+'.js')

                if (fs.existsSync(compiledFilePath)) {
                    compiledFileSource = fs.readFileSync(compiledFilePath).toString()

                    if (compiledFileSource.match(FILENAME_REGEX)) {
                        // regex for code that isn't bare:true.
                        let sourceRegex = r`\(function \(\) {\n\n${FILENAME_REGEX}(\n(.*|.*\/\/ \d+))+\n\/+\n\n}\)\.call\(this\);`

                        source = compiledFileSource.match(sourceRegex)

                        console.log('\n ################## SOURCE: \n', source)
                        break
                    }
                }
            }
            process.exit()
            return source ? source : null
        }

        /**
         * @return {Array.string} A list of module.js files in the whole application.
         *
         * TODO: Rename this
         */
        function getModuleFileNames() {
            // dependents is an array of PackageInfo
            var dependents = getDependentsOf('rocket:module')

            _.each(dependents, function(dependent) {
                _.each(dependent.files, function(file, i, files) {
                    files[i] = {
                        name: file,
                        source: getModuleSource(dependent, file)
                    }
                })
            })

            return dependents
        }

        var packageInfos = getModuleFileNames()
        _.each(packageInfos, (info) => {
            _.each(info.files, (fileInfo) => {
                console.log('\n --- module file: \n', fileInfo.name)
            })
        })
        process.exit()

        /*
         * Link the node_modules directory so modules can be resolved.
         *
         * TODO: Work entirely in the /tmp folder instead of creating the link
         * inside the currentPackage.
         */
        ~function() {
            currentPackage = packageDir(compileStep)
            var modulesLink = path.resolve(currentPackage, 'node_modules')
            var modulesSource = path.resolve(currentPackage, '.npm/package/node_modules')
            if (fs.existsSync(modulesLink)) fs.unlinkSync(modulesLink)
            fs.symlinkSync(modulesSource, modulesLink)
        }()

        /*
         * Extend the default Webpack configuration with the user's
         * configuration and get a Webpack compiler. Npm.require loads modules
         * relative to packages/<package-name>/.npm/plugin/<plugin-name>/node_modules
         * so we need to go back 5 dirs into the packagesDir then go into the
         * target packageDir.
         *
         * TODO: Move the Npm.require here to the top of the file, for ES6
         * Module compatibility.
         */
        ~function() {
            //output = path.resolve(output, compileStep.pathForSourceMap)
            var pathToConfig = path.join(packagesDirRelativeToNodeModules(),
                getFileName(currentPackage), 'webpack.config.js')
            var config = fs.existsSync(path.resolve(currentPackage, 'module.config.js')) ?
                Npm.require(pathToConfig) : {}
            config = _.merge(this.defaultConfig(compileStep, output), config)
            webpackCompiler = webpack(config)
        }()

        /*
         * Run the Webpack compiler synchronously and give the result back to Meteor.
         */
        ~function() {
            var webpackResult = Meteor.wrapAsync(webpackCompiler.run, webpackCompiler)()
            compileStep.addJavaScript({
                path: compileStep.inputPath,
                data: fs.readFileSync(output).toString(),
                sourcePath: compileStep.inputPath,
                bare: true
            })
        }()
    }
})

/**
 * Get a list of all the modules in the current app and it's local packages
 * that need to be handled by rocket:module's source handler.
 *
 * @return {Array} An array containing a list of all the modules (paths).
 */
function getUnhandledSources() {
    var app = getAppDir()
    if (!app) throw new Error('getUnhandledSources is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')
        // TODO: ^ Make a single function for this check.

    return []
}

/**
 * Convert a package name to an isopack name.
 *
 * @param {string} packageName The name to convert.
 * @return {string} The isopack name.
 */
function toIsopackName(packageName) {
    return packageName.split(':').join('_')
}

/**
 * Convert an isopack name to a package name.
 *
 * @param {string} isopackName The name to convert.
 * @return {string} The isopack name.
 */
function toPackageName(isopackName) {
    return isopackName.split('_').join(':')
}

/**
 * Get the local name of a package. This is the packageName in
 * userName:packageName, which is what Meteor also names the folder of a local
 * package.
 *
 * @param {string} packageName The full name of a package.
 * @return {string} The local name of the package.
 */
function toLocalPackageName(packageName) {
    var nameParts = packageName.split(':')
    return nameParts[nameParts.length - 1]
}

/**
 * Get the index of the object in an array that has the specified key value pair.
 *
 * @param {Array.Object} array An array containing Objects.
 * @param {string} key The key to check in each Object.
 * @param {?} value The value to check the key for (absolute equality).
 * @return {number} The integer index of the first Object found that has the key value pair.
 */
function indexOfObjectWithKeyValue(array, key, value) {
    var index = -1
    for (var i=0; i<array.length; i+=1) {
        if (array[i][key] && array[i][key] === value) {
            index = i
            break
        }
    }
    return index
}

/*
 * See http://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
 */
function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

// entrypoint
// TODO: use getIsopackPath() here instead of the repeated logic.
~function() {
    if (isAppBuild() && getAppDir()) {
        //console.log(' --- dependents:', getDependentsOf('rocket:module'))
        //process.exit()

        var localIsopacksDir = path.resolve(getAppDir(), '.meteor', 'local', 'isopacks')
        var dependents = getDependentsOf('rocket:module')

        // get only the local isopacks that are dependent on rocket:module
        var isopackNames = _.reduce(fs.readdirSync(localIsopacksDir), function(result, isopackName) {
            if (~indexOfObjectWithKeyValue(dependents, "name", toPackageName(isopackName)))
                result.push(isopackName)
            return result
        }, [])

        // if we've just started the `meteor` command
        if (isFirstRun) ~function() {

            // If there exist local isopacks dependent on rocket:module, delete
            // them from the filesystem, then tell the user to restart meteor
            // before finally exiting. On the next run this will be skipped.
            if (isopackNames.length) ~function() {
                var removalTasks = []

                _.forEach(isopackNames, function(isopackName) {
                    var isopackPath = path.resolve(localIsopacksDir, isopackName)
                    removalTasks.push(function(callback) {
                        fse.remove(isopackPath, callback)
                    })
                })

                Meteor.wrapAsync(function(callback) {
                    async.parallel(removalTasks, callback)
                })()

                console.log('\n\n')
                console.log(" --- Rocket:module builds cleaned. Please restart Meteor. (In a future version of rocket:module you won't have to restart manually.)")
                console.log('\n')
                process.exit()
            }()

            // Find the number of files that rocket:module's source handler will
            // handle on the app-side. These are the module.js files of the current
            // app and it's local packages. We don't care about non-local packages'
            // module.js files because those were already handled before those
            // packages were published. We need this so that we will be able to
            // determine when the source handlers are done running so that we can
            // then run our batch handler to compile all the modules of all the
            // packages in the app using the batch handler. We won't need to do all
            // this bookkeeping once Plugin.registerBatchHandler is released.
            var app = getAppDir()
            // only check the app for module.js files if rocket:module is installed for the app.
            if (appUsesRocketModule()) {
                var appModuleFiles = glob.sync(path.resolve(app, '**', '*module.js'))

                // filter out files from local packages.
                appModuleFiles = _.filter(appModuleFiles, function(file) {
                    // TODO: add escapeRegExp to regexr.
                    return !file.match(escapeRegExp(path.resolve(app, 'packages')))
                })

                console.log('+++ app files', appModuleFiles)

                numberOfFilesToHandle += appModuleFiles.length
            }
            _.forEach(dependents, function(dependent) {
                if (isLocalPackage(dependent.name)) {
                    console.log('\n --- local package: ', dependent.name, '\n')
                    var packageModuleFiles = _.reduce(dependent.files, function(result, file) {
                        if (file.match(/module\.js$/)) {
                            result.push(file)
                            console.log('+++ module file', dependent.name+'/'+file)
                        }
                        return result
                    }, [])
                    numberOfFilesToHandle += packageModuleFiles.length
                }
            })

            console.log('\nhow many total files?', numberOfFilesToHandle, '\n')
        }()
    }

    // TODO: code splitting among all bundles
    var compileManager = new CompileManager([
        // also catches module.ts files compiled by mologie:typescript
        'module.js',

        // in case there was a module.coffee file compiled by coffeescript
        'module.coffee.js',

        // in case there was a module.ts compiled by meteortypescript:compiler or jasonparekh:tsc
        'module.ts.js',

        // in case there was a module.ls compiled by dessix:livescript-compiler or vasaka:livescript-compiler
        'module.ls.js'
    ])

    // handle all files with the source handler. It simply prepends a comment to
    // files, on both publish and app side.
    compileManager.initSourceHandlers()
    console.log(' --- Added the source handlers! ')

    if (isAppBuild() && getAppDir()) {
        // Add this to the `process` so we can detect first runs vs re-builds after file
        // changes.
        if (!process.rocketModuleFirstRunComplete) {
            process.rocketModuleFirstRunComplete = true
        }
    }
}()
