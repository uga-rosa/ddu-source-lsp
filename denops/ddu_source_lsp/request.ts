import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";

import { ClientName, CLIENT_NAME } from "./client.ts";

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
      return true;
    }
    default: {
      clientName satisfies never;
      return null;
    }
  }
}

/** Array of results per client */
export type Response = unknown[];

export async function lspRequest(
  denops: Denops,
  bufNr: number,
  clientName: ClientName,
  method: Method,
  params: unknown,
): Promise<Response | null> {
  switch (clientName) {
    case "nvim-lsp": {
      return await denops.call(
        `luaeval`,
        `require('ddu_nvim_lsp').request(_A[1], _A[2], _A[3])`,
        [bufNr, method, params],
      ) as Response | null;
    }
    case "coc.nvim": {
      return await denops.call(
        `ddu#source#lsp#coc#request`,
        bufNr,
        method,
        params,
      ) as Response | null;
    }
    default:
      clientName satisfies never;
      return null;
  }
}
