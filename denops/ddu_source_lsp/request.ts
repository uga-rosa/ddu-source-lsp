import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { register, unregister } from "https://deno.land/x/denops_std@v5.0.0/lambda/mod.ts";
import { deferred } from "https://deno.land/std@0.190.0/async/deferred.ts";
import { ensureObject } from "https://deno.land/x/unknownutil@v2.1.1/ensure.ts";

import { CLIENT_NAME, ClientName } from "./client.ts";

export const SUPPORTED_METHOD = {
  "textDocument/declaration": "textDocument/declaration",
  "textDocument/definition": "textDocument/definition",
  "textDocument/typeDefinition": "textDocument/typeDefinition",
  "textDocument/implementation": "textDocument/implementation",
  "textDocument/references": "textDocument/references",
  "textDocument/documentSymbol": "textDocument/documentSymbol",
  "workspace/symbol": "workspace/symbol",
  "workspaceSymbol/resolve": "workspaceSymbol/resolve",
  "textDocument/prepareCallHierarchy": "textDocument/prepareCallHierarchy",
  "callHierarchy/incomingCalls": "callHierarchy/incomingCalls",
  "callHierarchy/outgoingCalls": "callHierarchy/outgoingCalls",
} as const satisfies Record<string, string>;

export type Method = typeof SUPPORTED_METHOD[keyof typeof SUPPORTED_METHOD];

export function isMethod(
  method: string,
): method is Method {
  return Object.values(SUPPORTED_METHOD).some((m) => method === m);
}

export async function isFeatureSupported(
  denops: Denops,
  bufNr: number,
  clientName: ClientName,
  method: Method,
): Promise<boolean | null> {
  switch (clientName) {
    case CLIENT_NAME["nvim-lsp"]: {
      return await denops.call(
        `luaeval`,
        `require('ddu_nvim_lsp').is_feature_supported(_A[1], _A[2])`,
        [bufNr, method],
      ) as boolean | null;
    }
    case CLIENT_NAME["coc.nvim"]: {
      // TODO
      return true;
    }
    case CLIENT_NAME["vim-lsp"]: {
      return await denops.call(
        `ddu#source#lsp#vimlsp#is_feature_supported`,
        bufNr,
        method,
      ) as boolean | null;
    }
    default: {
      clientName satisfies never;
      return null;
    }
  }
}

/** Array of results per client */
export type Results = unknown[];

export async function lspRequest(
  denops: Denops,
  bufNr: number,
  clientName: ClientName,
  method: Method,
  params: unknown,
): Promise<Results | null> {
  switch (clientName) {
    case CLIENT_NAME["nvim-lsp"]: {
      return await denops.call(
        `luaeval`,
        `require('ddu_nvim_lsp').request(_A[1], _A[2], _A[3])`,
        [bufNr, method, params],
      ) as Results | null;
    }
    case CLIENT_NAME["coc.nvim"]: {
      return await denops.call(
        `ddu#source#lsp#coc#request`,
        bufNr,
        method,
        params,
      ) as Results | null;
    }
    case CLIENT_NAME["vim-lsp"]: {
      const servers = await denops.call(
        `ddu#source#lsp#vimlsp#servers`,
        bufNr,
        method,
      ) as string[];
      const results = await Promise.all(servers.map(async (server) => {
        const data = deferred<unknown>();
        const id = register(denops, (response: unknown) => data.resolve(response));
        try {
          await denops.eval(
            `lsp#send_request(l:server, extend(l:request,` +
              `{'on_notification': {data -> denops#notify(l:name, l:id, [data])}}))`,
            { server, request: { method, params }, name: denops.name, id },
          );
          const resolvedData = await data;
          const { response } = ensureObject(resolvedData);
          const { result } = ensureObject(response);
          return result;
        } finally {
          unregister(denops, id);
        }
      }));
      return results.filter((res) => res != null);
    }
    default:
      clientName satisfies never;
      return null;
  }
}
