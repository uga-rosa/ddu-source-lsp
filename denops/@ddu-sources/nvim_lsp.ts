import {
  BaseSource,
  Context,
  Item,
} from "https://deno.land/x/ddu_vim@v2.8.6/types.ts#^";
import { Denops } from "https://deno.land/x/ddu_vim@v2.8.6/deps.ts#^";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.1/file.ts#^";
import { Location, LocationLink } from "npm:vscode-languageserver-types@3.17.3";

const SUPPORTED_METHODS = {
  ["textDocument/declaration"]: "textDocument/declaration",
  ["textDocument/definition"]: "textDocument/definition",
  ["textDocument/typeDefinition"]: "textDocument/typeDefinition",
  ["textDocument/implementation"]: "textDocument/implementation",
  ["textDocument/references"]: "textDocument/references",
};

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
   * Workaround. https://github.com/denoland/deno/issues/19304
   * filter deno virtual buffers with udd fragments
   * #(^|~|<|=)
   */
  return /^deno:.*%23(%5E|%7E|%3C|%3D)/.test(uri);
}

type Params = {
  method: string;
  autoJump: boolean;
};

type Response = {
  clientId: number;
  result: unknown;
}[];

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
    context: Context;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams: { method, autoJump }, context } = args;
    const { definitionHandler, referencesHandler } = this;

    return new ReadableStream({
      async start(controller) {
        if (!Object.values(SUPPORTED_METHODS).includes(method)) {
          console.log(`Unsupported method: ${method}`);
          controller.close();
          return;
        }

        const response = await denops.eval(
          `luaeval("require'ddu_nvim_lsp'['${method}'](${context.bufNr}, ${context.winId})")`,
        ) as Response | null;

        if (response === null) {
          controller.close();
          return;
        }

        switch (method) {
          case SUPPORTED_METHODS["textDocument/declaration"]:
          case SUPPORTED_METHODS["textDocument/definition"]:
          case SUPPORTED_METHODS["textDocument/typeDefinition"]:
          case SUPPORTED_METHODS["textDocument/implementation"]: {
            const items = await definitionHandler(denops, response, autoJump);
            if (items) {
              controller.enqueue(items);
            }
            break;
          }
          case SUPPORTED_METHODS["textDocument/references"]: {
            const items = referencesHandler(response);
            controller.enqueue(items);
            break;
          }
        }

        controller.close();
      },
    });
  }

  async definitionHandler(
    denops: Denops,
    response: Response,
    autoJump: boolean,
  ): Promise<Item<ActionData>[] | undefined> {
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
        if (autoJump) {
          locationClientIdPairs.push({ location, clientId });
        }
        return location;
      });
    }).filter((location) => {
      return !isDenoUriWithFragment(location);
    });

    if (autoJump && locations.length === 1) {
      // Jump directly when there is only one candidate.
      const pair = locationClientIdPairs
        .find(({ location }) => locations[0] === location);
      const clientId = pair?.clientId as number;
      await denops.eval(
        `luaeval("require'ddu_nvim_lsp'.jump(_A.location, _A.clientId)", l:)`,
        { location: locations[0], clientId },
      );
    } else {
      return locations.map(locationToItem);
    }
  }

  referencesHandler(
    response: Response,
  ): Item<ActionData>[] {
    return response.flatMap(({ result }) => {
      /**
       * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_references
       */
      const locations = result as Location[];
      return locations;
    }).filter((location) => !isDenoUriWithFragment(location)).map(
      locationToItem,
    );
  }

  params(): Params {
    return {
      method: "",
      autoJump: false,
    };
  }
}
