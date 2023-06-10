local M = {}

---@param bufNr integer
---@param method string
---@param params table
---@return table [ok, results]
---    - ok (boolean|nil): In the case of nil, no server is attached.
---    - results (unknown[]): The results per client.
function M.request(bufNr, method, params)
  local clients = vim.lsp.get_active_clients({ bufnr = bufNr })
  if #clients == 0 then
    return { nil }
  end

  local ok, response = pcall(vim.lsp.buf_request_sync, bufNr, method, params)
  if not ok then
    return { false }
  end

  local results = {}
  for _, responseMessage in pairs(response) do
    -- https://microsoft.github.io/language-server-protocol/specifications/specification-current/#responseMessage
    local error, result = responseMessage.error, responseMessage.result

    if error == nil and result then
      table.insert(results, result)
    end
  end
  return { true, results }
end

---@param name string
---@return integer|nil
function M.get_client_id_by_name(name)
  for _, client in ipairs(vim.lsp.get_active_clients({ name = name })) do
    return client.id
  end
end

return M
