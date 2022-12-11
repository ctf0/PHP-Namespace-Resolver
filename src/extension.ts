import * as vscode from 'vscode'
import Resolver    from './Resolver'

const PKG_NAME = 'namespaceResolver'

export async function activate(context) {
    let resolver = new Resolver()

    context.subscriptions.push(
        vscode.commands.registerCommand(`${PKG_NAME}.import`, async () => await resolver.import()),
        vscode.commands.registerCommand(`${PKG_NAME}.expand`, async () => await resolver.expand()),
        vscode.commands.registerCommand(`${PKG_NAME}.sort`, async () => await resolver.sortCommand()),
        vscode.commands.registerCommand(`${PKG_NAME}.importAll`, async () => await resolver.importAll()),
        vscode.commands.registerCommand(`${PKG_NAME}.generateNamespace`, async () => await resolver.generateNamespace())
    )

    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(async (event) => {
            if (
                event &&
                event.document.languageId === 'php' &&
                resolver.config('sortOnSave')
            ) {
                await resolver.sortCommand()
            }
        })
    )

    context.subscriptions.push(resolver)

    return {
        getNamespace(uri = null) {
            return resolver.generateNamespace(true, uri)
        },
        insertNamespace() {
            return resolver.generateNamespace()
        }
    }
}

export function deactivate() { }
