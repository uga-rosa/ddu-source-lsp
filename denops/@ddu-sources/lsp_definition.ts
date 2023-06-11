import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Location, LocationLink } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams } from "../ddu_source_lsp/params.ts";
import { locationToItem } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

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
        const results = await lspRequest(
          clientName,
          denops,
          ctx.bufNr,
          method,
          await makePositionParams(denops, ctx.bufNr, ctx.winId),
        );
        if (results) {
          const items = definitionsToItems(results, clientName, ctx.bufNr, method);
          controller.enqueue(items);
        }
        controller.close();
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
  clientName: ClientName,
  bufNr: number,
  method: Method,
): Item<ActionData>[] {
  return results.flatMap(({ result, clientId }) => {
    /**
     * References:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_declaration
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_definition
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_typeDefinition
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_implementation
     */
    const locations = result as Location | Location[] | LocationLink[];

    const context = { clientName, bufNr, method, clientId };
    if (Array.isArray(locations)) {
      return locations.map((location) => locationToItem(location, context));
    } else {
      return [locationToItem(locations, context)];
    }
  }).filter(isValidItem);
}
