/**
 * @fileoverview Sets up a Meteor build plugin that compiles entrypoints into
 * bundles. The code of the entrypoints can use module syntax (f.e. ES6, CJS,
 * or AMD). Currently the plugin uses Webpack to compile entrypoints.
 *
 * TODO: Make webpack watch files for changes while in dev mode?
 */

// npm builtin modules
var path                  = Npm.require('path')
var fs                    = Npm.require('fs')
var os                    = Npm.require('os')

// npm modules
var _                     = Npm.require('lodash')
var glob                  = Npm.require('glob')
var fse                   = Npm.require('fs-extra')
var async                 = Npm.require('async')
var regexr                = Npm.require('regexr')
var mkdirp                = Npm.require('mkdirp')
var npm                   = Npm.require('npm')
var shell                 = Npm.require('shelljs')

// Meteor package imports
var webpack               = Package['rocket:webpack'].Webpack
var BuildTools            = Package['rocket:build-tools'].BuildTools

var numberOfFilesToHandle = 0
var isFirstRun            = !process.rocketModuleFirstRunComplete

var SHARED_MODULES_PLACEHOLDER = '/*_____rocket_module_____:shared-modules*/'

var {
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
    getPath
} = BuildTools

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
 * A CompileManager keeps track of code splitting for dependency sharing across
 * bundles within the same Meteor package or across Meteor packages.
 *
 * @class CompileManager
 */
function CompileManager(extentions) {
    this.handledSourceCount = 0
    this.extentions = extentions
}
_.assign(CompileManager.prototype, {

    /**
     * @param {Array.string} extentions An array of files extensions
     * determining which files the CompileManager will handle.
     */
    constructor: CompileManager,

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
            data: compileStep.read().toString(),
            sourcePath: compileStep.inputPath,
            bare: false
        })

        // keep track of this so when we run on the app side we can detect when
        // all local module.js files (those of the app and those of the app's
        // packages) have been handled.
        this.handledSourceCount += 1
        console.log('hello count:', this.handledSourceCount)
        if (isAppBuild() && getAppPath() && isFirstRun &&
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
        var batchDir
        var r = regexr

        var app = getAppPath()
        if (!app) throw new Error('batchHandler is meant to be used while the directory that `meteor` is currently running in is a Meteor application.')

        function getModuleSourceAndPlatforms(extendedPackageInfo, fileName) {
            var r = regexr

            var source
            var platforms = []

            // We know our module file sources are bare, wrapped in a closure.
            var closureBeginRegex = r`\(function \(\) {\n\n`
            var closureEndRegex = r`\n\n}\)\.call\(this\);`

            fileName = escapeRegExp(`packages/${extendedPackageInfo.name}/${fileName}`)

            for (var i = 0, len = PLATFORM_NAMES.length; i<len; i+=1) {
                compiledFilePath = path.resolve(extendedPackageInfo.isopackPath,
                    PLATFORM_NAMES[i], "packages", toIsopackName(extendedPackageInfo.name)+'.js')

                if (fs.existsSync(compiledFilePath)) {
                    compiledFileSource = fs.readFileSync(compiledFilePath).toString()

                    if (compiledFileSource.match(FILENAME_REGEX)) {

                        // We take advantage of the fact that sources are
                        // currently separated by 7 lucky new lines in isopack
                        // files.
                        let enclosedSources = compiledFileSource.split('\n\n\n\n\n\n\n')

                        for ( let j = 0, len = enclosedSources.length; j<len; j+=1) {

                            // if the target source exists in this platform file
                            if (enclosedSources[j].match(FILENAME_REGEX)[0]
                                .match(r`/${fileName}/g`)) {

                                // if the source wasn't already gotten (it's the same across platform files).
                                if (!source)
                                    source = enclosedSources[j].replace(r`^\s*${closureBeginRegex}`, '')
                                        .replace(r`${closureEndRegex}\s*$`, '')

                                platforms.push(PLATFORM_NAMES[i])
                                break // we've found the source file we're looking for
                            }
                        }
                    }
                }
            }

            return {
                source: source ? source : null,
                platforms: platforms
            }
        }

        /*
         * Choose a temporary output location that doesn't exist yet.
         */
        batchDir = path.resolve(getAppPath(), '.meteor', 'local', 'rocket-module')

        _.each(PLATFORM_NAMES, () => {
        })
        // the initial webpack configuration object.
        let webpackConfig = {
            entry: {
                // f.e.:
                //'username_packagename/one/one': './packages/username_packagename/one/one',
                //'username_packagename/two/two': './packages/username_packagename/two/two',
            },
            output: {
                path: path.resolve(batchDir, './built'),
                filename: '[name]',
            },
            plugins: [ new webpack.optimize.CommonsChunkPlugin("shared-modules.js") ],
            resolve: {
                fallback: [
                    // f.e.:
                    //path.resolve('./node_modules/username_packagename/node_modules'),
                    //path.resolve('./node_modules/username_packagename/node_modules')
                ]
            },
            module: {
                loaders: [
                    { test: /\.css$/, loader: "style!css" }
                    // TODO: get babel-loader working.
                    //,{ test: /\.js$/, loader: "babel", exclude: /node_modules/ }
                ]
            }
        }

        /*
         * Write the sources and package.json files to the batchDir to be
         * handled by Webpack.
         *
         * dependents is an array of PackageInfo
         */
        let dependents = getDependentsOf('rocket:module')
        {

            _.each(dependents, (dependent) => {
                let isopackName = toIsopackName(dependent.name)
                let packagePath = path.resolve(batchDir, 'packages', isopackName)

                mkdirp.sync(packagePath)

                // write a package.json for the current package, containing npm
                // deps, package isopack name, and version 0.0.0 (version is
                // required by npm).
                _.each(dependent.npmDependencies, (version, name) => {
                    dependent.npmDependencies[name] = '^'+version
                })
                fs.writeFileSync(path.resolve(packagePath, 'package.json'), `{
                    "name": "${isopackName}",
                    "version": "0.0.0",
                    "dependencies": ${
                        JSON.stringify(dependent.npmDependencies)
                    }
                }`)

                // Create the root package.json if it doesn't exist yet.
                let mainPackageDotJson = path.resolve(batchDir, 'package.json')
                if (!fs.existsSync(mainPackageDotJson)) {
                    fs.writeFileSync(mainPackageDotJson, `{
                        "dependencies": {}
                    }`)
                }

                // Specify the current dependent as a dependency in the root package.json
                let json = JSON.parse(fs.readFileSync(mainPackageDotJson).toString())
                json.dependencies[isopackName] = `file:./packages/${isopackName}`
                fs.writeFileSync(mainPackageDotJson, JSON.stringify(json))

                _.each(dependent.files, (file, i, files) => {
                    //Add the sources of each file into the current dependent's PackageInfo.
                    //XXX Do this in getPackageInfo instead?
                    files[i] = _.extend({
                        name: file
                    }, getModuleSourceAndPlatforms(dependent, file))

                    file = files[i]

                    if (file.name.match(/module\.js$/)) {
                        let source = file.source

                        // Write the module source to the batchDir and list it
                        // in webpackConfig's entry option.
                        let isopackFile = path.join(isopackName, file.name)
                        let filePath = path.resolve(packagePath, file.name)

                        mkdirp.sync(getPath(filePath))
                        fs.writeFileSync(filePath, source)

                        // the following path is relative to the batchDir,
                        // where webpack will be running from, so the period is
                        // needed (path.join removes the period):
                        webpackConfig.entry[isopackFile] = '.' +path.sep+ 'packages' +path.sep+ isopackFile
                    }
                })
            })

            // install all the packages and their npm dependencies in the batchDir.
            let oldCwd = process.cwd()
            process.chdir(batchDir)
            Meteor.wrapAsync(function(callback) {
                npm.load({}, callback)
            })()
            Meteor.wrapAsync(function(callback) {
                npm.commands.install([], callback)
            })()
            process.chdir(oldCwd)

            // list each node_modules folder (that was installed in the previous
            // step) in webpackConfig.
            _.each(dependents, (dependent) => {
                let isopackName = toIsopackName(dependent.name)
                let nodeModulesPath = path.resolve(batchDir, 'node_modules', isopackName, 'node_modules')
                if (fs.existsSync(nodeModulesPath))
                    webpackConfig.resolve.fallback.push(nodeModulesPath)
            })
        }

        /*
         * Run the Webpack compiler synchronously.
         */
        {
            let oldCwd = process.cwd()
            process.chdir(batchDir)

            let webpackCompiler = webpack(webpackConfig)
            let webpackResult = Meteor.wrapAsync(function(callback) {
                webpackCompiler.run(function(error, stats) {

                    // TODO: Meteor doesn't catch this error.
                    // It would be nice to put Meteor into an error state,
                    // showing this error, so the user can fix what's broken
                    // here.
                    if (error) throw new Error(error)

                    callback(error, stats)
                })
            })()

            process.chdir(oldCwd)
        }

        /*
         * Put all the compiled files back into the isopacks.
         *
         * TODO: For now we just write the shared modules to each architecture.
         * In the future there will be a separate set of shared modules for
         * each architecture.
         */
        {
            let rocketModulePath = getPackageInfo('rocket:module').isopackPath

            // if not windows
            // TODO: windows
            if (!os.platform().match(/^win/)) {
                // make rocket:module's isopack files writable.
                shell.exec(['chmod', '-R', 'u+w', rocketModulePath].join(' '))
            }

            // write the shared file to the build file of each of rocket:module's architectures.
            _.each(PLATFORM_NAMES, function(platform) {
                let platformPath = path.resolve(rocketModulePath, platform)
                let isopackName = toIsopackName('rocket:module')
                let platformBuildFile = path.resolve(platformPath, 'packages', isopackName+'.js')

                // TODO: handle cordova builds which aren't present on the app-side.
                if (fs.existsSync(platformBuildFile)) {
                    let placeholderRegex = r`${escapeRegExp(SHARED_MODULES_PLACEHOLDER)}`
                    let isopackSource = fs.readFileSync(platformBuildFile).toString()
                    let sharedModulesSource = fs.readFileSync(path.resolve(batchDir, 'built', 'shared-modules.js')).toString()

                    if (platform === 'os')
                        sharedModulesSource = sharedModulesSource.replace(/\bwindow\b/g, 'RocketModule')

                    isopackSource = isopackSource.replace(placeholderRegex, sharedModulesSource)
                    fs.writeFileSync(platformBuildFile, isopackSource)

                    // reflect the new length of the platform source file into the
                    // platform json file.
                    let platformJsonFile = platformPath + '.json'
                    let platformJson = JSON.parse(fs.readFileSync(platformJsonFile).toString())
                    let indexOfResource = _.findIndex(platformJson.resources, function(resource) {
                        return resource.file.match(r`${
                            escapeRegExp(path.join(platform, 'packages', isopackName+'.js'))
                        }`)
                    })
                    platformJson.resources[indexOfResource].length = isopackSource.length
                    fs.writeFileSync(platformJsonFile, JSON.stringify(platformJson, null, 2))
                }
            })

            // write each compiled file back into it's place in each of the
            // platform files of the isopack from where it came.
            _.each(dependents, (dependent) => {
                let isopackName = toIsopackName(dependent.name)
                let builtPath = path.resolve(batchDir, 'built', isopackName)
                let isopackPath = dependent.isopackPath

                // if not windows
                // TODO: windows
                if (!os.platform().match(/^win/)) {
                    // make the dependent's isopack files writable.
                    shell.exec(['chmod', '-R', 'u+w', isopackPath].join(' '))
                }

                // For each file of the current dependent, write the file back to
                // the dependent's isopack.
                dependent.files = _.filter(dependent.files, (file)=>{
                    return file.name.match(/module\.js$/)
                })
                _.each(dependent.files, (file)=>{
                    let compiledSource = fs.readFileSync(
                        path.resolve(builtPath, file.name)
                    ).toString()
                    console.log('\n----- package file:', path.resolve(builtPath, file.name))

                    // for each of the file's platforms
                    _.each(file.platforms, (platform)=>{

                        // add the globals from the shared-modules.js file into
                        // each entrypoint's closure, only for the 'os' platform.
                        if (platform === 'os')
                            compiledSource = "Package['underscore']._.extend(this, Package['rocket:module'].RocketModule)\n"+compiledSource

                        // get the isopack for each platform
                        let platformPath = path.resolve(isopackPath, platform)
                        let isopackSourceFile = path.resolve(platformPath, 'packages', isopackName+'.js')
                        let isopackSource = fs.readFileSync(isopackSourceFile).toString()

                        // split it by 7 new lines and put the source where it should go.
                        let enclosedSources = isopackSource.split('\n\n\n\n\n\n\n')
                        let index = _.findIndex(enclosedSources, (source)=>{
                            console.log('----- source looking for:\n', dependent.name+'/'+file.name, platform)
                            console.log('----- file looking in:\n', isopackSourceFile)

                            // will be null if the current source was is already a
                            // compiled-by-webpack source inserted in a previous
                            // iteration of the current _.each loop.
                            let meteorFilenameSection = source.match(FILENAME_REGEX)

                            if (meteorFilenameSection)
                                return meteorFilenameSection[0].match(r`/${file.name}/g`)
                        })
                        //console.log('--- index;', index)
                        enclosedSources[index] = compiledSource

                        //join by 7 new lines and write the file
                        isopackSource = enclosedSources.join('\n\n\n\n\n\n\n')
                        fs.writeFileSync(isopackSourceFile, isopackSource)

                        //update the platform json file with file length.
                        let platformJsonFile = platformPath + '.json'
                        let platformJson = JSON.parse(fs.readFileSync(platformJsonFile).toString())
                        let indexOfResource = _.findIndex(platformJson.resources, function(resource) {
                            return resource.file.match(r`${
                                escapeRegExp(path.join(platform, 'packages', isopackName+'.js'))
                            }`)
                        })
                        platformJson.resources[indexOfResource].length = isopackSource.length
                        fs.writeFileSync(platformJsonFile, JSON.stringify(platformJson, null, 2))
                    })
                })
            })
            console.log('--- done?!!!')
        }

        /*
         * Create (if it doesn't exist) a dummy file in the app that we can
         * append a comment to in order to trigger an app re-build.
         */
        //setTimeout(()=>{
            //console.log(' ------ TRIGGERED REBUILD.')
            //let r = regexr
            //let message = (`/* Silence is golden. Don't edit this file. */`)
            //let dummyFile = path.resolve(getAppPath(), 'rocket-dummy.js')
            //if (
                //!fs.existsSync(dummyFile)
                //|| !fs.readFileSync(dummyFile).toString().match(r`/^${escapeRegExp(message)}$/g`)
            //) {
                //fs.writeFileSync(dummyFile, message)
            //}
            //else {
                //// append an empty comment.
                //fs.writeFileSync(dummyFile,
                    //fs.readFileSync(dummyFile).toString() + '\n//'
                //)
            //}
        //}, 0)

        console.log('--- no rebuild.')
        //process.exit()
    }
})

/**
 * Get the index of the object in an array that has the specified key value pair.
 *
 * @param {Array.Object} array An array containing Objects.
 * @param {string} key The key to check in each Object.
 * @param {?} value The value to check the key for (absolute equality).
 * @return {number} The integer index of the first Object found that has the key value pair.
 *
 * TODO: Is there already something like this in lodash or underscore? If not, move to army-knife.
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

// entrypoint
~function() {
    if (isAppBuild() && getAppPath()) {
        //console.log(' --- dependents:', getDependentsOf('rocket:module'))
        //process.exit()

        var localIsopacksDir = path.resolve(getAppPath(), '.meteor', 'local', 'isopacks')
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
            // See the collowing comments after this conditional block to know
            // why we need to do this.
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
            // this bookkeeping once Plugin.registerCompiler is released.
            var app = getAppPath()
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

    if (isAppBuild() && getAppPath()) {
        // Add this to the `process` so we can detect first runs vs re-builds after file
        // changes.
        if (!process.rocketModuleFirstRunComplete) {
            process.rocketModuleFirstRunComplete = true
        }
    }
}()
