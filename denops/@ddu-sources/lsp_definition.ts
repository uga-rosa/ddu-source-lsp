import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { Location, LocationLink } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { isFeatureSupported, lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName, isClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams } from "../ddu_source_lsp/params.ts";
import { locationToItem } from "../ddu_source_lsp/util.ts";
import { isDenoUriWithFragment } from "../ddu_source_lsp/deno.ts";

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
  kind = "file";

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
        if (!isClientName(clientName)) {
          console.log(`Unknown client name: ${clientName}`);
          controller.close();
          return;
        }

        const isSupported = await isFeatureSupported(denops, ctx.bufNr, clientName, method);
        if (!isSupported) {
          if (isSupported === false) {
            console.log(`${method} is not supported by any of the servers`);
          } else {
            console.log("No server attached");
          }
          controller.close();
          return;
        }

        const params = await makePositionParams(denops, ctx.bufNr, ctx.winId);

        const response = await lspRequest(denops, ctx.bufNr, clientName, method, params);
        if (response) {
          const items = definitionsToItems(response);
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
  response: Results,
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
