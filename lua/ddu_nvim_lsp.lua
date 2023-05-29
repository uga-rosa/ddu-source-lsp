local M = setmetatable({}, {
  __index = function(_, key)
    local method = key
    return function(bufNr, winId)
      vim.print(method, bufNr, winId)

      local params
      if
        vim.tbl_contains({
          "textDocument/definition",
          "textDocument/declaration",
          "textDocument/typeDefinition",
          "textDocument/implementation",
        }, method)
      then
        params = vim.lsp.util.make_position_params(winId)
      elseif method == "textDocument/references" then
        params = vim.lsp.util.make_position_params(winId)
        params.context = {
          includeDeclaration = true,
        }
      end

      if params then
        local response = vim.lsp.buf_request_sync(bufNr, method, params)
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
    end
  end,
})

function M.jump(location, client_id)
  local client = vim.lsp.get_client_by_id(client_id)
  vim.lsp.util.jump_to_location(location, client.offset_encoding)
end

return M
