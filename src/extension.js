let vscode   = require('vscode')
let Resolver = require('./Resolver')

function activate(context) {
    let resolver = new Resolver()

    context.subscriptions.push(
        vscode.commands.registerCommand('namespaceResolver.import', async () => await resolver.import()),
        vscode.commands.registerCommand('namespaceResolver.expand', async () => await resolver.expand()),
        vscode.commands.registerCommand('namespaceResolver.sort', async () => await resolver.sortCommand()),
        vscode.commands.registerCommand('namespaceResolver.importAll', async () => await resolver.importAll()),
        vscode.commands.registerCommand('namespaceResolver.generateNamespace', async () => await resolver.generateNamespace())
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

exports.activate = activate
