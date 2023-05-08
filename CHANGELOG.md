# Change Log

All notable changes to the "php-namespace-resolver" extension will be documented in this file.

## 0.0.1

- init

## 0.0.3

- fix stupid issue in 002

## 0.0.4

- fix incorrect ns for some files
- ns resolve should work with external/vendor packages now too, any issues plz open a ticket

## 0.0.5

- fix error msgs

## 0.0.7

- fix double back slash in namespace

## 0.0.9

- [fix Insert namespace before declare statements](https://github.com/ctf0/PHP-Namespace-Resolver/pull/10)

## 0.1.0

- make sure the command panel entries only shows up in php files

## 0.1.2

- fix import class before declare statements

## 0.1.3

- cleanup
- expose some functionality for other extensions to use

## 0.1.5

- support getting file namespace from just the uri
- fix giving error when file namespace if not pre-declared under `composer.json`

## 0.1.7

- fix a regression in 0.1.6

## 0.2.0

- use ts instead of js
- better api

## 0.3.0

- import all will now handle (traits, property promotions, interfaces)
- better api using php-parser
- remove class import when using expand command
- show error when importing a class that has a name being used as an alias

## 0.3.1

- fix not showing all available namespaces for selected class
- use `fs.readFile` instead of `vscode.openDocument`

## 0.4.0

- add new configs
- configs are now separated into categories, plz update your settings
- try to load php builtin namespaces dynamically & fall back to hardcoded classes when not possible
- if use statement already exists, no changes will be made
- support importing/expanding class FQN when its called with a partial FQN ex.`Rules\Password` + `use Illuminate\Validation\Rules;`
- you will get an error msg if a use statement already exists with a similar class name of what u r trying to import ex.`use Illuminate\Facade\Password;` + importing ex.`Rules\Password`

## 0.4.2

- fix not parsing of other types than class

## 0.4.3

- fix giving error when opening invalid workspace
- fix not generating namespace
- add new option `namespaceResolver.forceReplaceSimilarImports` to replace similar class import instead of keeping both (old & new)

## 0.4.4

- group menu items to submenu to save space in the context menu

## 0.4.5

- add new configs `namespaceResolver.removePath`, `namespaceResolver.useFolderTree`, `namespaceResolver.namespacePrefix`
- you we now generate namespaces based on folder hierarchy if project doesn't have a `composer.json` file & `namespaceResolver.useFolderTree` is `true`

## 0.4.7

- fix incorrect check for already imported classes with similar name

## 0.4.9

- fixes for `importAll`
- we now also check for type hints & return types for classes to import

## 0.5.1

- show output panel when phpcommand fails
