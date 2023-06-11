import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";

import { Encoding } from "./params.ts";

export const CLIENT_NAME = [
  "nvim-lsp",
  "coc.nvim",
  "vim-lsp",
] as const satisfies readonly string[];

export type ClientName = typeof CLIENT_NAME[number];

export function isClientName(clientName: string): clientName is ClientName {
  return CLIENT_NAME.some((name) => clientName === name);
}

export type ClientId = number | string;

export type Client = {
  name: ClientName;
  id: ClientId;
  encoding?: Encoding;
};

export async function getClients(
  denops: Denops,
  clientName: ClientName,
  bufNr: number,
): Promise<Client[]> {
  if (clientName === "nvim-lsp") {
    return await nvimLspClients(denops, bufNr);
  } else if (clientName === "coc.nvim") {
    return await cocClients(denops, bufNr);
  } else if (clientName === "vim-lsp") {
    return await vimLspClients(denops, bufNr);
  } else {
    clientName satisfies never;
    throw new Error(`Unknown clientName: ${clientName}`);
  }
}

async function nvimLspClients(
  denops: Denops,
  bufNr: number,
): Promise<Client[]> {
  return (await denops.call(
    `luaeval`,
    `require('ddu_nvim_lsp').get_client_by_bufnr(${bufNr})`,
  )) as Client[];
}

type CocService = {
  id: string;
  state: string;
  languageIds: string[];
};

async function cocClients(
  denops: Denops,
  bufNr: number,
): Promise<Client[]> {
  const services = await denops.call("CocAction", "services") as CocService[];
  const filetype = await fn.getbufvar(denops, bufNr, "&filetype") as string;
  const activeIds = services
    .filter((service) => service.state === "running" && service.languageIds.includes(filetype))
    .map((service) => service.id);
  return activeIds.map((id) => {
    return {
      name: "coc.nvim",
      id,
    };
  });
}

async function vimLspClients(
  denops: Denops,
  bufNr: number,
): Promise<Client[]> {
  const servers = await denops.call(
    `lsp#get_allowed_servers`,
    bufNr,
  ) as string[];
  return servers.map((server) => {
    return {
      name: "vim-lsp",
      id: server,
    };
  });
}
