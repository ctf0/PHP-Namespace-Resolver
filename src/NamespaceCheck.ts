/**
 * copyright @ctf0 https://github.com/ctf0
 * ================================================
 * read the namespaces using `namespaceResolver.checkForNamespaces.classMapFileGlob`
 * read the php_built-in classes using `namespaceResolver.php.builtIns`
 * use regex to search for any class imports `FQN, partial FQN` project wide excluding folders we dont care about using `ripgrep`
 * filter the statements that we already know about (using the data we have from `autoload_classmap` & `php_built-in`)
 * add the unknown statements to the diagnose panel
 */

import { execa } from 'execa';
import groupBy from 'lodash.groupby';
import * as vscode from 'vscode';
import Resolver from './Resolver';

export default async function checkForNamespaces(resolver: Resolver, createDiagnosticCollection: vscode.DiagnosticCollection) {
    if (resolver.CWD) {
        vscode.window.withProgress({
            location    : vscode.ProgressLocation.Notification,
            cancellable : false,
            title       : 'Please Wait',
        }, async () => {
            try {
                const autoloadFilesData = [...await getAutoloadFileData(resolver)]
                    .map((item) => item.namespace)
                    .concat(resolver.BUILT_IN_CLASSES)
                    .flat();

                const filesWithUseStatements: any = await searchAllFilesForImports(resolver);
                const nonFoundNamespaces = findNonFoundNamespaces(
                    [...new Set(autoloadFilesData)],
                    filesWithUseStatements,
                );

                const list: any = [];

                for (const item of nonFoundNamespaces) {
                    list.push([
                        vscode.Uri.file(item.file.replace(new RegExp('^\.', 'm'), resolver.CWD)),
                        [createDiagnostic(item)],
                    ]);
                }

                createDiagnosticCollection.set(list);

                await vscode.commands.executeCommand('workbench.panel.markers.view.focus');
            } catch (error) {
                console.error(error);
            }
        });
    }
}

async function getAutoloadFileData(resolver: Resolver): Promise<any> {
    const classMapFileGlob = resolver.config('checkForNamespaces.classMapFileGlob');

    if (!classMapFileGlob) {
        throw new Error('config required : classMapFileGlob');
    }

    const files = await vscode.workspace.findFiles(classMapFileGlob, null);

    const _data: any = await Promise
        .all(
            files.map(async (file) => {
                const fPath = file.path.replace(`${resolver.CWD}/`, '');

                return Object
                    .entries(await resolver.runPhpCli(`include("${fPath}")`))
                    .map(([key, value]) => {
                        const file: any = value;

                        return {
                            namespace: key,
                            // file      : file,
                            // name      : resolver.getFileNameFromPath(file),
                        };
                    });
            }),
        );

    return _data.flat();
}

async function searchAllFilesForImports(resolver: Resolver): Promise<any> {
    const rgCommand = resolver.config('checkForNamespaces.rg.command');
    const rgExcludeDirs = resolver
        .config('checkForNamespaces.rg.excludeDirs')
        .join(',');
    const rgExcludeFiles = resolver
        .config('checkForNamespaces.rg.excludeFiles')
        .join(',');

    if (!rgCommand || !rgExcludeDirs || !rgExcludeFiles) {
        throw new Error('config required : rgCommand,excludeDirs,excludeFiles');
    }

    const args = [
        '\'((namespace|use) )?\\\\?(\\w+\\\\)+\\w+(?=[ ;:\\(])\'',
        '--mmap',
        '--pcre2',
        '--no-messages',
        '--line-number',
        '--only-matching',
        '--glob=\'**/*.php\'',
        '--glob=\'!*.blade.php\'',
        `--glob='!{${rgExcludeDirs}}'`,
        `--glob='!{${rgExcludeFiles}}'`,
        './',
    ];

    const { stdout } = await execa(rgCommand, args, {
        cwd   : resolver.CWD,
        shell : vscode.env.shell,
    });

    const uses: any = [];

    return stdout
        .split('\n')
        .filter((line) => !line.includes(':namespace '))
        .map((item) => {
            const matches: any = item.split(':');
            const _file = matches[0];
            const _import = matches[2].replace(new RegExp('^\\\\', 'm'), ''); // \App > App

            /* -------------------------------------------------------------------------- */
            if (_import.startsWith('use ') && !uses.includes(_import)) {
                uses.push({
                    file   : _file,
                    import : _import,
                    found  : 0,
                });
            }

            if (!_import.startsWith('use ')) {
                const classBaseName: any = new RegExp(/\w+(?=\\)/).exec(_import);

                if (classBaseName !== null) {
                    const found = uses.find((_use) => _use.import.endsWith(classBaseName[0]) && _use.file === _file);

                    if (found) {
                        uses.find((_use) => {
                            if (_use.file === _file) {
                                _use.found++;

                                return true;
                            }
                        });

                        return;
                    }
                }
            }
            /* -------------------------------------------------------------------------- */

            return {
                file   : _file,
                line   : parseInt(matches[1]),
                import : _import.replace('use ', ''),
            };
        })
        .map((obj: any) => {
            if (obj && uses.find((_use) => _use.file === obj.file && _use.found > 0)) {
                return;
            }

            return obj;
        })
        .filter((e) => e);
}

function findNonFoundNamespaces(appNamespaces, importsFiles) {
    importsFiles = groupBy(importsFiles, 'import');
    const list: any = [];

    for (const namespace of Object.keys(importsFiles)) {
        if (!appNamespaces.includes(namespace)) {
            list.push(importsFiles[namespace]);
        }
    }

    return list.flat();
}

function createDiagnostic(item) {
    const line = item.line - 1;
    const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, 0),
        `unknown namespace : ${item.import}`,
        vscode.DiagnosticSeverity.Warning,
    );

    diagnostic.source = 'PHP Namespace Resolver';

    return diagnostic;
}
