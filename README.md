# ddu-source-lsp

Ddu source for lsp.

Supported lsp clients are:
- nvim-lsp (neovim's built-in client)
- coc.nvim (https://github.com/neoclide/coc.nvim)
- vim-lsp (https://github.com/prabirshrestha/vim-lsp)

Supported methods are:
- textDocument/declaration
- textDocument/definition
- textDocument/typeDefinition
- textDocument/implementation
- textDocument/references
- textDocument/documentSymbol
- workspace/symbol
- callHierarchy/incomingCalls
- callHierarchy/outgoingCalls

See [doc](./doc/ddu-source-lsp.txt) for details.

# ddu-source-lsp_diagnostic

Ddu source for diagnostic.

Supported lsp clients are:
- nvim-lsp (neovim's diagnostic framework)
- coc.nvim (https://github.com/neoclide/coc.nvim)
- vim-lsp (https://github.com/prabirshrestha/vim-lsp)

See [doc](./doc/ddu-source-lsp_diagnostic.txt) for details.
