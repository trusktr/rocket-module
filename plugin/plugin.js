/**
 * @fileoverview Sets up a Meteor build plugin that compiles entrypoints into
 * bundles. The code of the entrypoints can use module syntax (f.e. ES6, CJS,
 * or AMD). Currently the plugin uses Webpack to compile entrypoints.
 *
 * TODO: Make webpack watch files for changes while in dev mode?
 */

// npm builtin modules
const path                  = Npm.require('path')
const fs                    = Npm.require('fs')
const os                    = Npm.require('os')
const util                  = Npm.require('util')

// npm modules
const _                     = Npm.require('lodash')
//const glob                  = Npm.require('glob')
//const fse                   = Npm.require('fs-extra')
//const async                 = Npm.require('async')
const regexr                = Npm.require('regexr')
const mkdirp                = Npm.require('mkdirp')
const npm                   = Npm.require('npm')
const shell                 = Npm.require('shelljs')

// Meteor package imports
const webpack               = Package['rocket:webpack'].Webpack
const BuildTools            = Package['rocket:build-tools'].BuildTools

const {
    PLATFORM_NAMES,
    FILENAME_REGEX,
    getAppPath,
    getInstalledPackages,
    isAppBuild,
    getDependentsOf,
    isLocalPackage,
    getPackageInfo,
    toIsopackName,
    toPackageName,
    getPath,
    getFileName,
    getMeteorPath,
    getMeteorNpmRequireRoot,
    getCommonAncestorPath,
    requireFromMeteor,
    indexOfObjectWithKeyValue
} = BuildTools

// modules from Meteor.
const meteorNpm = requireFromMeteor(path.join('tools', 'isobuild', 'meteor-npm'))

let numberOfFilesToHandle = 0
let isFirstRun            = !process.rocketModuleFirstRunComplete

let npmIsLoaded = false

/**
 * RocketModuleCompiler uses Webpack to share dependencies and modules across
 * packages (including the local application which is a special package
 * itself). It also provides a bunch of loader for support of ES6,
 * Coffeescript, CSS, TypeScript, etc.
 *
 * The instance of this class that gets instantiated by Meteor stays alive as
 * long as the Meteor process does (unless rocket:module is a local package and
 * has had a file changed).
 *
 * @class RocketModuleCompiler
 */
class RocketModuleCompiler {

    /**
     * @constructor
     */
    constructor() {

        // if we've just started the `meteor` command, clear the rocket-module cache.
        //if (isFirstRun) {

        //}

        //// Add this to the `process` so we can detect first runs vs re-builds after file
        //// changes.
        //if (!process.rocketModuleFirstRunComplete) {
            //process.rocketModuleFirstRunComplete = true
        //}
    }

    /**
     * processFilesForTarget is executed in parallel, once for each platform.
     *
     * @override
     * @param {Array.InputFile} inputFiles An array of InputFile data types.
     * See Meteor's registerCompiler API for info.
     * @return {undefined}
     */
    processFilesForTarget(inputFiles) {

        let r = regexr
        let { platform } = fileInfo(inputFiles[0])

        /*
         * Choose a temporary output location that doesn't exist yet.
         */
        let rocketModuleCache = path.resolve(getAppPath(), '.meteor', 'local', 'rocket-module')
        let platformBatchDir = path.resolve(rocketModuleCache, 'platform-builds', platform)
        if (!fs.existsSync(platformBatchDir)) mkdirp.sync(platformBatchDir)

        // the initial webpack configuration object.
        let webpackConfig = {
            entry: {
                // f.e.: 'username_packagename/one/one': './packages/username_packagename/one/one',
            },
            output: {
                path: path.resolve(platformBatchDir, './built'),
                filename: '[name]',
            },
            plugins: [ new webpack.optimize.CommonsChunkPlugin('shared-modules.js') ],
            resolve: {
                extensions: [
                    '', '.webpack.js', '.web.js', '.js', // defaults
                    '.jsx', '.css' //custom
                ],
                root: [ path.resolve(platformBatchDir, './node_modules') ]
            },
            resolveLoader: {
                root: [ path.resolve(platformBatchDir, './node_modules') ]
            },
            module: {
                loaders: [
                    // Support for ES6 modules and the latest ES syntax.
                    { test: /\.js$/,  loader: 'babel', exclude: /node_modules/, query: { blacklist: ['react'] } },

                    // jsx files.
                    { test: /\.jsx$/, loader: 'babel', exclude: /node_modules/ },

                    // For loading CSS files.
                    { test: /\.css$/, loader: 'style!css' },

                    // glsl files.
                    //{ test: /\.glsl$/, loader: 'glslify!raw' }
                    { test: /\.(glsl|frag|vert)$/, loader: 'raw' },
                    { test: /\.(glsl|frag|vert)$/, loader: 'glslify' }
                ]
            }
        }

        let mainPackageDotJsonData = {
            dependencies: {}
        }

        // extract the npm dependency files from the inputFiles
        let dependencyFiles = _.filter(inputFiles, function(file) {
            let { fileName } = fileInfo(file)
            return fileName.match(/npm\.json$/g)
        })
        inputFiles = _.filter(inputFiles, function(file) {
            let { fileName } = fileInfo(file)
            return !fileName.match(/npm\.json$/g)
        })

        // Make an array of dependency objects, one per package.
        let npmDependencies = {}
        let jsonError = null
        _.each(dependencyFiles, function(file) {
            let { isopackName, fileSource } = fileInfo(file)
            try {
                npmDependencies[isopackName] = JSON.parse(fileSource)
            }
            catch (error) {
                jsonError = error
                file.error(error)
            }
        })
        if (jsonError) return;

        /*
         * Write the file sources, and package.json files for npm dependencies,
         * to the platformBatchDir to be handled by Webpack.
         */
        {
        let currentPackage = null
        _.each(inputFiles, (inputFile) => {
            let {
                package, fileName, isopackName, npmPackageName,
                relativePackageFileName, isopackPackageFileName, fileSource
            } = fileInfo(inputFile)

            let batchDirPackagePath = path.resolve(platformBatchDir, 'packages', npmPackageName)

            // make the package path, and other things, in the batch dir
            mkdirp.sync(batchDirPackagePath)

            // write a package.json for the current package, containing npm
            // deps, package isopack name, and version 0.0.0 (version is
            // required by npm).
            if (currentPackage !== isopackName) {

                // if the current package has no npm dependencies, give it an empty dependency list.
                if (!_.has(npmDependencies, isopackName))
                    npmDependencies[isopackName] = {}

                fs.writeFileSync(path.resolve(batchDirPackagePath, 'package.json'), `{
                    "name": "${npmPackageName}",
                    "version": "0.0.0",
                    "dependencies": ${
                        JSON.stringify(npmDependencies[isopackName])
                    }
                }`)

                // Specify the current package as a dependency in the main
                // package.json
                mainPackageDotJsonData.dependencies[npmPackageName] = `file:./packages/${npmPackageName}`
            }

            // All .js files except entry.js files can be required from
            // entry.js entrypoint files.
            if (fileName.match(/\.js$/g)
                && !(fileName.match(/shared-modules\.js$/g) && package.name === 'rocket:module')
                && !isEntryPoint(fileName)) {

                // write non-entrypoint files to the platformBatchDir
                let filePath = path.resolve(batchDirPackagePath, fileName)
                mkdirp.sync(getPath(filePath))
                fs.writeFileSync(filePath, fileSource)
            }

            // entry.js files are entrypoints.
            else if (isEntryPoint(fileName)) {

                // write entrypoint files to the platformBatchDir, add them to
                // webpackConfig's entry option.
                //
                // The Webpack entry path is relative to the platformBatchDir, where
                // webpack will be running from, so the period is needed (we
                // can't use path.join because it removes the leading period):
                let filePath = path.resolve(batchDirPackagePath, fileName)
                mkdirp.sync(getPath(filePath))
                fs.writeFileSync(filePath, fileSource)
                webpackConfig.entry[isopackPackageFileName] = relativePackageFileName
            }

            // Don't write the empty shared-modules file to the batchdir. We'll
            // set its source to the Webpack entry chunk after compilation.
            else if (fileName.match(/shared-modules\.js$/g) && package.name === 'rocket:module') {
                // do nothing.
            }
            currentPackage = isopackName
        })
        }

        // Write the main package.json file.
        let mainPackageDotJson = path.resolve(platformBatchDir, 'package.json')
        fs.writeFileSync(mainPackageDotJson, JSON.stringify(mainPackageDotJsonData))

        /*
         * Use npm to install npm locally for us to use via CLI. This is easier
         * than having to look for npm in the rocket:module isopack.
         */
        let npmContainerDirectory = path.resolve(rocketModuleCache, 'npmContainer')
        if (!fs.existsSync(npmContainerDirectory)) {
            mkdirp(npmContainerDirectory)

            let savedLogFunction = console.log
            console.log = function() {} // silence npm output.
            Meteor.wrapAsync((callback) => {
                npm.load({ prefix: npmContainerDirectory, loglevel: 'silent' }, function() {
                    npm.commands.install(npmContainerDirectory, ['npm@^3.2.0'], callback)
                })
            })()
            console.log = savedLogFunction
        }

        /**
         * A function for calling npm commands. F.e.:
         *
         * ```
         * npmCommand('install foo bar@1.2.3 baz --save')
         * ```
         *
         * Set npmCommand.bin to the path of an npm executable, otherwise it
         * defaults to the npm found in your PATH. F.e.:
         *
         * ```
         * npmCommand.bin = '/path/to/npm'
         * npmCommand('update')
         * ```
         *
         * @param {Array.string} args An array of arguments to pass to npm.
         * They get concatenated together.
         *
         * XXX: Use child_process.spawnSync?
         */
        function npmCommand(...args) {
            args = _.reduce(args, function(result, arg) {
                return `${result} ${arg}`
            }, '')

            return shell.exec(`${npmCommand.bin || 'npm'} ${args}`)
        }
        npmCommand.bin = null

        /*
         * Install all the packages and their npm dependencies in the platformBatchDir.
         */
        {
            npmCommand.bin = path.resolve(npmContainerDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
            let {code, output} = npmCommand(`--prefix ${platformBatchDir} install ${platformBatchDir}`)

            if (code !== 0)
                throw new Error('Error: Unable to install NPM dependencies. Check previous output for details.')
        }

        // list each node_modules folder (those installed in the previous
        // step) in webpackConfig's resolve.fallback option.
        // XXX: Is this still needed now that we are using NPM v3 and all deps
        // are flat?
        //_.each(inputFiles, (inputFile) => {
            //let currentPackage = null
            //let { package, isopackName } = fileInfo(inputFile)
            //let nodeModulesPath = path.resolve(platformBatchDir, 'node_modules', isopackName, 'node_modules')

            //// TODO: node_modules for the app if meteorhacks:npm is installed.
            //if (currentPackage !== isopackName && fs.existsSync(nodeModulesPath)) {
                //webpackConfig.resolve.fallback.push(nodeModulesPath)

                //// additionally, add rocket:module's node_modules folder to resolveLoader.fallback
                //if (package.name === 'rocket:module') {
                    //webpackConfig.resolveLoader.fallback.push(nodeModulesPath)
                //}
            //}
            //currentPackage = isopackName
        //})

        /*
         * Run the Webpack compiler synchronously.
         */
        let webpackCompilerStats
        {
            let oldCwd = process.cwd()
            process.chdir(platformBatchDir)

            // TODO: Find out why Webpack doesn't code split shared modules in this setup.
            // Files an issue on Webpack at https://github.com/webpack/webpack/issues/1296
            let compileErrors
            let webpackCompiler = webpack(webpackConfig)
            Meteor.wrapAsync((callback) =>
                webpackCompiler.run((error, stats) => {
                    if (error) throw new Error(error)

                    //console.log(util.inspect(stats, false, null))

                    webpackCompilerStats = stats.toJson()

                    let errors = stats.toJson().errors
                    errors = _.filter(errors, function(error) {
                        return !isWhitelistedWebpackError(error)
                    })

                    if (errors && errors.length)
                        compileErrors = errors

                    callback(error, stats)
                })
            )()

            process.chdir(oldCwd)

            // TODO: Detect errors for specific files, then pass the error to
            // the corresponding InputFile.error method. If the error is
            // generic, not for a specific file, then just throw an error.
            if (compileErrors) {
                inputFiles[0].error(new Error(compileErrors[0]))
                return
            }
        }

        /*
         * Pass all the compiled files back into their corresponding InputFiles
         * via the addJavaScript method.
         */
        _.each(inputFiles, (inputFile) => {
            let { fileName, package, isopackPackageFileName, relativePackageFileName, fileSource }
                = fileInfo(inputFile)

            let batchDirBuiltFilePath = path.resolve(platformBatchDir, 'built', isopackPackageFileName)

            let builtFileSource

            if (fileName.match(/shared-modules\.js$/g) && package.name === 'rocket:module') {
                builtFileSource = fs.readFileSync(
                    path.resolve(platformBatchDir, 'built', 'shared-modules.js')
                ).toString()

                // replace window with RocketModule on the server-side, which
                // is shared with all packages that depend on rocket:module.
                // Webpack adds things to window in web builds, but we don't
                // have window on the server-side. Luckily we know all packages
                // being processed by this compiler all depend on
                // rocket:module, so they can all access the RocketModule
                // symbol similarly to a global like window.
                if (platform.match(/^os/g)) {
                    builtFileSource = 'RocketModule = {};\n'+builtFileSource
                    builtFileSource = builtFileSource.replace(/\bwindow\b/g, 'RocketModule')
                }
                addSource()
            }
            else if (isEntryPoint(fileName)) {
                builtFileSource = fs.readFileSync(batchDirBuiltFilePath).toString()

                // add the RocketModule symbol to the entry points so that they
                // can read the stuff that Webpack added to RocketModule in the
                // shared-modules.js file.
                if (platform.match(/^os/g)) {
                    // extend function from http://stackoverflow.com/a/12317051/454780
                    builtFileSource = (`
                        function rocketModuleExtend(target, source) {
                            target = target || {};
                            for (var prop in source) {
                                if (typeof source[prop] === 'object') {
                                    target[prop] = rocketModuleExtend(target[prop], source[prop]);
                                } else {
                                    target[prop] = source[prop];
                                }
                            }
                            return target;
                        }
                        rocketModuleExtend(this, Package['rocket:module'].RocketModule);
                        ${builtFileSource}
                    `)
                }
                addSource()
            }
            else {
                let modules = webpackCompilerStats.modules

                // if the file wasn't handled by Webpack, we just give it's
                // original source back to Meteor for Meteor to handle.
                if (indexOfObjectWithKeyValue(modules, 'name', relativePackageFileName) < 0) {
                    builtFileSource = fileSource
                    addSource()
                }
            }

            function addSource() {
                // finally add the sources back!
                inputFile.addJavaScript({
                    path: fileName,
                    data: builtFileSource || '',
                    sourcePath: [package.name, fileName].join('/'),
                    sourceMap: null // TODO TODO TODO
                })
            }
        })
    }
}

/**
 * @return {boolean} Returns truthy if rocket:module is explicitly installed in the current app.
 */
function appUsesRocketModule() {
    return _.contains(getInstalledPackages(true), "rocket:module")
}

/*
 * See http://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
 * TODO: move this to regexr
 */
function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

/**
 * Gets the file info that rocket:module needs from the InputFile data type
 * passed to rocket:module in processFilesForTarget().
 *
 * @param {InputFile} inputFile An InputFile object.
 * @return {Object} An object containing the info rocket:module needs.
 */
function fileInfo(inputFile) {

    let unibuild = inputFile._resourceSlot.packageSourceBatch.unibuild
    let inputResource = inputFile._resourceSlot.inputResource

    let package = unibuild.pkg
    let fileName = inputResource.path

    // the isopackName of the current file's package, or rocket_module__app
    // if the file belongs to the app.
    // Note: I was using a name like __app__ instead of rocket_module__app
    // but a name with leading underscores causes npm to crash
    // (https://github.com/npm/npm/issues/9071).
    let isopackName = package.name ? toIsopackName(package.name) : '_app'
    let npmPackageName = 'rocket_module__'+isopackName

    let npmPackageFileName = path.join(npmPackageName, fileName)
    let isopackPackageFileName = path.join(isopackName, fileName)
    let relativePackageFileName = '.' +path.sep+ 'packages' +path.sep+ npmPackageFileName

    let fileSource = inputResource.data.toString()
    let extension = inputResource.extension

    let platform = unibuild.arch

    return {
        package, fileName, isopackName, npmPackageName, npmPackageFileName,
        isopackPackageFileName, relativePackageFileName, fileSource, extension,
        platform
    }
}

function isEntryPoint(fileName) {
    return !!getFileName(fileName).match(/(^entry\.js$)|(\.entry\.js$)/g)
}

function isWhitelistedWebpackError(error) {
    let r = regexr
    let whitelistError = false

    if (error.toString().match(r`/${
        escapeRegExp(
            `Module not found: Error: Cannot resolve module 'glslify'`
        )
    }.*famous/g`)) {
        whitelistError = true
    }

    return whitelistError
}

// entrypoint
{
    Plugin.registerCompiler({
        // TODO: Add css, typescript, coffeescript, etc.
        extensions: [ 'js' ],
        filenames: [ 'npm.json', 'entry.js' ]
    }, () => new RocketModuleCompiler)
}
