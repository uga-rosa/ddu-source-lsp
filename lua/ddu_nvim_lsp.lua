local M = {}

---@class Client
---@field name "nvim-lsp"
---@field id number
---@field offsetEncoding "utf-8" | "utf-16" | "utf-32"

---@param bufNr integer
---@return Client[]
function M.get_client_by_bufnr(bufNr)
  ---@diagnostic disable-next-line: deprecated
  local get_clients = vim.lsp.get_clients or vim.lsp.get_active_clients
  local clients = get_clients({ bufnr = bufNr })
  return vim.tbl_map(function(client)
    return {
      name = "nvim-lsp",
      id = client.id,
      offsetEncoding = client.offset_encoding,
    }
  end, clients)
end

---@param clientId number
---@param method string
---@param params table
---@param bufNr number
---@return unknown? result
function M.request(clientId, method, params, bufNr)
  local client = vim.lsp.get_client_by_id(clientId)
  if not client then
    return
  end
  if not client.supports_method(method) then
    return
  end
  local response = client.request_sync(method, params, 5000, bufNr)

  if response and response.result then
    return response.result
  end
end

return M
