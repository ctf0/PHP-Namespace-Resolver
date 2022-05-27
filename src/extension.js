let vscode   = require('vscode')
let Resolver = require('./Resolver')

function activate(context) {
    let resolver = new Resolver()

    context.subscriptions.push(
        vscode.commands.registerCommand('namespaceResolver.import', () => resolver.import()),
        vscode.commands.registerCommand('namespaceResolver.expand', () => resolver.expand()),
        vscode.commands.registerCommand('namespaceResolver.sort', () => resolver.sortCommand()),
        vscode.commands.registerCommand('namespaceResolver.importAll', () => resolver.importAll()),
        vscode.commands.registerCommand('namespaceResolver.generateNamespace', () => resolver.generateNamespace())
    )

    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument((event) => {
            if (
                event &&
            event.document.languageId === 'php' &&
            resolver.config('sortOnSave')
            ) {
                resolver.sortCommand()
            }
        })
    )

    context.subscriptions.push(resolver)
}

exports.activate = activate
