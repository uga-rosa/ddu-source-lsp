import {
  deadline,
  DeadlineError,
  deferred,
  Denops,
  ensure,
  is,
  register,
  unregister,
} from "./deps.ts";
import { Client } from "./client.ts";

export const SUPPORTED_METHOD = [
  "textDocument/declaration",
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/documentSymbol",
  "workspace/symbol",
  "workspaceSymbol/resolve",
  "textDocument/prepareCallHierarchy",
  "callHierarchy/incomingCalls",
  "callHierarchy/outgoingCalls",
  "textDocument/prepareTypeHierarchy",
  "typeHierarchy/supertypes",
  "typeHierarchy/subtypes",
  "textDocument/codeAction",
  "codeAction/resolve",
  "workspace/executeCommand",
  "deno/virtualTextDocument",
] as const satisfies readonly string[];

export type Method = typeof SUPPORTED_METHOD[number];

export function isMethod(
  method: string,
): method is Method {
  return SUPPORTED_METHOD.some((m) => method === m);
}

export type LspResult = unknown;

export async function lspRequest(
  denops: Denops,
  client: Client,
  method: Method,
  params: unknown,
  bufNr: number,
): Promise<LspResult> {
  if (client.name === "nvim-lsp") {
    return await nvimLspRequest(denops, client, method, params, bufNr);
  } else if (client.name === "coc.nvim") {
    return await cocRequest(denops, client, method, params);
  } else if (client.name === "vim-lsp") {
    return await vimLspRequest(denops, client, method, params);
  } else if (client.name === "lspoints") {
    return await lspointsRequest(denops, client, method, params);
  } else {
    client.name satisfies never;
    throw new Error(`Unknown clientName: ${client.name}`);
  }
}

async function nvimLspRequest(
  denops: Denops,
  client: Client,
  method: Method,
  params: unknown,
  bufNr: number,
): Promise<LspResult> {
  return await denops.call(
    `luaeval`,
    `require('ddu_nvim_lsp').request(_A[1], _A[2], _A[3], _A[4])`,
    [client.id, method, params, bufNr],
  ) as LspResult;
}

async function cocRequest(
  denops: Denops,
  client: Client,
  method: Method,
  params: unknown,
): Promise<LspResult> {
  try {
    return await denops.call("CocRequest", client.id, method, params);
  } catch {
    throw new Error(`Timeouted or unsupprted method: ${method}`);
  }
}

async function vimLspRequest(
  denops: Denops,
  client: Client,
  method: Method,
  params: unknown,
): Promise<LspResult> {
  /**
   * Original code is https://github.com/Milly/ddu-source-vimlsp
   * Copyright (c) 2023 Milly
   */
  const data = deferred<unknown>();
  const id = register(denops, (response: unknown) => data.resolve(response));
  try {
    await denops.eval(
      `lsp#send_request(l:server, extend(l:request,` +
        `{'on_notification': {data -> denops#notify(l:name, l:id, [data])}}))`,
      { server: client.id, request: { method, params }, name: denops.name, id },
    );
    const resolvedData = await deadline(data, 5_000);
    const { response } = ensure(resolvedData, is.Record);
    const { result } = ensure(response, is.Record);
    return result;
  } catch (e) {
    if (e instanceof DeadlineError) {
      throw new Error(`No response from server ${client.id}`);
    } else {
      throw new Error(`Unsupprted method: ${method}`);
    }
  } finally {
    unregister(denops, id);
  }
}

async function lspointsRequest(
  denops: Denops,
  client: Client,
  method: Method,
  params: unknown,
): Promise<LspResult> {
  return await denops.dispatch("lspoints", "request", client.id, method, params);
}
