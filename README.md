# PHP Namespace Resolver

based on https://github.com/MehediDracula/PHP-Namespace-Resolver which seems abandoned

## Changes

- apply pending PRs
- remove `Highlight` cmnds and settings as most of the time they aren't accurate
- generate name space should work correctly for both root & sub dirs, if u have issues plz open a ticket.
- expose an API for other extensions to use
- check for namespaces project wide
- check [CHANGELOG](./CHANGELOG.md)

### \# API

[Read More](https://code.visualstudio.com/api/references/vscode-api#extensions)

```js
const nsResolverExtension = vscode.extensions.getExtension('ctf0.php-namespace-resolver');

if (nsResolverExtension == null) {
    throw new Error("'ctf0.php-namespace-resolver' is required");
}

const NS_EXTENSION_PROVIDER = await nsResolverExtension.activate();

// now u can use it like so

NS_EXTENSION_PROVIDER.getNamespace(vscode.window.activeTextEditor.document.uri) // get namespace by file uri
NS_EXTENSION_PROVIDER.insertNamespace() // insert namespace in current active file
```

### \# Check for namespaces project wide

- make sure to run `composer dump` first & fix any reported issues.
- run `PHP Namespace Resolver: Check for namespaces project wide`
    - note that commented out FQN will show up in the problems panel as well, the cmnd lists all the namespaces that are unknown regardless of its position
    - also you might get positive-negative results because of nested namespaces, which will need more work to check if the namespace correspond to an actual file path or not
