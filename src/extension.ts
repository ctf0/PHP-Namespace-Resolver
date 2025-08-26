import * as vscode from 'vscode'
import checkForNamespaces from './NamespaceCheck'
import {PKG_LABEL, Resolver} from './Resolver'

export async function activate(context: vscode.ExtensionContext): Promise<{
    getNamespace: (uri?: vscode.Uri) => Promise<string | undefined>
    insertNamespace: () => Promise<string | undefined>
}> {
    const resolver = new Resolver()
    const createDiagnosticCollection = vscode.languages.createDiagnosticCollection(PKG_LABEL)

    context.subscriptions.push(
        createDiagnosticCollection,
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.import`, async() => await resolver.import()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.expand`, async() => await resolver.expand()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.importAll`, async() => await resolver.importAll()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.generateNamespace`, async() => await resolver.generateNamespace()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.checkForNamespaces`, async() => await checkForNamespaces(resolver, createDiagnosticCollection)),
        // other
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.copyTypeFQCN`, async() => await resolver.copyTypeFQCN()),
        vscode.commands.registerCommand(`${resolver.PKG_NAME}.updateFileTypeByName`, async() => await resolver.updateFileTypeByName()),
    )

    return {
        getNamespace(uri?: vscode.Uri) {
            return resolver.generateNamespace(true, uri)
        },
        insertNamespace() {
            return resolver.generateNamespace()
        },
    }
}

export function deactivate(): void {}
