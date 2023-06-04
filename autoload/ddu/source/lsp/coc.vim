function! ddu#source#lsp#coc#request(bufNr, method, params) abort
  if !s:coc_active()
    call ddu#source#lsp#error('Coc.nvim is disabled or not installed.')
    return
  endif
  let client_ids = s:get_active_client_ids(a:bufNr)
  if empty(client_ids)
    call ddu#source#lsp#error('No LS attached to buffer ' . a:bufNr)
    return
  endif
  return client_ids->map({_, id -> CocRequest(id, a:method, a:params)})
        \ ->filter({_, result -> type(result) != type(v:null)})
endfunction

function! s:coc_active() abort
  return get(g:, 'coc_enabled', 0) == 1
endfunction

function! s:get_active_client_ids(bufNr) abort
  let services = CocAction('services')
  let ft = getbufvar(a:bufNr, '&filetype')
  return services->filter({_, service -> service.state ==# 'running'})
        \ ->filter({_, service -> service.languageIds->index(ft) != -1})
        \ ->map({_, service->service.id})
endfunction

function! ddu#source#lsp#coc#diagnostics() abort
  return CocAction('diagnosticList')
endfunction
