import {execaCommand} from 'execa'
import {findUp} from 'find-up'
import fs from 'fs-extra'
import {compare} from 'natural-orderby'
import path from 'node:path'
import * as vscode from 'vscode'
import * as Parser from './Parser'
import BUILT_IN_CLASSES_FB from './classes'

export const PKG_LABEL = 'PHP Namespace Resolver'
const COMP_JSON = 'composer.json'
const regexWordWithNamespace = new RegExp(/[a-zA-Z0-9\\]+/)
const outputChannel = vscode.window.createOutputChannel(PKG_LABEL, 'log')

export class Resolver {
    BUILT_IN_CLASSES: any = BUILT_IN_CLASSES_FB
    CLASS_AST: any
    CWD: string
    EDITOR: vscode.TextEditor
    PKG_NAME = 'namespaceResolver'
    multiImporting = false

    public constructor() {
        try {
            this.CWD = vscode.workspace.workspaceFolders![0].uri.fsPath
        } catch {
            this.CWD = ''
        }

        this.getPHPClassList()
    }

    async importCommand(selection) {
        const className = this.resolving(selection)

        if (className === undefined) {
            return this.showMessage('No class is selected.', true)
        }

        let fqcn
        let replaceClassAfterImport = false

        // ex. \Test\Test::class
        if (/^\\/.test(className)) {
            // Test\Test
            fqcn = className.replace(/^\\/, '')
            replaceClassAfterImport = true
        }
        // ex. Test\Test::class
        else if (/\w+\\/.test(className)) {
            // Test
            fqcn = className.replace(/\w+\\/g, '')
            replaceClassAfterImport = true

            const files = await this.findFiles(fqcn)
            const namespaces = await this.findNamespaces(fqcn, files)
            fqcn = await this.pickClass(namespaces.filter((item) => item.endsWith(className)))
        }
        // ex. Test::class
        else {
            const files = await this.findFiles(className)
            const namespaces = await this.findNamespaces(className, files)

            fqcn = await this.pickClass(namespaces)
        }

        return this.importClass(selection, fqcn, replaceClassAfterImport)
    }

    async importAll() {
        this.setEditorAndAST()

        const {useStatements, declarationLines} = this.getDeclarations()
        let phpClasses = this.getFileClassesAndTraits(declarationLines)

        this.multiImporting = true

        phpClasses = phpClasses.filter((phpClass) => !this.hasConflict(useStatements, phpClass) && !this.hasAliasConflict(useStatements, phpClass))

        for (const phpClass of phpClasses) {
            if (phpClass === phpClasses[phpClasses.length - 1]) {
                this.multiImporting = false
            }

            try {
                await this.importCommand(phpClass)
            } catch (error) {
                // console.error(error);
                continue
            }
        }
    }

    getFileClassesAndTraits(declarationLines) {
        const text = this.EDITOR?.document.getText()
        const _class = declarationLines.class
        let phpClasses = []

        if (_class?.extends !== null) {
            phpClasses = phpClasses.concat(_class.extends.name)
        }

        if (_class?.implements !== null) {
            phpClasses = phpClasses.concat(
                _class.implements
                    .filter((item) => item.resolution == 'uqn')
                    .map((item) => item.name),
            )
        }

        phpClasses = phpClasses.concat(...this.getFromFunctionParameters(declarationLines.class))
        phpClasses = phpClasses.concat(this.getInitializedWithNew(text))
        phpClasses = phpClasses.concat(this.getFromStaticCalls(text))
        phpClasses = phpClasses.concat(this.getFromInstanceofOperator(text))
        phpClasses = phpClasses.concat(this.getFromTypeHints(text))
        phpClasses = phpClasses.concat(this.getFromReturnType(text))
        phpClasses = phpClasses.concat(declarationLines.trait?.map((item) => item.name))

        return phpClasses.filter((item) => item)
    }

    getFromFunctionParameters(_class) {
        const methods = _class.body?.filter((item) => item.kind === 'method' && item.arguments.length)

        return methods?.map((item) => item.arguments
            .filter((arg) => arg.type.kind == 'name' && arg.type.resolution == 'uqn')
            .map((arg) => arg.type.name))
    }

    getInitializedWithNew(text) {
        const regex = /new ([A-Z][A-Za-z0-9\-_]*)/gm
        let matches: any = []
        const phpClasses: any = []

        while ((matches = regex.exec(text))) {
            phpClasses.push(matches[1])
        }

        return phpClasses
    }

    getFromStaticCalls(text) {
        const regex = /([A-Z][A-Za-z0-9\-_]*)::/gm
        let matches: any = []
        const phpClasses: any = []

        while ((matches = regex.exec(text))) {
            phpClasses.push(matches[1])
        }

        return phpClasses
    }

    getFromInstanceofOperator(text) {
        const regex = /instanceof ([A-Z_][A-Za-z0-9_]*)/gm
        let matches: any = []
        const phpClasses: any = []

        while ((matches = regex.exec(text))) {
            phpClasses.push(matches[1])
        }

        return phpClasses
    }

    getFromTypeHints(text) {
        const regex = /(?<!\$)([A-Z_][A-Za-z0-9_]*)[[<]/gm

        let matches: any = []
        const phpClasses: any = []

        while ((matches = regex.exec(text))) {
            const txt = matches[1]

            if (!this.BUILT_IN_CLASSES.includes(txt)) {
                phpClasses.push(txt)
            }
        }

        return phpClasses
    }

    getFromReturnType(text) {
        const regex = /(?<=\):( )?)([A-Z_][A-Za-z0-9_]*)/gm

        let matches: any = []
        const phpClasses: any = []

        while ((matches = regex.exec(text))) {
            const txt = matches[1]

            if (!this.BUILT_IN_CLASSES.includes(txt)) {
                phpClasses.push(txt)
            }
        }

        return phpClasses
    }

    importClass(selection, fqcn, replaceClassAfterImport = false) {
        try {
            const {useStatements, declarationLines} = this.getDeclarations()
            const classBaseName = fqcn.match(/(\w+)/g).pop()

            if (this.hasConflict(useStatements, classBaseName)) {
                if (this.multiImporting) {
                    return
                }

                return this.insertAsAlias(selection, fqcn, useStatements, declarationLines)
            }

            if (this.hasAliasConflict(useStatements, classBaseName)) {
                return this.showMessage(`class : '${classBaseName}' is used as alias.`, true)
            }

            if (replaceClassAfterImport) {
                return this.importAndReplaceOldUseStatement(selection, classBaseName, fqcn, declarationLines)
            }

            return this.insert(fqcn, declarationLines)
        } catch (error) {
            return this.showMessage(error.message, true)
        }
    }

    async insert(fqcn, declarationLines, alias = null) {
        const insertLine = this.getInsertLine(declarationLines)
        let text = `use ${fqcn}`

        if (alias) {
            text += ` as ${alias}`
        }

        await this.EDITOR?.edit((textEdit) => {
            textEdit.insert(
                new vscode.Position(insertLine, 0),
                `${text};\n`,
            )
        }, {undoStopBefore: false, undoStopAfter: false})

        if (this.config('sort.auto')) {
            this.setEditorAndAST()
            await this.sortImports()
        }

        if (!this.multiImporting) {
            return this.showMessage('$(check) The class is imported.')
        }
    }

    async insertAsAlias(selection, fqcn, useStatements, declarationLines) {
        const alias: any = await vscode.window.showInputBox({
            placeHolder: 'Enter an alias or leave it empty to replace',
        })

        if (alias === undefined) {
            return
        }

        if (alias === '') {
            return this.insertNewUseStatement(selection, fqcn, useStatements, declarationLines)
        }

        if (this.hasAliasConflict(useStatements, alias)) {
            await this.showMessage(`alias : '${alias}' is already in use.`, true)

            return this.insertAsAlias(selection, fqcn, useStatements, declarationLines)
        }

        return this.importAndReplaceOldUseStatement(selection, alias, fqcn, declarationLines, alias)
    }

    async insertNewUseStatement(selection, fqcn, useStatements, declarationLines) {
        if (useStatements.find((use) => use.text == fqcn)) {
            const classBaseName = fqcn.match(/(\w+)/g).pop()
            this.changeSelectedClass(selection, classBaseName, false)

            return this.showMessage(`'${fqcn}' already exists`, true)
        }

        const editor = this.EDITOR
        const classBaseName = fqcn.match(/(\w+)/g).pop()
        const similarImport = useStatements.find((use) => use.text.endsWith(classBaseName) || fqcn.startsWith(use.text))

        if (similarImport) {
            if (this.config('forceReplaceSimilarImports')) {
                let useCall = `use ${fqcn}`

                if (similarImport.alias) {
                    useCall = `${useCall} as ${similarImport.alias}`
                }

                return editor.edit((textEdit) => {
                    textEdit.replace(
                        editor.document.lineAt(similarImport.line).range,
                        `${useCall};`,
                    )
                }, {undoStopBefore: false, undoStopAfter: false})
            } else {
                return this.showMessage(`use statement '${similarImport.text}' already exists`, true)
            }
        }

        await editor.edit((textEdit) => {
            textEdit.replace(
                // @ts-expect-error (position != range)
                editor.document.getWordRangeAtPosition(selection.active, regexWordWithNamespace),
                classBaseName,
            )
        }, {undoStopBefore: false, undoStopAfter: false})

        await this.insert(fqcn, declarationLines)
    }

    async importAndReplaceOldUseStatement(selection: any, replacingClassName: string, fqcn: any, declarationLines: any, alias = null) {
        await this.changeSelectedClass(selection, replacingClassName, false)

        return this.insert(fqcn, declarationLines, alias)
    }

    async expandCommand(selection) {
        const resolving = this.resolving(selection)
        let className = resolving

        if (resolving === null) {
            return this.showMessage('No class is selected.', true)
        }

        if (/\w+\\/.test(resolving)) {
            className = className.replace(/\w+\\/g, '')
        }

        const files = await this.findFiles(className)
        const namespaces = await this.findNamespaces(className, files)
        const fqcn = await this.pickClass(namespaces.filter((item) => item.endsWith(resolving)))

        await this.changeSelectedClass(selection, fqcn, true)
    }

    async changeSelectedClass(selection, fqcn, prependBackslash = false) {
        const editor: any = this.EDITOR

        await editor.edit((textEdit) => {
            textEdit.replace(
                editor.document.getWordRangeAtPosition(selection.active, regexWordWithNamespace),
                (prependBackslash && this.config('leadingSeparator') ? '\\' : '') + fqcn,
            )

            const {useStatements} = this.getDeclarations()
            const useStatement = useStatements.find((item) => item.text == fqcn)

            if (useStatement) {
                textEdit.delete(new vscode.Range(
                    useStatement.line,
                    0,
                    useStatement.line + 1,
                    0,
                ))
            }
        }, {undoStopBefore: false, undoStopAfter: false})

        const newPosition = new vscode.Position(selection.active.line, selection.active.character)

        editor.selection = new vscode.Selection(newPosition, newPosition)
    }

    async sortCommand() {
        this.setEditorAndAST()

        try {
            await this.sortImports()

            await this.showMessage('$(check)  Imports are sorted.')
        } catch (error) {
            return this.showMessage(error.message, true)
        }
    }

    async findFiles(resolving) {
        return vscode.workspace.findFiles(
            `**/${resolving}.php`,
            this.config('exclude').join('|'),
        )
    }

    async findNamespaces(className, files) {
        const parsedNamespaces = this.parseNamespaces(
            await this.getTextDocuments(files, className),
            className,
        )

        if (parsedNamespaces.length === 0) {
            return this.showMessage('$(circle-slash) The class is not found.', true)
        }

        return parsedNamespaces
    }

    pickClass(namespaces) {
        return new Promise((resolve) => {
            if (namespaces.length === 1) {
                // Only one namespace found so no need to show picker.
                return resolve(namespaces[0])
            }

            vscode.window.showQuickPick(namespaces).then((picked) => {
                if (picked !== undefined) {
                    resolve(picked)
                }
            })
        })
    }

    getFileNameFromPath(file) {
        return path.parse(file).name
    }
    getFileDirFromPath(file) {
        return path.parse(file).dir
    }

    async getTextDocuments(files, resolving) {
        const textDocuments: any = []

        for (const file of files) {
            const fileName = this.getFileNameFromPath(file.path)

            if (fileName !== resolving) {
                continue
            }

            textDocuments.push(
                await fs.readFile(file.path),
            )
        }

        return textDocuments
    }

    parseNamespaces(docs, className) {
        const parsedNamespaces: any = []

        for (const doc of docs) {
            const _namespace: any = Parser.getNamespaceInfo(doc.toString())

            if (_namespace) {
                const fqcn = `${_namespace.name}\\${className}`

                if (!parsedNamespaces.includes(fqcn)) {
                    parsedNamespaces.push(fqcn)
                }
            }
        }

        // If selected text is a built-in php class add that at the beginning.
        if (this.BUILT_IN_CLASSES.includes(className)) {
            parsedNamespaces.unshift(className)
        }

        // If namespace can't be parsed but there is a file with the same
        // name of selected text then assuming it's a global class and
        // add that in the parsedNamespaces array as a global class.
        if (parsedNamespaces.length === 0 && docs.length > 0) {
            parsedNamespaces.push(className)
        }

        return parsedNamespaces
    }

    async sortImports() {
        if (this.multiImporting) {
            return
        }

        const {useStatements} = this.getDeclarations()
        const alpha = this.config('sort.alphabetically')

        if (useStatements.length <= 1) {
            throw new Error(`${PKG_LABEL}: Nothing to sort.`)
        }

        let sortFunction = (a, b) => {
            const aText = a.text
            const bText = b.text

            const aAlias = a.alias || ''
            const bAlias = b.alias || ''

            if (alpha) {
                if (aText.toLowerCase() < bText.toLowerCase()) {
                    return -1
                }

                if (aText.toLowerCase() > bText.toLowerCase()) {
                    return 1
                }

                return 0
            } else {
                if ((aText.length + aAlias.length) == (bText.length + bAlias.length)) {
                    if (aText.toLowerCase() < bText.toLowerCase()) {
                        return -1
                    }

                    if (aText.toLowerCase() > bText.toLowerCase()) {
                        return 1
                    }
                }

                return (aText.length + aAlias.length) - (bText.length + bAlias.length)
            }
        }

        if (this.config('sort.natural')) {
            const natsort = compare({
                order: alpha ? 'asc' : 'desc',
            })

            sortFunction = (a, b) => natsort(a.text, b.text)
        }

        const sorted = useStatements.slice().sort(sortFunction)

        for (let i = 0; i < sorted.length; i++) {
            await this.EDITOR?.edit((textEdit) => {
                const sortItem = sorted[i]
                const item = useStatements[i]

                let itemLength = item.text.length + 4 // 'use '

                if (item.alias) {
                    itemLength += item.alias.length + 4 // ' as '
                }

                let sortText = `use ${sortItem.text}`

                if (sortItem.alias) {
                    sortText += ` as ${sortItem.alias}`
                }

                textEdit.replace(
                    new vscode.Range(item.line, 0, item.line, itemLength),
                    sortText,
                )
            }, {undoStopBefore: false, undoStopAfter: false})
        }
    }

    setEditorAndAST() {
        const editor: any = vscode.window.activeTextEditor

        this.EDITOR = editor

        try {
            this.CLASS_AST = Parser.buildClassASTFromContent(editor.document.getText())
        } catch (error) {
            this.showMessage(error.message, true)

            throw new Error()
        }
    }

    hasConflict(useStatements: any, resolving: string) {
        for (const useStatement of useStatements) {
            if (useStatement.text.endsWith(`\\${resolving}`)) {
                return true
            }

            if (useStatement.text == resolving) {
                return true
            }
        }

        return false
    }

    hasAliasConflict(useStatements: any, resolving: string) {
        for (const useStatement of useStatements) {
            if (useStatement.alias === resolving) {
                return true
            }
        }

        return false
    }

    getDeclarations() {
        const useStatements: any = []
        const declarationLines = {
            PHPTag       : this.CLASS_AST._openTag,
            declare      : this.CLASS_AST._declare,
            namespace    : this.CLASS_AST._namespace,
            useStatement : this.CLASS_AST._use,
            class        : this.CLASS_AST._class,
            trait        : this.CLASS_AST._trait,
        }

        for (const useStatement of declarationLines.useStatement) {
            const item = useStatement.items[0]

            useStatements.push({
                text  : item.name,
                alias : item.alias?.name,
                line  : useStatement.loc.start.line - 1,
            })
        }

        return {
            useStatements,
            declarationLines,
        }
    }

    getInsertLine(declarationLines) {
        const _use = declarationLines.useStatement

        if (_use.length) {
            return _use[0].loc.start.line - 1
        }

        const _class = declarationLines.class

        if (_class) {
            return _class.loc.start.line - 1
        }

        const namespaceOrTag = declarationLines.namespace || declarationLines.PHPTag

        if (namespaceOrTag) {
            return namespaceOrTag.loc.end.line
        }
    }

    resolving(selection) {
        if (typeof selection === 'string') {
            return selection
        }

        const document: any = this.EDITOR?.document

        const wordRange = document.getWordRangeAtPosition(selection.active, regexWordWithNamespace)

        if (wordRange === undefined) {
            return undefined
        }

        return document.getText(wordRange)
    }

    async showMessage(message, error = false): Promise<string | vscode.Disposable | undefined> {
        if (this.config('showMessageOnStatusBar')) {
            return vscode.window.setStatusBarMessage(message, 3000)
        }

        message = message.replace(/\$\(.+?\)/, '').trim()

        return error
            ? vscode.window.showErrorMessage(`${PKG_LABEL}: ${message}`)
            : vscode.window.showInformationMessage(`${PKG_LABEL}: ${message}`)
    }

    /**
     * @param uri: ?vscode.Uri
     */
    async generateNamespace(returnDontInsert = false, uri?: vscode.Uri) {
        if (!returnDontInsert) {
            this.setEditorAndAST()
        }

        const editor: any = this.EDITOR
        const currentUri: vscode.Uri = uri || editor?.document.uri

        let composerFile
        let psr4
        let ns

        try {
            composerFile = await this.findComposerFileByUri(currentUri, returnDontInsert)
            psr4 = await this.getComposerFileData(composerFile, returnDontInsert)
            ns = await this.createNamespace(
                currentUri,
                {
                    psrData          : psr4,
                    composerFilePath : composerFile,
                },
                returnDontInsert,
            )
        } catch {
            if (this.config('useFolderTree')) {
                ns = this.getFileDirFromPath(currentUri.path.replace(this.CWD, ''))
                    .replace(/^\//gm, '')
                    .replace(/\//g, '\\')
            } else {
                return undefined
            }
        }

        this.config('removePath').forEach((regex) => {
            ns = ns.replace(new RegExp(regex), '')
        })

        ns = this.config('namespacePrefix') + ns

        const namespace = '\n' + 'namespace ' + ns + ';' + '\n'

        if (returnDontInsert) {
            return namespace
        }

        try {
            const {declarationLines} = this.getDeclarations()

            if (declarationLines.namespace !== null) {
                await editor.edit((textEdit) => {
                    textEdit.replace(
                        Parser.getRangeFromLoc(declarationLines.namespace.loc.start, declarationLines.namespace.loc.end),
                        namespace,
                    )
                }, {undoStopBefore: false, undoStopAfter: false})
            } else {
                let line = declarationLines.PHPTag.loc.start.line

                if (declarationLines.declare !== undefined) {
                    line = declarationLines.declare.loc.end.line
                }

                await editor.edit(
                    (textEdit) => textEdit.insert(new vscode.Position(line, 0), namespace),
                    {undoStopBefore: false, undoStopAfter: false},
                )
            }
        } catch (error) {
            await this.showMessage(error.message, true)

            return undefined
        }
    }

    async findComposerFileByUri(currentUri: vscode.Uri, ignoreError = true): Promise<string | undefined> {
        const composerFile = findUp(COMP_JSON, {cwd: currentUri.path})

        if (!composerFile) {
            if (!ignoreError) {
                await this.showMessage('No composer.json file found', true)
            }

            throw new Error()
        }

        return composerFile
    }

    async getComposerFileData(composerFile: string, ignoreError = true): Promise<any> {
        const composerJson = await fs.readJson(composerFile)
        let psr4

        try {
            psr4 = composerJson['autoload']['psr-4']
        } catch {
            if (!ignoreError) {
                await this.showMessage('No psr-4 key in composer.json autoload object', true)
            }

            throw new Error()
        }

        let devPsr4: any = undefined

        try {
            devPsr4 = composerJson['autoload-dev']['psr-4']

            if (devPsr4 !== undefined) {
                psr4 = {...psr4, ...devPsr4}
            }
        } catch {}

        return psr4
    }

    async createNamespace(currentUri: vscode.Uri, composer: { psrData?: any; composerFilePath: string; }, ignoreError = true): Promise<any> {
        const currentFilePath = currentUri?.path
        const composerFileDir = this.getFileDirFromPath(composer.composerFilePath)
        const currentFileDir = this.getFileDirFromPath(currentFilePath)
        const psr4 = composer.psrData

        let currentRelativePath: any = currentFileDir.replace(`${composerFileDir}/`, '')

        // this is a way to always match with psr-4 entries
        if (!currentRelativePath.endsWith('/')) {
            currentRelativePath += '/'
        }

        let namespaceBase: any = Object.keys(psr4).find((k) => currentRelativePath.startsWith(psr4[k]))

        if (!namespaceBase) {
            if (!ignoreError) {
                await this.showMessage('path parent directory is not found under composer.json autoload object', true)
            }

            throw new Error()
        }

        const baseDir = psr4[namespaceBase]

        if (baseDir == currentRelativePath) {
            currentRelativePath = null
        } else {
            currentRelativePath = currentRelativePath
                .replace(baseDir, '')
                .replace(/\/$/g, '')
                .replace(/\//g, '\\')
        }

        namespaceBase = namespaceBase.replace(/\\$/g, '')

        if (!namespaceBase) {
            if (!ignoreError) {
                await this.showMessage('no namespace found for current file parent directory', true)
            }

            throw new Error()
        }

        let ns: any = null
        const namespaceBaseLower = namespaceBase.toLowerCase()

        if (!currentRelativePath || currentRelativePath == namespaceBaseLower) { // dir already namespaced
            ns = namespaceBase
        } else { // add parent dir/s to base namespace
            ns = `${namespaceBase}\\${currentRelativePath}`
        }

        return ns.replace(/\\{2,}/g, '\\')
    }

    async import() {
        this.setEditorAndAST()

        for (const selection of this.EDITOR.selections) {
            await this.importCommand(selection)
        }
    }

    async expand() {
        this.setEditorAndAST()

        const selections = this.EDITOR?.selections

        if (selections) {
            for (const selection of selections) {
                await this.expandCommand(selection)
            }
        }
    }

    getPHPClassList(): Promise<any> {
        return Promise
            .all(
                this
                    .config('php.builtIns')
                    .map(async(method) => await this.runPhpCli(method)),
            )
            .then((_data) => this.BUILT_IN_CLASSES = _data.flat())
    }

    async runPhpCli(method) {
        const phpCommand = this.config('php.command')

        if (!phpCommand) {
            throw new Error('config required : "namespaceResolver.php.command"')
        }

        try {
            const {stdout} = await execaCommand(`${phpCommand} -r 'echo json_encode(${method});'`, {
                cwd   : this.CWD,
                shell : vscode.env.shell,
            })

            return JSON.parse(stdout)
        } catch (error) {
            // console.error(error);

            outputChannel.replace(error.message)
            // outputChannel.show();
        }
    }

    config(key): any {
        return vscode.workspace.getConfiguration(this.PKG_NAME).get(key)
    }
}
