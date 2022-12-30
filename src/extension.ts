import * as vscode from 'vscode';
import checkForNamespaces from './NamespaceCheck';
import Resolver from './Resolver';

export async function activate(context) {
    const resolver = new Resolver();
    const createDiagnosticCollection = vscode.languages.createDiagnosticCollection('PHP Namespace Resolver');

    context.subscriptions.push(
        createDiagnosticCollection,
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.import`, async () => await resolver.import()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.expand`, async () => await resolver.expand()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.sort`, async () => await resolver.sortCommand()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.importAll`, async () => await resolver.importAll()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.generateNamespace`, async () => await resolver.generateNamespace()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.checkForNamespaces`, async () => await checkForNamespaces(resolver, createDiagnosticCollection)),

        vscode.workspace.onWillSaveTextDocument(async (event) => {
            if (
                event &&
                event.document.languageId === 'php' &&
                resolver.config('sort.onSave')
            ) {
                await resolver.sortCommand();
            }
        }),
    );

    return {
        getNamespace(uri = null) {
            return resolver.generateNamespace(true, uri);
        },
        insertNamespace() {
            return resolver.generateNamespace();
        },
    };
}

export function deactivate() { }
