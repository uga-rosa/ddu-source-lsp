export const CLIENT_NAME = {
  "nvim-lsp": "nvim-lsp",
  "coc.nvim": "coc.nvim",
  "vim-lsp": "vim-lsp",
} as const satisfies Record<string, string>;

export type ClientName = typeof CLIENT_NAME[keyof typeof CLIENT_NAME];

export function isClientName(clientName: string): clientName is ClientName {
  return Object.values(CLIENT_NAME).some((name) => clientName === name);
}
