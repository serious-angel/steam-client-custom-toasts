#! /usr/bin/env node

/**
 * @description An experimental workaround to change the sizes of notification toasts in Steam desktop client overlay.
 * @version 2025-10-18
 *
 * @copyright /r/Steam (2025-10)
 * @license Unlicense
 * @author Serious Angel
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import util from 'node:util';
import fetch from 'node-fetch';
import WebSocket from 'ws';

// Initials
// ----------------------------------------------------------------

const _moduleUrl = import.meta.url;
const _filepath = fileURLToPath(_moduleUrl);
const _dirpath = resolve(fileURLToPath(new URL('.', _moduleUrl)));

// Constants
// ----------------------------------------------------------------

const _steamClientUrl = 'http://127.0.0.1:8080/json';
const _customDomClass = 'lovely-custom-toasts';
const _wsResponseTimeout = 10000;

const _paths = Object.freeze({
    jsChunk: 'steamui/chunk~2dcc5aaf7.js',
    cssChunk: 'steamui/css/chunk~2dcc5aaf7.css',
});

/**
 * These are the values found in the original Webpack packed JavaScript and CSS files.
 * Both the files had the chunk signature '2dcc5aaf7' (as of 2025-10-18).
 */
const _originalValues = Object.freeze({
    // Toast width.
    width: 283,

    // Achievement and general toasts.
    height1: 70,

    // The toast with note: "Press Shift+Tab to begin".
    height2: 90,

    // DesktopToastContainer: "zXrpABNQHpWKgSzqnGlL"
    domClass: 'zXrpABNQHpWKgSzqnGlL'
});

/**
 * These are the RegEx written specifically for the files with the Webpack chunk signature '2dcc5aaf7' (as of 2025-10-18).
 *
 * @note The variable names or locations may change in new transpiled and packed file versions.
 *   Therefore, please be careful on different Steam client/chunk versions,
 *   where the behavior of changes, if matched, are undefined.
 */
const _regex = Object.freeze({
    jsWidth: /(V=(?:0|[1-9][0-9]*),H=(?:0|[1-9][0-9]*),j=(?:0|[1-9][0-9]*),q=)(0|[1-9][0-9]*)(;var Q;function)/,
    jsHeights: /(;const Oe=)(0|[1-9][0-9]*)(,Ge=)(0|[1-9][0-9]*)(;function Pe)/,
    jsDomClass: /(",DesktopToastContainer:")([A-Za-z0-9_\s\-]+)(",BackgroundAnimation:")/,
    cssClass: /(\nhtml,body{.+\s*\n)(\/\* Custom \*\/ .+\n)?(\/\*\# sourceMappingURL=.+)/,
});

// Variables
// ----------------------------------------------------------------

let _cmdId = 0;

// Functions
// ----------------------------------------------------------------
// Miscellaneous
// --------------------------------

const _print = (t, ...a) => a.length ? console[([null, 'warn', 'error'][t] ?? 'log')](` [${[' ', '!', '-', '+'][t] ?? '~'}]`, ...a) : console.log('');
const _l = (...a) => _print(0, ...a);
const _w = (...a) => _print(1, ...a);
const _e = (...a) => _print(2, ...a);
const _s = (...a) => _print(3, ...a);

function _now() {
    return new Date().toISOString().replace(/[:\.]/g, '-').replace('T','_');
}

// File-system
// --------------------------------

function _readFromFile(filepath) {
    try {
        const fileData = String(readFileSync(filepath) ?? '');

        if (!fileData.length) {
            throw new Error('Empty file data.');
        }

        return fileData;
    } catch (error) {
        _e(`Failed to read file: '${filepath}'.`);

        throw error;
    }
}

function _writeToFile(filepath, data) {
    try {
        writeFileSync(filepath, data);
    } catch (error) {
        _e(`Failed to write to file: '${filepath}'.`);

        throw error;
    }
}

function _backupFile(filepath) {
    try {
        const _backupFilepath = `${filepath}.${_now()}.backup`;

        _writeToFile(_backupFilepath, _readFromFile(filepath));

        return _backupFilepath;
    } catch (error) {
        _e(`Failed to backup file: '${filepath}'.`);

        throw error;
    }
}

// WebSocket (Steam desktop client)
// --------------------------------

async function _getSteamClientData() {
    const response = await fetch(_steamClientUrl);
    const clientData = await response.json();

    if (!Object.keys(clientData ?? {}).length) {
        throw new Error('Failed to get Steam client data. Empty response.');
    }

    return clientData;
}

/**
 * @see https://github.com/SteamDeckHomebrew/decky-loader/blob/86b5567d4eac84399245c9a71270d6142ee54ded/backend/decky_loader/injector.py
 */
async function _getSteamClientDebugWSUrl()
{
    const clientData = await _getSteamClientData();
    const sharedJsContextData = clientData.find(context => context?.title === 'SharedJSContext') ?? {};

    if (!Object.keys(sharedJsContextData).length) {
        throw new Error('Could not send a command. No "SharedJSContext" is available.');
    }

    const url = String(sharedJsContextData.webSocketDebuggerUrl ?? '');

    if (!url.length) {
        throw new Error('Could not send a command. No "SharedJSContext" debug WebSocket URL is available.');
    }

    return url;
}

function _wsSendCommand(method, expression, params = {})
{
    if (!String(method ?? '').length) {
        throw new Error('No command method is provided to send.');
    }

    if (!String(expression ?? '').length) {
        throw new Error('No command expression is provided to send.');
    }

    return new Promise(async (resolve, reject) => {
        // Let's get the URI each time, just in case.
        const url = await _getSteamClientDebugWSUrl();
        const ws = new WebSocket(url);
        const id = _cmdId++;
        const responses = [];
        let timeoutId;

        ws.on('open', () => {
            // _l('[WS] [Connected]');

            const message = JSON.stringify({
                id,
                method,

                params: {
                    expression,
                    userGesture: true,
                    awaitPromise: true,
                    ...params
                }
            });

            // _l(`[WS] [Sending] CID '${id}'`, message);
            ws.send(message);

            timeoutId = setTimeout(() => {
                responses.push(new Error(`Response timed out in ${_wsResponseTimeout}ms (CID ${id}).`));
                ws.close();
            }, _wsResponseTimeout);
        });

        ws.on('message', m => {
            const response = JSON.parse(m);

            responses.push(response);

            if (response?.id !== id) {
                _w(`[WS] [Received] Ignored ID '${id}'`, response);

                return;
            }

            const exceptionDetails = response.result?.exceptionDetails;

            if (exceptionDetails) {
                responses.push(new Error(`Steam client exception in response (CID '${id}'): ${JSON.stringify(exceptionDetails, null, 2)}`));
            } else if (!Object(response.result ?? {}).hasOwnProperty('result')) {
                responses.push(new Error(`Missing result in response (CID '${id}'): ${JSON.stringify(response, null, 2)}`));
            }

            clearTimeout(timeoutId);
            ws.close();

            return;
        });

        ws.on('error', error => {
            _e('[WS] [Error]', error);
            responses.push(error);
            ws.close();
        });

        ws.on('close', () => {
            const error = responses.find(r => r instanceof Error);

            // If any response, we defined as an error, is found.
            if (error) {
                reject(error);

                return;
            }

            const response = responses.find(r => r?.id === id);

            // If the response with the required command ID exists.
            if (response) {
                resolve(response.result.result);

                return;
            }

            reject(new Error(`Missing response on WebSocket disconnection (CID ${id}): ${JSON.stringify(responses, null, 2)}.`));
        });
    });
}

// Steam desktop client
// --------------------------------

async function _evaluateScript(script) {
    if (!String(script ?? '').length) {
        throw new Error('No script is provided to evaluate.');
    }

    try {
        return await _wsSendCommand('Runtime.evaluate', script);
    } catch (error) {
        _e(`[Script] [Error]`, error);

        throw error;
    }
}

function _restartClientJsContext() {
    return _evaluateScript('SteamClient.Browser.RestartJSContext();');
}

// Project
// --------------------------------

function _processJsChunk(filepath, scaleFactor)
{
    _l(`Processing JavaScript file: '${filepath}'.`);

    let fileData = _readFromFile(filepath);

    // Change values.
    // --------------------------------

    let requiredValues = {
        width: Math.round(_originalValues.width * scaleFactor),
        height1: Math.round(_originalValues.height1 * scaleFactor),
        height2: Math.round(_originalValues.height2 * scaleFactor),

        // Here we just let the DOM class be optional (e.g removed) yet verified further ^^
        domClass: `${_originalValues.domClass}${scaleFactor !== 1 ? ` ${_customDomClass}` : ''}`
    };

    fileData = String(fileData)
        .replace(_regex.jsWidth, `\$1${requiredValues.width}\$3`)
        .replace(_regex.jsHeights, `\$1${requiredValues.height1}\$3${requiredValues.height2}\$5`)
        .replace(_regex.jsDomClass, `\$1${requiredValues.domClass}\$3`);

    // Write changes.
    // --------------------------------

    _writeToFile(filepath, fileData);

    _w(`Wrote changes to JavaScript file: '${filepath}'.`);

    // Verify the changes.
    // --------------------------------

    fileData = _readFromFile(filepath);
    const heightsMatches = _regex.jsHeights.exec(fileData);

    const values = {
        width: Number(_regex.jsWidth.exec(fileData)?.[2] || 0),
        height1: Number(heightsMatches?.[2] ?? 0),
        height2: Number(heightsMatches?.[4] ?? 0),
        domClass: String(_regex.jsDomClass.exec(fileData)?.[2] || ''),
    };

    if (!util.isDeepStrictEqual(values, requiredValues)) {
        _l({ currentValues: values, requiredValues });

        throw new Error(`Failed to process JavaScript file. The result (current values) does not match the expected.`);
    }

    _s(
        `Processed JavaScript file. Set notification toast values (x${scaleFactor}):\n`,
        // Just an attempt to have it prettier ^^
        JSON.stringify(values, null, 5).replace(/^\{/, '').replace(/\s*\n}$/, ''),
        '\n'
    );
}

function _getClassDefinition(scaleFactor)
{
    return `/* Custom */ .${_originalValues.domClass}.${_customDomClass} { transform: scale(${scaleFactor}); transform-origin: top left; }\n`;
}

function _processCssChunk(filepath, scaleFactor)
{
    _l(`Processing CSS file: '${filepath}'.`);

    let fileData = _readFromFile(filepath);

    // Change values.
    // --------------------------------

    const requiredCssClassDefinition = scaleFactor !== 1 ? _getClassDefinition(scaleFactor) : '';
    fileData = String(fileData).replace(_regex.cssClass, `\$1${requiredCssClassDefinition}\$3`);
    let cssSectionDefinition = _regex.cssClass.exec(fileData);

    if (cssSectionDefinition === null) {
        throw new Error('Failed to parse the replaced CSS class section definition. Empty RegEx result.');
    }

    // Write changes.
    // --------------------------------

    _writeToFile(filepath, fileData);

    _w(`Wrote changes to CSS file: '${filepath}'.`);

    // Verify changes.
    // --------------------------------

    fileData = _readFromFile(filepath);
    cssSectionDefinition = _regex.cssClass.exec(fileData);
    const cssClassDefinition = String(cssSectionDefinition[2] ?? '');

    if (scaleFactor !== 1 && !cssClassDefinition?.length) {
        throw new Error(`Failed to process CSS file. No CSS class definition found.`);
    }

    if (cssClassDefinition !== requiredCssClassDefinition) {
        throw new Error(`Failed to process JavaScript file. The read toast values do not match the expected.`);
    }

    _s(`Processed CSS file${scaleFactor !== 1 ? `:\n\n     '${cssClassDefinition.trim()}'\n` : '. CSS reset.'}`);
}

// Main
// ----------------------------------------------------------------

async function _main(argv)
{
    util.inspect.defaultOptions.depth = null;

    let [ steamDirpath, scaleFactor, restartClient ] = argv;

    if (!steamDirpath?.length) {
        throw new Error('No Steam directory path is provided.');
    }

    if (steamDirpath === '--help') {
        _l();
        _l('Usage: <directory> [scale] [--restart]');
        _l();

        return 0;
    }

    scaleFactor = String(scaleFactor || '');

    if (scaleFactor.length && !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(scaleFactor || '')) {
        throw new Error(`Invalid scale value (expected an integer/float): '${scaleFactor}'.`);
    }

    scaleFactor = Number(scaleFactor || 1);

    if (scaleFactor < 1) {
        throw new Error('Invalid scale factor. The factor must be equal or higher than 1.');
    }

    if (!existsSync(steamDirpath) || !lstatSync(steamDirpath).isDirectory() ) {
        throw new Error(`Invalid Steam directory path: '${steamDirpath}'.`);
    };

    restartClient = restartClient === '--restart';

    // --------------------------------

    process.chdir(steamDirpath);
    _l();

    // JavaScript

    const jsFilepath = resolve(`${process.cwd()}/${_paths.jsChunk}`);

    _backupFile(jsFilepath);
    _processJsChunk(jsFilepath, scaleFactor);

    // CSS

    const cssFilepath = resolve(`${process.cwd()}/${_paths.cssChunk}`);

    _backupFile(cssFilepath);
    _processCssChunk(cssFilepath, scaleFactor);

    // ----------------

    if (restartClient) {
        // _l(await _evaluateScript(`(async () => { return await new Promise(r => setTimeout(() => r('Neat! ^^'), 0.1234)); 'Test'; })();`));
        _l('Restarting Steam desktop client.');
        await _restartClientJsContext();
    } else {
        _l('Skipped restarting Steam desktop client (option `--restart`).');
    }

    _s('At voila!');
    _l();

    return 0;
}

_main(process.argv.slice(2)).then(process.exit);