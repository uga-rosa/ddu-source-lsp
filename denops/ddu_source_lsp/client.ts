import { Denops, op } from "./deps.ts";
import { OffsetEncoding } from "./offset_encoding.ts";

export const CLIENT_NAME = [
  "nvim-lsp",
  "coc.nvim",
  "vim-lsp",
] as const satisfies readonly string[];

export type ClientName = typeof CLIENT_NAME[number];

export function assertClientName(
  clientName: string,
): asserts clientName is ClientName {
  if (!CLIENT_NAME.some((name) => clientName === name)) {
    throw new Error(`Unknown client name: ${clientName}`);
  }
}

export type Client = {
  name: ClientName;
  id?: number | string;
  offsetEncoding?: OffsetEncoding;
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
    throw new Error(`Unknown client name: ${clientName}`);
  }
}

async function nvimLspClients(
  denops: Denops,
  bufNr: number,
): Promise<Client[]> {
  if (denops.meta.host === "vim") {
    throw new Error("Client 'nvim-lsp' is not available in vim");
  }
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
  const filetype = await op.filetype.getBuffer(denops, bufNr);
  const activeIds = services
    .filter((service) => service.state === "running" && service.languageIds.includes(filetype))
    .map((service) => service.id);
  return activeIds.map((id) => ({
    name: "coc.nvim",
    id,
  }));
}

async function vimLspClients(
  denops: Denops,
  bufNr: number,
): Promise<Client[]> {
  const servers = await denops.call(
    `lsp#get_allowed_servers`,
    bufNr,
  ) as string[];
  return servers.map((server) => ({
    name: "vim-lsp",
    id: server,
  }));
}
