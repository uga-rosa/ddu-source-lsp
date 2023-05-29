---@enum Methods
local SUPPORTED_METHODS = {
  ["textDocument/declaration"] = "textDocument/declaration",
  ["textDocument/definition"] = "textDocument/definition",
  ["textDocument/typeDefinition"] = "textDocument/typeDefinition",
  ["textDocument/implementation"] = "textDocument/implementation",
  ["textDocument/references"] = "textDocument/references",
}

local M = {}

---@param method Methods
---@param bufNr integer
---@param winId integer
---@return table|nil
function M.request(method, bufNr, winId)
  local params
  if
    vim.tbl_contains({
      SUPPORTED_METHODS["textDocument/declaration"],
      SUPPORTED_METHODS["textDocument/definition"],
      SUPPORTED_METHODS["textDocument/typeDefinition"],
      SUPPORTED_METHODS["textDocument/implementation"],
    }, method)
  then
    params = vim.lsp.util.make_position_params(winId)
  elseif method == SUPPORTED_METHODS["textDocument/references"] then
    params = vim.lsp.util.make_position_params(winId)
    params.context = {
      includeDeclaration = true,
    }
  end

  local response = vim.lsp.buf_request_sync(bufNr, method, params)
  if not response then
    return
  end

  local results = {}
  for client_id, responseMessage in pairs(response) do
    -- https://microsoft.github.io/language-server-protocol/specifications/specification-current/#responseMessage
    local error, result = responseMessage.error, responseMessage.result

    if error == nil and result then
      table.insert(results, {
        clientId = client_id,
        result = result,
      })
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

function M.jump(location, client_id)
  local client = vim.lsp.get_client_by_id(client_id)
  vim.lsp.util.jump_to_location(location, client.offset_encoding)
end

return M
