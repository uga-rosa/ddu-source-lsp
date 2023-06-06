import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Location, LocationLink } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams } from "../ddu_source_lsp/params.ts";
import { locationToItem } from "../ddu_source_lsp/util.ts";
import { handler } from "../ddu_source_lsp/handler.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";

type Params = {
  clientName: ClientName;
  method: Extract<
    Method,
    | "textDocument/definition"
    | "textDocument/declaration"
    | "textDocument/typeDefinition"
    | "textDocument/implementation"
  >;
};

export class Source extends BaseSource<Params> {
  kind = "lsp";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
    context: Context;
    input: string;
    parent?: DduItem;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams, context: ctx } = args;
    const { clientName, method } = sourceParams;

    return new ReadableStream({
      async start(controller) {
        const params = await makePositionParams(denops, ctx.bufNr, ctx.winId);
        handler(
          async () => {
            const results = await lspRequest(denops, ctx.bufNr, clientName, method, params);
            if (results) {
              return definitionsToItems(results);
            }
          },
          controller,
          ctx.bufNr,
          clientName,
          method,
          params,
        );
      },
    });
  }

  params(): Params {
    return {
      clientName: "nvim-lsp",
      method: "textDocument/definition",
    };
  }
}

export function definitionsToItems(
  results: Results,
) {
  return results.flatMap((result) => {
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
  }).map(locationToItem);
}

export function toLocation(loc: Location | LocationLink): Location {
  if ("uri" in loc && "range" in loc) {
    return loc;
  } else {
    return {
      uri: loc.targetUri,
      range: loc.targetSelectionRange,
    };
  }
}
