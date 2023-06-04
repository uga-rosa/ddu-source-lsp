function! ddu#source#lsp#error(msg) abort
  redraw
  echohl Error
  echomsg a:msg
  echohl None
endfunction
