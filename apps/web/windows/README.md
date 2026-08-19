# POS no Windows

1. Abre o endereço HTTPS do POS no Edge e escolhe **Aplicações → Instalar HAWSMASH POS**.
2. Vincula o dispositivo à loja certa e confirma que o cardápio aparece.
3. Numa consola PowerShell do utilizador do balcão, executa:

   ```powershell
   .\install-pos-kiosk.ps1 -PosUrl 'https://staging.hawsmash.com/pos'
   ```

O instalador cria uma tarefa no início de sessão do utilizador actual. O Edge abre em ecrã inteiro e reinicia se
encerrar. Na loja, troca o URL de staging pelo URL live apenas depois do ensaio da F9.

Para remover o arranque automático, executa `uninstall-pos-kiosk.ps1`. A instalação da PWA no Edge pode depois
ser removida em `edge://apps`.
