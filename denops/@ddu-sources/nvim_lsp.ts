import {
  BaseSource,
  Context,
  Item,
} from "https://deno.land/x/ddu_vim@v2.8.6/types.ts#^";
import { Denops } from "https://deno.land/x/ddu_vim@v2.8.6/deps.ts#^";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.1/file.ts#^";
import { Location, LocationLink } from "npm:vscode-languageserver-types@3.17.3";

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

function locationToItem(location: Location): Item<ActionData> {
  const { uri, range } = location;
  const path = uri.startsWith("file:") ? new URL(uri).pathname : uri;
  const { line, character } = range.start;
  const [lineNr, col] = [line + 1, character + 1];
  return {
    word: path,
    display: `${path}:${lineNr}:${col}`,
    action: { path, lineNr, col },
  };
}

function isDenoUriWithFragment(location: Location) {
  const { uri } = location;
  /**
   * NOTE: Workaround
   * filter deno virtual buffers with udd fragments
   * #(^|~|<|=)
   */
  return /^deno:.*%23(%5E|%7E|%3C|%3D)/.test(uri);
}

type Params = {
  method: string;
};

const SUPPORTED_METHODS = [
  "textDocument/definition",
  "textDocument/declaration",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
];

export class Source extends BaseSource<Params> {
  kind = "file";
  gather(args: {
    denops: Denops;
    sourceParams: Params;
    context: Context;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams: { method }, context } = args;

    return new ReadableStream({
      async start(controller) {
        if (!SUPPORTED_METHODS.includes(method)) {
          console.log(`Unsupported method: ${method}`);
          controller.close();
          return;
        }

        const response = await denops.eval(
          `luaeval("require'ddu_nvim_lsp'['${method}'](${context.bufNr}, ${context.winId})")`,
        ) as { clientId: number; result: unknown }[] | null;

        if (response === null) {
          controller.close();
          return;
        }

        switch (method) {
          case "textDocument/declaration":
          case "textDocument/definition":
          case "textDocument/typeDefinition":
          case "textDocument/implementation": {
            const locationClientIdPairs: {
              location: Location;
              clientId: number;
            }[] = [];

            const locations = response.flatMap(({ result, clientId }) => {
              /**
               * response.result: Location | Location[] | LocationLink[]
               * References:
               * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_declaration
               * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_definition
               * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_typeDefinition
               * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_implementation
               */
              const locations = (Array.isArray(result) ? result : [result]) as
                | Location[]
                | LocationLink[];

              return locations.map((loc) => {
                const location = toLocation(loc);
                locationClientIdPairs.push({ location, clientId });
                return location;
              });
            }).filter((location) => {
              return !isDenoUriWithFragment(location);
            });

            if (locations.length === 1) {
              // Jump directly when there is only one candidate.
              const pairs = locationClientIdPairs
                .find(({ location }) => locations[0] === location);
              const clientId = pairs?.clientId as number;
              await denops.eval(
                `luaeval("require'ddu_nvim_lsp'.jump(_A.location, _A.clientId)", l:)`,
                { location: locations[0], clientId },
              );
            } else {
              const items = locations.map(locationToItem);
              controller.enqueue(items);
            }

            break;
          }
          case "textDocument/references": {
            const items = response.flatMap(({ result }) => {
              /**
               * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_references
               */
              const locations = result as Location[];
              return locations;
            }).filter((location) => !isDenoUriWithFragment(location))
              .map(locationToItem);
            controller.enqueue(items);

            break;
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
