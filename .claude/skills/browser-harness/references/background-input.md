# Clique em aba de fundo (Chrome local)

Quando o Chrome já está aberto e `Input.dispatchMouseEvent` chega ao elemento certo mas não muda o estado do app, habilite foco **emulado** no alvo antes do clique:

```python
cdp('Emulation.setFocusEmulationEnabled', enabled=True)
cdp('Input.dispatchMouseEvent', type='mouseMoved', x=x, y=y)
click_at_xy(x, y)
```

Isso permite o processamento do evento na aba de fundo sem trazer janela à frente. Não use `activate_tab`, `Target.activateTarget`, AppleScript `activate` nem abra janela para resolver input ignorado.

Confirme o evento e o estado real: bounding box/`elementFromPoint`, `pointerdown` confiável, URL/DOM após o clique e recarga. Espere uma condição verificável antes de recarregar; `wait_for_load()` sozinho não aguarda uma mudança de estado do React.

Se o conector integrado recusar perfil real porque o navegador padrão não é Chromium, isso não prova que o Chrome/Flow esteja indisponível. Avise a falha e confira o CLI **do mesmo browser-harness** conectado ao Chrome existente. Antes de `open_in_profile(url, 'flow')`, confirme pelo mapa de contextos e `Target.getTargets` que Flow já está aberto, evitando o fallback que abriria janela. Não mude navegador padrão, perfil ou preferências do usuário.
