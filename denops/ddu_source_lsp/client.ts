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
