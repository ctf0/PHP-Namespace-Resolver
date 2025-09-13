import * as PhpParser from 'php-parser'
import * as vscode from 'vscode'

const Parser = new PhpParser.Engine({
    parser : {
        locations      : true,
        extractDoc     : true,
        extractTokens  : true,
        suppressErrors : true,
    },
    ast : {
        withPositions : true,
    },
})

export function buildClassASTFromContent(content: string): any {
    try {
        const AST = Parser.parseCode(content, '*.php')

        const _tag: any = AST.tokens!.find((item: any) => item[0] == 'T_OPEN_TAG')
        const _declare: any = AST.children!.find((item: any) => item.kind == 'declare')
        const _namespace: any = AST.children!.find((item: any) => item.kind == 'namespace')
        const _use: any = (_namespace || AST).children!.filter((item: any) => item.kind == 'usegroup')
        const _class: any = (_namespace || AST).children!.find((item: any) => ['class', 'enum', 'interface', 'trait'].includes(item.kind))
        const _trait: any = _class ? _class.body!.find((item: any) => item.kind == 'traituse')?.traits : {}

        return {
            _openTag : {
                loc : {
                    start : {
                        line   : _tag[2],
                        column : _tag[3],
                    },
                    end : {
                        line   : _tag[2],
                        column : _tag[4],
                    },
                },
            },
            _declare   : _declare,
            _namespace : _namespace ? getCorrectLoc(_namespace) : null,
            _class     : _class ? getCorrectLoc(_class) : null,
            _use       : _use,
            _trait     : _trait,
        }
    } catch (error) {
        // console.error(error);
        throw new Error(error)
    }
}

export function getNamespaceInfo(content: string) {
    const AST = Parser.parseCode(content, '*.php')

    return AST.children?.find((item: any) => item.kind == 'namespace')
}

function getCorrectLoc(item: any) {
    let commentOrAttrGroup = undefined
    const comments = item.leadingComments?.at(0)
    const attrs = item.attrGroups?.at(0)

    if (item.leadingComments && item.attrGroups) {
        commentOrAttrGroup = comments.loc.start.line < attrs.loc.start.line
            ? comments.loc.start.line
            : attrs.loc.start.line
    } else if (item.leadingComments) {
        commentOrAttrGroup = comments.loc.start.line
    } else if (item.attrGroups) {
        commentOrAttrGroup = attrs.loc.start.line
    }

    return {
        ...item,
        loc : {
            start : {line: (commentOrAttrGroup || item.loc.start.line) - 1, column: 0},
            end   : item.loc.end,
        },
    }
}

export function getRangeFromLoc(start: {line: number, column: number}, end: {line: number, column: number}): vscode.Range {
    return new vscode.Range(
        new vscode.Position(start.line - 1, start.column),
        new vscode.Position(end.line - 1, end.column),
    )
}
