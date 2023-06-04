local M = {}

---@param bufNr integer
---@param method string
---@param params table
---@return table|nil
function M.request(bufNr, method, params)
  local response = vim.lsp.buf_request_sync(bufNr, method, params)
  if not response then
    return
  end

  local results = {}
  for client_id, responseMessage in pairs(response) do
    -- https://microsoft.github.io/language-server-protocol/specifications/specification-current/#responseMessage
    local error, result = responseMessage.error, responseMessage.result

    if error == nil and result then
      table.insert(results, result)
    end

    local client = vim.lsp.get_client_by_id(client_id)
    if client.handlers[method] then
      -- Temporarily disable vim.lsp.handlers since they are called in client.handlers.
      local tmp = vim.lsp.handlers[method]
      vim.lsp.handlers[method] = function() end

      client.handlers[method](error, result, {
        method = method,
        client_id = client_id,
        bufnr = bufNr,
        params = params,
      })

      vim.lsp.handlers[method] = tmp
    end
  end
  return results
end

local ProviderMap = {
  ["textDocument/declaration"] = "declarationProvider",
  ["textDocument/definition"] = "definitionProvider",
  ["textDocument/typeDefinition"] = "typeDefinitionProvider",
  ["textDocument/implementation"] = "implementationProvider",
  ["textDocument/references"] = "referencesProvider",
  ["textDocument/documentSymbol"] = "documentSymbolProvider",
  ["workspace/symbol"] = "workspaceSymbolProvider",
  ["callHierarchy/incomingCalls"] = "callHierarchyProvider",
  ["callHierarchy/outgoingCalls"] = "callHierarchyProvider",
}

--- true/false as is, supported or not
--- Return nil if no language server is attached in the buffer.
---@param bufnr integer
---@param method string
---@return boolean?
function M.is_feature_supported(bufnr, method)
  local provider = ProviderMap[method]
  local clients = vim.lsp.get_active_clients({ bufnr = bufnr })
  if #clients == 0 then
    return
  end
  for _, client in ipairs(clients) do
    if client.server_capabilities[provider] then
      return true
    end
  end
  return false
end

---@param bufNr integer
---@return table
function M.get_diagnostic(bufNr)
  return vim.diagnostic.get(bufNr)
end

return M
