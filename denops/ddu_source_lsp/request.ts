import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { register, unregister } from "https://deno.land/x/denops_std@v5.0.0/lambda/mod.ts";
import { deferred } from "https://deno.land/std@0.190.0/async/deferred.ts";
import { deadline } from "https://deno.land/std@0.190.0/async/deadline.ts";
import { ensureObject } from "https://deno.land/x/unknownutil@v2.1.1/ensure.ts";

import { ClientId, ClientName } from "./client.ts";
import { asyncFlatMap } from "./util.ts";

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
  "deno/virtualTextDocument",
] as const satisfies readonly string[];

export type Method = typeof SUPPORTED_METHOD[number];

export function isMethod(
  method: string,
): method is Method {
  return SUPPORTED_METHOD.some((m) => method === m);
}

/** Results per client */
export type Results = { result: unknown; clientId: ClientId }[];

export async function lspRequest(
  clientName: ClientName,
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
  clientId?: ClientId,
): Promise<Results | undefined> {
  switch (clientName) {
    case "nvim-lsp":
      return await nvimLspRequest(denops, bufNr, method, params, clientId);
    case "coc.nvim":
      return await cocRequest(denops, bufNr, method, params, clientId);
    case "vim-lsp":
      return await vimLspRequest(denops, bufNr, method, params, clientId);
    default:
      clientName satisfies never;
  }
  return null;
}

async function nvimLspRequest(
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
  clientId?: ClientId,
): Promise<Results | undefined> {
  const [ok, results] = await denops.call(
    `luaeval`,
    `require('ddu_nvim_lsp').request(_A[1], _A[2], _A[3], _A[4])`,
    [bufNr, method, params, clientId ?? 0],
  ) as [boolean | null, Results];
  if (!ok) {
    console.log(ok === null ? "No server attached" : `${method} is not supported by any of the servers`);
    return;
  }
  return results;
}

type CocService = {
  id: string;
  state: string;
  languageIds: string[];
};

async function cocRequest(
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
  clientId?: ClientId,
): Promise<Results | undefined> {
  const services = await denops.call("CocAction", "services") as CocService[];
  const filetype = await fn.getbufvar(denops, bufNr, "&filetype") as string;
  const activeServiceIds = services
    .filter((service) => service.state === "running" && service.languageIds.includes(filetype))
    .filter((service) => clientId === undefined || service.id === clientId)
    .map((service) => service.id);

  if (activeServiceIds.length === 0) {
    console.log("No server attached");
    return;
  }

  let errorCount = 0;
  const results = await asyncFlatMap(activeServiceIds, async (clientId) => {
    try {
      const result = await denops.call("CocRequest", clientId, method, params);
      return result ? [{ result, clientId }] : [];
    } catch {
      errorCount++;
    }
    return [];
  });
  if (errorCount === activeServiceIds.length) {
    console.log(`${method} is not supported by any of the servers`);
    return;
  }

  return results;
}

async function vimLspRequest(
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
  clientId?: ClientId,
): Promise<Results | undefined> {
  const allowedServers = await denops.call(
    `lsp#get_allowed_servers`,
    bufNr,
  ) as string[];
  const servers = allowedServers.filter((server) => clientId === undefined || server === clientId);
  if (servers.length === 0) {
    console.log("No server attached");
    return;
  }

  let errorCount = 0;
  const results: Results = await asyncFlatMap(servers, async (server) => {
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
        { server, request: { method, params }, name: denops.name, id },
      );
      const resolvedData = await deadline(data, 10_000);
      const { response } = ensureObject(resolvedData);
      const { result, error } = ensureObject(response);
      if (result) {
        return [{ result, clientId: server }];
      } else if (error) {
        errorCount++;
      }
    } catch {
      console.log(`No response from server ${server}`);
    } finally {
      unregister(denops, id);
    }
    return [];
  });
  if (errorCount === servers.length) {
    console.log(`${method} is not supported by any of the servers`);
    return;
  }

  return results;
}
