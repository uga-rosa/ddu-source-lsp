import { BaseSource, Context, Item } from "https://deno.land/x/ddu_vim@v2.8.6/types.ts#^";
import { Denops } from "https://deno.land/x/ddu_vim@v2.8.6/deps.ts#^";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.1/file.ts#^";
import {
  DocumentSymbol,
  Location,
  LocationLink,
  Position,
  ReferenceContext,
  SymbolInformation,
  TextDocumentIdentifier,
} from "npm:vscode-languageserver-types@3.17.3";

const VALID_METHODS = {
  "textDocument/declaration": "textDocument/declaration",
  "textDocument/definition": "textDocument/definition",
  "textDocument/typeDefinition": "textDocument/typeDefinition",
  "textDocument/implementation": "textDocument/implementation",
  "textDocument/references": "textDocument/references",
  "textDocument/documentSymbol": "textDocument/documentSymbol",
} as const satisfies Record<string, string>;

type Method = typeof VALID_METHODS[keyof typeof VALID_METHODS];

function isMethod(
  method: string,
): method is Method {
  return Object.values(VALID_METHODS).some((m) => method === m);
}

const ProviderMap = {
  "textDocument/declaration": "declarationProvider",
  "textDocument/definition": "definitionProvider",
  "textDocument/typeDefinition": "typeDefinitionProvider",
  "textDocument/implementation": "implementationProvider",
  "textDocument/references": "referencesProvider",
  "textDocument/documentSymbol": "documentSymbolProvider",
} as const satisfies Record<Method, string>;

type Provider = typeof ProviderMap[keyof typeof ProviderMap];

async function isMethodSupported(
  denops: Denops,
  method: Method,
  bufNr: number,
): Promise<boolean> {
  const serverCapabilities = await denops.call(
    `luaeval`,
    `require('ddu_nvim_lsp').get_server_capabilities(${bufNr})`,
  ) as Record<Provider, unknown>[];

  if (serverCapabilities.length === 0) {
    console.log("No server attached");
    return false;
  } else {
    const isSupported = serverCapabilities.some((serverCapability) => {
      const provider = ProviderMap[method];
      return provider in serverCapability;
    });
    if (!isSupported) {
      console.log(`${method} is not supported by any of the servers`);
    }
    return isSupported;
  }
}

interface TextDocumentPositionParams {
  /** The text document. */
  textDocument: TextDocumentIdentifier;
  /** The position inside the text document. */
  position: Position;
}

interface ReferenceParams extends TextDocumentPositionParams {
  context: ReferenceContext;
}

async function makePositionParams(
  denops: Denops,
  winId: number,
): Promise<TextDocumentPositionParams> {
  /**
   * @see :h vim.lsp.util.make_position_params()
   * Creates a `TextDocumentPositionParams` object for the current buffer and cursor position.
   * Reference: https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocumentPositionParams
   */
  return await denops.call(
    `luaeval`,
    `vim.lsp.util.make_position_params(${winId})`,
  ) as TextDocumentPositionParams;
}

async function makeTextDocumentIdentifier(
  denops: Denops,
  bufNr: number,
): Promise<TextDocumentIdentifier> {
  /**
   * @see :h vim.lsp.util.make_text_document_params()
   * Creates a `TextDocumentIdentifier` object for the current buffer.
   * Reference: https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocumentIdentifier
   */
  return await denops.call(
    `luaeval`,
    `vim.lsp.util.make_text_document_params(${bufNr})`,
  ) as TextDocumentIdentifier;
}

/** Array of results per client */
type Response = unknown[];

async function lspRequest(
  denops: Denops,
  bufnr: number,
  method: Method,
  params: unknown,
): Promise<Response | null> {
  return await denops.call(
    `luaeval`,
    `require('ddu_nvim_lsp').request(${bufnr}, '${method}', _A)`,
    params,
  ) as Response | null;
}

type Params = {
  method: string;
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
    context: Context;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams: { method }, context: { bufNr, winId } } = args;

    return new ReadableStream({
      async start(controller) {
        if (!isMethod(method)) {
          console.log(`Unknown method: ${method}`);
          controller.close();
          return;
        } else if (!(await isMethodSupported(denops, method, bufNr))) {
          controller.close();
          return;
        }

        switch (method) {
          case VALID_METHODS["textDocument/declaration"]:
          case VALID_METHODS["textDocument/definition"]:
          case VALID_METHODS["textDocument/typeDefinition"]:
          case VALID_METHODS["textDocument/implementation"]: {
            const params = await makePositionParams(denops, winId);
            const response = await lspRequest(denops, bufNr, method, params);
            if (response) {
              const items = definitionHandler(response);
              controller.enqueue(items);
            }
            break;
          }
          case VALID_METHODS["textDocument/references"]: {
            const params = await makePositionParams(denops, winId) as ReferenceParams;
            params.context = {
              includeDeclaration: true,
            };
            const response = await lspRequest(denops, bufNr, method, params);
            if (response) {
              const items = referencesHandler(response);
              controller.enqueue(items);
            }
            break;
          }
          case VALID_METHODS["textDocument/documentSymbol"]: {
            const params = {
              textDocument: await makeTextDocumentIdentifier(denops, bufNr),
            };
            const response = await lspRequest(denops, bufNr, method, params);
            if (response) {
              const items = symbolHandler(response, bufNr);
              controller.enqueue(items);
            }
            break;
          }
          default: {
            method satisfies never;
          }
        }

        controller.close();
      },
    });
  }

  params(): Params {
    return {
      method: "",
    };
  }
}

function definitionHandler(
  response: Response,
): Item<ActionData>[] {
  return response.flatMap((result) => {
    /**
     * References:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_declaration
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_definition
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_typeDefinition
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_implementation
     */
    const locations = result as Location | Location[] | LocationLink[];

    if (!Array.isArray(locations)) {
      return [locations];
    } else {
      return locations.map(toLocation);
    }
  }).filter((location) => !isDenoUriWithFragment(location))
    .map(locationToItem);
}

function referencesHandler(
  response: Response,
): Item<ActionData>[] {
  return response.flatMap((result) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_references
     */
    const locations = result as Location[];
    return locations;
  }).filter((location) => !isDenoUriWithFragment(location))
    .map(locationToItem);
}

function toLocation(loc: Location | LocationLink): Location {
  if ("uri" in loc && "range" in loc) {
    return loc;
  } else {
    return {
      uri: loc.targetUri,
      range: loc.targetSelectionRange,
    };
  }
}

function isDenoUriWithFragment(location: Location) {
  const { uri } = location;
  /**
   * Workaround. https://github.com/denoland/deno/issues/19304
   * filter deno virtual buffers with udd fragments
   * #(^|~|<|=)
   */
  return /^deno:.*%23(%5E|%7E|%3C|%3D)/.test(uri);
}

function locationToItem(
  location: Location,
): Item<ActionData> {
  const { uri, range } = location;
  const path = uriToPath(uri);
  const { line, character } = range.start;
  const [lineNr, col] = [line + 1, character + 1];
  return {
    word: path,
    display: `${path}:${lineNr}:${col}`,
    action: { path, lineNr, col },
  };
}

function uriToPath(uri: string) {
  if (uri.startsWith("file:")) {
    return new URL(uri).pathname;
  } else {
    return uri;
  }
}

function symbolHandler(
  response: Response,
  bufNr: number,
): Item<ActionData>[] {
  return response.flatMap((result) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_documentSymbol
     */
    const symbols = result as DocumentSymbol[] | SymbolInformation[];

    return symbols.map((symbol): Item<ActionData> => {
      if ("location" in symbol) {
        return {
          word: `[${symbol.kind}] ${symbol.name}`,
          action: {
            bufNr,
            lineNr: symbol.location.range.start.line + 1,
            col: symbol.location.range.start.character + 1,
          },
        };
      } else {
        return {
          word: `[${symbol.kind}] ${symbol.name}`,
          action: {
            bufNr,
            lineNr: symbol.selectionRange.start.line + 1,
            col: symbol.selectionRange.start.character + 1,
          },
        };
      }
    });
  });
}
