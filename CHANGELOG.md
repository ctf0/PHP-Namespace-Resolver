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
