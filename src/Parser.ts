import * as PhpParser from 'php-parser';
import * as vscode from 'vscode';

const Parser = new PhpParser.Engine({
    parser: {
        locations     : true,
        extractDoc    : true,
        extractTokens : true,
    },
    ast: {
        withPositions: true,
    },
});

export function buildClassASTFromContent(content: string) {
    try {
        const AST = Parser.parseCode(content, '*.php');

        const _tag: any = AST.tokens!.find((item: any) => item[0] == 'T_OPEN_TAG');
        const _declare: any = AST.children!.find((item: any) => item.kind == 'declare');
        const _namespace: any = AST.children!.find((item: any) => item.kind == 'namespace');
        const _use: any = (_namespace || AST).children!.filter((item: any) => item.kind == 'usegroup');
        const _class: any = (_namespace || AST).children!.find((item: any) => ['class', 'enum', 'interface', 'trait'].includes(item.kind));
        const _trait: any = _class!.body!.find((item: any) => item.kind == 'traituse')?.traits;

        return {
            _openTag: {
                loc: {
                    start: {
                        line   : _tag[2],
                        column : _tag[3],
                    },
                    end: {
                        line   : _tag[2],
                        column : _tag[4],
                    },
                },
            },
            _declare   : _declare,
            _namespace : _namespace ? getNamespaceLoc(_namespace, _use![0] || _class) : null,
            _class     : _class,
            _use       : _use,
            _trait     : _trait,
        };
    } catch (error) {
        console.error(error);
    }
}

export function getNamespaceInfo(content) {
    const AST = Parser.parseCode(content, '*.php');

    return AST.children?.find((item: any) => item.kind == 'namespace');
}

function getNamespaceLoc(start, end) {
    const line = end.leadingComments ? end.leadingComments[0].loc.start.line : end.loc.start.line;

    return {
        loc: {
            start : start.loc.start,
            end   : { line: line, column: 0 },
        },
    };
}

export function getRangeFromLoc(start: { line: number; column: number; }, end: { line: number; column: number; }): vscode.Range {
    return new vscode.Range(
        new vscode.Position(start.line - 1, start.column),
        new vscode.Position(end.line - 1, end.column),
    );
}
