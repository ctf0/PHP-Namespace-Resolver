import { findUp } from 'find-up';
import fs from 'fs-extra';
import naturalSort from 'node-natural-sort';
import path from 'node:path';
import * as vscode from 'vscode';
import BUILT_IN_CLASSES from './classes';
import * as Parser from './Parser';

const COMP_JSON = 'composer.json';
const regexWordWithNamespace = new RegExp(/[a-zA-Z0-9\\]+/);

export default class Resolver {
    CLASS_AST: any;
    EDITOR: vscode.TextEditor;

    async importCommand(selection) {
        const className = this.resolving(selection);

        if (className === undefined) {
            return this.showErrorMessage('No class is selected.');
        }

        let fqcn;
        let replaceClassAfterImport = false;

        if (/\\/.test(className)) {
            fqcn = className.replace(/^\\?/, '');
            replaceClassAfterImport = true;
        } else {
            const files = await this.findFiles(className);
            const namespaces = await this.findNamespaces(className, files);

            fqcn = await this.pickClass(namespaces);
        }

        this.importClass(selection, fqcn, replaceClassAfterImport);
    }

    async importAll() {
        this.setEditorAndAST();

        const [useStatements, declarationLines] = this.getDeclarations();
        const phpClasses = this.getFileClassesAndTraits(declarationLines);

        for (const phpClass of phpClasses) {
            if (!this.hasConflict(useStatements, phpClasses) && !this.hasAliasConflict(useStatements, phpClasses)) {
                await this.importCommand(phpClass);
            }
        }
    }

    getFileClassesAndTraits(declarationLines) {
        const text = this.EDITOR?.document.getText();
        const _class = declarationLines.class;
        let phpClasses = [];

        if (_class?.extends !== null) {
            phpClasses = phpClasses.concat(_class.extends.name);
        }

        if (_class?.implements !== null) {
            phpClasses = phpClasses.concat(
                _class.implements
                    .filter((item) => item.resolution == "uqn")
                    .map((item) => item.name),
            );
        }

        phpClasses = phpClasses.concat(...this.getFromFunctionParameters(declarationLines.class));
        phpClasses = phpClasses.concat(this.getInitializedWithNew(text));
        phpClasses = phpClasses.concat(this.getFromStaticCalls(text));
        phpClasses = phpClasses.concat(this.getFromInstanceofOperator(text));
        phpClasses = phpClasses.concat(declarationLines.trait?.map((item) => item.name));

        return phpClasses.filter((item) => item);
    }

    getFromFunctionParameters(_class) {
        const methods = _class.body?.filter((item) => item.kind === 'method' && item.arguments.length);

        return methods?.map((item) => item.arguments
            .filter((arg) => arg.type.kind == 'name' && arg.type.resolution == "uqn")
            .map((arg) => arg.type.name));
    }

    getInitializedWithNew(text) {
        const regex = /new ([A-Z][A-Za-z0-9\-_]*)/gm;
        let matches: any = [];
        const phpClasses: any = [];

        while (matches = regex.exec(text)) {
            phpClasses.push(matches[1]);
        }

        return phpClasses;
    }

    getFromStaticCalls(text) {
        const regex = /([A-Z][A-Za-z0-9\-_]*)::/gm;
        let matches: any = [];
        const phpClasses: any = [];

        while (matches = regex.exec(text)) {
            phpClasses.push(matches[1]);
        }

        return phpClasses;
    }

    getFromInstanceofOperator(text) {
        const regex = /instanceof ([A-Z_][A-Za-z0-9_]*)/gm;
        let matches: any = [];
        const phpClasses: any = [];

        while (matches = regex.exec(text)) {
            phpClasses.push(matches[1]);
        }

        return phpClasses;
    }

    getImportedPhpClasses(text) {
        const regex = /use (.*);/gm;
        let matches: any = [];
        const importedPhpClasses: any = [];

        while (matches = regex.exec(text)) {
            const className = matches[1].split('\\').pop();

            importedPhpClasses.push(className);
        }

        return importedPhpClasses;
    }

    importClass(selection, fqcn, replaceClassAfterImport = false) {
        try {
            const [useStatements, declarationLines] = this.getDeclarations();
            const classBaseName = fqcn.match(/(\w+)/g).pop();

            if (this.hasConflict(useStatements, classBaseName)) {
                return this.insertAsAlias(selection, fqcn, useStatements, declarationLines);
            }

            if (this.hasAliasConflict(useStatements, classBaseName)) {
                return this.showErrorMessage(`class : '${classBaseName}' is used as alias.`);
            }

            if (replaceClassAfterImport) {
                return this.importAndReplaceSelectedClass(selection, classBaseName, fqcn, declarationLines);
            }

            return this.insert(fqcn, declarationLines);
        } catch (error) {
            return this.showErrorMessage(error.message);
        }
    }

    async insert(fqcn, declarationLines, alias = null) {
        const insertLine = this.getInsertLine(declarationLines);
        let text = `use ${fqcn}`;

        if (alias) {
            text += ` as ${alias}`;
        }

        await this.EDITOR?.edit((textEdit) => {
            textEdit.insert(
                new vscode.Position(insertLine, 0),
                `${text};\n`,
            );
        });

        if (this.config('autoSort')) {
            this.setEditorAndAST();
            await this.sortImports();
        }

        this.showMessage('$(check) The class is imported.');
    }

    async insertAsAlias(selection, fqcn, useStatements, declarationLines) {
        const alias: any = await vscode.window.showInputBox({
            placeHolder: 'Enter an alias or leave it empty to replace',
        });

        if (alias === undefined) {
            return;
        }

        if (alias !== '') {
            if (this.hasAliasConflict(useStatements, alias)) {
                this.showErrorMessage(`alias : '${alias}' is already in use.`);

                return this.insertAsAlias(selection, fqcn, useStatements, declarationLines);
            }

            return this.importAndReplaceSelectedClass(selection, alias, fqcn, declarationLines, alias);
        } else {
            return this.replaceUseStatement(fqcn, useStatements);
        }
    }

    async replaceUseStatement(fqcn, useStatements) {
        const useStatement = useStatements.find((use) => fqcn == use.text);

        await this.EDITOR?.edit((textEdit) => {
            textEdit.replace(
                new vscode.Range(useStatement.line, 0, useStatement.line, useStatement.text.length + 4),
                `use ${fqcn}`,
            );
        });

        if (this.config('autoSort')) {
            await this.sortImports();
        }
    }

    async importAndReplaceSelectedClass(selection: any, replacingClassName: string, fqcn: any, declarationLines: any, alias = null) {
        await this.changeSelectedClass(selection, replacingClassName, false);

        this.insert(fqcn, declarationLines, alias);
    }

    async expandCommand(selection) {
        const resolving = this.resolving(selection);

        if (resolving === null) {
            return this.showErrorMessage('No class is selected.');
        }

        const files = await this.findFiles(resolving);
        const namespaces = await this.findNamespaces(resolving, files);
        const fqcn = await this.pickClass(namespaces);

        this.changeSelectedClass(selection, fqcn, true);
    }

    async changeSelectedClass(selection, fqcn, prependBackslash = false) {
        const editor: any = this.EDITOR;

        await editor.edit((textEdit) => {
            const [useStatements] = this.getDeclarations();
            const useStatement = useStatements.find((item) => item.text == fqcn);

            textEdit.replace(
                editor.document.getWordRangeAtPosition(selection.active, regexWordWithNamespace),
                (prependBackslash && this.config('leadingSeparator') ? '\\' : '') + fqcn,
            );

            textEdit.delete(new vscode.Range(
                useStatement.line,
                0,
                useStatement.line + 1,
                0,
            ));
        });

        const newPosition = new vscode.Position(selection.active.line, selection.active.character);

        editor.selection = new vscode.Selection(newPosition, newPosition);
    }

    async sortCommand() {
        this.setEditorAndAST();

        try {
            await this.sortImports();
        } catch (error) {
            return this.showErrorMessage(error.message);
        }

        this.showMessage('$(check)  Imports are sorted.');
    }

    async findFiles(resolving) {
        return vscode.workspace.findFiles(
            `**/${resolving}.php`,
            this.config('exclude'),
        );
    }

    async findNamespaces(className, files) {
        const parsedNamespaces = this.parseNamespaces(
            await this.getTextDocuments(files, className),
            className,
        );

        if (parsedNamespaces.length === 0) {
            return this.showErrorMessage('$(circle-slash) The class is not found.');
        }

        return parsedNamespaces;
    }

    pickClass(namespaces) {
        return new Promise((resolve) => {
            if (namespaces.length === 1) {
                // Only one namespace found so no need to show picker.
                return resolve(namespaces[0]);
            }

            vscode.window.showQuickPick(namespaces).then((picked) => {
                if (picked !== undefined) {
                    resolve(picked);
                }
            });
        });
    }

    async getTextDocuments(files, resolving) {
        const textDocuments: any = [];

        for (const file of files) {
            const fileName = path.parse(file.path).name;

            if (fileName !== resolving) {
                continue;
            }

            textDocuments.push(
                await vscode.workspace.openTextDocument(file),
            );
        }

        return textDocuments;
    }

    parseNamespaces(docs, className) {
        const parsedNamespaces: any = [];

        for (const doc of docs) {
            const _namespace: any = Parser.getNamespaceInfo(doc.getText());

            if (_namespace) {
                const fqcn = `${_namespace.name}\\${className}`;

                if (!parsedNamespaces.includes(fqcn)) {
                    parsedNamespaces.push(fqcn);
                    break;
                }
            }
        }

        // If selected text is a built-in php class add that at the beginning.
        if (BUILT_IN_CLASSES.includes(className)) {
            parsedNamespaces.unshift(className);
        }

        // If namespace can't be parsed but there is a file with the same
        // name of selected text then assuming it's a global class and
        // add that in the parsedNamespaces array as a global class.
        if (parsedNamespaces.length === 0 && docs.length > 0) {
            parsedNamespaces.push(className);
        }

        return parsedNamespaces;
    }

    async sortImports() {
        const [useStatements] = this.getDeclarations();

        if (useStatements.length <= 1) {
            throw new Error('PHP Namespace Resolver: Nothing to sort.');
        }

        let sortFunction = (a, b) => {
            const aText = a.text;
            const bText = b.text;

            const aAlias = a.alias || '';
            const bAlias = b.alias || '';

            if (this.config('sortAlphabetically')) {
                if (aText.toLowerCase() < bText.toLowerCase()) return -1;
                if (aText.toLowerCase() > bText.toLowerCase()) return 1;

                return 0;
            } else {
                if ((aText.length + aAlias.length) == (bText.length + bAlias.length)) {
                    if (aText.toLowerCase() < bText.toLowerCase()) return -1;
                    if (aText.toLowerCase() > bText.toLowerCase()) return 1;
                }

                return (aText.length + aAlias.length) - (bText.length + bAlias.length);
            }
        };

        if (this.config('sortNatural')) {
            const natsort = naturalSort({
                caseSensitive : true,
                order         : this.config('sortAlphabetically') ? 'ASC' : 'DESC',
            });

            sortFunction = (a, b) => natsort(a.text, b.text);
        }

        const sorted = useStatements.slice().sort(sortFunction);

        for (let i = 0; i < sorted.length; i++) {
            await this.EDITOR?.edit((textEdit) => {
                const sortItem = sorted[i];
                const item = useStatements[i];

                let itemLength = item.text.length + 4; // 'use '

                if (item.alias) {
                    itemLength += item.alias.length + 4; // ' as '
                }

                let sortText = `use ${sortItem.text}`;

                if (sortItem.alias) {
                    sortText += ` as ${sortItem.alias}`;
                }

                textEdit.replace(new vscode.Range(item.line, 0, item.line, itemLength), sortText);
            }, { undoStopBefore: false, undoStopAfter: false });
        }

    }

    setEditorAndAST() {
        const editor: any = vscode.window.activeTextEditor;

        this.EDITOR = editor;
        this.CLASS_AST = Parser.buildClassASTFromContent(editor.document.getText());
    }

    hasConflict(useStatements, resolving) {
        for (const useStatement of useStatements) {
            if (useStatement.text.endsWith(resolving)) {
                return true;
            }
        }

        return false;
    }

    hasAliasConflict(useStatements, resolving) {
        for (const useStatement of useStatements) {
            if (useStatement.alias === resolving) {
                return true;
            }
        }

        return false;
    }

    getDeclarations() {
        const useStatements: any = [];
        // @ts-ignore
        const declarationLines: declarationLines = {
            PHPTag       : this.CLASS_AST._openTag,
            declare      : this.CLASS_AST._declare,
            namespace    : this.CLASS_AST._namespace,
            useStatement : this.CLASS_AST._use,
            class        : this.CLASS_AST._class,
            trait        : this.CLASS_AST._trait,
        };

        for (const useStatement of declarationLines.useStatement) {
            const item = useStatement.items[0];

            useStatements.push({
                text  : item.name,
                alias : item.alias?.name,
                line  : useStatement.loc.start.line - 1,
            });
        }

        return [useStatements, declarationLines];
    }

    getInsertLine(declarationLines) {
        const _use = declarationLines.useStatement;

        if (_use) {
            return _use[0].loc.start.line - 1;
        }

        const _class = declarationLines.class;

        if (_class) {
            return _class.loc.start.line - 1;
        }

        const namespaceOrTag = declarationLines.namespace || declarationLines.PHPTag;

        if (namespaceOrTag) {
            return namespaceOrTag.loc.end.line;
        }
    }

    resolving(selection) {
        if (typeof selection === "string") {
            return selection;
        }

        const document: any = this.EDITOR?.document;

        const wordRange = document.getWordRangeAtPosition(selection.active, regexWordWithNamespace);

        if (wordRange === undefined) {
            return undefined;
        }

        return document.getText(wordRange);
    }

    showMessage(message, error = false) {
        if (this.config('showMessageOnStatusBar')) {
            return vscode.window.setStatusBarMessage(message, 3000);
        }

        message = message.replace(/\$\(.+?\)\s\s/, '');

        return error
            ? vscode.window.showErrorMessage(`PHP Namespace Resolver: ${message}`)
            : vscode.window.showInformationMessage(`PHP Namespace Resolver: ${message}`);
    }

    showErrorMessage(message) {
        return this.showMessage(message, true);
    }

    async generateNamespace(returnDontInsert = false, uri = null) {
        if (!returnDontInsert) {
            this.setEditorAndAST();
        }

        const editor: any = this.EDITOR;
        const currentUri = uri || editor?.document.uri;
        const currentFilePath = currentUri?.path;

        if (!currentFilePath) {
            this.showErrorMessage('No file path found');

            return undefined;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentUri)?.uri.fsPath;
        const currentFileDir = path.parse(currentFilePath).dir;

        // try to retrieve composer file by searching recursively into parent folders of the current file
        const composerFile = await findUp(COMP_JSON, { cwd: currentFilePath });

        if (!composerFile) {
            this.showErrorMessage('No composer.json file found');

            return undefined;
        }

        const composerJson = await fs.readJson(composerFile);
        let psr4;

        try {
            psr4 = composerJson['autoload']['psr-4'];
        } catch (error) {
            this.showErrorMessage('No psr-4 key in composer.json autoload object');

            return undefined;
        }

        let devPsr4: any = undefined;

        try {devPsr4 = composerJson['autoload-dev']['psr-4'];} catch (error) { }

        if (devPsr4 !== undefined) {
            psr4 = { ...psr4, ...devPsr4 };
        }

        let currentRelativePath: any = currentFileDir.replace(`${workspaceFolder}/`, '');

        // this is a way to always match with psr-4 entries
        if (!currentRelativePath.endsWith('/')) {
            currentRelativePath += '/';
        }

        let namespaceBase: any = Object.keys(psr4).find((k) => currentRelativePath.startsWith(psr4[k]));

        if (!namespaceBase) {
            this.showErrorMessage('path parent directory not found under composer.json autoload object');

            return undefined;
        }

        const baseDir = psr4[namespaceBase];

        if (baseDir == currentRelativePath) {
            currentRelativePath = null;
        } else {
            currentRelativePath = currentRelativePath
                .replace(baseDir, '')
                .replace(/\/$/g, '')
                .replace(/\//g, '\\');
        }

        namespaceBase = namespaceBase.replace(/\\$/g, '');

        if (!namespaceBase) {
            if (!returnDontInsert) {
                this.showErrorMessage('no namespace found for current file parent directory');
            }

            return undefined;
        }

        let ns: any = null;
        const lower = namespaceBase.toLowerCase();

        if (!currentRelativePath || currentRelativePath == lower) { // dir already namespaced
            ns = namespaceBase;
        } else { // add parent dir/s to base namespace
            ns = `${namespaceBase}\\${currentRelativePath}`;
        }

        ns = ns.replace(/\\{2,}/g, '\\');

        const namespace = '\n' + 'namespace ' + ns + ';' + '\n\n';

        if (returnDontInsert) {
            return namespace;
        }

        let declarationLines: any = {};

        try {
            [, declarationLines] = this.getDeclarations();
        } catch (error) {
            this.showErrorMessage(error.message);

            return undefined;
        }

        if (declarationLines.namespace !== null) {
            await this.EDITOR?.edit((textEdit) => {
                textEdit.replace(
                    Parser.getRangeFromLoc(declarationLines.namespace.loc.start, declarationLines.namespace.loc.end),
                    namespace,
                );
            });
        } else {
            let line = declarationLines.PHPTag.loc.start.line;

            if (declarationLines.declare !== undefined) {
                line = declarationLines.declare.loc.end.line;
            }

            await this.EDITOR?.edit((textEdit) => textEdit.insert(new vscode.Position(line, 0), namespace));
        }
    }

    async import() {
        this.setEditorAndAST();

        for (const selection of this.EDITOR.selections) {
            await this.importCommand(selection);
        }
    }

    async expand() {
        this.setEditorAndAST();

        const selections = this.EDITOR?.selections;

        if (selections) {
            for (const selection of selections) {
                await this.expandCommand(selection);
            }
        }
    }

    config(key): any {
        return vscode.workspace.getConfiguration('namespaceResolver').get(key);
    }
}
