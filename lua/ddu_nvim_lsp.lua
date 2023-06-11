local M = {}

---@param bufNr integer
---@return {id: integer, encoding: string}[]
function M.get_client_by_bufnr(bufNr)
  local clients = vim.lsp.get_active_clients({ bufnr = bufNr })
  return vim.tbl_map(function(client)
    return {
      name = "nvim-lsp",
      id = client.id,
      encoding = client.offset_encoding,
    }
  end, clients)
end

---@param clientId integer
---@param method string
---@param params table
---@param bufNr integer
---@return unknown? result
function M.request(clientId, method, params, bufNr)
  local client = vim.lsp.get_client_by_id(clientId)
  local response = client.request_sync(method, params, 5000, bufNr)

  if response and response.result then
    return response.result
  end
end

return M
