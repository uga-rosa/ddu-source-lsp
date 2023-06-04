function! ddu#source#lsp#vimlsp#servers(bufNr, method) abort
  return lsp#get_allowed_servers(a:bufNr)
        \ ->filter({-> s:is_feature_supported(v:val, a:method)})
endfunction

" v:true/v:false as is, supported or not
" Return v:null if no language server is attached in the buffer.
function! ddu#source#lsp#vimlsp#is_feature_supported(bufNr, method) abort
  let servers = lsp#get_allowed_servers(a:bufNr)
  if len(servers) == 0
    return v:null
  endif
  for server in servers
    if s:is_feature_supported(server, a:method)
      return v:true
    endif
  endfor
  return v:false
endfunction

function! s:is_feature_supported(server, method) abort
  let server_capabilities = lsp#get_server_capabilities(a:server)
  let provider = get(s:provider_map, a:method, '')
  return !!get(server_capabilities, provider,
        \ a:method =~# 'deno/' && a:server ==# 'deno' ? 1 : 0)
endfunction

let s:provider_map = {
      \ "textDocument/declaration": "declarationProvider",
      \ "textDocument/definition": "definitionProvider",
      \ "textDocument/typeDefinition": "typeDefinitionProvider",
      \ "textDocument/implementation": "implementationProvider",
      \ "textDocument/references": "referencesProvider",
      \ "textDocument/documentSymbol": "documentSymbolProvider",
      \ "workspace/symbol": "workspaceSymbolProvider",
      \ "callHierarchy/incomingCalls": "callHierarchyProvider",
      \ "callHierarchy/outgoingCalls": "callHierarchyProvider",
      \}

function! ddu#source#lsp#vimlsp#diagnostics(uri) abort
  if !empty(a:uri)
    " callers should always treat the return value as immutable
    " @return {
    "   'servername': response
    " }
    return lsp#internal#diagnostics#state#_get_all_diagnostics_grouped_by_server_for_uri(a:uri)
          \ ->values()
          \ ->map({-> v:val.params})
  else
    " callers should always treat the return value as immutable.
    " callers should treat uri as normalized via lsp#utils#normalize_uri
    " @return {
    "   'normalized_uri': {
    "       'servername': response
    "   }
    " }
    return lsp#internal#diagnostics#state#_get_all_diagnostics_grouped_by_uri_and_server()
          \ ->values()
          \ ->map({-> v:val->values()})
          \ ->flatten(1)
          \ ->map({-> v:val.params})
  endif
endfunction
