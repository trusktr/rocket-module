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

const r = regexr

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
    getMeteorPath,
    getMeteorNpmRequireRoot,
    getCommonAncestorPath,
    requireFromMeteor,
    indexOfObjectWithKeyValue
} = BuildTools

// leave this empty, it gets populated programmatically in the
// processFilesForTarget method of our compiler. This object contains one
// sub-object for each platform, and those sub-objects are the ones that get
// passed to Webpack.
const webpackCacheObject = {}

// leave this empty, it gets populated programmatically in the
// processFilesForTarget method of our compiler. This object contains one
// sub-object for each platform, and those sub-objects are the ones that get
// passed to Webpack.
const webpackConfig = {}

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
        // store source hashes to detect which files have changed, per platform.
        this.sourceHashes = {}
    }

    /**
     * Given an array of InputFiles, return an array of only the ones that were
     * modified by the user, for the current platform.
     * @param {Array.InputFile} inputFiles The input files.
     * @return {Array.InputFile} The modified files.
     *
     * TODO Make a post build asynchronous process that cleans up deleted
     * files after the user's app is started so it's transparent to the user.
     */
    getModifiedFiles(inputFiles) {
        let modifiedFiles = []
        for (let i=0, len=inputFiles.length; i<len; i+=1) {
            if (this.isModifiedFile(inputFiles[i])) modifiedFiles.push(inputFiles[i])
        }
    }

    /**
     * Looks at this.sourceHashes in this.sourceHashes to determine if a file
     * was modified, for the currnt platform.
     * @param {InputFile} inputFile The input file to check.
     * @return {boolean} True if the file was modified, otherwise false.
     */
    isModifiedFile(inputFile) {
        let { isopackPackageFileName, fileSourceHash, platform } = fileInfo(inputFile)
        let isModified = false

        if (!_.has(this.sourceHashes, [platform, isopackPackageFileName]) ||
            this.sourceHashes[platform][isopackPackageFileName] !== fileSourceHash) {

            isModified = true
        }

        return isModified
    }

    /**
     * Stores source hashes in this.sourceHashes for the current platform.
     * @param {Array.InputFile} inputFiles The files to update.
     */
    updateSourceHashes(inputFiles) {
        for (let i=0, len=inputFiles.length; i<len; i+=1) {
            if (this.isModifiedFile(inputFiles[i])) {
                let {isopackPackageFileName, fileSourceHash, platform} = fileInfo(inputFiles[i])
                this.sourceHashes[platform] = this.sourceHashes[platform] || {}
                this.sourceHashes[platform][isopackPackageFileName] = fileSourceHash
            }
        }
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

        console.log(`\n[rocket:module] Compiling for platform "${platform}"...   `)
        let startTime = Date.now()

        _.each(inputFiles, inputFile => {
            //console.log(this.isModifiedFile(inputFile), fileInfo(inputFile).isopackPackageFileName)
        })
        //this.updateSourceHashes(inputFiles); return

        /*
         * Choose a temporary output location that doesn't exist yet.
         */
        let rocketModuleCache = path.resolve(getAppPath(), '.meteor', 'local', 'rocket-module')
        let platformBatchDir = path.resolve(rocketModuleCache, 'platform-builds', platform)
        if (!fs.existsSync(platformBatchDir)) mkdirp.sync(platformBatchDir)

        /*
         * Create the initial webpack configuration object.
         */
        webpackCacheObject[platform] = webpackCacheObject[platform] || {}
        // Re-use the config object if it exists. Is this necessary?
        // https://github.com/webpack/webpack/issues/1402
        if (!webpackConfig[platform]) {
            webpackConfig[platform] = {
                entry: { // set programmatically later
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
                    root: [ path.resolve(platformBatchDir, './node_modules') ],
                    alias: {} // set programmatically later
                },
                resolveLoader: {
                    root: [ path.resolve(platformBatchDir, './node_modules') ]
                },
                module: {
                    loaders: [
                        // temporary support for Famous/engine's glslify transform requirement.
                        // TODO: Make rocket:module detect and apply browserify transforms.
                        //{ test: /\.js$/, loader: 'transform/cacheable?glslify'},
                        // dependencies for npm.json:
                        //  "transform-loader": "^0.2.0",
                        //  "glslify": "^2.0.0"

                        // Support for ES6 modules and the latest ES syntax.
                        {
                            test: /\.jsx?$/,
                            loader: 'babel',
                            exclude: /node_modules/,
                            query: {
                                cacheDirectory: true,
                                presets: [
                                    //'es2015', // tc39 stage 4, currently es2015?
                                    'react'
                                ],
                                plugins: [

                                    // es2015 preset, manual version:
                                    'transform-es2015-arrow-functions',
                                    'transform-es2015-block-scoped-functions',
                                    'transform-es2015-block-scoping',
                                    'transform-es2015-classes',
                                    'transform-es2015-computed-properties',
                                    'transform-es2015-destructuring',
                                    'transform-es2015-for-of',
                                    'transform-es2015-function-name',
                                    'transform-es2015-literals',
                                    'transform-es2015-modules-commonjs',
                                    'transform-es2015-object-super',
                                    'transform-es2015-parameters',
                                    'transform-es2015-shorthand-properties',
                                    'transform-es2015-spread',
                                    'transform-es2015-sticky-regex',
                                    'transform-es2015-template-literals',
                                    'transform-es2015-typeof-symbol',
                                    'transform-es2015-unicode-regex',
                                    'transform-regenerator', // not needed in Chrome or Firefox. Soon won't be needed in Edge or Safari.

                                    'transform-async-to-generator',

                                    'transform-es5-property-mutators',

                                    // module support
                                    'transform-es2015-modules-amd',
                                    //'transform-es2015-modules-systemjs', // needs System existing in global scope first (f.e. via SystemJS)
                                    'transform-es2015-modules-umd',
                                ],
                            },
                        },

                        // TODO: We still have to tell Meteor rocket:module will
                        // handle other file types besides JavaScript files, but
                        // for now the following works when importing such files
                        // from NPM modules.

                        // For loading CSS files.
                        // XXX: Should we handle CSS files? This already works for
                        // importing CSS files from NPM packages if needed, but
                        // Meteor already compiles CSS files found elsewhere.
                        { test: /\.css$/, loader: 'style!css' },

                        //images
                        { test: /\.(png|jpg|jpeg)$/, loader: 'url' },

                        // glsl files.
                        //{ test: /\.glsl$/, loader: 'glslify!raw' }
                        { test: /\.(glsl|frag|vert)$/, loader: 'raw' },
                        { test: /\.(glsl|frag|vert)$/, loader: 'glslify' }
                    ]
                },
                cache: webpackCacheObject[platform],
            }
        }

        /*
         * Get the app-level config from rocket-module.json file of the app and
         * apply it to the webpack config. Ignore rocket-module.json files
         * found in packages.
         */
        let rocketModuleConfigFile = _.filter(inputFiles, function(file) {
            let { fileName, isopackName } = fileInfo(file)
            return isopackName.match(/^_app$/g) && fileName.match(/^rocket-module\.json$/g)
        })[0]
        inputFiles = _.filter(inputFiles, function(file) {
            let { fileName, isopackName } = fileInfo(file)
            return !(isopackName.match(/^_app$/g) && fileName.match(/^rocket-module\.json$/g))
        })
        let rocketModuleConfig = {}
        if (rocketModuleConfigFile) {
            let { fileSource } = fileInfo(rocketModuleConfigFile)
            rocketModuleConfig = JSON.parse(fileSource)
            webpackConfig[platform].resolve.alias = rocketModuleConfig.aliases
        }


        /*
         * Extract the npm dependency files from the inputFiles.
         */
        let dependencyFiles = _.filter(inputFiles, function(file) {
            let { fileName } = fileInfo(file)
            return fileName.match(/^npm\.json$/g)
        })
        inputFiles = _.filter(inputFiles, function(file) {
            let { fileName } = fileInfo(file)
            return !fileName.match(/^npm\.json$/g)
        })

        /*
         * Make an array of dependency objects, one per package.
         *
         * TODO: Merge multiple npm.json files of a package into one, the last
         * override deps of the previous.
         */
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
        let mainPackageDotJsonData = {
            name: "rocket_module__root",
            description: "root package",
            version: "0.0.0",
            license: "WTFPL",
            repository: {
                type: "git",
                url: "git://github.com/meteor-rocket/module.git"
            },
            dependencies: {
                "webpack": "^1.10.5"
            }
        }
        let previousPackage = null
        _.each(inputFiles, inputFile => {
            let {
                package, fileName, isopackName, npmPackageName,
                relativePackageFileName, isopackPackageFileName, fileSource
            } = fileInfo(inputFile)

            let batchDirPackagePath = path.resolve(platformBatchDir, 'packages', npmPackageName)

            // make the package path for the current file.
            if (!fs.existsSync(batchDirPackagePath))
                mkdirp.sync(batchDirPackagePath)

            // write a package.json for the current package, containing npm
            // deps, package isopack name, and version 0.0.0 (version is
            // required by npm).
            let currentPackage = isopackName
            if (previousPackage !== currentPackage) { // When we're at the first file of each package.

                // if the current package has no npm dependencies, give it an empty dependency list.
                if (!_.has(npmDependencies, currentPackage))
                    npmDependencies[currentPackage] = {}

                // TODO Avoid writing these package.json files (cache them)
                // unless necessary, for performance.
                fs.writeFileSync(path.resolve(batchDirPackagePath, 'package.json'), `{
                    "name": "${npmPackageName}",
                    "version": "0.0.0",
                    "dependencies": ${
                        JSON.stringify(npmDependencies[currentPackage])
                    }
                }`)

                // Specify the current package as a dependency in the main
                // package.json
                mainPackageDotJsonData.dependencies[npmPackageName] = `file:./packages/${npmPackageName}`
            }

            // Write all modified js files to the cache. All files will be
            // written on first run.
            //
            // All `.js` files except entry.js files can be required from an
            // entry.js entrypoint file.
            if (fileName.match(/\.js$/g)
                && !(fileName.match(/shared-modules\.js$/g) && package.name === 'rocket:module')
                && !isEntryPoint(fileName)) {

                // Let's make the file's path if it doesn't exist.
                let filePath = path.resolve(batchDirPackagePath, fileName)
                if (!fs.existsSync(path.dirname(filePath)))
                    mkdirp.sync(path.dirname(filePath))

                // write the non-entrypoint file to it's place if it's a
                // modified file. On first run, all files will be "modified"
                // and written. On subsequent runs, only one file (unless
                // Meteor changes this in issue
                // https://github.com/meteor/meteor/issues/4899) will be
                // modified.
                if (this.isModifiedFile(inputFile))
                    fs.writeFileSync(filePath, fileSource)
            }

            // entry.js files are entrypoints.
            else if (isEntryPoint(fileName)) {

                // write entrypoint files to the platformBatchDir, add them to
                // webpackConfig's entry option.  The Webpack entry path is
                // relative to the platformBatchDir, where webpack will be
                // running from.
                let filePath = path.resolve(batchDirPackagePath, fileName)
                if (!fs.existsSync(path.dirname(filePath)))
                    mkdirp.sync(path.dirname(filePath))
                if (this.isModifiedFile(inputFile))
                    fs.writeFileSync(filePath, fileSource)
                webpackConfig[platform].entry[isopackPackageFileName] = relativePackageFileName
            }

            // Don't write the empty shared-modules file to the batchdir. We'll
            // set its source to the Webpack entry chunk after compilation.
            else if (fileName.match(/shared-modules\.js$/g) && package.name === 'rocket:module') {
                // do nothing.
            }
            previousPackage = currentPackage // set previousPackage for the next iteration of the loop.
        })

        // Write the main package.json file.
        let mainPackageDotJson = path.resolve(platformBatchDir, 'package.json')
        fs.writeFileSync(mainPackageDotJson, JSON.stringify(mainPackageDotJsonData))
        }

        /*
         * Use npm to install npm locally for us to use via CLI. This is easier
         * than having to look for npm in rocket:module's isopack because we
         * can't guarantee that the structure of that won't change. The
         * programmatic NPM API doesn't work as nicely as the CLI, and we can't
         * depend on the user having the CLI, so we'll use the programmatic API
         * to locally install the version of NPM that we want for our needs.
         */
        let npmContainerDirectory = path.resolve(rocketModuleCache, 'npmContainer')
        let npmContainerNodeModules = path.resolve(npmContainerDirectory, 'node_modules')
        if (!fs.existsSync(npmContainerNodeModules)) {
            mkdirp(npmContainerNodeModules)

            console.log(`\n[rocket:module] Installing a local copy of npm@^3.2.0...  `)
            Meteor.wrapAsync(callback => {

                let loglevel = 'info'

                // Let us supply the npm loglevel via command like, f.e. meteor
                // --npm-loglevel verbose, for debugging.
                // XXX: Apparently we can't add CLI options to the meteor command.
                // TODO: Use an environment variable here.
                //let loglevelOptionIndex = process.argv.indexOf('--npm-loglevel')
                //if (loglevelOptionIndex > -1) {
                    //loglevel = process.argv[loglevelOptionIndex + 1]
                //}

                npm.load({ prefix: npmContainerDirectory, loglevel: loglevel }, function() {
                    npm.commands.install(npmContainerDirectory, ['npm@^3.2.0'], function() {
                        console.log('[rocket:module] The preceding WARN messages are harmless.')
                        callback()
                    })
                })
            })()
            console.log(`\n[rocket:module] Done installing npm@^3.2.0.               `)
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
         * They get concatenated together with spaces in between.
         *
         * XXX: Use child_process.spawnSync instead of shell.exec?
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
                //webpackConfig[platform].resolve.fallback.push(nodeModulesPath)

                //// additionally, add rocket:module's node_modules folder to resolveLoader.fallback
                //if (package.name === 'rocket:module') {
                    //webpackConfig[platform].resolveLoader.fallback.push(nodeModulesPath)
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
            // Filed an issue on Webpack at https://github.com/webpack/webpack/issues/1296
            let compileErrors
            let webpackCompiler = webpack(webpackConfig[platform])
            Meteor.wrapAsync(callback =>
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
        _.each(inputFiles, inputFile => {
            let { fileName, package, isopackPackageFileName, relativePackageFileName, fileSource }
                = fileInfo(inputFile)

            let batchDirBuiltFilePath = path.resolve(platformBatchDir, 'built', isopackPackageFileName)

            let builtFileSource = ''

            if (fileName.match(/shared-modules\.js$/g) && package.name === 'rocket:module') {
                // Add the Facebook regenerator runtime so that generator/yield
                // and async/await functions work in places where generators
                // aren't natively supported yet, as we're compiling
                // async/await into generator/yield form and finally in ES5
                // with Facebook's Regenerator.
                builtFileSource = "\n/*@#@#@#*/\n"+getBabelPolyfillSource()+"\n/*#%#%#%*/\n"
                function getBabelPolyfillSource() {
                    return fs.readFileSync(path.resolve(platformBatchDir, 'node_modules', 'babel-polyfill/dist/polyfill.js')).toString()
                }

                let sharedModuleSource = fs.readFileSync(
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
                    sharedModuleSource = 'RocketModule = {};\n'+sharedModuleSource
                    sharedModuleSource = sharedModuleSource.replace(/\bwindow\b/g, 'RocketModule')
                }

                builtFileSource += sharedModuleSource

                // write the resulting share-modules.js file to the OS's tmpdir
                // folder for reference/debugging.
                let getAppId = function getAppId(callback) {
                    fs.readFile(path.resolve(getAppPath(), '.meteor', '.id'), 'utf8', (err, data) => {
                        if (err) throw new Error(err)
                        let appId = data.trim().split('\n').slice(-1)[0] // the last line of the file.
                        callback(appId)
                    })
                }
                getAppId(appId => {
                    let destination = path.resolve(os.tmpdir(), `${ appId }-shared-modules.js`)
                    fs.writeFile(destination, builtFileSource, err => {
                        if (err) throw new Error(err)
                        console.log(`[rocket:module] Wrote shared-modules.js to ${ destination }.`)
                    })
                })

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

                // if the file wasn't handled by Webpack
                if (indexOfObjectWithKeyValue(modules, 'name', relativePackageFileName) < 0) {

                    // if the file ends with {client,server}.js and belongs to
                    // the current platform, or the file is not a
                    // {client,server}.js file.
                    if (fileBelongsToPlatform(platform, fileName) && !fileIsModule(fileName, rocketModuleConfig)) {

                        // give it's original source back to Meteor for Meteor to handle.
                        builtFileSource = fileSource
                        addSource()
                    }
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

        this.updateSourceHashes(inputFiles)

        let endTime = Date.now()
        let elapsed = endTime - startTime
        console.log(`[rocket:module] Done compiling for platform "${platform}". Elapsed time: ${elapsed}ms`)
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

    // the isopackName of the current file's package, or rocket_module___app
    // if the file belongs to the app.
    // Note: I was using a name like __app__ instead of rocket_module___app
    // but a name with leading underscores causes npm to crash
    // (https://github.com/npm/npm/issues/9071).
    let isopackName = package.name ? toIsopackName(package.name) : '_app'
    let npmPackageName = 'rocket_module__'+isopackName

    let npmPackageFileName = path.join(npmPackageName, fileName)
    let isopackPackageFileName = path.join(isopackName, fileName)
    let relativePackageFileName = '.' +path.sep+ 'packages' +path.sep+ npmPackageFileName

    let extension = inputResource.extension
    let fileSource = inputResource.data.toString()

    let fileSourceHash = inputFile.getSourceHash()

    let platform = unibuild.arch

    return {
        package, fileName, isopackName, npmPackageName, npmPackageFileName,
        isopackPackageFileName, relativePackageFileName, fileSource, extension,
        platform, fileSourceHash
    }
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

function isEntryPoint(fullFileName) {
    let basename = path.basename(fullFileName)
    return !!basename.match(/(^|\.)entry\.jsx?$/g)
}

// detects if a file ends with the extensions (or is entirely named)
// {server,client}.js or {server,client}.entry.js
function isClientServerFile(fullFileName) {
    let basename = path.basename(fullFileName)
    return basename.match(/(^|\.)(client|server)(\.entry)?\.jsx?$/g)
}

/**
 * Is the file a module file? Module files are files that are specifically not
 * going to be handled by Meteor's default file handling mechanism; they are
 * files intended to be imported somewhere in the import chain of an entrypoint
 * file (entry.js files).
 *
 * @param {string} fullFileName A file name relative to the package where the
 * file is found.
 * @param {object} rocketConfig The configuration from rocket-module.json.
 */
function fileIsModule(fullFileName, rocketConfig) {
    let dirname = path.dirname(fullFileName)

    // TODO: let user configure this project-wide setting. Setting it to true
    // would mean that all files are treated as modules, and never handled by
    // Meteor's normal file handling. All files would never execute unless they
    // are imported into some file anywhere in the import chain of an
    // entrypoint file.
    let enforceModules = false

    let isIgnored = fileIsIgnored(fullFileName, rocketConfig)

    return enforceModules || (!isIgnored &&  toBoolean(_.detect(dirname.split(path.sep), pathPart => pathPart.match(/modules/g))))
}

/**
 * Convert the given value to a boolean.
 */
function toBoolean(value) {
    return !!value
}

/**
 * Determines if the file should be ignored from rocket:module handling.  If
 * the file is ignored in rocket-module.json's ignore field, then file isn't a
 * module.  For now, just checks if the file contains any of the rules listed
 * in rocket-module.json in it's filename.
 *
 * TODO: Use globs (f.e. path/to/* or path/*foo/file), similar to .gitignore rules.
 */
function fileIsIgnored(fullFileName, rocketConfig) {
    let isIgnored = false

    for (let rule of rocketConfig.ignore) {
        if (fullFileName.indexOf(rule) === 0) { // if the rule matches at the beginning of the file.
            isIgnored = true
            break
        }
    }

    return isIgnored
}

function fileBelongsToPlatform(platform, fullFileName) {
    let itBelongs = false
    let basename = path.basename(fullFileName)
    let dirname = path.dirname(fullFileName)

    let side = platform.match(/^web\./g) ? 'client' : 'server'
    let otherSide = side === 'client' ? 'server' : 'client'

    if (
        basename.match(r`/(^|\.)${side}(\.entry)?\.jsx?$/g`)
        // if the file doesn't have "client" or "server" in the name,
        || !isClientServerFile(fullFileName) && (
            // and if it is in a "server"/"client" folder (the one matching the current platform)
            _.detect(dirname.split(path.sep), pathPart => pathPart.match(r`/${side}/g`))
            // or it's not in a "server"/"client" folder at all.
            || !_.detect(dirname.split(path.sep), pathPart => pathPart.match(r`/${side}/g`))
                && !_.detect(dirname.split(path.sep), pathPart => pathPart.match(r`/${otherSide}/g`))
        )
    ) {
        // then it belongs
        itBelongs = true
    }

    return itBelongs
}

// entrypoint
{
    Plugin.registerCompiler({
        // TODO: Add css, typescript, coffeescript, etc.
        extensions: [
            'js',
            //'jsx',
        ],
        filenames: [
            'npm.json',
            'rocket-module.json',
        ]
    }, x=> new RocketModuleCompiler)
}
